const { Markup } = require('telegraf');
const { DRIVER_CITIES } = require('../config/constants');

// ─── Reply keyboard button labels ────────────────────────────────────────────

const BTN_POST_CARGO = '📦 Yuk Joylashtirish (Tekin)';
const BTN_FIND_CARGO = '🚛 Yuk Izlash / Profilni Sozlash';
const BTN_MY_STATUS = '⚙️ Mening Holatim';

const BTN_SEEKING = '🟢 Yuk qidiryapman';
const BTN_BUSY = '🔴 Yo\'ldaman';
const BTN_BACK_MAIN = '↩️ Bosh menyu';

const MSG_POST_CARGO_SOON =
  "Tez orada brokerlar, logistlar va zavodlar uchun to'g'ridan-to'g'ri yuk joylash bo'limi 100% ishga tushadi! " +
  "Hozircha tizim guruhlardan yuklarni avtomat yig'ish rejimida ishlamoqda.";

// ─── Reply keyboards ──────────────────────────────────────────────────────────

function mainMenuKeyboard() {
  return Markup.keyboard([[BTN_POST_CARGO], [BTN_FIND_CARGO], [BTN_MY_STATUS]])
    .resize()
    .persistent();
}

/** Status ekranida ko'rsatiladigan pastki klaviatura */
function statusScreenKeyboard() {
  return Markup.keyboard([
    [BTN_SEEKING, BTN_BUSY],
    [BTN_BACK_MAIN],
  ]).resize();
}

// ─── Inline keyboards (driver profile wizard) ────────────────────────────────

/** 1-qadam: mashina turi tanlash */
function driverCarKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚐 Labo/Damas', 'drv_car_labo'),
      Markup.button.callback('🚐 Gazel',       'drv_car_gazel'),
    ],
    [
      Markup.button.callback('🚛 Isuzu',  'drv_car_isuzu'),
      Markup.button.callback('🚚 Fura',   'drv_car_fura'),
    ],
  ]);
}

/** 2-qadam: asosiy yo'nalish (shahar) tanlash — 2 ustun */
function driverCityKeyboard() {
  const rows = [];
  for (let i = 0; i < DRIVER_CITIES.length; i += 2) {
    const pair = DRIVER_CITIES.slice(i, i + 2).map((c) =>
      Markup.button.callback(c.label, `drv_city_${c.slug}`)
    );
    rows.push(pair);
  }
  return Markup.inlineKeyboard(rows);
}

/** Eski inline toggle — orqaga muvofiqlik uchun saqlanadi */
function driverToggleKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🟢 Yuk qidiryapman', 'driver_set_active'),
      Markup.button.callback("🔴 Yo'ldaman",         'driver_set_busy'),
    ],
  ]);
}

module.exports = {
  BTN_POST_CARGO,
  BTN_FIND_CARGO,
  BTN_MY_STATUS,
  BTN_SEEKING,
  BTN_BUSY,
  BTN_BACK_MAIN,
  MSG_POST_CARGO_SOON,
  mainMenuKeyboard,
  statusScreenKeyboard,
  driverCarKeyboard,
  driverCityKeyboard,
  driverToggleKeyboard,
};
