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
const { insertOrder } = require('./lib/orders');
const { normalizePhone } = require('./lib/normalize');
const { createTelegramAdapter } = require('./lib/botApi');
const { CARGO_GROUPS } = require('./config/constants');

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
const SESSION_FILE = path.join(__dirname, 'session.txt');
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

function loadSession() {
  if (process.env.TELEGRAM_SESSION?.trim()) {
    return process.env.TELEGRAM_SESSION.trim();
  }
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[session] Could not read session file:', err.message);
  }
  return '';
}

function saveSession(sessionString) {
  if (process.env.TELEGRAM_SESSION) {
    console.log('[session] Yangi session — DigitalOcean da TELEGRAM_SESSION secret ni yangilang');
    return;
  }
  fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
  console.log(`[session] Saved to ${SESSION_FILE}`);
}

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
    console.error('[scraper] Session yo\'q. Serverda TELEGRAM_SESSION env o\'rnating.');
    console.error('[scraper] Lokalda: node scraper.js → login → session.txt dan nusxa oling');
    process.exit(1);
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

async function handleGroupMessage(message, groupLabel) {
  const msgKey = `${groupLabel}:${message.id}`;
  if (processedMsgKeys.has(msgKey)) return;
  processedMsgKeys.add(msgKey);

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

  try {
    const order = await insertOrder({
      ...parsed,
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
      console.error('[scraper] Haydovchiga xabar yuborish xatosi:', notifyErr.message);
    }
  } catch (err) {
    const rls = /row-level security/i.test(err.message);
    console.error(
      '[scraper] Saqlash xatosi:',
      err.message,
      rls ? '→ supabase/policies.sql ni ishga tushiring' : ''
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (CARGO_GROUPS.length === 0) {
    console.error('[scraper] CARGO_GROUPS bo\'sh!');
    console.error('  karvon.env ga qo\'shing: CARGO_GROUPS=@guruh1,@guruh2');
    console.error('  yoki config/constants.js ichiga yozing');
    process.exit(1);
  }

  const sessionString = loadSession();
  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: Infinity,
    retryDelay: 3000,
    autoReconnect: true,
    useWSS: process.env.TELEGRAM_USE_WSS === '1',
    baseLogger: new Logger('error'),
  });

  console.log('[scraper] Telegramga ulanmoqda...');

  await ensureLoggedIn(client);

  const newSession = client.session.save();
  if (newSession && newSession !== sessionString) {
    saveSession(newSession);
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
    console.error('[scraper] Hech qanday guruh ulanmadi. A\'zolik va username/ID ni tekshiring.');
    process.exit(1);
  }

  console.log(`[scraper] ${CARGO_GROUPS.length} ta guruh kuzatilmoqda. Ctrl+C — to'xtatish.`);

  client.addEventHandler(async (event) => {
    try {
      const chatId =
        event.chatId?.toString() ||
        (event.message?.peerId ? utils.getPeerId(event.message.peerId).toString() : null);

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

  // Zaxira poll: har 60 soniyada faqat YANGI xabarlar (token tejash)
  setInterval(async () => {
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

  // Bir martalik backfill (ixtiyoriy: SCRAPER_BACKFILL=1)
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

  setInterval(() => {
    console.log(`[scraper] 📊 Jon: OK | qayta ishlangan: ${liveStats.processed} ta (60 soniya)`);
    liveStats.processed = 0;
    logAiStats();
  }, 60_000);
}

main().catch((err) => {
  console.error('[scraper] Fatal:', err.message);
  process.exit(1);
});

process.once('SIGINT', () => {
  console.log('\n[scraper] To\'xtatildi.');
  process.exit(0);
});
