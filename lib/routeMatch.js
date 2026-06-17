const { DRIVER_WIZARD_REGIONS } = require('../config/constants');

/** AI region → haydovchi tanlaydigan shaharlar */
const REGION_TO_CITIES = {
  Toshkent: ['Toshkent'],
  Vodiy: ["Farg'ona", 'Andijon', 'Namangan'],
  Samarqand: ['Samarqand'],
  Buxoro: ['Buxoro'],
  Voha: ['Qashqadaryo', 'Surxondaryo'],
};

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[''`]/g, "'");
}

/** Nomni shaharlar ro'yxatiga kengaytiradi */
function expandToCities(name) {
  const n = norm(name);
  for (const [region, cities] of Object.entries(REGION_TO_CITIES)) {
    if (norm(region) === n) return cities.map((c) => norm(c));
    for (const c of cities) {
      if (norm(c) === n) return [norm(c)];
    }
  }
  if (DRIVER_WIZARD_REGIONS.some((r) => norm(r.label) === n)) return [n];
  return [n];
}

/** Matn jihatdan moslik: "Vodiy" ↔ "Farg'ona" */
function regionsTextMatch(orderRegion, driverRegion) {
  if (!orderRegion || !driverRegion) return false;
  const a = expandToCities(orderRegion);
  const b = expandToCities(driverRegion);
  return a.some((x) => b.includes(x));
}

function carTypesMatch(orderCar, driverCar) {
  if (!orderCar || !driverCar) return false;
  const o = norm(orderCar);
  const d = norm(driverCar);
  if (o === d) return true;
  return (o.includes('labo') || o.includes('damas')) && (d.includes('labo') || d.includes('damas'));
}

/** Qat'iy: to'g'ri yo'nalish yoki backhaul */
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
