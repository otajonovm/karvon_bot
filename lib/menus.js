const { Markup } = require('telegraf');
const { DRIVER_WIZARD_REGIONS } = require('../config/constants');

const BTN_POST_CARGO = '📦 Yuk Joylash';
const BTN_FIND_CARGO = '🚛 Yuk Izlash';
const BTN_MY_STATUS = '🪪 Profilim';

const BTN_SEEKING = '🟢 Yuk qidiryapman';
const BTN_BUSY = "🔴 Yo'ldaman";
const BTN_BACK_MAIN = '↩️ Bosh menyu';

const MSG_POST_CARGO_SOON = '';

/** Broker wizard — mashina turi */
function brokerCarKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Fura', 'brk_car_fura'),
      Markup.button.callback('Isuzu', 'brk_car_isuzu'),
    ],
    [
      Markup.button.callback('Gazel', 'brk_car_gazel'),
      Markup.button.callback('Labo', 'brk_car_labo'),
    ],
  ]);
}

/** Broker wizard — viloyat (2 ustun) */
function brokerRegionKeyboard(prefix) {
  const rows = [];
  for (let i = 0; i < DRIVER_WIZARD_REGIONS.length; i += 2) {
    rows.push(
      DRIVER_WIZARD_REGIONS.slice(i, i + 2).map((r) =>
        Markup.button.callback(r.label, `${prefix}_${r.slug}`)
      )
    );
  }
  return Markup.inlineKeyboard(rows);
}

function mainMenuKeyboard() {
  return Markup.keyboard([[BTN_POST_CARGO], [BTN_FIND_CARGO], [BTN_MY_STATUS]])
    .resize()
    .persistent();
}

function statusScreenKeyboard() {
  return Markup.keyboard([[BTN_SEEKING, BTN_BUSY], [BTN_BACK_MAIN]]).resize();
}

/** 1-qadam: mashina turi */
function driverCarKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Fura', 'drv_car_fura'),
      Markup.button.callback('Isuzu', 'drv_car_isuzu'),
    ],
    [
      Markup.button.callback('Gazel', 'drv_car_gazel'),
      Markup.button.callback('Labo', 'drv_car_labo'),
    ],
  ]);
}

/** 2/3-qadam: viloyat tanlash — 2 ustun */
function driverRegionKeyboard(prefix) {
  const rows = [];
  for (let i = 0; i < DRIVER_WIZARD_REGIONS.length; i += 2) {
    rows.push(
      DRIVER_WIZARD_REGIONS.slice(i, i + 2).map((r) =>
        Markup.button.callback(r.label, `${prefix}_${r.slug}`)
      )
    );
  }
  return Markup.inlineKeyboard(rows);
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
  driverRegionKeyboard,
  brokerCarKeyboard,
  brokerRegionKeyboard,
};
