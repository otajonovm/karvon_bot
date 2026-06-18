require('./config/env');

console.log('[bot] Karvon index.js yuklanmoqda...');

if (process.env.PORT && !process.env.KARVON_CHILD) {
  require('./lib/healthServer').startHealthServer();
}

const { Telegraf, Markup } = require('telegraf');
const { getSupabase } = require('./lib/supabase');
const {
  notifyMatchingDrivers,
  markOrderTakenForOthers,
  acceptOrder,
} = require('./lib/notifications');
const { insertOrder, insertBrokerOrder } = require('./lib/orders');
const { normalizePhone } = require('./lib/normalize');
const { REGIONS, CAR_TYPES, ROLES, DRIVER_STATUS, DRIVER_WIZARD_REGIONS, wizardSlugToLabel } = require('./config/constants');
const {
  BTN_POST_CARGO,
  BTN_FIND_CARGO,
  BTN_MY_STATUS,
  BTN_SEEKING,
  BTN_BUSY,
  BTN_BACK_MAIN,
  mainMenuKeyboard,
  statusScreenKeyboard,
  driverCarKeyboard,
  driverRegionKeyboard,
  brokerCarKeyboard,
  brokerRegionKeyboard,
} = require('./lib/menus');
const { upsertDriverProfile, setDriverStatus, getDriverProfile } = require('./lib/drivers');
const { getUserById, upsertUserPhone } = require('./lib/users');
const { buildStatusMessage, ensureDriverRole } = require('./lib/statusPanel');
const { ensureBroker } = require('./lib/brokers');
const { findDriversForBroker, formatDriverList } = require('./lib/brokerMatching');
const { crosspostToDm } = require('./lib/crosspost');
const { getActiveClient } = require('./lib/userbotClient');
const { handleRoyalGroupMessage } = require('./lib/groupSecurity');
const { postOrderToRoyalGroup } = require('./lib/royalGroupPost');
const { getRoyalCargoGroupId } = require('./config/constants');

// ─── Validate env ────────────────────────────────────────────────────────────

const { validateEnv, printEnvHelp } = require('./lib/validateEnv');
const missing = validateEnv();
if (missing.length) {
  for (const key of missing) {
    console.error(`Missing required env variable: ${key}`);
  }
  printEnvHelp(missing);
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = getSupabase();

const royalGroupId = getRoyalCargoGroupId();
if (royalGroupId) {
  console.log(`[bot] Rasmiy guruh nazorati: ${royalGroupId}`);
  console.log('[bot] Tavsiya: BotFather → /setprivacy → Disable (guruh xabarlarini ko\'rish)');
} else {
  console.warn('[bot] ROYAL_CARGO_GROUP_ID yo\'q — karvon.env ga qo\'shing!');
}

// Guruh xabarlari — doim faol (rasmiy guruh moderatsiyasi)
bot.on('message', async (ctx, next) => {
  try {
    const handled = await handleRoyalGroupMessage(ctx);
    if (handled) return;
  } catch (err) {
    console.error('[group-security] handler:', err.message);
  }
  return next();
});

// In-memory broker yuk joylash wizard
const brokerSessions = new Map();
const pendingBroker = new Set();

// Eski /neworder wizard
const wizardSessions = new Map();

// Haydovchi profil wizard
const profileSessions = new Map();

const CAR_SLUG_MAP = {
  fura: 'Fura',
  isuzu: 'Isuzu',
  gazel: 'Gazel',
  labo: 'Labo/Damas',
};

const MENU_BUTTONS = new Set([
  BTN_POST_CARGO,
  BTN_FIND_CARGO,
  BTN_MY_STATUS,
  BTN_SEEKING,
  BTN_BUSY,
  BTN_BACK_MAIN,
]);

const WIZARD_STEPS = {
  FROM: 'from',
  TO: 'to',
  CAR: 'car',
  DETAILS: 'details',
  SUMMARY: 'summary',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkButtons(items, prefix, cols = 2) {
  const rows = [];
  for (let i = 0; i < items.length; i += cols) {
    rows.push(
      items.slice(i, i + cols).map((item) =>
        Markup.button.callback(item, `${prefix}_${item}`)
      )
    );
  }
  return rows;
}

function regionKeyboard(prefix) {
  return Markup.inlineKeyboard(chunkButtons(REGIONS, prefix));
}


function clearWizard(userId) {
  wizardSessions.delete(userId);
}

function clearProfile(userId) {
  profileSessions.delete(userId);
}

async function sendMainMenu(ctx, text) {
  await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard() });
}

