const { utils } = require('telegram');
const { Markup } = require('telegraf');
const { getRoyalCargoGroupId, BOT_PUBLIC_URL, BOT_USERNAME } = require('../config/constants');

const BOT_URL = BOT_PUBLIC_URL;
const BOT_HANDLE = `@${BOT_USERNAME.replace(/^@/, '')}`;
const EDUCATION_TTL_MS = 20_000;
const ADMIN_CACHE_TTL_MS = 60_000;
const EDUCATION_COOLDOWN_MS = 15_000;

const adminCache = new Map();
const educationCooldown = new Map();

const EDUCATION_TEXT =
  `⚠️ Bu guruh faqat rasmiy yuk e'lonlari uchun!\n\n` +
  `E'lon bermoqchi bo'lsangiz, ${BOT_HANDLE} orqali e'lon bering:\n` +
  `1️⃣ ${BOT_HANDLE} → /start\n` +
  `2️⃣ [ 📦 Yuk Joylash ]\n` +
  `3️⃣ Ma'lumotlarni kiriting\n` +
  `4️⃣ [ 🚀 Guruhga Tekin Chiqarish ]\n\n` +
  `Bot yukingizni avtomat joylaydi — TEKIN!`;

const EDUCATION_KEYBOARD = {
  inline_keyboard: [[{ text: '🤖 Botga kirish va E\'lon berish', url: BOT_URL }]],
};

function normalizeChatId(id) {
  return String(id ?? '').trim();
}

function isRoyalGroupChat(chatId) {
  const royal = getRoyalCargoGroupId();
  if (!royal) return false;
  const a = normalizeChatId(chatId);
  const b = normalizeChatId(royal);
  return a === b;
}

function isGroupPermissionError(err) {
  const msg = err?.description || err?.response?.description || err?.message || String(err);
  return /admin_rights_required|not enough rights|message can't be deleted|CHAT_ADMIN_REQUIRED|have rights|need administrator|description can't be empty|CHAT_WRITE_FORBIDDEN/i.test(
    msg
  );
}

function logGroupPermissionWarn(action) {
  console.warn(
    `[group-security] Bot guruhda to'liq admin emas yoki huquqlari yetishmayapti! (${action})`
  );
}

async function safeDeleteMessage(telegram, chatId, messageId) {
  try {
    await telegram.deleteMessage(chatId, messageId);
    return true;
  } catch (err) {
    if (isGroupPermissionError(err)) {
      logGroupPermissionWarn('deleteMessage');
      return false;
    }
    console.warn('[group-security] deleteMessage:', err?.message || err);
    return false;
  }
}

function isChatAdmin(member) {
  if (!member) return false;
  return member.status === 'creator' || member.status === 'administrator';
}

async function checkIsGroupAdmin(telegram, chatId, userId) {
  const key = `${chatId}:${userId}`;
  const cached = adminCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const member = await telegram.getChatMember(chatId, userId);
    const isAdmin = isChatAdmin(member);
    adminCache.set(key, { isAdmin, expires: Date.now() + ADMIN_CACHE_TTL_MS });
    return isAdmin;
  } catch (err) {
    if (isGroupPermissionError(err)) {
      logGroupPermissionWarn('getChatMember');
    } else {
      console.warn('[group-security] getChatMember:', err?.message || err);
    }
    return false;
  }
}

function formatUserMention(from) {
  if (!from) return 'Do\'st';
  const name = from.first_name || from.username || 'Do\'st';
  if (from.username) {
    return `<a href="https://t.me/${from.username}">${name}</a>`;
  }
  return `<a href="tg://user?id=${from.id}">${name}</a>`;
}

function shouldSendEducation(userId) {
  const last = educationCooldown.get(userId) || 0;
  if (Date.now() - last < EDUCATION_COOLDOWN_MS) return false;
  educationCooldown.set(userId, Date.now());
  return true;
}

async function sendEducationMessage(telegram, chatId, from) {
  if (!shouldSendEducation(from?.id)) return null;

  const mention = formatUserMention(from);
  const text = `${mention}\n\n${EDUCATION_TEXT}`;

  try {
    const sent = await telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...Markup.inlineKeyboard([
        [Markup.button.url('🤖 Botga kirish va E\'lon berish', BOT_URL)],
      ]),
    });

    setTimeout(() => {
      safeDeleteMessage(telegram, chatId, sent.message_id).catch(() => {});
    }, EDUCATION_TTL_MS);

    return sent;
  } catch (err) {
    if (isGroupPermissionError(err)) {
      logGroupPermissionWarn('sendMessage');
      return null;
    }
    console.warn('[group-security] education send:', err?.message || err);
    return null;
  }
}

