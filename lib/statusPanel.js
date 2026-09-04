const { ROLES, DRIVER_STATUS } = require('../config/constants');
const { getUserById, setUserRole } = require('./users');
const { getDriverProfile } = require('./drivers');
const { formatRouteLabel, hasAllRoutes } = require('./driverRoutes');

function hasRouteProfile(profile) {
  if (!profile) return false;
  if (hasAllRoutes(profile)) return true;
  if (profile.current_location) return true;
  return Boolean(profile.from_region && profile.to_region);
}

async function buildStatusMessage(userId) {
  const user = await getUserById(userId);

  if (!user?.phone) {
    return { text: '⚠️ Avval /start orqali telefon raqamingizni ulashing.', hasProfile: false };
  }

  const profile = await getDriverProfile(userId);

  if (!hasRouteProfile(profile)) {
    return {
      text:
        '🪪 <b>SHAXSIY KABINET</b>\n' +
        '━━━━━━━━━━━━━━━\n' +
        `📱 <b>Raqam:</b> ${user.phone}\n\n` +
        '<i>Marshrut hali sozlanmagan.</i>\n' +
        '「⛟ Yuk Izlash」 orqali mashina va yo\'nalishni belgilang.',
      hasProfile: false,
      profile: null,
    };
  }

  const truckNum = profile.truck_number || '—';
  const truckType = profile.truck_type || profile.car_type || '—';
  const loc = profile.current_location || profile.from_region || '—';
  const busy = profile.status === DRIVER_STATUS.BUSY;
  const statusLabel = busy ? "🔴 Bandman (yo'lda)" : "🟢 Bo'shman";

  const text =
    '🪪 <b>SHAXSIY KABINET</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `📱 <b>Raqam:</b> ${user.phone}\n` +
    `🚚 <b>Moshina:</b> ${truckType} (${truckNum})\n` +
    `📍 <b>Joylashuv:</b> ${loc}\n` +
    `🔄 <b>Yo'nalish:</b> ${formatRouteLabel(profile)}\n` +
    `📊 <b>Holat:</b> ${statusLabel}`;

  return { text, hasProfile: true, profile };
}

async function ensureDriverRole(userId) {
  const user = await getUserById(userId);
  if (!user?.phone) return { ok: false, reason: 'no_phone' };
  if (user.role !== ROLES.DRIVER) {
    await setUserRole(userId, ROLES.DRIVER);
  }
  return { ok: true };
}

module.exports = { buildStatusMessage, ensureDriverRole, hasRouteProfile };
