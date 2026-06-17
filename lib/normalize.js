const { CAR_TYPES, CANONICAL_CITIES } = require('../config/constants');

/** Barcha shahar/qishloq → 8 ta bosh viloyat markazi */
const REGION_ALIASES = {
  toshkent: 'Toshkent',
  tashkent: 'Toshkent',
  ташкент: 'Toshkent',
  qibray: 'Toshkent',
  gazalkent: 'Toshkent',
  xonobod: 'Toshkent',
  chirchiq: 'Toshkent',
  angren: 'Toshkent',

  fargona: "Farg'ona",
  "farg'ona": "Farg'ona",
  фергана: "Farg'ona",
  vodiy: "Farg'ona",
  qoqon: "Farg'ona",
  kokand: "Farg'ona",
  margilon: "Farg'ona",
  margilan: "Farg'ona",
  "marg'ilon": "Farg'ona",
  rishton: "Farg'ona",
  quva: "Farg'ona",
  quvasoy: "Farg'ona",

  andijon: 'Andijon',
  asaka: 'Andijon',
  shahrixon: 'Andijon',
  xonobodandijon: 'Andijon',

  namangan: 'Namangan',
  chust: 'Namangan',
  pop: 'Namangan',
  toshloq: 'Namangan',

  samarqand: 'Samarqand',
  samarkand: 'Samarqand',
  kattaqorgon: 'Samarqand',
  "kattaqo'rg'on": 'Samarqand',
  gurlan: "Farg'ona",
  andijan: 'Andijon',
  kurgantepa: 'Andijon',
  sirdaryo: 'Qashqadaryo',
  "qo'ng'irot": 'Qashqadaryo',
  qongirot: 'Qashqadaryo',

  buxoro: 'Buxoro',
  bukhara: 'Buxoro',
  kogon: 'Buxoro',

  qashqadaryo: 'Qashqadaryo',
  qarshi: 'Qashqadaryo',
  shahrisabz: 'Qashqadaryo',
  muborak: 'Qashqadaryo',

  surxondaryo: 'Surxondaryo',
  surxandar: 'Surxondaryo',
  termiz: 'Surxondaryo',
  denov: 'Surxondaryo',
  sherobod: 'Surxondaryo',

  // Eski AI formatlari → eng yaqin markaz
  voha: 'Qashqadaryo',
  navoi: 'Qashqadaryo',
  navoiy: 'Qashqadaryo',
  jizzax: 'Qashqadaryo',
  jizax: 'Qashqadaryo',
  guliston: 'Qashqadaryo',
  urgench: 'Qashqadaryo',
  urganch: 'Qashqadaryo',
  xiva: 'Qashqadaryo',
  xorazm: 'Qashqadaryo',
  nukus: 'Qashqadaryo',
  qoraqalpogiston: 'Qashqadaryo',
  qoraqalpoq: 'Qashqadaryo',
  mingbuloq: 'Andijon',
  torakorgon: 'Andijon',
  "to'raqorg'on": 'Andijon',
  konimex: 'Buxoro',
  kitob: 'Qashqadaryo',
  guzar: 'Qashqadaryo',
  boysun: 'Surxondaryo',
  denau: 'Surxondaryo',
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

function normKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[''`ʻ]/g, "'")
    .replace(/\s+/g, '');
}

function normalizeRegion(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (CANONICAL_CITIES.includes(raw)) return raw;

  const key = normKey(raw);
  if (REGION_ALIASES[key]) return REGION_ALIASES[key];

  const found = CANONICAL_CITIES.find((c) => normKey(c) === key);
  if (found) return found;

  // Qisman mos kelish (masalan: "kattaqorgondan" → Samarqand)
  for (const [alias, city] of Object.entries(REGION_ALIASES)) {
    if (alias.length >= 4 && (key.includes(alias) || alias.includes(key))) {
      return city;
    }
  }

  return null;
}

function normalizeCarType(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (CAR_TYPES.includes(raw)) return raw;

  const key = normKey(raw);
  if (CAR_ALIASES[key]) return CAR_ALIASES[key];

  if (/labo|damas|лабо/i.test(raw)) return 'Labo/Damas';
  if (/gazel|газел/i.test(raw)) return 'Gazel';
  if (/isuzu|исузу/i.test(raw)) return 'Isuzu';
  if (/fura|фура|tir|tent|тент/i.test(raw)) return 'Fura';

  return null;
}

function normalizePhone(value) {
  if (!value) return null;
  let phone = String(value).replace(/[^\d+]/g, '');
  if (phone.startsWith('998') && !phone.startsWith('+')) phone = `+${phone}`;
  if (phone.startsWith('8') && phone.length === 10) phone = `+998${phone.slice(1)}`;
  if (/^\d{9}$/.test(phone)) phone = `+998${phone}`;
  if (/^[7-9]\d{8}$/.test(phone.replace(/^\+998/, ''))) {
    phone = phone.startsWith('+') ? phone : `+998${phone.replace(/^\+/, '')}`;
  }
  if (!phone.startsWith('+') && phone.length >= 9) phone = `+${phone}`;
  return phone.length >= 10 ? phone : null;
}

function phoneToTel(value) {
  const phone = normalizePhone(value);
  if (!phone) return null;
  // Telegram Bot API tel:+998... ni noto'g'ri parse qiladi (+998 = port)
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9 ? `tel:${digits}` : null;
}

function extractPrice(cargoDetails) {
  if (!cargoDetails) return 'Kelishiladi';
  const patterns = [
    /(\d+[\d.,]*\s*(?:mln|млн|million))/i,
    /(\d+[\d.,]*\s*(?:so'?m|сум|sum|сўм))/i,
    /(?:💰|narx)[:\s]*([^\n,]+)/i,
  ];
  for (const pattern of patterns) {
    const match = cargoDetails.match(pattern);
    if (match) return match[1].trim();
  }
  return 'Kelishiladi';
}

function buildRoute(from, to) {
  return `${from}-${to}`;
}

function reverseRoute(route) {
  const [from, to] = route.split('-');
  if (!from || !to) return null;
  return `${to}-${from}`;
}

function normalizeParsedOrder(parsed) {
  if (!parsed) return null;

  const from_region = normalizeRegion(parsed.from_region);
  const to_region = normalizeRegion(parsed.to_region);
  const car_type = normalizeCarType(parsed.car_type);
  const cargo_details = String(parsed.cargo_details || '').trim() || "Yuk tavsifi ko'rsatilmagan";
  const phone_number = normalizePhone(parsed.phone_number);

  if (!from_region || !to_region || !car_type || !phone_number) {
    console.error('[normalize] Invalid fields:', {
      raw_from: parsed.from_region,
      raw_to: parsed.to_region,
      from_region,
      to_region,
      car_type,
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
  phoneToTel,
  extractPrice,
  buildRoute,
  reverseRoute,
  normalizeParsedOrder,
};
