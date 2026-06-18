require('./config/env');

const fs = require('fs');
const path = require('path');
const input = require('input');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const { TelegramClient, utils } = require('telegram');
const { Logger } = require('telegram/extensions');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');

const { getSupabase } = require('./lib/supabase');
const { parseCargoMessage, logAiStats } = require('./lib/gemini');
const { notifyMatchingDrivers } = require('./lib/notifications');
const { insertOrder, logSupabaseError } = require('./lib/orders');
const { normalizePhone } = require('./lib/normalize');
const { createTelegramAdapter } = require('./lib/botApi');
const { CARGO_GROUPS, getRoyalCargoGroupId } = require('./config/constants');
const { handleRoyalGroupMessageUserbot } = require('./lib/groupSecurity');
const { setActiveClient, clearActiveClient } = require('./lib/userbotClient');

// ─── Validate env ────────────────────────────────────────────────────────────

const required = ['API_ID', 'API_HASH', 'BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env variable: ${key}`);
    process.exit(1);
  }
}

if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
  console.error('Missing AI key: set GEMINI_API_KEY or DEEPSEEK_API_KEY');
  process.exit(1);
}

const API_ID = parseInt(process.env.API_ID, 10);
const API_HASH = process.env.API_HASH;
const QR_FILE = path.join(__dirname, 'karvon-qr.png');

// Telegraf ishlatilmaydi — faqat HTTP API (bot index.js da polling qiladi)
const notifyTelegram = createTelegramAdapter();

// GramJS tarmoq xatolarini yumshoq ko'rsatish (TIMEOUT/ETIMEDOUT — odatda o'zi tiklanadi)
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (/TIMEOUT|Not connected|ETIMEDOUT|ECONNRESET|connection closed/i.test(msg)) {
    console.log('[scraper] ⚠️ Telegram ulanishi vaqtincha uzildi, qayta ulanmoqda...');
    return;
  }
  console.error('[scraper] Unhandled:', msg);
});

const processedMsgKeys = new Set();
const liveStats = { processed: 0 };

// ─── Session ─────────────────────────────────────────────────────────────────

const { loadSession, saveSessionToFile } = require('./lib/session');

async function ensureLoggedIn(client) {
  const apiCredentials = { apiId: API_ID, apiHash: API_HASH };

  const passwordFn = async () => {
    const p = await input.text('2FA parol (yo\'q bo\'lsa Enter): ');
    return p.trim() || undefined;
  };

  const onError = (err) => {
    console.error('[scraper] Auth error:', err.message);
    return false;
  };

  await client.connect();

  if (await client.checkAuthorization()) {
    console.log('[scraper] Oldingi session orqali avtomatik kirildi');
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error('TELEGRAM_SESSION_INVALID');
  }

  console.log('\n[scraper] Telegram akkauntiga kirish kerak');
  console.log('[scraper] Kod kelmayaptimi? → Enter bosing (QR kod usuli)\n');
  const choice = await input.text('Login usuli: [Enter]=QR kod (tavsiya), 2=Telefon raqam: ');

  if (choice.trim() !== '2') {
    console.log('\n[scraper] ═══════════════════════════════════════════════');
    console.log('[scraper] QR KOD ORQALI KIRISH');
    console.log('[scraper] Telefonda: Telegram → Sozlamalar (⚙️) → Qurilmalar');
    console.log('[scraper]   → "Kompyuterni ulash" / "Link Desktop Device"');
    console.log('[scraper]   → pastdagi QR kodni skaner qiling');
    console.log('[scraper] ═══════════════════════════════════════════════\n');

    await client.signInUserWithQrCode(apiCredentials, {
      qrCode: async ({ token }) => {
        const url = `tg://login?token=${token.toString('base64url')}`;

        qrcodeTerminal.generate(url, { small: true });

        try {
          await QRCode.toFile(QR_FILE, url, { width: 400, margin: 2 });
          console.log(`[scraper] QR rasm saqlandi: ${QR_FILE}`);
          console.log('[scraper] Terminalda QR ko\'rinmasa, shu faylni ochib skaner qiling.');
        } catch (e) {
          console.error('[scraper] QR rasm saqlanmadi:', e.message);
        }
        console.log('\n[scraper] Skaner qiling... (QR 30 soniyada yangilanadi, normal holat)\n');
      },
      password: passwordFn,
      onError,
    });
    return;
  }

  const smsChoice = await input.text('Haqiqiy SMS xohlaysizmi? "sms" yozing (yoki Enter): ');
  const forceSMS = smsChoice.trim().toLowerCase() === 'sms';

  await client.start({
    forceSMS,
    phoneNumber: async () => {
      while (true) {
        const raw = await input.text('Telefon raqam (+998901234567 yoki 901234567): ');
        const phone = normalizePhone(raw.trim());
        if (phone) {
          console.log(`[scraper] Raqam: ${phone}`);
          return phone;
        }
        console.error('[scraper] Noto\'g\'ri raqam. Misol: +998901234567');
      }
    },
    password: passwordFn,
    phoneCode: async (isCodeViaApp) => {
      console.log('\n[scraper] ─────────────────────────────────────────');
      if (isCodeViaApp) {
        console.log('[scraper] Kod TELEGRAM ILOVANGIZGA yuborildi (SMS emas!)');
        console.log('[scraper] "Telegram" chatini oching → "Login code: 12345"');
      } else {
        console.log('[scraper] Kod SMS orqali yuborildi — telefon xabarlarini tekshiring');
      }
      console.log('[scraper] ─────────────────────────────────────────\n');
      return await input.text('Kod (5 raqam): ');
    },
    onError,
  });
}