/** Userbot (GramJS) orqali xabar o'chirish */
async function safeDeleteMessageUserbot(client, chatId, messageId) {
  try {
    const entity = await client.getEntity(chatId);
    await client.deleteMessages(entity, [messageId], { revoke: true });
    return true;
  } catch (err) {
    if (/admin|rights|CHAT_ADMIN|not enough/i.test(err?.message || '')) {
      logGroupPermissionWarn('userbot deleteMessage');
      return false;
    }
    console.warn('[group-security] userbot delete:', err?.message || err);
    return false;
  }
}

async function checkIsGroupAdminUserbot(client, chatId, userId) {
  const key = `ub:${chatId}:${userId}`;
  const cached = adminCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.isAdmin;
  }

  try {
    const entity = await client.getEntity(chatId);
    const participant = await client.getParticipant(entity, userId);
    const isAdmin =
      participant?.adminRights != null ||
      participant?.className === 'ChannelParticipantCreator' ||
      participant?.className === 'ChannelParticipantAdmin' ||
      participant?.className === 'ChatParticipantCreator' ||
      participant?.className === 'ChatParticipantAdmin';
    adminCache.set(key, { isAdmin, expires: Date.now() + ADMIN_CACHE_TTL_MS });
    return isAdmin;
  } catch (err) {
    console.warn('[group-security] userbot getParticipant:', err?.message || err);
    return false;
  }
}

async function moderateNonAdminMessage(telegram, chatId, msg, from) {
  await safeDeleteMessage(telegram, chatId, msg.message_id);
  await sendEducationMessage(telegram, chatId, from);
  console.log(`[group-security] Noadmin xabar o'chirildi (bot): user=${from?.id} chat=${chatId}`);
}

/**
 * Telegraf bot — guruh xabarlari (privacy o'chiq bo'lsa).
 */
async function handleRoyalGroupMessage(ctx) {
  const chatId = ctx.chat?.id;
  if (!isRoyalGroupChat(chatId)) return false;

  const msg = ctx.message;
  if (!msg || msg.from?.is_bot) return true;

  const userId = msg.from?.id;
  if (!userId) return true;

  try {
    const isAdmin = await checkIsGroupAdmin(ctx.telegram, chatId, userId);
    if (isAdmin) return true;

    await moderateNonAdminMessage(ctx.telegram, chatId, msg, msg.from);
  } catch (err) {
    if (isGroupPermissionError(err)) {
      logGroupPermissionWarn('moderation');
    } else {
      console.error('[group-security] moderation xato:', err?.message || err);
    }
  }

  return true;
}

/**
 * Userbot (GramJS) — barcha guruh xabarlarini ko'radi (asosiy moderatsiya).
 */
async function handleRoyalGroupMessageUserbot(client, message, botTelegram) {
  const royalId = getRoyalCargoGroupId();
  if (!royalId || !message || !client?.connected) return false;

  let chatId;
  try {
    chatId = message.peerId ? String(utils.getPeerId(message.peerId)) : null;
  } catch {
    return false;
  }

  if (!isRoyalGroupChat(chatId)) return false;

  let sender;
  try {
    sender = await message.getSender();
  } catch {
    return false;
  }

  if (!sender || sender.bot || sender.className === 'Channel') return true;

  const userId = Number(sender.id);
  if (!userId) return true;

  try {
    const isAdmin = await checkIsGroupAdminUserbot(client, royalId, userId);
    if (isAdmin) return true;

    await safeDeleteMessageUserbot(client, royalId, message.id);

    const from = {
      id: userId,
      first_name: sender.firstName || sender.first_name,
      username: sender.username,
    };

    if (botTelegram) {
      const mention = formatUserMention(from);
      const text = `${mention}\n\n${EDUCATION_TEXT}`;
      if (shouldSendEducation(from?.id)) {
        try {
          const sent = await botTelegram.sendMessage(royalId, text, EDUCATION_KEYBOARD);
          setTimeout(() => {
            botTelegram.deleteMessage?.(royalId, sent.message_id).catch(() => {});
          }, EDUCATION_TTL_MS);
        } catch (err) {
          console.warn('[group-security] education (api):', err?.message || err);
        }
      }
    }

    console.log(`[group-security] Noadmin xabar o'chirildi (userbot): user=${userId}`);
  } catch (err) {
    console.error('[group-security] userbot moderation:', err?.message || err);
  }

  return true;
}

module.exports = {
  handleRoyalGroupMessage,
  handleRoyalGroupMessageUserbot,
  isRoyalGroupChat,
  isGroupPermissionError,
  getRoyalCargoGroupId,
};
