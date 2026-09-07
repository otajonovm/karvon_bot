const { inferOrderBodyType } = require('./routeMatch');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function bodyLabel(order) {
  return order?.body_type || inferOrderBodyType(order) || 'Ixtiyoriy';
}

function formatDispatcherReport(order, { matchedCount = 0, notifiedCount = 0 } = {}) {
  const from = escapeHtml(order?.from_region || '—');
  const to = escapeHtml(order?.to_region || '—');
  const truck = escapeHtml(order?.car_type || order?.truck_type || '—');
  const body = escapeHtml(bodyLabel(order));
  const matched = Number(matchedCount) || 0;
  const count = Number(notifiedCount) || 0;

  if (matched > 0) {
    return (
      "✅ <b>E’loningiz qabul qilindi va guruhga joylandi!</b>\n\n" +
      "📡 <b>DISPETCHER HISOBOTI:</b>\n" +
      `📍 Yo‘nalish: <b>${from}</b> ➔ <b>${to}</b>\n` +
      `🚛 Mashina talabi: <b>${truck}</b> (${body})\n` +
      `🔎 Mos haydovchilar topildi: <b>${matched} ta</b>\n` +
      `📤 PUSH yuborildi: <b>${count} ta</b>\n\n` +
      (count > 0
        ? "⏳ Haydovchilar buyurtmani ko'rib chiqmoqda. Bog'lanishsa, telefoningizga qo'ng'iroq qilishadi."
        : "⚠️ Mos haydovchilar topildi, ammo PUSH yuborilmadi. Keyinroq qayta taklif qilinadi.")
    );
  }

  return (
    "✅ <b>E’loningiz qabul qilindi va rasmiy guruhga chiqarildi!</b>\n\n" +
    "📡 <b>DISPETCHER BILDIRISHNOMASI:</b>\n" +
    `📍 Yo‘nalish: <b>${from}</b> ➔ <b>${to}</b>\n` +
    '🔎 Mos haydovchilar topildi: <b>0 ta</b>\n' +
    '📤 PUSH yuborildi: <b>0 ta</b>\n' +
    "⚠️ Hozirda bu yo'nalishda bo'sh turgan furalar aniqlanmadi (yoki barchasi band).\n" +
    "👥 E'loningiz rasmiy guruhimizdagi haydovchilar lentasiga chiqarildi.\n" +
    "🔔 Bo'shagan ilk haydovchiga bot yukni avtomatik taklif qiladi."
  );
}

async function sendDispatcherReport(telegram, chatId, order, result = {}) {
  if (!telegram || !chatId) {
    return { ok: false, skipped: true };
  }
  try {
    await telegram.sendMessage(chatId, formatDispatcherReport(order, result), {
      parse_mode: 'HTML',
    });
    return { ok: true };
  } catch (err) {
    console.error(`[dispatch] report ${chatId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

function formatDriverAcceptedReport(order, driver, user) {
  const target = order?.broker_user_id || order?.sender_telegram_id;
  if (!target) return null;
  const name = escapeHtml(driver?.full_name || user?.first_name || 'Haydovchi');
  const truck = escapeHtml(driver?.truck_type || driver?.car_type || order?.car_type || '—');
  const plate = escapeHtml(driver?.truck_number || '—');
  const phone = escapeHtml(user?.phone || 'Bot orqali bog‘lanadi');
  return (
    '🎉 <b>YUKINGIZNI HAYDOVCHI OLDI!</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    `📍 Yo‘nalish: <b>${escapeHtml(order?.from_region)}</b> ➔ <b>${escapeHtml(order?.to_region)}</b>\n` +
    `👤 Haydovchi: <b>${name}</b>\n` +
    `🚛 Mashina: <b>${truck}</b>\n` +
    `🔢 Davlat raqami: <code>${plate}</code>\n` +
    `📞 Telefon: <code>${phone}</code>\n\n` +
    '✅ E’loningiz bo‘yicha haydovchi biriktirildi.'
  );
}

async function sendDriverAcceptedReport(telegram, order, driver, user) {
  const chatId = order?.broker_user_id || order?.sender_telegram_id;
  const text = formatDriverAcceptedReport(order, driver, user);
  if (!chatId || !text) return { ok: false, skipped: true };
  try {
    await telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    return { ok: true };
  } catch (err) {
    console.error(`[dispatch] accepted report ${chatId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  formatDispatcherReport,
  formatDriverAcceptedReport,
  sendDispatcherReport,
  sendDriverAcceptedReport,
};
