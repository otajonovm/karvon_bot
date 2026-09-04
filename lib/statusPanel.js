const { ROLES } = require('../config/constants');
const { getUserById, setUserRole } = require('./users');
const { getDriverProfile } = require('./drivers');
const { hasAllRoutes } = require('./driverRoutes');
const { formatDriverCard } = require('./driverCard');
const { cabinetInlineKeyboard } = require('./menus');

function hasRouteProfile(profile) {
  if (!profile) return false;
  const truck = profile.truck_type || profile.car_type;
  const loc = profile.current_location || profile.from_region;
  if (!truck || !loc) return false;
  if (hasAllRoutes(profile)) return true;
  return Boolean(profile.truck_number || profile.preferred_routes?.length);
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
        '🪪 <b>KARVON HAYDOVCHI GUVOHNOMASI</b>\n' +
        '━━━━━━━━━━━━━━━━━━\n' +
        `📱 <b>Tel:</b> ${user.phone}\n\n` +
        "<i>Profil hali to'liq emas.</i>\n" +
        '「⛟ Yuk Izlash」 orqali guvohnomani oching.',
      hasProfile: false,
      profile: null,
    };
  }

  return {
    text: formatDriverCard(profile, user),
    hasProfile: true,
    profile,
  };
}

function cabinetKeyboardFor(profile) {
  if (!profile) return {};
  return cabinetInlineKeyboard(profile);
}

async function ensureDriverRole(userId) {
  const user = await getUserById(userId);
  if (!user?.phone) return { ok: false, reason: 'no_phone' };
  if (user.role !== ROLES.DRIVER) {
    await setUserRole(userId, ROLES.DRIVER);
  }
  return { ok: true };
}

module.exports = {
  buildStatusMessage,
  ensureDriverRole,
  hasRouteProfile,
  cabinetKeyboardFor,
};