function clearBroker(userId) {
  brokerSessions.delete(userId);
}

async function beginBrokerWizard(ctx, phone) {
  const userId = ctx.from.id;
  await ensureBroker(userId, phone);

  const sent = await ctx.reply('🚚 Moshina turi:', brokerCarKeyboard());
  brokerSessions.set(userId, {
    step: 'car_type',
    phone,
    chatId: sent.chat.id,
    messageId: sent.message_id,
  });
}

async function startBrokerFlow(ctx) {
  const userId = ctx.from.id;
  const user = await getUserById(userId);

  if (!user?.phone) {
    pendingBroker.add(userId);
    return ctx.reply(
      '📱 Davom etish uchun telefon raqamingizni yuboring:',
      Markup.keyboard([Markup.button.contactRequest('📱 Telefon raqamni yuborish')])
        .oneTime()
        .resize()
    );
  }

  await beginBrokerWizard(ctx, user.phone);
}

async function beginDriverProfileFlow(ctx) {
  const userId = ctx.from.id;
  const user = await getUserById(userId);

  if (!user?.phone) {
    return ctx.reply('Avval telefon raqamingizni ulashing — /start bosing.', Markup.removeKeyboard());
  }

  await ensureDriverRole(userId);

  const sent = await ctx.reply('Moshina turi:', driverCarKeyboard());
  profileSessions.set(userId, {
    step: 'car_type',
    chatId: sent.chat.id,
    messageId: sent.message_id,
  });
}

// ─── /start ──────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    const user = await getUserById(ctx.from.id);

    if (user?.phone) {
      return sendMainMenu(
        ctx,
        '👋 <b>Karvonga xush kelibsiz!</b>\n\n' +
          'Yuk joylashtirish, izlash va holatingizni boshqarish uchun pastdagi menyudan foydalaning.'
      );
    }

    await ctx.reply(
      "👋 <b>Karvon</b>ga xush kelibsiz!\n\n" +
        'Davom etish uchun telefon raqamingizni yuboring.',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([
          Markup.button.contactRequest('📱 Telefon raqamni yuborish'),
        ])
          .oneTime()
          .resize(),
      }
    );
  } catch (err) {
    console.error('[start]', err.message);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.');
  }
});

// ─── Contact registration ────────────────────────────────────────────────────

bot.on('contact', async (ctx) => {
  const contact = ctx.message.contact;

  if (!contact || contact.user_id !== ctx.from.id) {
    return ctx.reply('Iltimos, o\'z telefon raqamingizni yuboring.');
  }

  const phone = contact.phone_number;
  const userId = ctx.from.id;

  try {
    await upsertUserPhone(userId, phone);

    await ctx.reply('✅ Raqamingiz saqlandi!', Markup.removeKeyboard());

    if (pendingBroker.has(userId)) {
      pendingBroker.delete(userId);
      await beginBrokerWizard(ctx, phone);
      return;
    }

    await sendMainMenu(
      ctx,
      '🎉 <b>Ro\'yxatdan o\'tdingiz!</b>\n\nKerakli bo\'limni tanlang:'
    );
  } catch (err) {
    console.error('[contact]', err.message);
    const rls = /row-level security/i.test(err.message);
    await ctx.reply(
      rls
        ? "⚠️ Bazada ruxsat yo'q (RLS). Admin `supabase/policies.sql` ni ishga tushirishi kerak."
        : "Ro'yxatdan o'tishda xatolik. Qayta /start bosing."
    );
  }
});

