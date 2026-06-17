const REGIONS = ['Toshkent', 'Vodiy', 'Samarqand', 'Buxoro', 'Voha'];

const CAR_TYPES = ['Labo/Damas', 'Gazel', 'Isuzu', 'Fura'];

/** Marshrut wizard — 6 ta asosiy viloyat markazi */
const DRIVER_WIZARD_REGIONS = [
  { slug: 'toshkent',  label: 'Toshkent'  },
  { slug: 'fargona',   label: "Farg'ona"  },
  { slug: 'andijon',   label: 'Andijon'   },
  { slug: 'namangan',  label: 'Namangan'  },
  { slug: 'samarqand', label: 'Samarqand' },
  { slug: 'buxoro',    label: 'Buxoro'    },
];

/** @deprecated — routeMatch uchun */
const DRIVER_CITIES = DRIVER_WIZARD_REGIONS.map((r) => ({
  ...r,
  region: r.label === 'Toshkent' ? 'Toshkent' : r.label === 'Samarqand' ? 'Samarqand' : r.label === 'Buxoro' ? 'Buxoro' : 'Vodiy',
}));

/** Shahar label → REGIONS dagi region nomi */
function cityLabelToRegion(label) {
  const found = DRIVER_CITIES.find((c) => c.label === label || c.slug === label);
  return found?.region ?? label;
}

/** Slug → display label */
function citySlugToLabel(slug) {
  const found = DRIVER_WIZARD_REGIONS.find((c) => c.slug === slug);
  return found?.label ?? slug;
}

function wizardSlugToLabel(slug) {
  return citySlugToLabel(slug);
}

const ROLES = {
  CLIENT: 'role_client',
  DRIVER: 'role_driver',
};

const ORDER_STATUS = {
  ACTIVE: 'active',
  TAKEN: 'taken',
};

const DRIVER_STATUS = {
  ACTIVE: 'active',
  BUSY: 'busy',
};

/** All directed region pairs (from !== to) for driver route selection */
const ROUTES = REGIONS.flatMap((from) =>
  REGIONS.filter((to) => to !== from).map((to) => `${from}-${to}`)
);

const GEMINI_SYSTEM_INSTRUCTION = `Extract logistics data from Uzbek Telegram cargo group messages.
Return strict raw JSON only (no markdown) with keys: from_region, to_region, car_type, cargo_details, phone_number.

Normalize regions to exactly: Toshkent, Vodiy, Samarqand, Buxoro, Voha.
Normalize car_type to exactly: Labo/Damas, Gazel, Isuzu, Fura.
phone_number must include country code (+998...).

If spam, advertisement, or not a cargo transport offer, return {"error": "spam"}.

Example input: "Toshkentdan Vodiyga 5t yuk. Isuzu kerak. 3mln. +998901234567"
Example output: {"from_region":"Toshkent","to_region":"Vodiy","car_type":"Isuzu","cargo_details":"5t yuk, 3mln","phone_number":"+998901234567"}`;

/** Cargo groups: karvon.env da CARGO_GROUPS=@guruh1,@guruh2 yoki shu yerga yozing */
function loadCargoGroups() {
  const fromEnv = (process.env.CARGO_GROUPS || '')
    .split(',')
    .map((g) => g.trim().replace(/^@/, ''))
    .filter(Boolean);

  const hardcoded = [
    // 'logistika_guruhi',
    // '-1001234567890',
  ].filter(Boolean);

  return fromEnv.length > 0 ? fromEnv : hardcoded;
}

const CARGO_GROUPS = loadCargoGroups();

module.exports = {
  REGIONS,
  CAR_TYPES,
  DRIVER_WIZARD_REGIONS,
  DRIVER_CITIES,
  cityLabelToRegion,
  citySlugToLabel,
  wizardSlugToLabel,
  ROLES,
  ORDER_STATUS,
  DRIVER_STATUS,
  ROUTES,
  GEMINI_SYSTEM_INSTRUCTION,
  CARGO_GROUPS,
};
