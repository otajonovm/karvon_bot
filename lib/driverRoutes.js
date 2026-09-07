const { DRIVER_WIZARD_REGIONS } = require('../config/constants');
const { regionsTextMatch, carTypesMatch, bodyTypesMatch, inferOrderBodyType } = require('./routeMatch');

const ALL_ROUTES = 'ALL_ROUTES';
const ANY_DEST = 'ANY_DEST';

const VODIY = ["Farg'ona", 'Andijon', 'Namangan'];
const SAM_BUX = ['Samarqand', 'Buxoro'];
const SOUTH = ['Qashqadaryo', 'Surxondaryo'];

const ROUTE_PRESETS = {
  all: {
    id: 'all',
    routes: [ALL_ROUTES],
    origins: null,
    label: "Har qanday yo'nalish (Barcha viloyatlar)",
    short: "Butun O'zbekiston",
  },
  vodiy: {
    id: 'vodiy',
    origins: ['Toshkent', ...VODIY],
    label: "Toshkent ⇄ Farg'ona vodiysi",
    short: "Toshkent ⇄ Vodiy",
  },
  sam: {
    id: 'sam',
    origins: ['Toshkent', ...SAM_BUX],
    label: 'Toshkent ⇄ Samarqand / Buxoro',
    short: 'Toshkent ⇄ Samarqand/Buxoro',
  },
  south: {
    id: 'south',
    origins: ['Toshkent', ...SOUTH],
    label: 'Toshkent ⇄ Qashqadaryo / Surxondaryo',
    short: 'Toshkent ⇄ Qashqa/Surxon',
  },
};

function parsePreferredRoutes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      if (raw === ALL_ROUTES) return [ALL_ROUTES];
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function hasAllRoutes(driver) {
  const routes = parsePreferredRoutes(driver?.preferred_routes);
  if (routes.includes(ALL_ROUTES)) return true;
  if (driver?.preferred_route === ALL_ROUTES) return true;
  if (driver?.from_region === ALL_ROUTES) return true;
  return false;
}

function corridorOrigins(presetId) {
  return ROUTE_PRESETS[presetId]?.origins || [];
}

function detectPreset(driver) {
  if (hasAllRoutes(driver)) return 'all';
  const routes = parsePreferredRoutes(driver?.preferred_routes).map(String);
  for (const [id, preset] of Object.entries(ROUTE_PRESETS)) {
    if (!preset.origins) continue;
    const same =
      preset.origins.length === routes.length &&
      preset.origins.every((c) => routes.includes(c));
    if (same) return id;
  }
  return 'custom';
}

function formatRouteLabel(driver) {
  if (!driver) return '—';
  const preset = detectPreset(driver);
  if (preset !== 'custom') return ROUTE_PRESETS[preset].short;

  const loc = driver.current_location || driver.from_region;
  const dest = driver.to_region;
  if (!loc) return 'Sozlanmagan';
  if (!dest || dest === ANY_DEST || dest === ALL_ROUTES) {
    return `${loc} ➔ istalgan viloyat`;
  }
  return `${loc} ➔ ${dest}`;
}

function matchOrigins(driver) {
  if (hasAllRoutes(driver)) return [ALL_ROUTES];
  const routes = parsePreferredRoutes(driver?.preferred_routes);
  const origins = [];
  if (driver?.current_location) origins.push(driver.current_location);
  for (const r of routes) {
    if (r === ALL_ROUTES || r === ANY_DEST) continue;
    if (typeof r === 'string') origins.push(r);
  }
  if (driver?.from_region && driver.from_region !== ALL_ROUTES) {
    origins.push(driver.from_region);
  }
  return [...new Set(origins)];
}

function hasAnyDest(driver) {
  const routes = parsePreferredRoutes(driver?.preferred_routes);
  if (routes.includes(ANY_DEST)) return true;
  if (driver?.to_region === ANY_DEST) return true;
  return false;
}

/**
 * Push: ALL_ROUTES → mashina + kuzov.
 * Aniq hudud → from_region va to_region haydovchi zonalariga mos.
 */
function driverMatchesOrder(driver, order) {
  if (!driver || !order) return false;
  if (!carTypesMatch(order.car_type, driver.car_type ?? driver.truck_type)) return false;
  if (!bodyTypesMatch(inferOrderBodyType(order), driver.body_type)) return false;
  if (hasAllRoutes(driver)) return true;

  const zones = matchOrigins(driver).filter((z) => z && z !== ALL_ROUTES);
  const fromOk = zones.some((z) => regionsTextMatch(order.from_region, z));
  if (!fromOk) return false;
  if (hasAnyDest(driver)) return true;

  const toOk =
    zones.some((z) => regionsTextMatch(order.to_region, z)) ||
    regionsTextMatch(order.to_region, driver.to_region);
  return toOk;
}

function buildSaveFields({ presetId, current_location, dest, truck_type, truck_number, status }) {
  const loc = current_location || null;
  if (presetId === 'all') {
    return {
      truck_type,
      truck_number,
      status,
      preferred_routes: [ALL_ROUTES],
      current_location: loc,
      from_region: loc || 'Toshkent',
      to_region: ALL_ROUTES,
      preferred_route: ALL_ROUTES,
    };
  }
  if (ROUTE_PRESETS[presetId]?.origins) {
    const origins = ROUTE_PRESETS[presetId].origins;
    return {
      truck_type,
      truck_number,
      status,
      preferred_routes: origins,
      current_location: loc || origins[0],
      from_region: loc || origins[0],
      to_region: origins.find((c) => c !== (loc || origins[0])) || origins[0],
      preferred_route: ROUTE_PRESETS[presetId].short,
    };
  }
  const to = dest === ANY_DEST || !dest ? ANY_DEST : dest;
  return {
    truck_type,
    truck_number,
    status,
    preferred_routes: to === ANY_DEST ? [loc, ANY_DEST].filter(Boolean) : [loc, to].filter(Boolean),
    current_location: loc,
    from_region: loc || 'Toshkent',
    to_region: to,
    preferred_route: formatRouteLabel({
      current_location: loc,
      from_region: loc,
      to_region: to,
      preferred_routes: [],
    }),
  };
}

function regionBySlug(slug) {
  return DRIVER_WIZARD_REGIONS.find((r) => r.slug === slug) || null;
}

module.exports = {
  ALL_ROUTES,
  ANY_DEST,
  ROUTE_PRESETS,
  parsePreferredRoutes,
  hasAllRoutes,
  detectPreset,
  formatRouteLabel,
  matchOrigins,
  driverMatchesOrder,
  buildSaveFields,
  regionBySlug,
  corridorOrigins,
};
