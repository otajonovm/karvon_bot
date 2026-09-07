require('./config/env');

console.log('[bot] Karvon index.js yuklanmoqda...');

if (process.env.PORT && !process.env.KARVON_CHILD) {
  require('./lib/healthServer').startHealthServer();
}

const { Telegraf, Markup } = require('telegraf');
const { getSupabase } = require('./lib/supabase');
const {
  matchAndNotifyDrivers,
  pushRecentMatchingOrders,
  markOrderTakenForOthers,
  acceptOrder,
  fetchLiveOrdersFromRegion,
} = require('./lib/notifications');
const { insertOrder, insertBrokerOrder } = require('./lib/orders');
const { normalizePhone } = require('./lib/normalize');
const { REGIONS, CAR_TYPES, BODY_TYPES, ROLES, DRIVER_STATUS, DRIVER_WIZARD_REGIONS, wizardSlugToLabel } = require('./config/constants');
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
  driverBodyKeyboard,
  driverNameKeyboard,
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
const { crosspostToDm } = require('./lib/crosspost');
const { getActiveClient } = require('./lib/userbotClient');
const { handleRoyalGroupMessage } = require('./lib/groupSecurity');
const { postOrderToRoyalGroup } = require('./lib/royalGroupPost');
const { getRoyalCargoGroupId, isAdmin } = require('./config/constants');
const { isDbUnreachable, logDbError } = require('./lib/dbError');
const { resolveSupabaseUrl } = require('./lib/supabase');
const { markLaunched, markOk, markError } = require('./lib/botHealth');
const { collectAdminStats, formatAdminPanel } = require('./lib/admin');
const { ANY_DEST, buildSaveFields, regionBySlug, formatRouteLabel } = require('./lib/driverRoutes');
const { formatDriverCard, telegramDisplayName } = require('./lib/driverCard');
const {
  formatDispatcherReport,
  sendDriverAcceptedReport,
} = require('./lib/dispatchReport');
const {
  PAYMENT_PLANS,
  PAYMENT_CARD,
  PAYMENT_CARD_HOLDER,
  ADMIN_CHAT_ID,
  ADMIN_USERNAME,
  canPublishOrder,
  reserveOrderSlot,
  releaseOrderSlot,
  createPayment,
  approvePayment,
  rejectPayment,
  paymentPlanLabel,
} = require('./lib/subscriptions');
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
const pendingDriverSignup = new Set();
const pendingOrderByUser = new Map();

// Eski /neworder wizard
const wizardSessions = new Map();

// Haydovchi profil wizard
const profileSessions = new Map();
const receiptSessions = new Map();

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

const STATUS_TOAST = 'Holatingiz yangilandi!';

const BODY_SLUG_MAP = Object.fromEntries(BODY_TYPES.map((b) => [b.slug, b.label]));

async function replyCabinet(ctx, { edit = false } = {}) {
  try {
    const { text, hasProfile, profile } = await buildStatusMessage(ctx.from.id);
    const opts = {
      parse_mode: 'HTML',
      ...(hasProfile ? cabinetInlineKeyboard(profile) : {}),
    };
    if (edit && ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, opts);
      return hasProfile;
    }
    await ctx.reply(text, opts);
    return hasProfile;
  } catch (err) {
    console.error('[cabinet]', err.message);
    throw err;
  }
}

async function persistSessionRoute(userId, session, extra = {}) {
  const existing = await getDriverProfile(userId);
  const fields = buildSaveFields({
    presetId: session.presetId || 'custom',
    current_location: session.current_location || session.from_region,
    dest: session.to_region,
    truck_type: extra.truck_type || session.car_type || existing?.truck_type,
    truck_number: extra.truck_number || session.truck_number || existing?.truck_number,
    status: extra.status || existing?.status || DRIVER_STATUS.ACTIVE,
  });
  return upsertDriverProfile(userId, {
    ...fields,
    full_name: extra.full_name || session.full_name || existing?.full_name,
    body_type: extra.body_type || session.body_type || existing?.body_type,
    is_verified: true,
    rating: existing?.rating ?? 5.0,
    completed_trips: existing?.completed_trips ?? 0,
  });
}

async function editWizard(ctx, session, text, extra = {}) {
  const opts = { parse_mode: 'HTML', ...extra };
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, opts);
      session.chatId = ctx.chat.id;
      session.messageId = ctx.callbackQuery.message.message_id;
      return;
    }
    if (session.chatId && session.messageId) {
      await ctx.telegram.editMessageText(session.chatId, session.messageId, undefined, text, opts);
      return;
    }
  } catch (err) {
    console.warn('[wizard] edit:', err.message);
  }
  const sent = await ctx.reply(text, opts);
  session.chatId = sent.chat.id;
  session.messageId = sent.message_id;
}

function rememberWizard(userId, session) {
  profileSessions.set(userId, session);
  return session;
}

