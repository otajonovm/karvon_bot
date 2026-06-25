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
  kitob: 'Qashqadaryo',
  xiva: 'Qashqadaryo',

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
    .replace(/ТОШКЕНТ/gi, 'Toshkent')
    .replace(/Андижон/gi, 'Andijon')
    .replace(/Андижан/gi, 'Andijon')
    .replace(/Наманган/gi, 'Namangan')
    .replace(/Самарканд/gi, 'Samarqand')
    .replace(/САМАРКАНД/gi, 'Samarqand')
    .replace(/Бухоро/gi, 'Buxoro')
    .replace(/БУХОРО/gi, 'Buxoro')
    .replace(/Фергана/gi, "Farg'ona")
    .replace(/ФАРГОНА/gi, "Farg'ona")
    .replace(/Фаргона/gi, "Farg'ona")
    .replace(/КАШКАДАРЁ/gi, 'Qashqadaryo')
    .replace(/Кашкадар/gi, 'Qashqadaryo')
    .replace(/КАШКАДАР/gi, 'Qashqadaryo')
    .replace(/Сурхондар/gi, 'Surxondaryo')
    .replace(/СИРДАРЁ/gi, 'Sirdaryo')
    .replace(/Сирдар/gi, 'Sirdaryo')
    .replace(/Навоий/gi, 'Navoiy')
    .replace(/НАВОИ/gi, 'Navoiy')
    .replace(/Жиззах/gi, 'Jizzax')
    .replace(/Гулистон/gi, 'Guliston');
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
    if (place.length < 3) continue;
    let idx = 0;
    while ((idx = lower.indexOf(place, idx)) >= 0) {
      found.push({ place, city, index: idx });
      idx += place.length;
    }
  }

  found.sort((a, b) => a.index - b.index);

  const unique = [];
  for (const f of found) {
    if (unique.length === 0 || unique[unique.length - 1].city !== f.city) {
      unique.push(f);
    }
    if (unique.length >= 2) break;
  }
  return unique;
}

function extractRouteEmoji(text) {
  const t = preprocessText(text);
  const fromM = t.match(/📍\s*:?\s*([^\n🏁🚚]+)/i);
  const toM = t.match(/🏁\s*:?\s*([^\n🚚📦]+)/i);
  if (!fromM || !toM) return null;
  const fromRaw = fromM[1].trim().split(/\s+/)[0];
  const toRaw = toM[1].trim().split(/\s+/)[0];
  const from = mapPlace(fromRaw) || mapPlace(fromM[1].trim());
  const to = mapPlace(toRaw) || mapPlace(toM[1].trim());
  if (from && to) return { from_region: from, to_region: to };
  return null;
}

function extractRoute(text) {
  const t = preprocessText(text);
  const place = `[${PLACE_CHARS}][${PLACE_CHARS}\\s]{1,24}?`;

  const emojiRoute = extractRouteEmoji(t);
  if (emojiRoute) return emojiRoute;

  // LORRY: KATTAQO'RG'ON -> FARG'ONA
  const arrow = t.match(new RegExp(`(${place})\\s*(?:->|→|➡|➔)\\s*(${place})`, 'i'));
  if (arrow) {
    const from = mapPlace(arrow[1].trim());
    const to = mapPlace(arrow[2].trim());
    if (from && to) return { from_region: from, to_region: to };
  }

  const danGa = t.match(/(\w+)dan\s+(\w+)/i);
  if (danGa) {
    const from = mapPlace(danGa[1]);
    const toWord = danGa[2].replace(/(ga|га)$/i, '');
    const to = mapPlace(toWord);
    if (from && to) return { from_region: from, to_region: to };
  }

  // TOSHKENT - NAVOIY  🚛  yoki  TOSHKENT     ANDIJON
  const dash = t.match(new RegExp(`(${place})\\s*[-–—_]{1,3}\\s*(${place})`, 'i'));
  if (dash) {
    const from = mapPlace(dash[1].trim());
    const to = mapPlace(dash[2].trim());
    if (from && to) return { from_region: from, to_region: to };
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
  const { extractPhoneFromText } = require('./normalize');
  const phone_number = extractPhone(text) || extractPhoneFromText(text);
  const route = extractRoute(text);

  if (!phone_number || !route) return null;

  const car_type = extractCarType(text) || 'Fura';

  return normalizeParsedOrder({
    from_region: route.from_region,
    to_region: route.to_region,
    car_type,
    cargo_details: text.replace(/\s+/g, ' ').trim().slice(0, 300),
    phone_number,
  });
}

module.exports = { parseWithRegex, extractPhone, extractCarType, extractRoute, preprocessText };