// ─── Group message → DB → haydovchiga push ───────────────────────────────────

function extractMessageText(message) {
  const text = String(message.text || message.message || message.rawText || '').trim();
  return text;
}

function normalizeChatId(id) {
  if (id === null || id === undefined) return null;
  return String(id).replace(/^-100/, '').replace(/^-/, '');
}

function isAllowedChat(chatId, allowedIds) {
  if (!chatId) return false;
  const raw = chatId.toString();
  if (allowedIds.has(raw)) return true;
  const norm = normalizeChatId(raw);
  for (const id of allowedIds) {
    if (normalizeChatId(id) === norm) return true;
  }
  return false;
}

async function extractSenderMeta(message) {
  try {
    const sender = await message.getSender();
    if (!sender || sender.className === 'Channel' || sender.className === 'Chat') {
      return { sender_username: null, sender_telegram_id: null };
    }
    return {
      sender_username: sender.username ? String(sender.username).replace(/^@/, '') : null,
      sender_telegram_id: sender.id ? Number(sender.id) : null,
    };
  } catch (err) {
    console.warn('[scraper] Sender o\'qilmadi:', err.message);
    return { sender_username: null, sender_telegram_id: null };
  }
}

async function handleGroupMessage(message, groupLabel) {
  const msgKey = `${groupLabel}:${message.id}`;
  if (processedMsgKeys.has(msgKey)) return;
  processedMsgKeys.add(msgKey);

  try {
    const sender = await message.getSender();
    if (sender?.bot) return;
  } catch {
    /* ignore */
  }

  const text = extractMessageText(message);
  if (!text) {
    console.log(`[scraper] [${groupLabel}] Matnsiz xabar (rasm/sticker) — o'tkazildi`);
    return;
  }

  const preview = text.replace(/\n/g, ' ').slice(0, 80);
  liveStats.processed++;
  console.log(`[scraper] [${groupLabel}] ${preview}...`);

  let parsed;
  try {
    parsed = await parseCargoMessage(text);
  } catch (err) {
    console.error('[scraper] AI parse error:', err.message);
    return;
  }

  if (!parsed) {
    console.log('[scraper] O\'tkazib yuborildi (spam yoki noto\'g\'ri format)');
    return;
  }

  console.log(
    `[scraper] Aniqlandi: ${parsed.from_region} → ${parsed.to_region}, ` +
      `${parsed.car_type}, ${parsed.phone_number}`
  );

  const sender = await extractSenderMeta(message);

  try {
    const order = await insertOrder({
      ...parsed,
      ...sender,
      source: 'scraper',
      source_group: groupLabel,
      source_message_id: message.id,
      raw_text: text.slice(0, 2000),
    });

    if (!order) return;

    console.log(`[scraper] Bazaga saqlandi: order #${order.id}`);
    try {
      await notifyMatchingDrivers(notifyTelegram, order);
    } catch (notifyErr) {
      console.error('[scraper] Push xatosi:', notifyErr.message);
    }

    await new Promise((r) => setTimeout(r, 400));
  } catch (err) {
    if (err?.message) logSupabaseError('scraper.insertOrder', err);
    const rls = /row-level security/i.test(err?.message || '');
    console.error(
      '[scraper] Saqlash xatosi:',
      err?.message || err,
      rls ? '→ supabase/policies.sql ni ishga tushiring' : ''
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

let activeClient = null;
let loopActive = false;
let firstCloudDelayDone = false;

function stopScraperLoop() {
  loopActive = false;
}

async function disconnectActiveClient() {
  try {
    if (activeClient?.connected) {
      await activeClient.disconnect();
    }
  } catch {
    /* ignore */
  }
  activeClient = null;
  clearActiveClient();
}

function isConfigError(msg) {
  return /TELEGRAM_SESSION_REQUIRED|TELEGRAM_SESSION_INVALID|CARGO_GROUPS_EMPTY/.test(msg);
}

function logConfigHelp(err) {
  const msg = err?.message || '';
  if (msg === 'TELEGRAM_SESSION_REQUIRED') {
    console.error('[scraper] ❌ TELEGRAM_SESSION yo\'q!');
    console.error('[scraper]    DO → App-Level → TELEGRAM_SESSION_B64 (Encrypt, tavsiya)');
    console.error('[scraper]    yoki TELEGRAM_SESSION — session.txt butun qatori');
    console.error('[scraper]    Lokal: node scripts/print-session-for-do.js');
    return;
  }
  if (msg === 'TELEGRAM_SESSION_INVALID') {
    console.error('[scraper] ❌ Session noto\'g\'ri yoki qisqartirilgan!');
    console.error('[scraper]    session.txt = 369 belgi. DO da 260 belgi = noto\'g\'ri format.');
    console.error('[scraper]    TELEGRAM_SESSION_B64 ga session.txt QO\'YMASLIK!');
    console.error('[scraper]    To\'g\'ri: kalit TELEGRAM_SESSION, qiymat session.txt butun qatori');
    console.error('[scraper]    yoki: node scripts/print-session-for-do.js → TELEGRAM_SESSION_B64');
  }
}

function reconnectDelay(err, attempt) {
  const msg = err?.message || '';
  if (isConfigError(msg)) {
    return 1_800_000;
  }
  if (/AUTH_KEY_DUPLICATED/i.test(msg)) {
    return Math.min(120_000 * attempt, 600_000);
  }
  if (/TIMEOUT|ETIMEDOUT|ECONNRESET|Not connected|connection closed/i.test(msg)) {
    return Math.min(30_000 * attempt, 180_000);
  }
  if (/NO_GROUPS_CONNECTED/i.test(msg)) {
    return Math.min(60_000 * attempt, 300_000);
  }
  return Math.min(45_000 * attempt, 300_000);
}

async function shutdownScraper(signal) {
  console.log(`\n[scraper] ${signal} — Telegram ulanishi yopilmoqda...`);
  stopScraperLoop();
  await disconnectActiveClient();
  if (!process.env.KARVON_COMBINED) {
    process.exit(0);
  }
}

if (!process.env.KARVON_COMBINED) {
  process.once('SIGINT', () => shutdownScraper('SIGINT'));
  process.once('SIGTERM', () => shutdownScraper('SIGTERM'));
}

async function watchConnection(client) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!loopActive) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (!client.connected) {
        clearInterval(timer);
        reject(new Error('Telegram disconnected'));
      }
    }, 15_000);
  });
}

