const { CANONICAL_CITIES } = require('../config/constants');
const { normalizeRegion, normalizeCarType } = require('./normalize');

/** Eski formatlar → 8 ta markaz */
const LEGACY_TO_CITIES = {
  Vodiy: ["Farg'ona", 'Andijon', 'Namangan'],
  Voha: ['Qashqadaryo', 'Surxondaryo'],
};

/** Mashina sig'imi: kichik → katta. Haydovchi bir pog'ona katta mashina bilan ham mos. */
const TRUCK_RANK = {
  'labo/damas': 1,
  labo: 1,
  damas: 1,
  gazel: 2,
  isuzu: 3,
  fura: 4,
};

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[''`ʻʼ\u02BC\u2018\u2019]/g, "'");
}

function expandToCities(name) {
  const n = norm(name);
  for (const city of CANONICAL_CITIES) {
    if (norm(city) === n) return [city];
  }
  for (const [legacy, cities] of Object.entries(LEGACY_TO_CITIES)) {
    if (norm(legacy) === n) return cities;
  }
  return [name];
}

/**
 * Tuman / shahar / viloyat nomini bosh viloyat ID(lar)iga aylantiradi.
 * "Qo'qon" → Farg'ona, "Toshkent, Chirchiq" → Toshkent.
 */
function provinceIds(name) {
  if (!name) return [];
  const parts = String(name)
    .split(/[,\/|–—+~]|➔|→|-/g)
    .map((p) => p.trim())
    .filter(Boolean);

  const ids = new Set();
  for (const part of parts.length ? parts : [name]) {
    const canonical = normalizeRegion(part);
    if (canonical) {
      ids.add(canonical);
      continue;
    }
    for (const city of expandToCities(part)) {
      const mapped = normalizeRegion(city) || city;
      if (mapped) ids.add(mapped);
    }
  }
  return [...ids];
}

function regionsTextMatch(a, b) {
  if (!a || !b) return false;
  const setA = provinceIds(a).map(norm);
  const setB = provinceIds(b).map(norm);
  if (setA.length === 0 || setB.length === 0) return false;
  return setA.some((x) => setB.includes(x));
}

function orderTruckType(order) {
  return order?.truck_type || order?.car_type || null;
}

function driverTruckType(driver) {
  return driver?.truck_type || driver?.car_type || null;
}

function truckRank(value) {
  const canonical = normalizeCarType(value) || value;
  return TRUCK_RANK[norm(canonical)] || 0;
}

/**
 * Aniq tur yoki mos sig'im: haydovchi bir pog'ona katta mashina bilan ham qabul qiladi.
 * Labo/Damas bir xil sinf. Fura haydovchiga Labo yuk ketmaydi.
 */
function carTypesMatch(orderCar, driverCar) {
  if (!orderCar || !driverCar) return false;
  const o = normalizeCarType(orderCar) || orderCar;
  const d = normalizeCarType(driverCar) || driverCar;
  if (norm(o) === norm(d)) return true;

  const oRank = truckRank(o);
  const dRank = truckRank(d);
  if (!oRank || !dRank) return false;
  return dRank >= oRank && dRank - oRank <= 1;
}

function twoWayRouteMatch(driver, order) {
  const dFrom = driver.from_region;
  const dTo = driver.to_region;
  const oFrom = order.from_region;
  const oTo = order.to_region;
  if (!dFrom || !dTo || !oFrom || !oTo) return false;

  const forward = regionsTextMatch(oFrom, dFrom) && regionsTextMatch(oTo, dTo);
  const backhaul = regionsTextMatch(oFrom, dTo) && regionsTextMatch(oTo, dFrom);
  return forward || backhaul;
}

/** To'g'ri yo'nalish yoki backhaul + mashina turi + tuman→viloyat */
function routeMatchesOrder(driver, order) {
  if (!driver || !order) return false;
  if (!carTypesMatch(orderTruckType(order), driverTruckType(driver))) return false;
  return twoWayRouteMatch(driver, order);
}

module.exports = {
  regionsTextMatch,
  carTypesMatch,
  routeMatchesOrder,
  provinceIds,
  orderTruckType,
  driverTruckType,
  twoWayRouteMatch,
};
