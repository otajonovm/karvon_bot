require('./config/env');

console.log('[bot] Karvon index.js yuklanmoqda...');

if (process.env.PORT && !process.env.KARVON_CHILD) {
  require('./lib/healthServer').startHealthServer();
}

const { Telegraf, Markup } = require('telegraf');
const { getSupabase } = require('./lib/supabase');
const {
  notifyMatchingDrivers,
  pushRecentMatchingOrders,
  markOrderTakenForOthers,
  acceptOrder,
  fetchLiveOrdersFromRegion,
} = require('./lib/notifications');
const { insertOrder, insertBrokerOrder } = require('./lib/orders');
const { normalizePhone } = require('./lib/normalize');
const { REGIONS, CAR_TYPES, ROLES, DRIVER_STATUS, DRIVER_WIZARD_REGIONS, wizardSlugToLabel } = require('./config/constants');
const {
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
  mainMenuKeyboard,
  statusScreenKeyboard,
  driverCarKeyboard,
  driverRegionKeyboard,
  driverRoutePresetKeyboard,
  cabinetInlineKeyboard,
  showcaseChoiceKeyboard,
  brokerCarKeyboard,
  brokerRegionKeyboard,
} = require('./lib/menus');
const { upsertDriverProfile, setDriverStatus, getDriverProfile } = require('./lib/drivers');
const { getUserById, upsertUserPhone } = require('./lib/users');
const { buildStatusMessage, ensureDriverRole, hasRouteProfile } = require('./lib/statusPanel');
const { ensureBroker } = require('./lib/brokers');
const { findDriversForBroker, formatDriverList } = require('./lib/brokerMatching');
const { crosspostToDm } = require('./lib/crosspost');
const { getActiveClient } = require('./lib/userbotClient');
const { handleRoyalGroupMessage } = require('./lib/groupSecurity');
const { postOrderToRoyalGroup } = require('./lib/royalGroupPost');
const { getRoyalCargoGroupId, isAdmin } = require('./config/constants');
const { isDbUnreachable, logDbError } = require('./lib/dbError');
const { resolveSupabaseUrl } = require('./lib/supabase');
const { markLaunched, markOk, markError } = require('./lib/botHealth');
const { collectAdminStats, formatAdminPanel } = require('./lib/admin');
const { ANY_DEST, buildSaveFields, regionBySlug, formatRouteLabel, ROUTE_PRESETS } = require('./lib/driverRoutes');
const { isOrderActive, EXPIRED_USER_MSG } = require('./lib/orders');
const {
  scheduleFeedback,
  confirmDeal,
  rejectDeal,
  startFeedbackLoop,
} = require('./lib/dealFeedback');

console.log(`[bot] Supabase: ${resolveSupabaseUrl() || 'YO\'Q'}`);

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
  BTN_FIND_CARGO_LEGACY,
  BTN_MY_STATUS,
  BTN_MY_STATUS_LEGACY,
  BTN_SHOWCASE,
  BTN_ADMIN,
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

async function replyCabinet(ctx, { edit = false } = {}) {
  const { text, hasProfile } = await buildStatusMessage(ctx.from.id);
  const opts = {
    parse_mode: 'HTML',
    ...(hasProfile ? cabinetInlineKeyboard() : {}),
  };
  if (edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, opts);
    return hasProfile;
  }
  await ctx.reply(text, opts);
  return hasProfile;
}

async function persistSessionRoute(userId, session, extra = {}) {
  const existing = await getDriverProfile(userId);
  const fields = buildSaveFields({
    presetId: session.presetId || 'custom',
    current_location: session.current_location || session.from_region,
    dest: session.to_region,
    truck_type: extra.truck_type || session.car_type || existing?.truck_type,
    truck_number: extra.truck_number || existing?.truck_number,
    status: extra.status || existing?.status || DRIVER_STATUS.ACTIVE,
  });
  return upsertDriverProfile(userId, fields);
}

async function sendMainMenu(ctx, text) {
  const admin = isAdmin(ctx.from?.id);
  await ctx.reply(text, { parse_mode: 'HTML', ...mainMenuKeyboard({ isAdmin: admin }) });
}

