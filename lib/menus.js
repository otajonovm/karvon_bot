const { Markup } = require('telegraf');

const BTN_POST_CARGO = '📦 Yuk Joylashtirish (Tekin)';
const BTN_FIND_CARGO = '🚛 Yuk Izlash / Profilni Sozlash';
const BTN_MY_STATUS = '⚙️ Mening Holatim';

const BTN_SEEKING = '🟢 Yuk qidiryapman';
const BTN_BUSY = '🔴 Bandman';

const MSG_POST_CARGO_SOON =
  "Tez orada brokerlar, logistlar va zavodlar uchun to'g'ridan-to'g'ri yuk joylash bo'limi 100% ishga tushadi! " +
  "Hozircha tizim guruhlardan yuklarni avtomat yig'ish rejimida ishlamoqda.";

function mainMenuKeyboard() {
  return Markup.keyboard([[BTN_POST_CARGO], [BTN_FIND_CARGO], [BTN_MY_STATUS]])
    .resize()
    .persistent();
}

function driverToggleKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(BTN_SEEKING, 'driver_set_active'),
      Markup.button.callback(BTN_BUSY, 'driver_set_busy'),
    ],
  ]);
}

module.exports = {
  BTN_POST_CARGO,
  BTN_FIND_CARGO,
  BTN_MY_STATUS,
  BTN_SEEKING,
  BTN_BUSY,
  MSG_POST_CARGO_SOON,
  mainMenuKeyboard,
  driverToggleKeyboard,
};
