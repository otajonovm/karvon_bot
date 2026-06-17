const { ROLES } = require('../config/constants');
const { getUserById, setUserRole } = require('./users');
const { getDriverProfile } = require('./drivers');

async function buildStatusMessage(userId) {
  const user = await getUserById(userId);

  if (!user?.phone) {
    return { text: '⚠️ Avval /start orqali telefon raqamingizni ulashing.', hasProfile: false };
  }

  const profile = await getDriverProfile(userId);

  if (!profile?.from_region || !profile?.to_region) {
    return {
      text:
        '🪪 <b>KARVON PROFIL</b>\n' +
        '━━━━━━━━━━━━━━━\n' +
        `📱 <b>Raqam:</b> ${user.phone}\n\n` +
        '<i>Marshrut hali sozlanmagan.</i>\n' +
        '「🚛 Yuk Izlash」 tugmasini bosing.',
      hasProfile: false,
    };
  }

  const truckNum = profile.truck_number || '—';
  const truckType = profile.truck_type || profile.car_type || '—';

  const text =
    '🪪 <b>KARVON PROFIL</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `📱 <b>Raqam:</b> ${user.phone}\n` +
    `🚚 <b>Moshina:</b> ${truckType} (${truckNum})\n` +
    `🔄 <b>Yo'nalish:</b> ${profile.from_region} ⇄ ${profile.to_region}`;

  return { text, hasProfile: true };
}

async function ensureDriverRole(userId) {
  const user = await getUserById(userId);
  if (!user?.phone) return { ok: false, reason: 'no_phone' };
  if (user.role !== ROLES.DRIVER) {
    await setUserRole(userId, ROLES.DRIVER);
  }
  return { ok: true };
}

module.exports = { buildStatusMessage, ensureDriverRole };
