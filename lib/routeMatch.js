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

/** To'g'ri yo'nalish yoki backhaul */
function routeMatchesOrder(driver, order) {
  const from = driver.from_region;
  const to = driver.to_region;
  if (!from || !to) return false;
  if (!carTypesMatch(order.car_type, driver.car_type ?? driver.truck_type)) return false;

  const forward =
    regionsTextMatch(order.from_region, from) && regionsTextMatch(order.to_region, to);
  const backhaul =
    regionsTextMatch(order.from_region, to) && regionsTextMatch(order.to_region, from);

  return forward || backhaul;
}

module.exports = { regionsTextMatch, carTypesMatch, routeMatchesOrder };
