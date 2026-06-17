const { normalizeRegion, normalizePhone, normalizeParsedOrder } = require('./normalize');

const PLACE_CHARS = "A-Za-zА-Яа-яЁёӢӣҒғҚқЎўҲҳO'o''ʻ`";

/** Shahar/qishloq → 8 ta bosh viloyat markazi */
const PLACE_TO_CITY = {
  toshkent: 'Toshkent',
  tashkent: 'Toshkent',
  ташкент: 'Toshkent',
  angren: 'Toshkent',
  qibray: 'Toshkent',
  chirchiq: 'Toshkent',
  olmaliq: 'Toshkent',

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
  gurlan: "Farg'ona",

  andijon: 'Andijon',
  andijan: 'Andijon',
  андижан: 'Andijon',
  asaka: 'Andijon',
  shahrixon: 'Andijon',
  kurgantepa: 'Andijon',

  namangan: 'Namangan',
  namagan: 'Namangan',
  chust: 'Namangan',
  pop: 'Namangan',
  uchkurgan: 'Namangan',

  samarqand: 'Samarqand',
  samarkand: 'Samarqand',
  самарканд: 'Samarqand',
  kattaqorgon: 'Samarqand',
  "kattaqo'rg'on": 'Samarqand',

  buxoro: 'Buxoro',
  bukhara: 'Buxoro',
  buhoro: 'Buxoro',

  qashqadaryo: 'Qashqadaryo',
  qarshi: 'Qashqadaryo',
  shahrisabz: 'Qashqadaryo',
  navoi: 'Qashqadaryo',
  navoiy: 'Qashqadaryo',
  jizzax: 'Qashqadaryo',
  jizax: 'Qashqadaryo',
  xorazm: 'Qashqadaryo',
  xorezm: 'Qashqadaryo',
  urganch: 'Qashqadaryo',
  urgench: 'Qashqadaryo',
  qongirot: 'Qashqadaryo',
  "qo'ng'irot": 'Qashqadaryo',
  sirdaryo: 'Qashqadaryo',
  guliston: 'Qashqadaryo',

  surxondaryo: 'Surxondaryo',
  surxandar: 'Surxondaryo',
  termiz: 'Surxondaryo',
  denov: 'Surxondaryo',
  sherobod: 'Surxondaryo',
};

function normPlaceKey(word) {
  return String(word || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC\u0060ʻ]/g, "'")
    .replace(/[ьъ]/g, '')
    .replace(/\s+/g, '');
}

function mapPlace(word) {
  if (!word) return null;
  const key = normPlaceKey(word);
  if (PLACE_TO_CITY[key]) return PLACE_TO_CITY[key];
  return normalizeRegion(word);
}

function preprocessText(text) {
  return text
    .replace(/[\u2018\u2019\u02BC\u0060ʻ]/g, "'")
    .replace(/Ташкент/gi, 'Toshkent')
    .replace(/Андижан/gi, 'Andijon')
    .replace(/Наманган/gi, 'Namangan')
    .replace(/Самарканд/gi, 'Samarqand')
    .replace(/Бухоро/gi, 'Buxoro')
    .replace(/Фергана/gi, "Farg'ona");
}

function extractPhone(text) {
  const m =
    text.match(/\+998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/) ||
    text.match(/\b998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/) ||
    text.match(/(?:tel|тел|📱|☎️)\s*:?\s*(\+?998?\d{9,12})/i) ||
    text.match(/\b([7-9]\d{8})\b/);

  if (!m) return null;
  return normalizePhone(m[1] || m[0]);
}

function extractCarType(text) {
  const t = text.toLowerCase();
  if (/labo|damas|лабо/i.test(t)) return 'Labo/Damas';
  if (/gazel|газел/i.test(t)) return 'Gazel';
  if (/isuzu|исузу/i.test(t)) return 'Isuzu';
  if (/fura|фура|tent|тент|ref\b|tir\b|chakman|чакман/i.test(t)) return 'Fura';
  return null;
}

function findPlacesInText(text) {
  const lower = preprocessText(text).toLowerCase();
  const found = [];

  for (const [place, city] of Object.entries(PLACE_TO_CITY)) {
    const escaped = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(?:^|[\\s,.:;\\-])${escaped}(?:[\\s,.:;\\-]|$|[🚛📦💰📱])`, 'i');
    const match = lower.match(pattern);
    if (match) {
      found.push({ place, city, index: match.index });
    }
  }

  found.sort((a, b) => a.index - b.index);
  return found;
}

function extractRoute(text) {
  const t = preprocessText(text);
  const place = `[${PLACE_CHARS}][${PLACE_CHARS}\\s]{1,24}?`;

  // LORRY: KATTAQO'RG'ON -> FARG'ONA
  const arrow = t.match(new RegExp(`(${place})\\s*(?:->|→|➡)\\s*(${place})`, 'i'));
  if (arrow) {
    const from = mapPlace(arrow[1].trim());
    const to = mapPlace(arrow[2].trim());
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  const danGa = t.match(/(\w+)dan\s+(\w+?)(?:ga|га)\b/i);
  if (danGa) {
    const from = mapPlace(danGa[1]);
    const to = mapPlace(danGa[2]);
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  // TOSHKENT - NAVOIY  🚛
  const dash = t.match(new RegExp(`(${place})\\s*[-–—]\\s*(${place})(?=\\s|[🚛📦💰📱]|$)`, 'i'));
  if (dash) {
    const from = mapPlace(dash[1].trim());
    const to = mapPlace(dash[2].trim());
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  const places = findPlacesInText(t);
  if (places.length >= 2) {
    const from = places[0].city;
    const to = places[1].city;
    if (from !== to) return { from_region: from, to_region: to };
  }

  return null;
}

function parseWithRegex(text) {
  const phone_number = extractPhone(text);
  const car_type = extractCarType(text);
  const route = extractRoute(text);

  if (!phone_number || !car_type || !route) return null;

  return normalizeParsedOrder({
    from_region: route.from_region,
    to_region: route.to_region,
    car_type,
    cargo_details: text.replace(/\s+/g, ' ').trim().slice(0, 300),
    phone_number,
  });
}

module.exports = { parseWithRegex, extractPhone, extractCarType };