// ─── Asosiy menyu (Reply Keyboard) ───────────────────────────────────────────

bot.hears(BTN_POST_CARGO, async (ctx) => {
  try {
    await startBrokerFlow(ctx);
  } catch (err) {
    console.error('[post_cargo]', err.message);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.', mainMenuKeyboard());
  }
});

bot.hears(BTN_FIND_CARGO, async (ctx) => {
  try {
    await beginDriverProfileFlow(ctx);
  } catch (err) {
    console.error('[find_cargo]', err.message);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.', mainMenuKeyboard());
  }
});

bot.hears(BTN_MY_STATUS, async (ctx) => {
  try {
    const { text, hasProfile } = await buildStatusMessage(ctx.from.id);
    const keyboard = hasProfile ? statusScreenKeyboard() : mainMenuKeyboard();
    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  } catch (err) {
    console.error('[my_status]', err.message);
    await ctx.reply("Holatni yuklab bo'lmadi.", mainMenuKeyboard());
  }
});

bot.hears(BTN_BACK_MAIN, async (ctx) => {
  await sendMainMenu(ctx, '🏠 Asosiy menyu');
});

// ─── Role selection (eski inline xabarlar uchun) ─────────────────────────────

bot.action(/^role_(client|driver)$/, async (ctx) => {
  const role = ctx.match[1] === 'client' ? ROLES.CLIENT : ROLES.DRIVER;
  const userId = ctx.from.id;

  try {
    const { error } = await supabase
      .from('users')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;

    await ctx.answerCbQuery();

    if (role === ROLES.DRIVER) {
      await ctx.editMessageText(
        '🚛 Siz haydovchi sifatida ro\'yxatdan o\'tdingiz!\n\n' +
          '「🚛 Yuk Izlash」 tugmasini bosing.'
      );
      await sendMainMenu(ctx, 'Asosiy menyu:');
    } else {
      await ctx.editMessageText(
        '📦 Siz yuk egasi sifatida ro\'yxatdan o\'tdingiz!\n\n' +
          'Yangi buyurtma: /neworder'
      );
      await sendMainMenu(ctx, 'Asosiy menyu:');
    }
  } catch (err) {
    console.error('[role]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

// ─── /profile (driver) ───────────────────────────────────────────────────────

bot.command('profile', async (ctx) => {
  try {
    await beginDriverProfileFlow(ctx);
  } catch (err) {
    console.error('[profile]', err.message);
    await ctx.reply('Xatolik yuz berdi.');
  }
});

// ─── Driver profile wizard (4 qadam, bitta xabar edit) ───────────────────────

bot.action(/^drv_car_(.+)$/, async (ctx) => {
  const carType = CAR_SLUG_MAP[ctx.match[1]];
  if (!carType) return ctx.answerCbQuery('Noto\'g\'ri tanlov');

  const userId = ctx.from.id;
  const session = profileSessions.get(userId) || {};
  profileSessions.set(userId, { ...session, step: 'from_region', car_type: carType });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Moshina turi: <b>${carType}</b>\n\n` +
      '🔄 Yukni <b>QAYERDAN</b> olasiz?\n' +
      '<i>(Siz turgan yoki qatnaydigan asosiy joy)</i>',
    { parse_mode: 'HTML', ...driverRegionKeyboard('drv_from') }
  );
});

bot.action(/^drv_from_(.+)$/, async (ctx) => {
  const slug = ctx.match[1];
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);

  if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');
  if (!DRIVER_WIZARD_REGIONS.some((r) => r.slug === slug)) {
    return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  }

  const fromLabel = wizardSlugToLabel(slug);
  profileSessions.set(userId, { ...session, step: 'to_region', from_region: fromLabel });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Moshina: <b>${session.car_type}</b>\n` +
      `Qayerdan: <b>${fromLabel}</b>\n\n` +
      '🏁 Yukni <b>QAYERGA</b> yetkazasiz?\n' +
      '<i>(Boradigan asosiy joyingiz)</i>',
    { parse_mode: 'HTML', ...driverRegionKeyboard('drv_to') }
  );
});

bot.action(/^drv_to_(.+)$/, async (ctx) => {
  const slug = ctx.match[1];
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);

  if (!session?.from_region) return ctx.answerCbQuery('Avval qayerdan tanlang');
  if (!DRIVER_WIZARD_REGIONS.some((r) => r.slug === slug)) {
    return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  }

  const toLabel = wizardSlugToLabel(slug);
  profileSessions.set(userId, {
    ...session,
    step: 'truck_number',
    to_region: toLabel,
    chatId: ctx.chat.id,
    messageId: ctx.callbackQuery.message.message_id,
  });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `Moshina: <b>${session.car_type}</b>\n` +
      `Marshrut: <b>${session.from_region}</b> ➔ <b>${toLabel}</b>\n\n` +
      '📝 Mashinangiz davlat raqamini kiriting:\n' +
      '<i>(Misol: 01 A 123 AA)</i>',
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
  );
});

// ─── Broker yuk joylash wizard (4 qadam) ─────────────────────────────────────

bot.action(/^brk_car_(.+)$/, async (ctx) => {
  const carType = CAR_SLUG_MAP[ctx.match[1]];
  if (!carType) return ctx.answerCbQuery('Noto\'g\'ri tanlov');

  const userId = ctx.from.id;
  const session = brokerSessions.get(userId) || {};
  brokerSessions.set(userId, { ...session, step: 'from_region', truck_type: carType });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🚚 Moshina: <b>${carType}</b>\n\n🔄 <b>Yuklash viloyati:</b>`,
    { parse_mode: 'HTML', ...brokerRegionKeyboard('brk_from') }
  );
});

bot.action(/^brk_from_(.+)$/, async (ctx) => {
  const slug = ctx.match[1];
  const userId = ctx.from.id;
  const session = brokerSessions.get(userId);

  if (!session?.truck_type) return ctx.answerCbQuery('Avval mashina tanlang');
  if (!DRIVER_WIZARD_REGIONS.some((r) => r.slug === slug)) {
    return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  }

  const fromLabel = wizardSlugToLabel(slug);
  brokerSessions.set(userId, { ...session, step: 'to_region', from_region: fromLabel });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🚚 ${session.truck_type} | Yuklash: <b>${fromLabel}</b>\n\n🏁 <b>Tushirish viloyati:</b>`,
    { parse_mode: 'HTML', ...brokerRegionKeyboard('brk_to') }
  );
});