async function askDriverName(ctx, session) {
  const tgName = telegramDisplayName(ctx.from);
  const next = rememberWizard(ctx.from.id, { ...session, step: 'full_name' });
  await editWizard(
    ctx,
    next,
    '🪪 <b>Haydovchi guvohnomasi</b>\n\n' +
      '👤 Ism-familiyangizni yozing yoki Telegram ismingizni tanlang.',
    driverNameKeyboard(tgName)
  );
}

async function askDriverCar(ctx, session) {
  const next = rememberWizard(ctx.from.id, { ...session, step: 'car_type' });
  await editWizard(
    ctx,
    next,
    `👤 <b>${session.full_name || telegramDisplayName(ctx.from)}</b>\n\n🚚 Mashina turini tanlang:`,
    driverCarKeyboard()
  );
}

async function askDriverBody(ctx, session) {
  const next = rememberWizard(ctx.from.id, { ...session, step: 'body_type' });
  await editWizard(
    ctx,
    next,
    `Moshina: <b>${session.car_type}</b>\n\n📦 Kuzov turini tanlang:`,
    driverBodyKeyboard()
  );
}

async function askDriverPlate(ctx, session) {
  const next = rememberWizard(ctx.from.id, {
    ...session,
    step: 'truck_number',
    chatId: ctx.chat?.id || session.chatId,
    messageId: ctx.callbackQuery?.message?.message_id || session.messageId,
  });
  await editWizard(
    ctx,
    next,
    `Moshina: <b>${session.car_type}</b> · ${session.body_type || ''}\n\n` +
      '📝 Mashina davlat raqamini kiriting:\n' +
      '<i>(Misol: 01 A 777 AA)</i>',
    { reply_markup: { inline_keyboard: [] } }
  );
}

async function askDriverLocation(ctx, session) {
  const next = rememberWizard(ctx.from.id, { ...session, step: 'location' });
  await editWizard(
    ctx,
    next,
    `Moshina: <b>${session.car_type}</b> · <code>${session.truck_number || ''}</code>\n\n` +
      '📍 Hozir qaysi viloyatdasiz?',
    driverRegionKeyboard('drv_loc')
  );
}

async function askDriverRoute(ctx, session) {
  const next = rememberWizard(ctx.from.id, { ...session, step: 'route_preset' });
  await editWizard(
    ctx,
    next,
    `📍 Joylashuv: <b>${session.current_location || session.from_region}</b>\n\n` +
      "🔄 Qatnaydigan asosiy yo'nalish:",
    driverRoutePresetKeyboard()
  );
}

async function finishDriverWizard(ctx, session, extra = {}) {
  const userId = ctx.from.id;
  const driver = await persistSessionRoute(userId, session, extra);
  clearProfile(userId);
  const user = await getUserById(userId);
  const text = formatDriverCard(driver, user);
  try {
    if (ctx.callbackQuery?.message) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        ...cabinetInlineKeyboard(driver),
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        ...cabinetInlineKeyboard(driver),
      });
    }
  } catch (err) {
    console.error('[wizard] card:', err.message);
    await ctx.reply(text, { parse_mode: 'HTML', ...cabinetInlineKeyboard(driver) });
  }
  try {
    await pushRecentMatchingOrders(ctx.telegram, driver);
  } catch (pushErr) {
    console.error('[wizard] recent push:', pushErr.message);
  }

  const pendingOrderId = pendingOrderByUser.get(userId);
  if (pendingOrderId) {
    pendingOrderByUser.delete(userId);
    try {
      await ctx.reply("✅ Guvohnoma tayyor. Guruhdagi yuk ochildi:");
      await deliverOrderToDriver(ctx, pendingOrderId);
    } catch (err) {
      console.error('[wizard] pending order:', err.message);
    }
  }
  return driver;
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

function subscriptionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💳 Haftalik PRO (19 000)', 'pay_plan_pro_weekly'),
    ],
    [
      Markup.button.callback('💳 Oylik PRO (49 000)', 'pay_plan_pro_monthly'),
    ],
    [
      Markup.button.callback('💳 Bittalik (5 000)', 'pay_plan_single_order'),
    ],
  ]);
}