async function runScraper() {
  if (process.env.DO_APP_ID && !firstCloudDelayDone) {
    const sec = parseInt(process.env.SCRAPER_START_DELAY_SEC || '20', 10);
    console.log(`[scraper] Cloud: ${sec}s kutilmoqda...`);
    await new Promise((r) => setTimeout(r, sec * 1000));
    firstCloudDelayDone = true;
  }

  if (CARGO_GROUPS.length === 0) {
    throw new Error('CARGO_GROUPS_EMPTY');
  }

  const sessionString = loadSession();
  if (!sessionString && !process.stdin.isTTY) {
    throw new Error('TELEGRAM_SESSION_REQUIRED');
  }

  if (sessionString) {
    console.log(`[scraper] Session yuklandi (${sessionString.length} belgi)`);
  }

  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 10,
    retryDelay: 5000,
    autoReconnect: true,
    useWSS: process.env.TELEGRAM_USE_WSS === '1',
    baseLogger: new Logger('error'),
  });
  activeClient = client;
  setActiveClient(client);

  console.log('[scraper] Telegramga ulanmoqda...');

  try {
    await ensureLoggedIn(client);
  } catch (err) {
    if (/AUTH_KEY_DUPLICATED/i.test(err.message)) {
      throw new Error('AUTH_KEY_DUPLICATED');
    }
    if (/not a valid string/i.test(err.message)) {
      throw new Error('TELEGRAM_SESSION_INVALID');
    }
    throw err;
  }

  const newSession = client.session.save();
  if (newSession && newSession !== sessionString) {
    saveSessionToFile(newSession);
  }

  console.log('[scraper] Login muvaffaqiyatli');

  const allowedIds = new Set();
  const labels = new Map();
  const groupEntities = [];
  const lastSeenId = new Map();

  for (const group of CARGO_GROUPS) {
    allowedIds.add(String(group));
    try {
      const entity = await client.getEntity(group);
      const peerId = utils.getPeerId(entity).toString();
      allowedIds.add(peerId);
      allowedIds.add(normalizeChatId(peerId));
      const label = entity.title || entity.username || group;
      labels.set(peerId, label);
      labels.set(normalizeChatId(peerId), label);
      labels.set(String(group), label);
      groupEntities.push({ entity, label });
      lastSeenId.set(label, 0);
      console.log(`[scraper] Guruh ulandi: ${label} (id: ${peerId})`);
    } catch (err) {
      console.error(`[scraper] Guruh topilmadi: ${group} —`, err.message);
    }
  }

  if (allowedIds.size === 0) {
    throw new Error('NO_GROUPS_CONNECTED');
  }

  console.log(`[scraper] ${CARGO_GROUPS.length} ta guruh kuzatilmoqda.`);
  const royalId = getRoyalCargoGroupId();
  if (royalId) {
    console.log(`[scraper] Rasmiy guruh moderatsiyasi (userbot): ${royalId}`);
    try {
      await client.getEntity(royalId);
      console.log('[scraper] ✓ Rasmiy guruh userbot orqali ulandi');
    } catch (err) {
      console.error(`[scraper] ✗ Rasmiy guruh topilmadi (${royalId}):`, err.message);
      console.error('[scraper]   → Userbot akkaunti guruhga qo\'shilgan va admin bo\'lishi kerak!');
    }
  }

  client.addEventHandler(async (event) => {
    try {
      const chatId =
        event.chatId?.toString() ||
        (event.message?.peerId ? utils.getPeerId(event.message.peerId).toString() : null);

      if (chatId && getRoyalCargoGroupId()) {
        const moderated = await handleRoyalGroupMessageUserbot(
          client,
          event.message,
          notifyTelegram
        );
        if (moderated) return;
      }

      if (!isAllowedChat(chatId, allowedIds)) return;

      const label =
        labels.get(chatId) ||
        labels.get(normalizeChatId(chatId)) ||
        labels.get(chatId?.toString()) ||
        chatId;

      await handleGroupMessage(event.message, label);
    } catch (err) {
      console.error('[scraper] Handler error:', err.message);
    }
  }, new NewMessage({}));

  const pollTimer = setInterval(async () => {
    if (!loopActive || !client.connected) return;
    for (const { entity, label } of groupEntities) {
      try {
        const minId = lastSeenId.get(label) || 0;
        const messages = await client.getMessages(entity, { limit: 3, minId: minId || undefined });
        for (const msg of messages) {
          if (msg.id > minId) lastSeenId.set(label, msg.id);
          if (extractMessageText(msg)) await handleGroupMessage(msg, label);
        }
      } catch (err) {
        console.error(`[scraper] Poll xato (${label}):`, err.message);
      }
    }
  }, 60_000);

  const statsTimer = setInterval(() => {
    if (!loopActive) return;
    const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    console.log(
      `[scraper] 📊 Jon: OK | qayta ishlangan: ${liveStats.processed} ta | RAM: ${rssMb}MB (60 soniya)`
    );
    liveStats.processed = 0;
    logAiStats();
  }, 60_000);

  if (process.env.SCRAPER_BACKFILL === '1') {
    console.log('\n[scraper] Oxirgi 15 ta xabar tekshirilmoqda (SCRAPER_BACKFILL=1)...');
    for (const { entity, label } of groupEntities) {
      try {
        const messages = await client.getMessages(entity, { limit: 15 });
        let n = 0;
        for (const msg of messages) {
          if (extractMessageText(msg)) {
            await handleGroupMessage(msg, label);
            n++;
          }
        }
        console.log(`[scraper] ${label}: ${n} ta xabar tekshirildi`);
      } catch (err) {
        console.error(`[scraper] Backfill xato (${label}):`, err.message);
      }
    }
  }

  console.log('[scraper] Doimiy kuzatuv aktiv (event + 60s poll zaxira)\n');

  try {
    await watchConnection(client);
  } finally {
    clearInterval(pollTimer);
    clearInterval(statsTimer);
  }
}