bot.action(/^brk_to_(.+)$/, async (ctx) => {
  const slug = ctx.match[1];
  const userId = ctx.from.id;
  const session = brokerSessions.get(userId);

  if (!session?.from_region) return ctx.answerCbQuery('Avval yuklash viloyatini tanlang');
  if (!DRIVER_WIZARD_REGIONS.some((r) => r.slug === slug)) {
    return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  }

  const toLabel = wizardSlugToLabel(slug);
  brokerSessions.set(userId, {
    ...session,
    step: 'details',
    to_region: toLabel,
  });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🚚 ${session.truck_type}\n` +
      `Marshrut: <b>${session.from_region}</b> ➔ <b>${toLabel}</b>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
  );

  await ctx.reply(
    '📝 Yuk turi, vazni va taklif narxini bitta xabarda yozing:\n' +
      "<i>(Misol: Mebel, 20tn, 6 mln so'm)</i>",
    { parse_mode: 'HTML' }
  );
});

bot.action('brk_publish', async (ctx) => {
  const userId = ctx.from.id;
  const session = brokerSessions.get(userId);

  if (!session || session.step !== 'confirm') {
    return ctx.answerCbQuery('Avval yuk ma\'lumotlarini to\'ldiring');
  }

  await ctx.answerCbQuery('Guruhga joylanmoqda...');

  try {
    const order = await insertBrokerOrder({
      truck_type: session.truck_type,
      from_region: session.from_region,
      to_region: session.to_region,
      cargo_details: session.cargo_details,
      broker_phone: session.phone,
      broker_user_id: userId,
    });

    clearBroker(userId);
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});

    const drivers = await findDriversForBroker({
      truck_type: session.truck_type,
      from_region: session.from_region,
      to_region: session.to_region,
    });

    await notifyMatchingDrivers(ctx.telegram, order);

    const dmClient = getActiveClient();
    if (dmClient) {
      crosspostToDm(dmClient, order).catch((err) => {
        console.error('[crosspost_dm]', err.message);
      });
    }

    const royal = await postOrderToRoyalGroup(ctx.telegram, order);

    if (royal.ok) {
      await ctx.reply(
        '✅ Yukingiz rasmiy guruhga joylandi va mos haydovchilarga yuborildi!',
        mainMenuKeyboard()
      );
    } else if (royal.error === 'ROYAL_CARGO_GROUP_ID_EMPTY') {
      await ctx.reply(
        "✅ Yuk saqlandi va haydovchilarga yuborildi.\n⚠️ ROYAL_CARGO_GROUP_ID sozlanmagan — guruhga chiqarilmadi.",
        mainMenuKeyboard()
      );
    } else if (royal.error === 'ADMIN_RIGHTS_REQUIRED') {
      await ctx.reply(
        "✅ Yuk saqlandi va haydovchilarga yuborildi.\n⚠️ Bot guruhda admin emas — guruhga chiqarib bo'lmadi.",
        mainMenuKeyboard()
      );
    } else {
      await ctx.reply(
        `✅ Yuk saqlandi va haydovchilarga yuborildi.\n⚠️ Guruhga chiqarishda xatolik: ${royal.error}`,
        mainMenuKeyboard()
      );
    }

    if (drivers.length > 0) {
      await ctx.reply("✅ Mos bo'sh moshinalar:\n" + formatDriverList(drivers));
    }
  } catch (err) {
    console.error('[brk_publish]', err.message);
    await ctx.reply('Saqlashda xatolik. Qayta urinib ko\'ring.', mainMenuKeyboard());
  }
});

