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

function formatDispatcherReport(order, { notifiedCount = 0 } = {}) {
  const from = escapeHtml(order?.from_region || '—');
  const to = escapeHtml(order?.to_region || '—');
  const truck = escapeHtml(order?.car_type || order?.truck_type || '—');
  const body = escapeHtml(bodyLabel(order));
  const count = Number(notifiedCount) || 0;

  if (count > 0) {
    return (
      "✅ <b>E’loningiz qabul qilindi va guruhga joylandi!</b>\n\n" +
      "📡 <b>DISPETCHER HISOBOTI:</b>\n" +
      `📍 Yo‘nalish: <b>${from}</b> ➔ <b>${to}</b>\n` +
      `🚛 Mashina talabi: <b>${truck}</b> (${body})\n` +
      `🔔 Bildirishnoma: Tizimdagi <b>${count}</b> ta mos fura/haydovchiga to'g'ridan-to'g'ri PUSH xabar yuborildi.\n\n` +
      "⏳ Haydovchilar buyurtmani ko'rib chiqmoqda. Bog'lanishsa, telefoningizga qo'ng'iroq qilishadi."
    );
  }

  return (
    "✅ <b>E’loningiz qabul qilindi va rasmiy guruhga chiqarildi!</b>\n\n" +
    "📡 <b>DISPETCHER BILDIRISHNOMASI:</b>\n" +
    `📍 Yo‘nalish: <b>${from}</b> ➔ <b>${to}</b>\n` +
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

module.exports = {
  formatDispatcherReport,
  sendDispatcherReport,
};
