const { Markup } = require('telegraf');

const BTN_SEEKING = '🟢 Yuk qidiryapman';
const BTN_BUSY = '🔴 Bandman';

function driverStatusKeyboard() {
  return Markup.keyboard([[BTN_SEEKING, BTN_BUSY]]).resize();
}

module.exports = { BTN_SEEKING, BTN_BUSY, driverStatusKeyboard };