// ─── Driver availability (Reply Keyboard) ───────────────────────────────────

async function requireDriver(ctx) {
  const user = await getUserById(ctx.from.id);
  if (!user?.phone) {
    await ctx.reply('Avval /start orqali telefon raqamingizni ulashing.');
    return false;
  }

  const profile = await getDriverProfile(ctx.from.id);
  if (!profile) {
    await ctx.reply(
      'Avval haydovchi profilini sozlang — 「⛟ Yuk Izlash」 tugmasini bosing.',
      mainMenuKeyboard()
    );
    return false;
  }
  return true;
}

async function setDriverActive(ctx) {
  if (!(await requireDriver(ctx))) return;
  await setDriverStatus(ctx.from.id, DRIVER_STATUS.ACTIVE);
  await ctx.reply(
    '🟢 <b>Yuk qidiryapman</b>\n\nYangi yuklar bo\'yicha bildirishnomalar yoqildi.',
    { parse_mode: 'HTML', ...mainMenuKeyboard() }
  );
}

async function setDriverBusy(ctx) {
  if (!(await requireDriver(ctx))) return;
  await setDriverStatus(ctx.from.id, DRIVER_STATUS.BUSY);
  await ctx.reply(
    "🔴 <b>Yo'ldaman</b>\n\nYangi yuk bildirishnomalari to'xtatildi. Yetib borganingizda holatni o'zgartiring.",
    { parse_mode: 'HTML', ...mainMenuKeyboard() }
  );
}

