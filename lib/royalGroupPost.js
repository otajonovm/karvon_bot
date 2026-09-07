const { Markup } = require('telegraf');
const { getRoyalCargoGroupId } = require('../config/constants');
const { normalizePhone } = require('./normalize');
const { isGroupPermissionError } = require('./groupSecurity');
const { botStartUrl, maskPhone, botHandle } = require('./botLinks');

const BOT_HANDLE = botHandle();

function buildRoyalGroupMessage(order) {
  const phone = normalizePhone(order.broker_phone || order.phone_number);
  const scraped = order.source === 'scraper';
  const footer = scraped
    ? `🤖 Karvon tarmog'i · @${BOT_HANDLE}`
    : `🤖 Ushbu yuk @${BOT_HANDLE} orqali 1 daqiqada TEKIN joylandi!`;

  return (
    '📦 <b>YUK E\'LONI</b>\n' +
    '━━━━━━━━━━━━━━━━━\n' +
    `🚛 <b>${order.car_type || '—'}</b>\n` +
    `📍 <b>${order.from_region}</b> ➔ <b>${order.to_region}</b>\n` +
    `📝 ${order.cargo_details || '—'}\n` +
    `📞 ${maskPhone(phone)}\n\n` +
    '🔒 <b>Mijoz raqami faqat botda ochiladi.</b>\n' +
    "🚚 Yukni olish uchun haydovchi sifatida ro'yxatdan o'ting.\n\n" +
    footer
  );
}

function royalGroupKeyboard(order) {
  const claimUrl = order?.id
    ? botStartUrl(`order_${order.id}`)
    : botStartUrl('driver');
  return Markup.inlineKeyboard([
    [Markup.button.url("🚚 Haydovchi bo'lib yukni olish", claimUrl)],
    [Markup.button.url("🪪 Ro'yxatdan o'tish", botStartUrl('driver'))],
  ]);
}

/**
 * Broker yukini rasmiy guruhga bot orqali post qiladi.
 */
async function postOrderToRoyalGroup(telegram, order) {
  const royalId = getRoyalCargoGroupId();
  if (!royalId) {
    console.warn('[royal-post] ROYAL_CARGO_GROUP_ID sozlanmagan');
    return { ok: false, error: 'ROYAL_CARGO_GROUP_ID_EMPTY' };
  }

  const text = buildRoyalGroupMessage(order);
  const keyboard = royalGroupKeyboard(order);

  try {
    const msg = await telegram.sendMessage(royalId, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...keyboard,
    });
    console.log(`[royal-post] ✓ Guruhga joylandi: order=${order.id} msg=${msg.message_id}`);
    return { ok: true, messageId: msg.message_id };
  } catch (err) {
    const msg = err?.description || err?.message || String(err);

    if (/tel:|Wrong port number|inline keyboard/i.test(msg)) {
      try {
        const msg2 = await telegram.sendMessage(royalId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...Markup.inlineKeyboard([
            [Markup.button.url("🚚 Haydovchi bo'lib yukni olish", botStartUrl('driver'))],
          ]),
        });
        console.log(`[royal-post] ✓ (tel siz) Guruhga joylandi: order=${order.id}`);
        return { ok: true, messageId: msg2.message_id };
      } catch (retryErr) {
        console.error('[royal-post] retry xato:', retryErr?.message || retryErr);
        return { ok: false, error: retryErr?.message };
      }
    }

    if (isGroupPermissionError(err)) {
      console.warn('[group-security] Bot guruhda to\'liq admin emas yoki huquqlari yetishmayapti! (post)');
      return { ok: false, error: 'ADMIN_RIGHTS_REQUIRED' };
    }

    console.error('[royal-post] xato:', msg);
    return { ok: false, error: msg };
  }
}

module.exports = {
  buildRoyalGroupMessage,
  royalGroupKeyboard,
  postOrderToRoyalGroup,
};