const BROKER_BENEFITS_TEXT =
  '📦 <b>Karvonda yuk joylashning afzalliklari</b>\n' +
  '━━━━━━━━━━━━━━━━━━\n' +
  '✅ E’loningiz rasmiy Karvon guruhiga chiqariladi.\n' +
  '✅ Tizim yo‘nalish, mashina turi va kuzoviga mos haydovchilarni topadi.\n' +
  '✅ Mos bo‘sh haydovchilarga to‘g‘ridan-to‘g‘ri Telegram PUSH yuboriladi.\n' +
  '✅ Nechta haydovchi topilgani va nechta PUSH yuborilgani haqida hisobot olasiz.\n' +
  '✅ Haydovchi yukni olganda uning ismi, mashinasi, raqami va telefoni sizga yuboriladi.\n' +
  '✅ Telefon raqamingiz guruhda yashiriladi va faqat ro‘yxatdan o‘tgan haydovchiga ochiladi.\n' +
  '✅ E’lonlar dublikatlardan himoyalanadi va muddati o‘tgan yuklar avtomatik yopiladi.\n\n' +
  '🛡 <b>Haydovchilar ishonchliligi</b>\n' +
  'Haydovchi botda telefon raqami, ism-familiyasi, mashina turi, kuzovi, davlat raqami va yo‘nalishini kiritib ro‘yxatdan o‘tadi. Tizim faqat profili to‘liq va holati <b>Bo‘sh</b> haydovchilarga PUSH yuboradi.\n\n' +
  '⚠️ Karvon moslashtirish va aloqa platformasi: yakuniy kelishuv, narx va hujjatlarni tomonlar o‘zlari tekshiradi. Platforma haydovchi yoki yuk bo‘yicha 100% kafolat bermaydi.\n\n' +
  '💳 <b>Tariflar:</b> kuniga 1 ta e’lon bepul. Keyin Haftalik PRO — 19 000 so‘m, Oylik PRO — 49 000 so‘m yoki bittalik e’lon — 5 000 so‘m.';

async function showBrokerBenefits(ctx, phone) {
  await ctx.reply(BROKER_BENEFITS_TEXT, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🚀 E’lon berishni boshlash', 'broker_start_wizard')],
    ]),
  });
}

async function replySubscriptionRequired(ctx) {
  await ctx.reply(
    '⚠️ <b>Kunlik bepul limitingiz tugadi!</b>\n\n' +
      'Siz bugun 1 ta bepul e’lon berdingiz. Yukingiz zudlik bilan barcha haydovchilarga PUSH xabar bo‘lib borishi uchun obunani faollashtiring:\n\n' +
      '🔹 <b>Haftalik PRO:</b> 19 000 so‘m (7 kun cheksiz)\n' +
      '🔹 <b>Oylik PRO:</b> 49 000 so‘m (30 kun cheksiz)\n' +
      '🔹 <b>Bittalik e’lon:</b> 5 000 so‘m\n\n' +
      'Kerakli tarifni tanlang:',
    { parse_mode: 'HTML', ...subscriptionKeyboard() }
  );
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

  const access = await canPublishOrder(userId);
  if (!access.allowed) {
    await replySubscriptionRequired(ctx);
    return;
  }

  await showBrokerBenefits(ctx, user.phone);
}

