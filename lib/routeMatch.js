const { CANONICAL_CITIES } = require('../config/constants');

/** Eski formatlar → 8 ta markaz */
const LEGACY_TO_CITIES = {
  Vodiy: ["Farg'ona", 'Andijon', 'Namangan'],
  Voha: ['Qashqadaryo', 'Surxondaryo'],
};

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "'");
}

function expandToCities(name) {
  const n = norm(name);
  for (const city of CANONICAL_CITIES) {
    if (norm(city) === n) return [n];
  }
  for (const [legacy, cities] of Object.entries(LEGACY_TO_CITIES)) {
    if (norm(legacy) === n) return cities.map((c) => norm(c));
  }
  return [n];
}

function regionsTextMatch(a, b) {
  if (!a || !b) return false;
  const setA = expandToCities(a);
  const setB = expandToCities(b);
  return setA.some((x) => setB.includes(x));
}

function carTypesMatch(orderCar, driverCar) {
  if (!orderCar || !driverCar) return false;
  const o = norm(orderCar);
  const d = norm(driverCar);
  if (o === d) return true;
  return (o.includes('labo') || o.includes('damas')) && (d.includes('labo') || d.includes('damas'));
}

function bodyTypesMatch(orderBody, driverBody) {
  if (!orderBody) return true;
  if (!driverBody) return false;
  return norm(orderBody) === norm(driverBody);
}

function inferOrderBodyType(order) {
  if (!order) return null;
  if (order.body_type) return order.body_type;
  const t = String(order.cargo_details || '').toLowerCase();
  if (/refrij|refrijerator|\bref\b|muzlat|sovuq/.test(t)) return 'Refrijerator';
  if (/\btent\b/.test(t)) return 'Tent';
  if (/butka|\bbort\b/.test(t)) return 'Butka/Bort';
  return null;
}

/** To'g'ri yo'nalish yoki yangi preferred_routes / ALL_ROUTES */
function routeMatchesOrder(driver, order) {
  try {
    return require('./driverRoutes').driverMatchesOrder(driver, order);
  } catch (err) {
    console.error('[routeMatch]', err.message);
    const from = driver.from_region;
    const to = driver.to_region;
    if (!from || !to) return false;
    if (!carTypesMatch(order.car_type, driver.car_type ?? driver.truck_type)) return false;
    if (!bodyTypesMatch(inferOrderBodyType(order), driver.body_type)) return false;
    const forward =
      regionsTextMatch(order.from_region, from) && regionsTextMatch(order.to_region, to);
    const backhaul =
      regionsTextMatch(order.from_region, to) && regionsTextMatch(order.to_region, from);
    return forward || backhaul;
  }
}

module.exports = { regionsTextMatch, carTypesMatch, bodyTypesMatch, inferOrderBodyType, routeMatchesOrder };
