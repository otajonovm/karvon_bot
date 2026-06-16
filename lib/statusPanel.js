const { ROLES, DRIVER_STATUS } = require('../config/constants');
const { getUserById, setUserRole } = require('./users');
const { getDriverProfile } = require('./drivers');
const { driverToggleKeyboard } = require('./menus');

function roleLabel(role) {
  if (role === ROLES.DRIVER) return '🚛 Haydovchi';
  if (role === ROLES.CLIENT) return '📦 Yuk egasi';
  return '— tanlanmagan';
}

async function buildStatusMessage(userId) {
  const user = await getUserById(userId);

  if (!user?.phone) {
    return {
      text: '⚠️ Avval /start orqali telefon raqamingizni ulashing.',
      extra: {},
    };
  }

  let text =
    '⚙️ <b>Mening holatim</b>\n\n' +
    `📱 Telefon: <b>${user.phone}</b>\n` +
    `👤 Rol: ${roleLabel(user.role)}\n`;

  const profile = await getDriverProfile(userId);

  if (profile) {
    const statusLabel =
      profile.status === DRIVER_STATUS.BUSY ? '🔴 Bandman' : '🟢 Yuk qidiryapman';
    const verifiedLabel = profile.is_verified ? '✅ Tasdiqlangan' : '⏳ Tasdiqlanmagan';

    text +=
      '\n<b>Haydovchi profili</b>\n' +
      `🚛 Mashina: <b>${profile.truck_type}</b>\n` +
      `📍 Yo'nalish: <b>${profile.preferred_route}</b>\n` +
      `📡 Holat: ${statusLabel}\n` +
      `🪪 Verifikatsiya: ${verifiedLabel}\n`;

    return {
      text,
      extra: { parse_mode: 'HTML', ...driverToggleKeyboard() },
    };
  }

  text += '\n<i>Haydovchi profili hali sozlanmagan.</i>\n';
  text += '「🚛 Yuk Izlash / Profilni Sozlash」 tugmasini bosing.';

  return { text, extra: { parse_mode: 'HTML' } };
}

async function ensureDriverRole(userId) {
  const user = await getUserById(userId);
  if (!user?.phone) return { ok: false, reason: 'no_phone' };
  if (user.role !== ROLES.DRIVER) {
    await setUserRole(userId, ROLES.DRIVER);
  }
  return { ok: true };
}

module.exports = { buildStatusMessage, ensureDriverRole, roleLabel };