bot.action('driver_set_active', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await setDriverActive(ctx);
  } catch (err) {
    console.error('[driver_set_active]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('driver_set_busy', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await setDriverBusy(ctx);
  } catch (err) {
    console.error('[driver_set_busy]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.hears(BTN_SEEKING, async (ctx) => {
  try {
    await setDriverActive(ctx);
  } catch (err) {
    console.error('[driver_active]', err.message);
    await ctx.reply('Holatni saqlashda xatolik. Qayta urinib ko\'ring.');
  }
});

bot.hears(BTN_BUSY, async (ctx) => {
  try {
    await setDriverBusy(ctx);
  } catch (err) {
    console.error('[driver_busy]', err.message);
    await ctx.reply('Holatni saqlashda xatolik. Qayta urinib ko\'ring.');
  }
});

// ─── /neworder wizard ────────────────────────────────────────────────────────

bot.command('neworder', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('role, phone')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return ctx.reply('Avval /start orqali ro\'yxatdan o\'ting.');
    }

    if (user.role !== ROLES.CLIENT) {
      return ctx.reply('Bu buyruq faqat yuk egalari uchun.');
    }

    wizardSessions.set(userId, { step: WIZARD_STEPS.FROM, data: { phone: user.phone } });

    await ctx.reply(
      '📦 <b>Yangi buyurtma</b>\n\nQaysi hududdan yuk jo\'natmoqchisiz?',
      { parse_mode: 'HTML', ...regionKeyboard('wiz_from') }
    );
  } catch (err) {
    console.error('[neworder]', err.message);
    await ctx.reply('Xatolik yuz berdi.');
  }
});