bot.action('broker_start_wizard', async (ctx) => {
  try {
    const user = await getUserById(ctx.from.id);
    if (!user?.phone) {
      return ctx.answerCbQuery('Avval telefon raqamingizni ulang', { show_alert: true });
    }
    const access = await canPublishOrder(ctx.from.id);
    if (!access.allowed) {
      await ctx.answerCbQuery();
      await replySubscriptionRequired(ctx);
      return;
    }
    await ctx.answerCbQuery();
    await beginBrokerWizard(ctx, user.phone);
  } catch (err) {
    console.error('[broker_start_wizard]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

function paymentInstructions(planId) {
  const plan = PAYMENT_PLANS[planId];
  return (
    '💳 <b>To‘lov ma’lumotlari</b>\n\n' +
    `Tarif: <b>${plan.label} (${plan.amount.toLocaleString('uz-UZ')} so‘m)</b>\n\n` +
    `Karta: <code>${PAYMENT_CARD}</code>\n` +
    `Karta egasi: <b>${PAYMENT_CARD_HOLDER}</b>\n\n` +
    '⚠️ To‘lovni amalga oshirgach, to‘lov cheki (skrinshot)ni ushbu botga rasm holatida yuboring.'
  );
}

bot.action(/^pay_plan_(pro_weekly|pro_monthly|single_order)$/, async (ctx) => {
  const planId = ctx.match[1];
  try {
    if (!PAYMENT_PLANS[planId]) return ctx.answerCbQuery('Tarif topilmadi');
    receiptSessions.set(ctx.from.id, {
      plan: planId,
      createdAt: Date.now(),
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(paymentInstructions(planId), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('[payment.plan]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

function adminPaymentCaption(payment, from) {
  const username = from?.username ? `@${from.username}` : 'username yo‘q';
  return (
    '🔔 <b>Yangi to‘lov cheki!</b>\n' +
    `👤 Foydalanuvchi: ${from?.first_name || payment.payer_first_name || '—'} ` +
    `(${username} / ID: ${payment.user_id})\n` +
    `📦 Tarif: ${paymentPlanLabel(payment.plan)}\n` +
    `💰 Summa: ${Number(payment.amount_uzs || 0).toLocaleString('uz-UZ')} so‘m\n` +
    `🆔 To‘lov ID: #${payment.id}`
  );
}

bot.on('photo', async (ctx, next) => {
  const session = receiptSessions.get(ctx.from.id);
  if (!session?.plan) return next();

  try {
    const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
    if (!photo?.file_id) {
      return ctx.reply('Chek rasmini qayta yuboring.');
    }

    const payment = await createPayment({
      userId: ctx.from.id,
      plan: session.plan,
      receiptPhotoId: photo.file_id,
      firstName: ctx.from.first_name,
      username: ctx.from.username,
    });
    receiptSessions.delete(ctx.from.id);

    await ctx.reply(
      '✅ To‘lov cheki qabul qilindi!\n' +
        'Admin tasdiqlashi bilan obunangiz avtomatik yoqiladi ' +
        '(odatiy vaqt: 5–15 daqiqa).'
    );

    if (!ADMIN_CHAT_ID) {
      console.error('[payment] ADMIN_CHAT_ID/ADMIN_IDS sozlanmagan');
      return;
    }

    await ctx.telegram.sendPhoto(ADMIN_CHAT_ID, photo.file_id, {
      parse_mode: 'HTML',
      caption: adminPaymentCaption(payment, ctx.from),
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Tasdiqlash', `approve_pay_${payment.id}`),
          Markup.button.callback('❌ Rad etish', `reject_pay_${payment.id}`),
        ],
      ]),
    });
  } catch (err) {
    console.error('[payment.receipt]', err.message);
    await ctx.reply('Chekni saqlashda xatolik. Iltimos, qayta yuboring.');
  }
});

async function askSharePhone(ctx, hint) {
  return ctx.reply(hint || '📱 Davom etish uchun telefon raqamingizni yuboring:', {
    parse_mode: 'HTML',
    ...Markup.keyboard([Markup.button.contactRequest('📱 Telefon raqamni yuborish')])
      .oneTime()
      .resize(),
  });
}

async function deliverOrderToDriver(ctx, orderId, { scheduleFeedbackForDriver = false } = {}) {
  const { formatOrderMessage, orderActionKeyboard } = require('./lib/notifications');
  const { active, reason, order } = await isOrderActive(orderId);
  if (!active || !order) {
    await ctx.reply(reason === 'taken' ? 'Bu yuk allaqachon olingan!' : EXPIRED_USER_MSG);
    return false;
  }
  await ctx.reply(formatOrderMessage(order, null), {
    parse_mode: 'HTML',
    ...orderActionKeyboard(order),
  });
  if (scheduleFeedbackForDriver) {
    scheduleFeedback(orderId, ctx.from.id).catch(() => {});
  }
  return true;
}

async function claimGroupOrder(ctx, orderId) {
  const user = await getUserById(ctx.from.id);
  if (!user?.phone) {
    pendingOrderByUser.set(ctx.from.id, orderId);
    pendingDriverSignup.add(ctx.from.id);
    await askSharePhone(
      ctx,
      "🚚 Guruhdagi yukni olish uchun avval telefon raqamingizni ulashing, so'ng haydovchi sifatida ro'yxatdan o'ting."
    );
    return;
  }

  const profile = await getDriverProfile(ctx.from.id);
  if (!hasRouteProfile(profile)) {
    pendingOrderByUser.set(ctx.from.id, orderId);
    await ctx.reply(
      "🚚 <b>Yukni olish uchun haydovchi profili kerak</b>\n\n" +
        "Guruhdagi mijoz raqami faqat ro'yxatdan o'tgan haydovchiga ochiladi. " +
        "Hozir guvohnomani to'ldiring — tugagach shu yuk ochiladi.",
      { parse_mode: 'HTML' }
    );
    await beginDriverProfileFlow(ctx);
    return;
  }

  const roleResult = await ensureDriverRole(ctx.from.id);
  if (!roleResult.ok) {
    await ctx.reply("Haydovchi sifatida davom etish uchun telefon raqamingizni ulang.");
    return;
  }
  pendingOrderByUser.delete(ctx.from.id);
  await deliverOrderToDriver(ctx, orderId);
  await sendMainMenu(ctx, 'Asosiy menyu:');
}

async function startDriverSignup(ctx) {
  const user = await getUserById(ctx.from.id);
  if (!user?.phone) {
    pendingDriverSignup.add(ctx.from.id);
    await askSharePhone(
      ctx,
      "🚚 Haydovchi bo'lish uchun avval telefon raqamingizni ulashing."
    );
    return;
  }
  const profile = await getDriverProfile(ctx.from.id);
  if (hasRouteProfile(profile)) {
    await sendMainMenu(
      ctx,
      "✅ Siz allaqachon haydovchi sifatida ro'yxatdan o'tgansiz. Mos yuklar shaxsiyga tushadi."
    );
    await replyCabinet(ctx);
    try {
      await pushRecentMatchingOrders(ctx.telegram, profile);
    } catch (err) {
      console.error('[start driver] catch-up:', err.message);
    }
    return;
  }
  await beginDriverProfileFlow(ctx);
}

async function beginDriverProfileFlow(ctx) {
  const userId = ctx.from.id;
  const user = await getUserById(userId);

  if (!user?.phone) {
    return ctx.reply('Avval telefon raqamingizni ulashing — /start bosing.', Markup.removeKeyboard());
  }

  await ensureDriverRole(userId);
  const existing = await getDriverProfile(userId);
  const tgName = telegramDisplayName(ctx.from);
  const sent = await ctx.reply(
    '🪪 <b>Haydovchi guvohnomasi</b>\n\n' +
      '👤 Ism-familiyangizni yozing yoki Telegram ismingizni tanlang.',
    { parse_mode: 'HTML', ...driverNameKeyboard(tgName) }
  );
  profileSessions.set(userId, {
    step: 'full_name',
    mode: 'onboarding',
    full_name: existing?.full_name || null,
    chatId: sent.chat.id,
    messageId: sent.message_id,
  });
}

// ─── /start ──────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    const payload = String(ctx.startPayload || '').trim();
    const orderId = payload.startsWith('order_') ? payload.slice('order_'.length) : '';
    const wantDriver = payload === 'driver' || Boolean(orderId);

    let user;
    try {
      user = await getUserById(ctx.from.id);
    } catch (err) {
      logDbError('start', err);
      if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
      throw err;
    }

    if (orderId) {
      await claimGroupOrder(ctx, orderId);
      return;
    }

    if (payload === 'driver') {
      await startDriverSignup(ctx);
      return;
    }

    if (user?.phone) {
      return sendMainMenu(
        ctx,
        '👋 <b>Karvonga xush kelibsiz!</b>\n\n' +
          'Yuk joylashtirish, izlash va holatingizni boshqarish uchun pastdagi menyudan foydalaning.'
      );
    }

    if (wantDriver) pendingDriverSignup.add(ctx.from.id);

    await askSharePhone(
      ctx,
      "👋 <b>Karvon</b>ga xush kelibsiz!\n\nDavom etish uchun telefon raqamingizni yuboring."
    );
  } catch (err) {
    logDbError('start', err);
    if (isDbUnreachable(err)) return replyDbUnavailable(ctx);
    await ctx.reply("Xatolik yuz berdi. Qayta urinib ko'ring.", mainMenuKeyboard());
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
      await showBrokerBenefits(ctx, phone);
      return;
    }

    if (pendingDriverSignup.has(userId) || pendingOrderByUser.has(userId)) {
      pendingDriverSignup.delete(userId);
      const orderId = pendingOrderByUser.get(userId);
      if (orderId) {
        await claimGroupOrder(ctx, orderId);
        return;
      }
      await startDriverSignup(ctx);
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

async function editPaymentAdminMessage(ctx, text) {
  try {
    if (ctx.callbackQuery?.message?.photo) {
      await ctx.editMessageCaption(`${ctx.callbackQuery.message.caption || ''}\n\n${text}`, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });
    } else {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] },
      });
    }
  } catch (err) {
    console.warn('[payment.admin.edit]', err.message);
  }
}

bot.action(/^approve_pay_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Faqat admin uchun', { show_alert: true });
  }
  const paymentId = Number(ctx.match[1]);
  try {
    const result = await approvePayment(paymentId);
    if (!result.ok) return ctx.answerCbQuery('Bu to‘lov allaqachon ko‘rib chiqilgan');

    await ctx.answerCbQuery('Tasdiqlandi');
    await editPaymentAdminMessage(
      ctx,
      `✅ <b>Tasdiqlangan — ${new Date().toLocaleString('uz-UZ')}</b>`
    );

    try {
      await ctx.telegram.sendMessage(
        result.payment.user_id,
        `🎉 <b>To‘lovingiz tasdiqlandi!</b>\n` +
          `${paymentPlanLabel(result.payment.plan)} faollashtirildi.\n` +
          'Endi yuklaringiz mos haydovchilarga zudlik bilan PUSH qilinadi. ' +
          'Boshlash uchun menyudan yuk joylang!',
        { parse_mode: 'HTML' }
      );
    } catch (notifyErr) {
      console.error('[payment.approve.notify]', notifyErr.message);
    }
  } catch (err) {
    console.error('[payment.approve]', err.message);
    await ctx.answerCbQuery('Tasdiqlashda xatolik');
  }
});

bot.action(/^reject_pay_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) {
    return ctx.answerCbQuery('Faqat admin uchun', { show_alert: true });
  }
  const paymentId = Number(ctx.match[1]);
  try {
    const result = await rejectPayment(paymentId);
    if (!result.ok) return ctx.answerCbQuery('Bu to‘lov allaqachon ko‘rib chiqilgan');

    await ctx.answerCbQuery('Rad etildi');
    await editPaymentAdminMessage(
      ctx,
      `❌ <b>Rad etilgan — ${new Date().toLocaleString('uz-UZ')}</b>`
    );

    try {
      await ctx.telegram.sendMessage(
        result.payment.user_id,
        `❌ To‘lov chekingiz tasdiqlanmadi.\n` +
          `Iltimos, admin bilan bog‘laning: @${ADMIN_USERNAME.replace(/^@/, '')}`
      );
    } catch (notifyErr) {
      console.error('[payment.reject.notify]', notifyErr.message);
    }
  } catch (err) {
    console.error('[payment.reject]', err.message);
    await ctx.answerCbQuery('Rad etishda xatolik');
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

// ─── Driver profile wizard ───────────────────────────────────────────────────

bot.action('drv_name_tg', async (ctx) => {
  try {
    const session = profileSessions.get(ctx.from.id) || { mode: 'onboarding' };
    const full_name = telegramDisplayName(ctx.from);
    await ctx.answerCbQuery();
    await askDriverCar(ctx, { ...session, full_name });
  } catch (err) {
    console.error('[drv_name_tg]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_car_(.+)$/, async (ctx) => {
  const carType = CAR_SLUG_MAP[ctx.match[1]];
  if (!carType) return ctx.answerCbQuery('Noto\'g\'ri tanlov');

  try {
    const session = profileSessions.get(ctx.from.id) || {
      mode: 'onboarding',
      full_name: telegramDisplayName(ctx.from),
    };
    await ctx.answerCbQuery();
    await askDriverBody(ctx, { ...session, car_type: carType });
  } catch (err) {
    console.error('[drv_car]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_body_(.+)$/, async (ctx) => {
  const bodyType = BODY_SLUG_MAP[ctx.match[1]];
  if (!bodyType) return ctx.answerCbQuery("Noto'g'ri kuzov");

  try {
    const session = profileSessions.get(ctx.from.id);
    if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');
    await ctx.answerCbQuery();
    await askDriverPlate(ctx, { ...session, body_type: bodyType });
  } catch (err) {
    console.error('[drv_body]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_rt_(all|vodiy|sam|south|custom)$/, async (ctx) => {
  const presetId = ctx.match[1];
  const session = profileSessions.get(ctx.from.id);
  if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');

  try {
    if (presetId === 'custom') {
      await ctx.answerCbQuery();
      if (!session.current_location && !session.from_region) {
        await askDriverLocation(ctx, { ...session, presetId: 'custom' });
        return;
      }
      const next = rememberWizard(ctx.from.id, { ...session, step: 'to_region', presetId: 'custom' });
      await editWizard(
        ctx,
        next,
        `📍 Hozir: <b>${session.current_location || session.from_region || '—'}</b>\n\n` +
          '🏁 Qayerga qatnaysiz?',
        driverRegionKeyboard('drv_dest', {
          extra: [[Markup.button.callback('🌍 Istalgan viloyatga', 'drv_dest_any')]],
        })
      );
      return;
    }

    const next = { ...session, presetId };
    if (session.truck_number || session.current_location) {
      await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
      await finishDriverWizard(ctx, next);
      return;
    }

    await ctx.answerCbQuery();
    await askDriverPlate(ctx, next);
  } catch (err) {
    console.error('[drv_rt]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_loc_(.+)$/, async (ctx) => {
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery("Noto'g'ri viloyat");
  const session = profileSessions.get(ctx.from.id);
  if (!session?.car_type) return ctx.answerCbQuery('Avval mashina turini tanlang');

  try {
    const next = {
      ...session,
      current_location: region.label,
      from_region: region.label,
    };
    await ctx.answerCbQuery();
    if (session.truck_number || session.mode === 'onboarding') {
      await askDriverRoute(ctx, next);
      return;
    }
    rememberWizard(ctx.from.id, { ...next, step: 'to_region', presetId: 'custom' });
    await editWizard(
      ctx,
      next,
      `Moshina: <b>${session.car_type}</b>\nHozir: <b>${region.label}</b>\n\n🏁 Qayerga bormoqchisiz?`,
      driverRegionKeyboard('drv_dest', {
        extra: [[Markup.button.callback('🌍 Istalgan viloyatga', 'drv_dest_any')]],
      })
    );
  } catch (err) {
    console.error('[drv_loc]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

async function finishCustomDest(ctx, dest) {
  const session = profileSessions.get(ctx.from.id);
  if (!session?.current_location && !session?.from_region) {
    return ctx.answerCbQuery('Avval viloyatni tanlang');
  }
  const next = { ...session, to_region: dest, presetId: 'custom' };
  if (session.truck_number) {
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
    await finishDriverWizard(ctx, next);
    return;
  }
  await ctx.answerCbQuery();
  await askDriverPlate(ctx, next);
}

bot.action('drv_dest_any', async (ctx) => {
  try {
    await finishCustomDest(ctx, ANY_DEST);
  } catch (err) {
    console.error('[drv_dest_any]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^drv_dest_(.+)$/, async (ctx) => {
  if (ctx.match[1] === 'any') return;
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery("Noto'g'ri viloyat");
  try {
    await finishCustomDest(ctx, region.label);
  } catch (err) {
    console.error('[drv_dest]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('change_location', async (ctx) => {
  try {
    const profile = await getDriverProfile(ctx.from.id);
    if (!profile) {
      return ctx.answerCbQuery('Avval Yuk Izlash orqali profil oching', { show_alert: true });
    }
    profileSessions.set(ctx.from.id, { mode: 'change_location', step: 'cloc' });
    await ctx.answerCbQuery();
    await ctx.editMessageText('📍 <b>Hozir qaysi viloyatdasiz?</b>', {
      parse_mode: 'HTML',
      ...driverRegionKeyboard('cloc'),
    });
  } catch (err) {
    console.error('[change_location]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action(/^cloc_(.+)$/, async (ctx) => {
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery("Noto'g'ri viloyat");
  try {
    const existing = await getDriverProfile(ctx.from.id);
    await upsertDriverProfile(ctx.from.id, {
      current_location: region.label,
      from_region: region.label,
      truck_type: existing?.truck_type || existing?.car_type,
    });
    clearProfile(ctx.from.id);
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
    await replyCabinet(ctx, { edit: true });
  } catch (err) {
    console.error('[cloc]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
  }
});

bot.action('edit_truck', async (ctx) => {
  try {
    const profile = await getDriverProfile(ctx.from.id);
    if (!profile) {
      return ctx.answerCbQuery('Avval profilni oching', { show_alert: true });
    }
    profileSessions.set(ctx.from.id, {
      mode: 'edit_truck',
      step: 'car_type',
      full_name: profile.full_name,
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText('🚚 Yangi mashina turini tanlang:', {
      parse_mode: 'HTML',
      ...driverCarKeyboard(),
    });
  } catch (err) {
    console.error('[edit_truck]', err.message);
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
      truck_number: profile.truck_number,
      body_type: profile.body_type,
      full_name: profile.full_name,
      mode: 'change',
    });
    await ctx.answerCbQuery();
    await ctx.editMessageText(
      '📍 <b>Hozir qaysi viloyatdasiz?</b>\n<i>2 bosishda marshrut yangilanadi</i>',
      {
        parse_mode: 'HTML',
        ...driverRegionKeyboard('ch_loc', {
          extra: [[Markup.button.callback("🌍 Butun O'zbekiston", 'ch_rt_all')]],
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
    await persistSessionRoute(
      ctx.from.id,
      { presetId: 'all', current_location: existing?.current_location },
      {}
    );
    clearProfile(ctx.from.id);
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
    await replyCabinet(ctx, { edit: true });
  } catch (err) {
    console.error('[ch_rt_all]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
  }
});

bot.action(/^ch_loc_(.+)$/, async (ctx) => {
  const region = regionBySlug(ctx.match[1]);
  if (!region) return ctx.answerCbQuery("Noto'g'ri viloyat");
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
  await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
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
  if (!region) return ctx.answerCbQuery("Noto'g'ri viloyat");
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
    return ctx.answerCbQuery("Avval yuk ma'lumotlarini to'ldiring");
  }

  await ctx.answerCbQuery('Guruhga joylanmoqda...');

  let slot = null;
  try {
    slot = await reserveOrderSlot(userId);
    if (!slot.allowed) {
      await replySubscriptionRequired(ctx);
      return;
    }

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

    const royal = await postOrderToRoyalGroup(ctx.telegram, order);

    const dmClient = getActiveClient();
    if (dmClient) {
      crosspostToDm(dmClient, order).catch((err) => {
        console.error('[crosspost_dm]', err.message);
      });
    }

    let pushResult = { matchedCount: 0, notifiedCount: 0, notifiedDriverIds: [] };
    try {
      pushResult = (await matchAndNotifyDrivers(ctx.telegram, order)) || pushResult;
    } catch (pushErr) {
      console.error('[brk_publish] push:', pushErr.message);
    }

    await ctx.reply(formatDispatcherReport(order, pushResult), {
      parse_mode: 'HTML',
      ...mainMenuKeyboard({ isAdmin: isAdmin(userId) }),
    });

    if (!royal.ok && royal.error && royal.error !== 'ROYAL_CARGO_GROUP_ID_EMPTY') {
      await ctx.reply(
        royal.error === 'ADMIN_RIGHTS_REQUIRED'
          ? "⚠️ Bot guruhda admin emas — e'lon guruhga chiqmadi, lekin haydovchilarga yuborildi."
          : `⚠️ Guruhga chiqarishda xatolik: ${royal.error}`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (err) {
    if (slot?.reserved) {
      await releaseOrderSlot(userId, slot.reason);
    }
    console.error('[brk_publish]', err.message);
    await ctx.reply("Saqlashda xatolik. Qayta urinib ko'ring.", mainMenuKeyboard());
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
      "🟢 <b>Yuk qidiryapman</b>\n\n" +
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

bot.action('driver_toggle_status', async (ctx) => {
  try {
    const driver = await getDriverProfile(ctx.from.id);
    if (!hasRouteProfile(driver)) {
      return ctx.answerCbQuery('Avval profilni oching', { show_alert: true });
    }
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
    if (driver.status === DRIVER_STATUS.BUSY) {
      await setDriverActive(ctx, { viaCabinet: true });
    } else {
      await setDriverBusy(ctx, { viaCabinet: true });
    }
  } catch (err) {
    console.error('[driver_toggle_status]', err.message);
    try {
      await ctx.answerCbQuery('Xatolik');
    } catch {
      /* ignore */
    }
  }
});

bot.action('driver_set_active', async (ctx) => {
  try {
    await setDriverActive(ctx, { viaCabinet: true });
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
  } catch (err) {
    console.error('[driver_set_active]', err.message);
    await ctx.answerCbQuery('Xatolik');
  }
});

bot.action('driver_set_busy', async (ctx) => {
  try {
    await setDriverBusy(ctx, { viaCabinet: true });
    await ctx.answerCbQuery(STATUS_TOAST, { show_alert: true });
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
  if (prof?.step === 'full_name') {
    if (text.length < 2) {
      return ctx.reply('Ism juda qisqa. Ism-familiyani yozing.');
    }
    try {
      await askDriverCar(ctx, { ...prof, full_name: text });
    } catch (err) {
      console.error('[full_name]', err.message);
      await ctx.reply('Xatolik. Qayta urinib ko\'ring.');
    }
    return;
  }

  if (prof?.step === 'truck_number') {
    if (text.length < 4) {
      return ctx.reply('Raqam juda qisqa. Misol: <i>01 A 777 AA</i>', { parse_mode: 'HTML' });
    }

    try {
      const plate = text.toUpperCase();
      const next = { ...prof, truck_number: plate };

      if (prof.mode === 'edit_truck') {
        const existing = await getDriverProfile(userId);
        const driver = await upsertDriverProfile(userId, {
          truck_type: prof.car_type || existing?.truck_type,
          body_type: prof.body_type || existing?.body_type,
          truck_number: plate,
          full_name: prof.full_name || existing?.full_name,
          is_verified: true,
        });
        clearProfile(userId);
        const user = await getUserById(userId);
        await ctx.reply(formatDriverCard(driver, user), {
          parse_mode: 'HTML',
          ...cabinetInlineKeyboard(driver),
        });
        return;
      }

      if (prof.presetId || prof.to_region) {
        await finishDriverWizard(ctx, next, {
          truck_type: prof.car_type,
          truck_number: plate,
          status: DRIVER_STATUS.ACTIVE,
        });
        await ctx.reply('✅ Guvohnoma tayyor. Mos yuklar shaxsiyga tushadi.', {
          parse_mode: 'HTML',
          ...mainMenuKeyboard({ isAdmin: isAdmin(userId) }),
        });
        return;
      }

      rememberWizard(userId, next);
      await askDriverLocation(ctx, next);
    } catch (err) {
      console.error('[truck_number]', err.message);
      await ctx.reply("Saqlashda xatolik. Qayta urinib ko'ring.");
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

    let pushResult = { matchedCount: 0, notifiedCount: 0, notifiedDriverIds: [] };
    try {
      pushResult = (await matchAndNotifyDrivers(ctx.telegram, order)) || pushResult;
    } catch (pushErr) {
      console.error('[wiz_confirm] push:', pushErr.message);
    }

    await ctx.editMessageText(formatDispatcherReport(order, pushResult), {
      parse_mode: 'HTML',
    });
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
    const profile = await getDriverProfile(driverId);
    if (!profile || !hasRouteProfile(profile)) {
      await ctx.answerCbQuery("Avval haydovchi sifatida ro'yxatdan o'ting", { show_alert: true });
      pendingDriverSignup.add(driverId);
      await beginDriverProfileFlow(ctx);
      return;
    }

    // Eski profillarda users.role client bo'lib qolgan bo'lishi mumkin.
    // To'liq driver profil mavjud bo'lsa, rolni shu yerda sinxronlaymiz.
    const roleResult = await ensureDriverRole(driverId);
    if (!roleResult.ok) {
      await ctx.answerCbQuery(
        "Avval telefon raqamingizni ulang",
        { show_alert: true }
      );
      return;
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

    try {
      const driver = await getDriverProfile(driverId);
      const driverUser = await getUserById(driverId);
      await sendDriverAcceptedReport(ctx.telegram, order, driver, driverUser);
    } catch (reportErr) {
      console.error('[accept_order] broker report:', reportErr.message);
    }

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
    const profile = await getDriverProfile(ctx.from.id);
    if (!hasRouteProfile(profile)) {
      await ctx.answerCbQuery("Raqam faqat haydovchilarga ochiladi", { show_alert: true });
      pendingOrderByUser.set(ctx.from.id, orderId);
      await beginDriverProfileFlow(ctx);
      return;
    }
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
