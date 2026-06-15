const { normalizeRegion, normalizePhone } = require('./normalize');

/** Shahar/viloyat → asosiy hudud */
const PLACE_TO_REGION = {
  toshkent: 'Toshkent',
  tashkent: 'Toshkent',
  ташкент: 'Toshkent',
  samarqand: 'Samarqand',
  samarkand: 'Samarqand',
  buxoro: 'Buxoro',
  bukhara: 'Buxoro',
  fargona: 'Vodiy',
  "farg'ona": 'Vodiy',
  фергана: 'Vodiy',
  andijon: 'Vodiy',
  namangan: 'Vodiy',
  qoqon: 'Vodiy',
  kokand: 'Vodiy',
  margilon: 'Vodiy',
  termiz: 'Voha',
  navoi: 'Voha',
  navoiy: 'Voha',
  jizzax: 'Voha',
  jizax: 'Voha',
  guliston: 'Voha',
  urgench: 'Voha',
  urganch: 'Voha',
  xiva: 'Voha',
  xorazm: 'Voha',
  nukus: 'Voha',
  qarshi: 'Voha',
  shahrisabz: 'Voha',
  kattaqorgon: 'Voha',
  qibray: 'Toshkent',
  gazalkent: 'Toshkent',
  xonobod: 'Toshkent',
  vodiy: 'Vodiy',
  voha: 'Voha',
};

const REGION_WORDS = ['toshkent', 'samarqand', 'buxoro', 'vodiy', 'voha', ...Object.keys(PLACE_TO_REGION)];

function mapPlace(word) {
  if (!word) return null;
  const key = word.toLowerCase().replace(/[''`]/g, "'").replace(/\s+/g, '');
  if (PLACE_TO_REGION[key]) return PLACE_TO_REGION[key];
  return normalizeRegion(word);
}

function extractPhone(text) {
  const m =
    text.match(/\+998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/) ||
    text.match(/\b998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/) ||
    text.match(/(?:tel|тел|📱|☎️)[:\s]*(\d{9,12})/i) ||
    text.match(/\b([89]\d{8})\b/);

  if (!m) return null;
  return normalizePhone(m[1] || m[0]);
}

function extractCarType(text) {
  const t = text.toLowerCase();
  if (/labo|damas|лабо/i.test(t)) return 'Labo/Damas';
  if (/gazel|газел/i.test(t)) return 'Gazel';
  if (/isuzu|исузу/i.test(t)) return 'Isuzu';
  if (/fura|фура|tent|тент|ref\b|tir\b/i.test(t)) return 'Fura';
  return null;
}

function findPlacesInText(text) {
  const lower = text.toLowerCase();
  const found = [];

  for (const [place, region] of Object.entries(PLACE_TO_REGION)) {
    const pattern = new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(lower)) {
      found.push({ place, region, index: lower.indexOf(place) });
    }
  }

  for (const r of ['toshkent', 'samarqand', 'buxoro', 'vodiy', 'voha']) {
    const pattern = new RegExp(`\\b${r}\\b`, 'i');
    const match = lower.match(pattern);
    if (match) {
      const region = mapPlace(r);
      if (!found.some((f) => f.region === region)) {
        found.push({ place: r, region, index: match.index });
      }
    }
  }

  found.sort((a, b) => a.index - b.index);
  return found;
}

function extractRoute(text) {
  const danGa = text.match(/(\w+)dan\s+(\w+?)(?:ga|га)\b/i);
  if (danGa) {
    const from = mapPlace(danGa[1]);
    const to = mapPlace(danGa[2]);
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  const arrow = text.match(
    /([\w'ʻ'`\-]+)\s*(?:->|→|➡|dan|дан|den)\s*([\w'ʻ'`\-]+)/i
  );
  if (arrow) {
    const from = mapPlace(arrow[1]);
    const to = mapPlace(arrow[2]);
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  const dash = text.match(/([\w'ʻ'`\-]+)\s*[-–—]\s*([\w'ʻ'`\-]+)/i);
  if (dash) {
    const from = mapPlace(dash[1]);
    const to = mapPlace(dash[2]);
    if (from && to && from !== to) return { from_region: from, to_region: to };
  }

  const places = findPlacesInText(text);
  if (places.length >= 2) {
    const from = places[0].region;
    const to = places[1].region;
    if (from !== to) return { from_region: from, to_region: to };
  }

  return null;
}

/**
 * Regex bilan tez parse — AI kerak emas (~80% xabarlar).
 * @returns {object|null}
 */
function parseWithRegex(text) {
  const phone_number = extractPhone(text);
  const car_type = extractCarType(text);
  const route = extractRoute(text);

  if (!phone_number || !car_type || !route) return null;

  const cargo_details = text
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  return {
    from_region: route.from_region,
    to_region: route.to_region,
    car_type,
    cargo_details,
    phone_number,
  };
}

module.exports = { parseWithRegex, extractPhone, extractCarType };