bot.action(/^wiz_from_(.+)$/, async (ctx) => {
  const region = ctx.match[1];
  const userId = ctx.from.id;
  const wiz = wizardSessions.get(userId);

  if (!wiz || wiz.step !== WIZARD_STEPS.FROM) {
    return ctx.answerCbQuery('Buyurtma boshlang: /neworder');
  }

  if (!REGIONS.includes(region)) {
    return ctx.answerCbQuery('Noto\'g\'ri hudud');
  }

  wiz.data.from_region = region;
  wiz.step = WIZARD_STEPS.TO;
  wizardSessions.set(userId, wiz);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📍 Qayerdan: <b>${region}</b>\n\nQaysi hududga yuk yetkazmoqchisiz?`,
    { parse_mode: 'HTML', ...regionKeyboard('wiz_to') }
  );
});

bot.action(/^wiz_to_(.+)$/, async (ctx) => {
  const region = ctx.match[1];
  const userId = ctx.from.id;
  const wiz = wizardSessions.get(userId);

  if (!wiz || wiz.step !== WIZARD_STEPS.TO) {
    return ctx.answerCbQuery('Buyurtma boshlang: /neworder');
  }

  if (!REGIONS.includes(region)) {
    return ctx.answerCbQuery('Noto\'g\'ri hudud');
  }

  wiz.data.to_region = region;
  wiz.step = WIZARD_STEPS.CAR;
  wizardSessions.set(userId, wiz);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `📍 ${wiz.data.from_region} → <b>${region}</b>\n\nQanday mashina kerak?`,
    { parse_mode: 'HTML', ...Markup.inlineKeyboard(chunkButtons(CAR_TYPES, 'wiz_car', 2)) }
  );
});

bot.action(/^wiz_car_(.+)$/, async (ctx) => {
  const carType = ctx.match[1];
  const userId = ctx.from.id;
  const wiz = wizardSessions.get(userId);

  if (!wiz || wiz.step !== WIZARD_STEPS.CAR) {
    return ctx.answerCbQuery('Buyurtma boshlang: /neworder');
  }

  if (!CAR_TYPES.includes(carType)) {
    return ctx.answerCbQuery('Noto\'g\'ri mashina turi');
  }

  wiz.data.car_type = carType;
  wiz.step = WIZARD_STEPS.DETAILS;
  wizardSessions.set(userId, wiz);

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `🚛 Mashina: <b>${carType}</b>\n\n` +
      'Yuk tavsifi va narxini yozing.\n' +
      '<i>Masalan: 5 tonna qog\'oz, 3 mln so\'m</i>',
    { parse_mode: 'HTML' }
  );
});

// Text handler: haydovchi raqami + buyurtma tavsifi
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
  const text = ctx.message.text?.trim() || '';

  if (MENU_BUTTONS.has(text)) return next();

  const brk = brokerSessions.get(userId);
  if (brk?.step === 'details') {
    if (text.length < 5) {
      return ctx.reply('Iltimos, yuk haqida batafsil yozing (turi, vazn, narx).');
    }

    brokerSessions.set(userId, {
      ...brk,
      step: 'confirm',
      cargo_details: text,
    });

    await ctx.reply(
      '📋 <b>Yuk xulosasi</b>\n\n' +
        `🚛 ${brk.truck_type}\n` +
        `📍 ${brk.from_region} ➔ ${brk.to_region}\n` +
        `📝 ${text}\n` +
        `📞 ${brk.phone}\n\n` +
        'Tasdiqlang — yuk rasmiy guruhga TEKIN chiqadi va haydovchilarga yuboriladi:',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🚀 Guruhga Tekin Chiqarish', 'brk_publish')],
        ]),
      }
    );
    return;
  }

  const prof = profileSessions.get(userId);
  if (prof?.step === 'truck_number') {
    if (text.length < 4) {
      return ctx.reply('Raqam juda qisqa. Misol: <i>01 A 123 AA</i>', { parse_mode: 'HTML' });
    }

    try {
      await upsertDriverProfile(userId, {
        truck_type: prof.car_type,
        from_region: prof.from_region,
        to_region: prof.to_region,
        truck_number: text.toUpperCase(),
        status: DRIVER_STATUS.ACTIVE,
      });

      clearProfile(userId);

      await ctx.reply(
        `✅ Rahmat! Yo'nalish yoqildi: <b>${prof.from_region}</b> ➔ <b>${prof.to_region}</b>.\n` +
          'Tizim sizga faqat shu yo\'nalishdagi toza yuklarni shaxsiyingizga avtomat oqizib beradi. ' +
          "Safaringiz bexatar bo'lsin!",
        { parse_mode: 'HTML', ...mainMenuKeyboard() }
      );
    } catch (err) {
      console.error('[truck_number]', err.message);
      await ctx.reply('Saqlashda xatolik. Qayta urinib ko\'ring.');
    }
    return;
  }

  const wiz = wizardSessions.get(userId);
  if (!wiz || wiz.step !== WIZARD_STEPS.DETAILS) {
    return next();
  }

  const details = ctx.message.text.trim();
  if (!details) {
    return ctx.reply('Iltimos, yuk tavsifi va narxini yozing.');
  }

  wiz.data.cargo_details = details;
  wiz.step = WIZARD_STEPS.SUMMARY;
  wizardSessions.set(userId, wiz);

  const d = wiz.data;
  await ctx.reply(
    `📋 <b>Buyurtma xulosasi</b>\n\n` +
      `📍 Qayerdan: ${d.from_region}\n` +
      `🏁 Qayerga: ${d.to_region}\n` +
      `🚛 Mashina: ${d.car_type}\n` +
      `📝 Tavsif: ${d.cargo_details}\n` +
      `📞 Telefon: ${d.phone}\n\n` +
      'Tasdiqlaysizmi?',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🚀 Tizimga chiqarish', 'wiz_confirm'),
          Markup.button.callback('❌ Bekor qilish', 'wiz_cancel'),
        ],
      ]),
    }
  );
});

