/** AI va filtrlash uchun 8 ta bosh viloyat markazi */
const CANONICAL_CITIES = [
  'Toshkent',
  "Farg'ona",
  'Andijon',
  'Namangan',
  'Samarqand',
  'Buxoro',
  'Qashqadaryo',
  'Surxondaryo',
];

const REGIONS = CANONICAL_CITIES;

const CAR_TYPES = ['Labo/Damas', 'Gazel', 'Isuzu', 'Fura'];

/** Marshrut wizard — 8 ta viloyat */
const DRIVER_WIZARD_REGIONS = [
  { slug: 'toshkent',  label: 'Toshkent'     },
  { slug: 'fargona',   label: "Farg'ona"     },
  { slug: 'andijon',   label: 'Andijon'      },
  { slug: 'namangan',  label: 'Namangan'     },
  { slug: 'samarqand', label: 'Samarqand'    },
  { slug: 'buxoro',    label: 'Buxoro'       },
  { slug: 'qashqa',    label: 'Qashqadaryo'  },
  { slug: 'surxon',    label: 'Surxondaryo' },
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

Normalize regions to EXACTLY one of: Toshkent, Farg'ona, Andijon, Namangan, Samarqand, Buxoro, Qashqadaryo, Surxondaryo.
Map sub-cities: Qo'qon/Marg'ilon/Rishton→Farg'ona; Asaka/Shahrixon→Andijon; Chust/Pop→Namangan; Termiz→Surxondaryo; Qarshi→Qashqadaryo.
Never use Vodiy or Voha — always pick the specific province center above.
Normalize car_type to exactly: Labo/Damas, Gazel, Isuzu, Fura.
phone_number must include country code (+998...).

If spam, advertisement, or not a cargo transport offer, return {"error": "spam"}.

Example: "Toshkentdan Qo'qonga 5t yuk. Fura. +998901234567"
Output: {"from_region":"Toshkent","to_region":"Farg'ona","car_type":"Fura","cargo_details":"5t yuk","phone_number":"+998901234567"}`;

/** Guruh/kanal ID (scraper va crosspost uchun) */
function isGroupChatRef(ref) {
  const s = String(ref).trim();
  if (!s) return false;
  if (s.startsWith('@')) return true;
  if (s.startsWith('-')) return true;
  // Faqat musbat raqam — odatda user lichka ID, guruh emas
  return !/^\d+$/.test(s);
}

/** Cargo groups — ROYAL guruh scraper dan chiqariladi (bot boshqaradi) */
function loadCargoGroups() {
  const royal = (process.env.ROYAL_CARGO_GROUP_ID || '').trim();
  const fromEnv = (process.env.CARGO_GROUPS || '')
    .split(',')
    .map((g) => g.trim().replace(/^@/, ''))
    .filter(Boolean)
    .filter(isGroupChatRef)
    .filter((g) => !royal || g !== royal);

  const hardcoded = [
    // 'logistika_guruhi',
    // '-1001234567890',
  ].filter(Boolean);

  return fromEnv.length > 0 ? fromEnv : hardcoded;
}

const CARGO_GROUPS = loadCargoGroups();

/** Guruhlarga tarqatish — CROSSPOST_GROUPS yoki CARGO_GROUPS */
function loadCrosspostGroups() {
  const fromEnv = (process.env.CROSSPOST_GROUPS || '')
    .split(',')
    .map((g) => g.trim().replace(/^@/, ''))
    .filter(Boolean)
    .filter(isGroupChatRef);

  return fromEnv.length > 0 ? fromEnv : CARGO_GROUPS;
}

const CROSSPOST_GROUPS = loadCrosspostGroups();

/** Broker yuklari tashlanadigan lichkalar (Telegram user ID, vergul bilan) */
function loadCrosspostDmIds() {
  return (process.env.CROSSPOST_DM_ID || '')
    .split(',')
    .map((id) => id.trim().replace(/^@/, ''))
    .filter(Boolean);
}

const CROSSPOST_DM_IDS = loadCrosspostDmIds();

/** Rasmiy Karvon guruh — har safar env dan o'qiladi */
function getRoyalCargoGroupId() {
  return (process.env.ROYAL_CARGO_GROUP_ID || '').trim() || null;
}

const BOT_USERNAME = (process.env.BOT_USERNAME || 'karvongo_bot').replace(/^@/, '');
const BOT_PUBLIC_URL = process.env.BOT_PUBLIC_URL || `https://t.me/${BOT_USERNAME}`;

/** STRICT_FILTERS=1 bo'lsa — qattiq spam/marshrut filtri. Default: yumshoq (ko'proq yuk o'tadi). */
function isStrictFilters() {
  return process.env.STRICT_FILTERS === '1';
}

/** Barcha faol haydovchilarga yuborish (marshrutdan qat'i nazar). Default: yoqilgan. */
function notifyAllDrivers() {
  return process.env.NOTIFY_ALL_DRIVERS !== '0';
}

module.exports = {
  REGIONS,
  CANONICAL_CITIES,
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
  CROSSPOST_GROUPS,
  CROSSPOST_DM_IDS,
  getRoyalCargoGroupId,
  BOT_USERNAME,
  BOT_PUBLIC_URL,
  isStrictFilters,
  notifyAllDrivers,
};
