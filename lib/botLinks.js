const { BOT_USERNAME, BOT_PUBLIC_URL } = require('../config/constants');

function botHandle() {
  return String(BOT_USERNAME || 'karvongo_bot').replace(/^@/, '');
}

function botStartUrl(payload) {
  const base = BOT_PUBLIC_URL || `https://t.me/${botHandle()}`;
  if (!payload) return base;
  const safe = String(payload).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  return `https://t.me/${botHandle()}?start=${safe}`;
}

function maskPhone(phone) {
  const raw = String(phone || '').replace(/\s/g, '');
  if (raw.length < 8) return 'Botda ochiladi';
  return `${raw.slice(0, 6)} *** ${raw.slice(-2)}`;
}

module.exports = { botHandle, botStartUrl, maskPhone };