async function replyDbUnavailable(ctx) {
  return ctx.reply(
    '⚠️ <b>Vaqtincha ulanish yo\'q</b>\n\n' +
      'Baza (Supabase) ga ulanib bo\'lmadi. Internet/DNS ni tekshiring yoki VPN yoqing.\n' +
      'Keyin qayta /start bosing.',
    { parse_mode: 'HTML', ...mainMenuKeyboard({ isAdmin: isAdmin(ctx.from?.id) }) }
  );
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
    const payload = String(ctx.startPayload || '').trim();
    if (payload.startsWith('order_')) {
      const orderId = payload.slice('order_'.length);
      const { active, reason, order } = await isOrderActive(orderId);
      if (!active || !order) {
        await ctx.reply(reason === 'taken' ? 'Bu yuk allaqachon olingan!' : EXPIRED_USER_MSG);
      } else {
        const { formatOrderMessage, orderActionKeyboard } = require('./lib/notifications');
        await ctx.reply(formatOrderMessage(order, null), {
          parse_mode: 'HTML',
          ...orderActionKeyboard(order),
        });
        scheduleFeedback(orderId, ctx.from.id).catch(() => {});
      }
    }

    let user;
    try {
      user = await getUserById(ctx.from.id);
    } catch (err) {
      logDbError('start', err);
      if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
      throw err;
    }

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
    logDbError('start', err);
    if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.', mainMenuKeyboard());
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
    logDbError('post_cargo', err);
    if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.', mainMenuKeyboard());
  }
});

bot.hears([BTN_FIND_CARGO, BTN_FIND_CARGO_LEGACY], async (ctx) => {
  try {
    await beginDriverProfileFlow(ctx);
  } catch (err) {
    logDbError('find_cargo', err);
    if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
    await ctx.reply('Xatolik yuz berdi. Qayta urinib ko\'ring.', mainMenuKeyboard());
  }
});

bot.hears([BTN_MY_STATUS, BTN_MY_STATUS_LEGACY], async (ctx) => {
  try {
    await replyCabinet(ctx);
  } catch (err) {
    console.error('[cabinet]', err.message);
    await ctx.reply("Kabinetni yuklab bo'lmadi.", mainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id) }));
  }
});

bot.hears(BTN_SHOWCASE, async (ctx) => {
  try {
    const profile = await getDriverProfile(ctx.from.id);
    if (profile) {
      await ctx.reply('🔍 <b>Reyslar vitrinasi</b>\nQanday qidiramiz?', {
        parse_mode: 'HTML',
        ...showcaseChoiceKeyboard(),
      });
      return;
    }
    await ctx.reply('🔍 Qaysi viloyatdan chiquvchi yuklarni ko\'ramiz?', {
      parse_mode: 'HTML',
      ...driverRegionKeyboard('vit_from'),
    });
  } catch (err) {
    console.error('[vitrina]', err.message);
    await ctx.reply('Vitrinani ochib bo\'lmadi.', mainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id) }));
  }
});

bot.hears(BTN_ADMIN, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('Bu bo‘lim faqat admin uchun.', mainMenuKeyboard());
  }
  try {
    await ctx.reply('📊 Statistika yuklanmoqda...');
    const stats = await collectAdminStats();
    await ctx.reply(formatAdminPanel(stats), {
      parse_mode: 'HTML',
      ...mainMenuKeyboard({ isAdmin: true }),
    });
  } catch (err) {
    console.error('[admin]', err.message);
    if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
    await ctx.reply('Statistikani yuklab bo‘lmadi.', mainMenuKeyboard({ isAdmin: true }));
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

  try {
    const userId = ctx.from.id;
    const session = profileSessions.get(userId) || {};
    profileSessions.set(userId, { ...session, step: 'route_preset', car_type: carType });

    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Moshina turi: <b>${carType}</b>\n\n` +
        '🔄 Qaysi yo\'nalishlarda ishlaysiz?',
      { parse_mode: 'HTML', ...driverRoutePresetKeyboard() }
    );
  } catch (err) {
    console.error('[drv_car]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

async function askTruckNumber(ctx, session) {
  const userId = ctx.from.id;
  profileSessions.set(userId, {
    ...session,
    step: 'truck_number',
    chatId: ctx.chat.id,
    messageId: ctx.callbackQuery.message.message_id,
  });
  const routeHint =
    session.presetId && ROUTE_PRESETS[session.presetId]
      ? ROUTE_PRESETS[session.presetId].short
      : `${session.current_location || session.from_region} ➔ ${
          session.to_region === ANY_DEST ? 'istalgan viloyat' : session.to_region || '—'
        }`;
  await ctx.editMessageText(
    `Moshina: <b>${session.car_type}</b>\n` +
      `Yo'nalish: <b>${routeHint}</b>\n\n` +
      '📝 Mashinangiz davlat raqamini kiriting:\n' +
      '<i>(Misol: 01 A 123 AA)</i>',
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } }
  );
}

