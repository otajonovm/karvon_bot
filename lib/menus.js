const { Markup } = require('telegraf');
const { DRIVER_WIZARD_REGIONS, BODY_TYPES, DRIVER_STATUS } = require('../config/constants');

const BTN_POST_CARGO = '📦 Yuk Joylash';
const BTN_FIND_CARGO = '⛟ Yuk Izlash';
const BTN_FIND_CARGO_LEGACY = '🚛 Yuk Izlash';
const BTN_MY_STATUS = '🪪 Shaxsiy Kabinet';
const BTN_MY_STATUS_LEGACY = '🪪 Profilim';
const BTN_SHOWCASE = '🔍 Reyslar Vitrinasi';
const BTN_ADMIN = '📊 Admin';

const BTN_SEEKING = '🟢 Yuk qidiryapman';
const BTN_BUSY = "🔴 Yo'ldaman";
const BTN_BACK_MAIN = '↩️ Bosh menyu';

const MSG_POST_CARGO_SOON = '';

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

function mainMenuKeyboard({ isAdmin = false } = {}) {
  const rows = [
    [BTN_POST_CARGO],
    [BTN_FIND_CARGO, BTN_SHOWCASE],
    [BTN_MY_STATUS],
  ];
  if (isAdmin) rows.push([BTN_ADMIN]);
  return Markup.keyboard(rows).resize().persistent();
}

function statusScreenKeyboard() {
  return Markup.keyboard([[BTN_SEEKING, BTN_BUSY], [BTN_BACK_MAIN]]).resize();
}

function driverCarKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🚚 Fura', 'drv_car_fura'),
      Markup.button.callback('🚛 Isuzu', 'drv_car_isuzu'),
    ],
    [
      Markup.button.callback('🛻 Gazel', 'drv_car_gazel'),
      Markup.button.callback('🚙 Labo', 'drv_car_labo'),
    ],
  ]);
}

function driverBodyKeyboard() {
  return Markup.inlineKeyboard(
    BODY_TYPES.map((b) => [Markup.button.callback(`${b.emoji} ${b.label}`, `drv_body_${b.slug}`)])
  );
}

function driverNameKeyboard(tgName) {
  const short = String(tgName || 'Telegram ismimni olish').slice(0, 40);
  return Markup.inlineKeyboard([[Markup.button.callback(`👤 ${short}`, 'drv_name_tg')]]);
}

function driverRegionKeyboard(prefix, { extra = [] } = {}) {
  const rows = extra.map((row) => row);
  for (let i = 0; i < DRIVER_WIZARD_REGIONS.length; i += 2) {
    rows.push(
      DRIVER_WIZARD_REGIONS.slice(i, i + 2).map((r) =>
        Markup.button.callback(r.label, `${prefix}_${r.slug}`)
      )
    );
  }
  return Markup.inlineKeyboard(rows);
}

function driverRoutePresetKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🌍 Butun O'zbekiston", 'drv_rt_all')],
    [Markup.button.callback("Toshkent ⇄ Farg'ona vodiysi", 'drv_rt_vodiy')],
    [Markup.button.callback('Toshkent ⇄ Samarqand / Buxoro', 'drv_rt_sam')],
    [Markup.button.callback('Toshkent ⇄ Qashqadaryo / Surxondaryo', 'drv_rt_south')],
    [Markup.button.callback("🎯 Aniq yo'nalish (O'zim tanlayman)", 'drv_rt_custom')],
  ]);
}

function cabinetInlineKeyboard(profile) {
  const busy = profile?.status === DRIVER_STATUS.BUSY;
  const statusBtn = busy
    ? Markup.button.callback("🟢 Bo'shman (Reys kutyapman)", 'driver_toggle_status')
    : Markup.button.callback("🔴 Bandman (Yo'ldaman)", 'driver_toggle_status');
  return Markup.inlineKeyboard([
    [statusBtn],
    [Markup.button.callback("🔄 Hozirgi joylashuvni o'zgartirish", 'change_location')],
    [Markup.button.callback('🚚 Mashinani tahrirlash', 'edit_truck')],
  ]);
}

function showcaseChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Mening marshrutim bo'yicha", 'vit_mine')],
    [Markup.button.callback('Boshqa viloyatdan qidirish', 'vit_other')],
  ]);
}

module.exports = {
  BTN_POST_CARGO,
  BTN_FIND_CARGO,
  BTN_FIND_CARGO_LEGACY,
  BTN_MY_STATUS,
  BTN_MY_STATUS_LEGACY,
  BTN_SHOWCASE,
  BTN_ADMIN,
  BTN_SEEKING,
  BTN_BUSY,
  BTN_BACK_MAIN,
  MSG_POST_CARGO_SOON,
  mainMenuKeyboard,
  statusScreenKeyboard,
  driverCarKeyboard,
  driverBodyKeyboard,
  driverNameKeyboard,
  driverRegionKeyboard,
  driverRoutePresetKeyboard,
  cabinetInlineKeyboard,
  showcaseChoiceKeyboard,
  brokerCarKeyboard,
  brokerRegionKeyboard,
};
