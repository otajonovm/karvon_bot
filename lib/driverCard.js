const { DRIVER_STATUS, BODY_TYPES } = require('../config/constants');
const { formatRouteLabel } = require('./driverRoutes');

function formatDriverId(userId) {
  const n = String(userId || '').replace(/\D/g, '');
  return `#DRV-${n.slice(-7).padStart(7, '0')}`;
}

function telegramDisplayName(from) {
  if (!from) return 'Haydovchi';
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
  return name || from.username || 'Haydovchi';
}

function bodyTypeLabel(value) {
  if (!value) return '—';
  const found = BODY_TYPES.find(
    (b) => b.label === value || b.slug === String(value).toLowerCase()
  );
  return found ? `${found.emoji} ${found.label}` : value;
}

function formatRating(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '5.0';
  return n.toFixed(1);
}

function formatDriverCard(profile, user) {
  const id = formatDriverId(profile?.user_id || user?.id);
  const name = profile?.full_name || '—';
  const phone = user?.phone || '—';
  const verified = profile?.is_verified !== false;
  const truck = profile?.truck_type || profile?.car_type || '—';
  const body = bodyTypeLabel(profile?.body_type);
  const plate = profile?.truck_number || '—';
  const loc = profile?.current_location || profile?.from_region || '—';
  const route = formatRouteLabel(profile);
  const busy = profile?.status === DRIVER_STATUS.BUSY;
  const trips = Number(profile?.completed_trips) || 0;
  const rating = formatRating(profile?.rating ?? 5);

  return (
    '🪪 <b>KARVON HAYDOVCHI GUVOHNOMASI</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    `<code>ID         ${id}</code>\n` +
    `👤 <b>Ism:</b> ${escapeHtml(name)}\n` +
    `📱 <b>Tel:</b> <code>${escapeHtml(phone)}</code>\n` +
    `${verified ? '🟢 <b>Tasdiqlangan</b>' : '⚪ Tasdiqlanmagan'}\n` +
    '━━━━━━━━━━━━━━━━━━\n' +
    `🚚 <b>Mashina:</b> ${escapeHtml(truck)}\n` +
    `📦 <b>Kuzov:</b> ${escapeHtml(body)}\n` +
    `🔢 <b>Raqam:</b> <code>${escapeHtml(plate)}</code>\n` +
    '━━━━━━━━━━━━━━━━━━\n' +
    `📍 <b>Joylashuv:</b> ${escapeHtml(loc)}\n` +
    `🔄 <b>Yo'nalish:</b> ${escapeHtml(route)}\n` +
    `📊 <b>Holat:</b> ${busy ? "🔴 Yo'lda" : "🟢 Bo'sh"}\n` +
    '━━━━━━━━━━━━━━━━━━\n' +
    `🏁 <b>Reyslar:</b> ${trips}\n` +
    `⭐️ <b>Reyting:</b> ${rating}`
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

module.exports = {
  formatDriverId,
  telegramDisplayName,
  bodyTypeLabel,
  formatRating,
  formatDriverCard,
};