async function startScraperLoop() {
  loopActive = true;
  let attempt = 0;

  while (loopActive) {
    try {
      await runScraper();
      if (!loopActive) break;
      attempt += 1;
      console.log('[scraper] Ulanish uzildi, qayta ulanmoqda...');
      await disconnectActiveClient();
      await new Promise((r) => setTimeout(r, reconnectDelay(new Error('disconnected'), attempt)));
    } catch (err) {
      if (!loopActive) break;
      attempt += 1;
      const delay = reconnectDelay(err, attempt);
      const isAuthDup = /AUTH_KEY_DUPLICATED/i.test(err.message);

      console.error('[scraper] Xato:', err.message);
      if (isConfigError(err.message)) {
        logConfigHelp(err);
        console.error('[scraper] Konfiguratsiya tuzatilguncha 30 daqiqada bir marta uriniladi...');
      } else if (isAuthDup) {
        console.error('[scraper] ❌ Session boshqa joyda ochiq — lokal scraper to\'xtating, 2 daqiqa kuting');
      }
      console.error(`[scraper] ${Math.round(delay / 1000)}s dan keyin qayta ulanadi (urinish ${attempt})...`);

      await disconnectActiveClient();
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

if (require.main === module) {
  startScraperLoop().catch((err) => {
    console.error('[scraper] Fatal:', err.message);
    process.exit(1);
  });
}

function getActiveClient() {
  const { getActiveClient: getSharedClient } = require('./lib/userbotClient');
  return getSharedClient();
}

module.exports = { startScraperLoop, stopScraperLoop, runScraper, getActiveClient };
