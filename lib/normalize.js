const { REGIONS, CAR_TYPES } = require('../config/constants');

const REGION_ALIASES = {
  toshkent: 'Toshkent',
  tashkent: 'Toshkent',
  ташкент: 'Toshkent',
  vodiy: 'Vodiy',
  фергана: 'Vodiy',
  fargona: 'Vodiy',
  andijon: 'Vodiy',
  namangan: 'Vodiy',
  samarqand: 'Samarqand',
  samarkand: 'Samarqand',
  buxoro: 'Buxoro',
  bukhara: 'Buxoro',
  voha: 'Voha',
  xiva: 'Voha',
  khiva: 'Voha',
};

const CAR_ALIASES = {
  'labo/damas': 'Labo/Damas',
  labo: 'Labo/Damas',
  damas: 'Labo/Damas',
  лабо: 'Labo/Damas',
  gazel: 'Gazel',
  gazelle: 'Gazel',
  газель: 'Gazel',
  isuzu: 'Isuzu',
  исузу: 'Isuzu',
  fura: 'Fura',
  фура: 'Fura',
  tir: 'Fura',
};

function normalizeRegion(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (REGIONS.includes(raw)) return raw;

  const key = raw.toLowerCase().replace(/\s+/g, '');
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];

  const found = REGIONS.find((r) => r.toLowerCase() === key);
  return found || null;
}

function normalizeCarType(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (CAR_TYPES.includes(raw)) return raw;

  const key = raw.toLowerCase().replace(/\s+/g, '');
  if (CAR_ALIASES[key]) return CAR_ALIASES[key];

  if (/labo|damas|лабо/i.test(raw)) return 'Labo/Damas';
  if (/gazel|газел/i.test(raw)) return 'Gazel';
  if (/isuzu|исузу/i.test(raw)) return 'Isuzu';
  if (/fura|фура|tir/i.test(raw)) return 'Fura';

  return null;
}

function normalizePhone(value) {
  if (!value) return null;
  let phone = String(value).replace(/[^\d+]/g, '');
  if (phone.startsWith('998') && !phone.startsWith('+')) phone = `+${phone}`;
  if (phone.startsWith('8') && phone.length === 10) phone = `+998${phone.slice(1)}`;
  if (/^\d{9}$/.test(phone)) phone = `+998${phone}`;
  if (!phone.startsWith('+') && phone.length >= 9) phone = `+${phone}`;
  return phone.length >= 10 ? phone : null;
}

function buildRoute(from, to) {
  return `${from}-${to}`;
}

function reverseRoute(route) {
  const [from, to] = route.split('-');
  if (!from || !to) return null;
  return `${to}-${from}`;
}

/**
 * Validate and normalize AI-parsed cargo fields.
 * @returns {object|null}
 */
function normalizeParsedOrder(parsed) {
  if (!parsed) return null;

  const from_region = normalizeRegion(parsed.from_region);
  const to_region = normalizeRegion(parsed.to_region);
  const car_type = normalizeCarType(parsed.car_type);
  const cargo_details = String(parsed.cargo_details || '').trim() || 'Yuk tavsifi ko\'rsatilmagan';
  const phone_number = normalizePhone(parsed.phone_number);

  if (!from_region || !to_region || !car_type || !phone_number) {
    console.error('[normalize] Invalid fields:', {
      from_region,
      to_region,
      car_type,
      has_details: !!cargo_details,
      phone_number,
    });
    return null;
  }

  if (from_region === to_region) return null;

  return { from_region, to_region, car_type, cargo_details, phone_number };
}

module.exports = {
  normalizeRegion,
  normalizeCarType,
  normalizePhone,
  buildRoute,
  reverseRoute,
  normalizeParsedOrder,
};