bot.action('wiz_confirm', async (ctx) => {
  const userId = ctx.from.id;
  const wiz = wizardSessions.get(userId);

  if (!wiz || wiz.step !== WIZARD_STEPS.SUMMARY) {
    return ctx.answerCbQuery('Buyurtma topilmadi');
  }

  const d = wiz.data;

  try {
    const order = await insertOrder({
      from_region: d.from_region,
      to_region: d.to_region,
      car_type: d.car_type,
      cargo_details: d.cargo_details,
      phone_number: d.phone,
      source: 'bot',
    });

    if (!order) throw new Error('Insert failed');

    clearWizard(userId);
    await ctx.answerCbQuery('Buyurtma joylandi!');
    await ctx.editMessageText('✅ Buyurtmangiz tizimga chiqarildi! Haydovchilar tez orada bog\'lanadi.');

    await notifyMatchingDrivers(ctx.telegram, order);
  } catch (err) {
    console.error('[wiz_confirm]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
    await ctx.reply('Buyurtmani saqlashda xatolik. Qayta urinib ko\'ring.');
  }
});

bot.action('wiz_cancel', async (ctx) => {
  clearWizard(ctx.from.id);
  await ctx.answerCbQuery('Bekor qilindi');
  await ctx.editMessageText('❌ Buyurtma bekor qilindi.');
});

// ─── Order acceptance (eski callback xabarlar uchun) ─────────────────────────

bot.action(/^accept_order_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const driverId = ctx.from.id;

  try {
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('id', driverId)
      .single();

    if (!user || user.role !== ROLES.DRIVER) {
      return ctx.answerCbQuery('Faqat haydovchilar yuk olishi mumkin');
    }

    const result = await acceptOrder(orderId, driverId);

    if (!result.success) {
      if (result.reason === 'already_taken') {
        await ctx.answerCbQuery('Bu yuk allaqachon olingan!');
        await ctx.editMessageReplyMarkup(
          Markup.inlineKeyboard([
            Markup.button.callback('🔴 Yuk olindi', 'order_taken'),
          ]).reply_markup
        );
      } else {
        await ctx.answerCbQuery('Buyurtma topilmadi');
      }
      return;
    }

    const order = result.order;

    await ctx.answerCbQuery('Yuk sizga biriktirildi!');
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + `\n\n✅ <b>Siz oldingiz!</b>\n📞 Mijoz: ${order.phone_number}`,
      { parse_mode: 'HTML' }
    );

    await markOrderTakenForOthers(ctx.telegram, order, driverId);
  } catch (err) {
    console.error('[accept_order]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

bot.action('order_taken', async (ctx) => {
  await ctx.answerCbQuery('Bu yuk allaqachon olingan');
});

// ─── Error handling & launch ─────────────────────────────────────────────────

bot.use(async (ctx, next) => {
  const from = ctx.from?.id ?? '?';
  const kind = ctx.updateType;
  const detail = ctx.message?.text || ctx.callbackQuery?.data || '';
  console.log(`[update] ${kind} user=${from} ${detail}`);
  return next();
});

bot.catch((err, ctx) => {
  console.error(`[bot] Error for ${ctx?.updateType}:`, err.message);
});

(async () => {
  const { deleteWebhook } = require('./lib/botApi');

  for (let attempt = 1; attempt <= 5; attempt++) {
    await deleteWebhook();

    const err = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      bot
        .launch({ dropPendingUpdates: true }, () => {
          // 409 ba'zan callbackdan keyin keladi — qisqa kutamiz
          setTimeout(() => {
            console.log(`🚀 Karvon bot ishga tushdi — @${bot.botInfo?.username}`);
            finish(null);
          }, 800);
        })
        .catch((e) => finish(e));
    });

    if (!err) return;

    try {
      await bot.stop();
    } catch {
      /* ignore */
    }

    const is409 = String(err.message).includes('409');
    console.error(`[bot] Launch urinish ${attempt}/5:`, err.message);

    if (is409 && attempt < 5) {
      console.log(`[bot] 409 conflict — ${attempt * 5}s kutib qayta uriniladi...`);
      console.log('[bot] Boshqa terminalda node index.js yoki start-all ishlamasin!');
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }

    if (is409) {
      console.error("[bot] Barcha terminaldagi node jarayonlarini to'xtating:");
      console.error('       node scripts/stop-karvon.js');
    }
    process.exit(1);
  }
})();

process.on('unhandledRejection', (err) => {
  console.error('[bot] Unhandled rejection:', err?.message || err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
