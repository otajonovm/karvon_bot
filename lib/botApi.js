/**
 * Telegraf siz — faqat HTTP orqali xabar yuborish (409 conflict oldini oladi).
 */
const BOT_TOKEN = () => process.env.BOT_TOKEN;

async function apiCall(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.description || `Telegram API ${method} failed`);
    err.code = data.error_code;
    throw err;
  }
  return data.result;
}

async function deleteMessage(chatId, messageId) {
  return apiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function sendMessage(chatId, text, replyMarkup) {
  return apiCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  return apiCall('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

async function deleteWebhook() {
  try {
    await apiCall('deleteWebhook', { drop_pending_updates: true });
  } catch {
    // ignore
  }
}

/** Telegraf.telegram bilan mos adapter */
function createTelegramAdapter() {
  return {
    sendMessage: (chatId, text, extra) => {
      const markup = extra?.reply_markup;
      return sendMessage(chatId, text, markup);
    },
    editMessageReplyMarkup: (chatId, messageId, _, markup) =>
      editMessageReplyMarkup(chatId, messageId, markup),
    deleteMessage: (chatId, messageId) => deleteMessage(chatId, messageId),
  };
}

module.exports = { sendMessage, editMessageReplyMarkup, deleteMessage, deleteWebhook, createTelegramAdapter };