bot.action(/^drv_rt_(all|vodiy|sam|south|custom)$/, async (ctx) => {
  const presetId = ctx.match[1];
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);
  if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');

  try {
    if (presetId === 'custom') {
      profileSessions.set(userId, { ...session, step: 'from_region', presetId: 'custom' });
      await ctx.answerCbQuery();
      await ctx.editMessageText(
        `Moshina: <b>${session.car_type}</b>\n\n📍 <b>Hozir qaysi viloyatdasiz?</b>`,
        { parse_mode: 'HTML', ...driverRegionKeyboard('drv_loc') }
      );
      return;
    }

    profileSessions.set(userId, { ...session, presetId, step: 'truck_number' });
    await ctx.answerCbQuery();
    await askTruckNumber(ctx, { ...session, presetId });
  } catch (err) {
    console.error('[drv_rt]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_loc_(.+)$/, async (ctx) => {
  const slug = ctx.match[1];
  const region = regionBySlug(slug);
  if (!region) return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);
  if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');

  try {
    profileSessions.set(userId, {
      ...session,
      step: 'to_region',
      current_location: region.label,
      from_region: region.label,
      presetId: 'custom',
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `Moshina: <b>${session.car_type}</b>\n` +
        `Hozir: <b>${region.label}</b>\n\n` +
        '🏁 <b>Qayerga bormoqchisiz?</b>',
      {
        parse_mode: 'HTML',
        ...driverRegionKeyboard('drv_dest', {
          extra: [[Markup.button.callback('🌍 Istalgan viloyatga', 'drv_dest_any')]],
        }),
      }
    );
  } catch (err) {
    console.error('[drv_loc]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('drv_dest_any', async (ctx) => {
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);
  if (!session?.from_region && !session?.current_location) {
    return ctx.answerCbQuery('Avval viloyatni tanlang');
  }
  try {
    await ctx.answerCbQuery();
    await askTruckNumber(ctx, { ...session, to_region: ANY_DEST, presetId: 'custom' });
  } catch (err) {
    console.error('[drv_dest_any]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_dest_(.+)$/, async (ctx) => {
  if (ctx.match[1] === 'any') return;
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);
  if (!session?.current_location && !session?.from_region) {
    return ctx.answerCbQuery('Avval qayerdan tanlang');
  }
  try {
    await ctx.answerCbQuery();
    await askTruckNumber(ctx, { ...session, to_region: region.label, presetId: 'custom' });
  } catch (err) {
    console.error('[drv_dest]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('change_route', async (ctx) => {
  try {
    const profile = await getDriverProfile(ctx.from.id);
    if (!profile) {
      return ctx.answerCbQuery('Avval Yuk Izlash orqali profil oching', { show_alert: true });
    }
    profileSessions.set(ctx.from.id, {
      step: 'ch_loc',
      car_type: profile.truck_type || profile.car_type,
      mode: 'change',
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📍 <b>Hozir qaysi viloyatdasiz?</b>\n<i>2 bosishda marshrut yangilanadi</i>',
      {
        parse_mode: 'HTML',
        ...driverRegionKeyboard('ch_loc', {
          extra: [[Markup.button.callback('🌍 Har qanday yo\'nalish', 'ch_rt_all')]],
        }),
      }
    );
  } catch (err) {
    console.error('[change_route]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('ch_rt_all', async (ctx) => {
  try {
    const existing = await getDriverProfile(ctx.from.id);
    await persistSessionRoute(ctx.from.id, { presetId: 'all', current_location: existing?.current_location }, {});
    clearProfile(ctx.from.id);
    await ctx.answerCbQuery('Marshrutingiz muvaffaqiyatli yangilandi!', { show_alert: true });
    await replyCabinet(ctx, { edit: true });
  } catch (err) {
    console.error('[ch_rt_all]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
  }
});

bot.action(/^ch_loc_(.+)$/, async (ctx) => {
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  try {
    const session = profileSessions.get(ctx.from.id) || { mode: 'change' };
    profileSessions.set(ctx.from.id, {
      ...session,
      mode: 'change',
      presetId: 'custom',
      current_location: region.label,
      from_region: region.label,
      step: 'ch_dest',
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      `📍 Hozir: <b>${region.label}</b>\n\n🏁 <b>Qayerga bormoqchisiz?</b>`,
      {
        parse_mode: 'HTML',
        ...driverRegionKeyboard('ch_dest', {
          extra: [[Markup.button.callback('🌍 Istalgan viloyatga', 'ch_dest_any')]],
        }),
      }
    );
  } catch (err) {
    console.error('[ch_loc]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

async function finishChangeRoute(ctx, dest) {
  const session = profileSessions.get(ctx.from.id);
  if (!session?.current_location && !session?.from_region) {
    return ctx.answerCbQuery('Avval joylashuvni tanlang');
  }
  await persistSessionRoute(ctx.from.id, { ...session, to_region: dest, presetId: 'custom' });
  clearProfile(ctx.from.id);
  await ctx.answerCbQuery('Marshrutingiz muvaffaqiyatli yangilandi!', { show_alert: true });
  await replyCabinet(ctx, { edit: true });
}

bot.action('ch_dest_any', async (ctx) => {
  try {
    await finishChangeRoute(ctx, ANY_DEST);
  } catch (err) {
    console.error('[ch_dest_any]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
  }
});

bot.action(/^ch_dest_(.+)$/, async (ctx) => {
  if (ctx.match[1] === 'any') return;
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  try {
    await finishChangeRoute(ctx, region.label);
  } catch (err) {
    console.error('[ch_dest]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
  }
});

async function sendVitrinaOrders(ctx, orders, title) {
  if (!orders.length) {
    const fn = ctx.callbackQuery ? ctx.editMessageText.bind(ctx) : ctx.reply.bind(ctx);
    await fn(`${title}\n\nHozircha tirik yuk yo'q.`, { parse_mode: 'HTML' });
    return;
  }
  if (ctx.callbackQuery) {
    await ctx.editMessageText(`${title}\n\nOxirgi ${orders.length} ta tirik yuk:`, { parse_mode: 'HTML' });
  } else {
    await ctx.reply(`${title}\n\nOxirgi ${orders.length} ta tirik yuk:`, { parse_mode: 'HTML' });
  }
  const { formatOrderMessage, orderActionKeyboard } = require('./lib/notifications');
  for (const order of orders) {
    await ctx.reply(formatOrderMessage(order, null), {
      parse_mode: 'HTML',
      ...orderActionKeyboard(order),
    });
  }
}

bot.action('vit_mine', async (ctx) => {
  try {
    const driver = await getDriverProfile(ctx.from.id);
    if (!hasRouteProfile(driver)) {
      return ctx.answerCbQuery('Avval marshrutni sozlang', { show_alert: true });
    }
    await ctx.answerCbQuery();
    const { getSupabase } = require('./lib/supabase');
    const { liveSinceIso, isLiveOrder } = require('./lib/orderExpiry');
    const { driverMatchesOrder } = require('./lib/driverRoutes');
    const supabase = getSupabase();
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'active')
      .gte('created_at', liveSinceIso('bot'))
      .order('created_at', { ascending: false })
      .limit(80);
    const orders = (data || []).filter(isLiveOrder).filter((o) => driverMatchesOrder(driver, o)).slice(0, 5);
    await sendVitrinaOrders(ctx, orders, '🔍 <b>Mening marshrutim</b>');
  } catch (err) {
    console.error('[vit_mine]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('vit_other', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.editMessageText('🔍 Qaysi viloyatdan chiquvchi yuklar?', {
      parse_mode: 'HTML',
      ...driverRegionKeyboard('vit_from'),
    });
  } catch (err) {
    console.error('[vit_other]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^vit_from_(.+)$/, async (ctx) => {
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery('Noto\'g\'ri viloyat');
  try {
    await ctx.answerCbQuery();
    const orders = await fetchLiveOrdersFromRegion(region.label, 5);
    await sendVitrinaOrders(ctx, orders, `🔍 <b>${region.label}</b>dan yuklar`);
  } catch (err) {
    console.error('[vit_from]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
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
    return null;
  }

  const profile = await getDriverProfile(ctx.from.id);
  if (!hasRouteProfile(profile)) {
    await ctx.reply(
      'Avval haydovchi profilini sozlang — 「⛟ Yuk Izlash」 tugmasini bosing.',
      mainMenuKeyboard()
    );
    return null;
  }
  return profile;
}

async function setDriverActive(ctx, { viaCabinet = false } = {}) {
  const driver = await requireDriver(ctx);
  if (!driver) return;

  await setDriverStatus(ctx.from.id, DRIVER_STATUS.ACTIVE);
  const live = { ...driver, status: DRIVER_STATUS.ACTIVE };

  if (viaCabinet) {
    await replyCabinet(ctx, { edit: true });
  } else {
    await ctx.reply(
      '🟢 <b>Yuk qidiryapman</b>\n\n' +
        `Yo'nalish: <b>${formatRouteLabel(driver)}</b> · ${driver.car_type || driver.truck_type}\n` +
        "Bildirishnomalar yoqildi. Mos aktiv yuklar hozir yuboriladi…",
      { parse_mode: 'HTML', ...mainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id) }) }
    );
  }

  try {
    const sent = await pushRecentMatchingOrders(ctx.telegram, live);
    if (sent > 0) {
      await ctx.reply(
        `✅ <b>${sent}</b> ta mos yuk yuborildi.\n` +
          'Yangi yuklar kelishi bilan ham shu yerga tushadi.',
        { parse_mode: 'HTML' }
      );
    } else if (!viaCabinet) {
      await ctx.reply(
        "ℹ️ Hozircha yo'nalishingizda aktiv yuk yo'q.\n" +
          'Guruhlardan yangi mos yuk kelishi bilan darhol yuboraman.'
      );
    }
  } catch (err) {
    console.error('[setDriverActive] recent push:', err.message);
  }
}

async function setDriverBusy(ctx, { viaCabinet = false } = {}) {
  if (!(await requireDriver(ctx))) return;
  await setDriverStatus(ctx.from.id, DRIVER_STATUS.BUSY);
  if (viaCabinet) {
    await replyCabinet(ctx, { edit: true });
    return;
  }
  await ctx.reply(
    "🔴 <b>Yo'ldaman</b>\n\nYangi yuk bildirishnomalari to'xtatildi. Yetib borganingizda holatni o'zgartiring.",
    { parse_mode: 'HTML', ...mainMenuKeyboard({ isAdmin: isAdmin(ctx.from.id) }) }
  );
}

bot.action('driver_set_active', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await setDriverActive(ctx, { viaCabinet: true });
  } catch (err) {
    console.error('[driver_set_active]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('driver_set_busy', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await setDriverBusy(ctx, { viaCabinet: true });
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
      const driver = await persistSessionRoute(userId, prof, {
        truck_type: prof.car_type,
        truck_number: text.toUpperCase(),
        status: DRIVER_STATUS.ACTIVE,
      });

      clearProfile(userId);

      await ctx.reply(
        `✅ Rahmat! Yo'nalish yoqildi: <b>${formatRouteLabel(driver)}</b>.\n` +
          'Mos tirik yuklar shaxsiyga avtomat tushadi.',
        { parse_mode: 'HTML', ...mainMenuKeyboard({ isAdmin: isAdmin(userId) }) }
      );

      try {
        const sent = await pushRecentMatchingOrders(ctx.telegram, driver);
        if (sent === 0) {
          await ctx.reply(
            'ℹ️ Hozircha bu yo\'nalishda yangi yuk yo\'q. ' +
              'Yangi yuk paydo bo\'lishi bilan darhol shu yerga yuboraman.'
          );
        }
      } catch (pushErr) {
        console.error('[truck_number] recent push:', pushErr.message);
      }
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

    // Expired tekshiruv
    const { active, reason } = await isOrderActive(orderId);
    if (!active) {
      const msg = reason === 'taken' ? 'Bu yuk allaqachon olingan!' : EXPIRED_USER_MSG;
      await ctx.answerCbQuery(msg, { show_alert: true });
      await ctx.editMessageReplyMarkup(
        Markup.inlineKeyboard([
          Markup.button.callback('🔴 Yuk olindi / Muddati o\'tgan', 'order_taken'),
        ]).reply_markup
      ).catch(() => {});
      return;
    }

    const result = await acceptOrder(orderId, driverId);

    if (!result.success) {
      if (result.reason === 'already_taken') {
        await ctx.answerCbQuery('Bu yuk allaqachon olingan!', { show_alert: true });
        await ctx.editMessageReplyMarkup(
          Markup.inlineKeyboard([
            Markup.button.callback('🔴 Yuk olindi', 'order_taken'),
          ]).reply_markup
        ).catch(() => {});
      } else {
        await ctx.answerCbQuery('Buyurtma topilmadi');
      }
      return;
    }

    const order = result.order;

    await ctx.answerCbQuery('Yuk sizga biriktirildi!');
    await ctx.editMessageText(
      ctx.callbackQuery.message.text +
        `\n\n✅ <b>Siz oldingiz!</b>\n📞 Mijoz: ${order.phone_number}`,
      { parse_mode: 'HTML' }
    );

    await markOrderTakenForOthers(ctx.telegram, order, driverId);

    // 30 daqiqadan so'ng "kelishdingizmi?" feedback yuboriladi
    scheduleFeedback(orderId, driverId).catch(() => {});
  } catch (err) {
    console.error('[accept_order]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

// ─── Deal feedback callbacks ─────────────────────────────────────────────────

bot.action(/^call_order_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  try {
    const { active, reason, order } = await isOrderActive(orderId);
    if (!active) {
      const msg = reason === 'taken' ? 'Bu yuk allaqachon olingan!' : EXPIRED_USER_MSG;
      return ctx.answerCbQuery(msg, { show_alert: true });
    }
    const phone = normalizePhone(order.phone_number) || order.phone_number;
    await ctx.answerCbQuery();
    await ctx.reply(`📞 Mijoz raqami: <b>${phone}</b>\nQo'ng'iroq qiling.`, {
      parse_mode: 'HTML',
    });
    scheduleFeedback(orderId, ctx.from.id).catch((err) =>
      console.error('[call_order] feedback:', err.message)
    );
  } catch (err) {
    console.error('[call_order]', err.message);
    await ctx.answerCbQuery('Xatolik').catch(() => {});
  }
});

bot.action(/^deal_taken_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const driverId = ctx.from.id;
  try {
    await ctx.answerCbQuery('Tabriklaymiz! Yuk qabul qilindi.');
    await confirmDeal(orderId, driverId);
    await ctx.editMessageText(
      ctx.callbackQuery.message.text +
        '\n\n🤝 <b>Muvaffaqiyatli reys. Status: yo\'lda.</b>',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[deal_taken]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^deal_success_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const driverId = ctx.from.id;
  try {
    await ctx.answerCbQuery('Tabriklaymiz! Yuk qabul qilindi.');
    await confirmDeal(orderId, driverId);
    await ctx.editMessageText(
      ctx.callbackQuery.message.text +
        '\n\n🤝 <b>Muvaffaqiyatli reys qayd etildi. Yo\'lda omon bo\'ling!</b>',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[deal_success]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^deal_failed_(.+)$/, async (ctx) => {
  const orderId = ctx.match[1];
  const driverId = ctx.from.id;
  try {
    await ctx.answerCbQuery('Tushunarli. Keyingi safar omad!');
    await rejectDeal(orderId, driverId);
    await ctx.editMessageText(
      ctx.callbackQuery.message.text + '\n\n❌ Kelishilmadi.',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[deal_failed]', err.message);
    await ctx.answerCbQuery('Xatolik');
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

// ─── Watchdog: bot tirikligini doimiy tekshiradi ────────────────────────────
// getMe() bir necha marta ketma-ket muvaffaqiyatsiz bo'lsa, process'ni
// to'xtatamiz — DigitalOcean konteynerni avtomat qayta ishga tushiradi.
let watchdogStarted = false;
function startBotWatchdog() {
  if (watchdogStarted) return;
  watchdogStarted = true;

  const INTERVAL_MS = 120_000;
  const MAX_FAILURES = 3;
  let failures = 0;

  const timer = setInterval(async () => {
    try {
      await bot.telegram.getMe();
      markOk();
      failures = 0;
    } catch (err) {
      failures += 1;
      markError(err.message);
      console.error(`[bot] Watchdog: getMe muvaffaqiyatsiz (${failures}/${MAX_FAILURES}) —`, err.message);

      if (failures >= MAX_FAILURES) {
        clearInterval(timer);
        console.error('[bot] Watchdog: bot uzoq vaqt javob bermayapti — qayta ishga tushish uchun chiqilmoqda');
        setTimeout(() => process.exit(1), 1000).unref();
      }
    }
  }, INTERVAL_MS);
  timer.unref();
}

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
            markLaunched();
            startBotWatchdog();
            try {
              require('./lib/orderExpiry').startExpiryLoop();
            } catch (err) {
              console.error('[bot] expiry loop:', err.message);
            }
            startFeedbackLoop(bot.telegram);
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

// Kutilmagan sync xato process'ni o'ldirmasin — log qilamiz va davom etamiz.
// Agar bot haqiqatan ishlamay qolsa, watchdog/health uni qayta ishga tushiradi.
process.on('uncaughtException', (err) => {
  console.error('[bot] Uncaught exception:', err?.message || err);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
