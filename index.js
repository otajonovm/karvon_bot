require('./config/env');

console.log('[bot] Karvon index.js yuklanmoqda...');

const { Telegraf, Markup } = require('telegraf');
const { getSupabase } = require('./lib/supabase');
const {
  notifyMatchingDrivers,
  markOrderTakenForOthers,
  acceptOrder,
} = require('./lib/notifications');
const { insertOrder } = require('./lib/orders');
const { REGIONS, CAR_TYPES, ROLES, ROUTES } = require('./config/constants');

// ─── Validate env ────────────────────────────────────────────────────────────

const required = ['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env variable: ${key}`);
    process.exit(1);
  }
}

const bot = new Telegraf(process.env.BOT_TOKEN);
const supabase = getSupabase();

// In-memory wizard sessions: userId -> { step, data }
const wizardSessions = new Map();

// In-memory profile setup: userId -> { step, car_type? }
const profileSessions = new Map();

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

function carTypeKeyboard(prefix) {
  return Markup.inlineKeyboard(chunkButtons(CAR_TYPES, prefix, 2));
}

function routeKeyboard() {
  const rows = [];
  for (let i = 0; i < ROUTES.length; i += 2) {
    rows.push(
      ROUTES.slice(i, i + 2).map((route) =>
        Markup.button.callback(route, `route_${route}`)
      )
    );
  }
  return Markup.inlineKeyboard(rows);
}

function clearWizard(userId) {
  wizardSessions.delete(userId);
}

function clearProfile(userId) {
  profileSessions.delete(userId);
}

// ─── /start ──────────────────────────────────────────────────────────────────

bot.start(async (ctx) => {
  try {
    await ctx.reply(
      "👋 <b>Karvon</b>ga xush kelibsiz!\n\n" +
        "Davom etish uchun telefon raqamingizni yuboring.",
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
    const { error } = await supabase.from('users').upsert(
      {
        id: userId,
        phone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (error) throw error;

    await ctx.reply(
      '✅ Raqamingiz saqlandi!\n\nRolingizni tanlang:',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [
            Markup.button.callback('📦 Men Yuk Egasiman', 'role_client'),
            Markup.button.callback('🚛 Men Haydovchiman', 'role_driver'),
          ],
        ]),
      }
    );

    await ctx.reply('Menyuni ochish uchun tugmani bosing.', Markup.removeKeyboard());
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

// ─── Role selection ───────────────────────────────────────────────────────────

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
          'Profil sozlash: /profile\n' +
          'Yangi yuklar avtomatik keladi.'
      );
    } else {
      await ctx.editMessageText(
        '📦 Siz yuk egasi sifatida ro\'yxatdan o\'tdingiz!\n\n' +
          'Yangi buyurtma: /neworder'
      );
    }
  } catch (err) {
    console.error('[role]', err.message);
    await ctx.answerCbQuery('Xatolik yuz berdi');
  }
});

// ─── /profile (driver) ───────────────────────────────────────────────────────

bot.command('profile', async (ctx) => {
  const userId = ctx.from.id;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('role')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return ctx.reply('Avval /start orqali ro\'yxatdan o\'ting.');
    }

    if (user.role !== ROLES.DRIVER) {
      return ctx.reply('Bu buyruq faqat haydovchilar uchun.');
    }

    profileSessions.set(userId, { step: 'car_type' });

    await ctx.reply(
      '🚛 <b>Profil sozlash</b>\n\nMashina turini tanlang:',
      { parse_mode: 'HTML', ...carTypeKeyboard('profile_car') }
    );
  } catch (err) {
    console.error('[profile]', err.message);
    await ctx.reply('Xatolik yuz berdi.');
  }
});

bot.action(/^profile_car_(.+)$/, async (ctx) => {
  const carType = ctx.match[1];
  const userId = ctx.from.id;

  if (!CAR_TYPES.includes(carType)) {
    return ctx.answerCbQuery('Noto\'g\'ri mashina turi');
  }

  profileSessions.set(userId, { step: 'route', car_type: carType });

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `✅ Mashina: <b>${carType}</b>\n\nYo'nalishni tanlang:`,
    { parse_mode: 'HTML', ...routeKeyboard() }
  );
});

bot.action(/^route_(.+)$/, async (ctx) => {
  const route = ctx.match[1];
  const userId = ctx.from.id;
  const session = profileSessions.get(userId);

  if (!session || !session.car_type) {
    return ctx.answerCbQuery('Avval /profile bosing');
  }

  if (!ROUTES.includes(route)) {
    return ctx.answerCbQuery('Noto\'g\'ri yo\'nalish');
  }

  try {
    const { error } = await supabase.from('drivers').upsert(
      {
        user_id: userId,
        car_type: session.car_type,
        preferred_route: route,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) throw error;

    clearProfile(userId);
    await ctx.answerCbQuery('Profil saqlandi!');
    await ctx.editMessageText(
      `✅ <b>Profil yangilandi!</b>\n\n` +
        `🚛 Mashina: ${session.car_type}\n` +
        `📍 Yo'nalish: ${route}`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('[route]', err.message);
    await ctx.answerCbQuery('Saqlashda xatolik');
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
    { parse_mode: 'HTML', ...carTypeKeyboard('wiz_car') }
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

// Text handler for cargo details step
bot.on('text', async (ctx, next) => {
  const userId = ctx.from.id;
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

// ─── Order acceptance ────────────────────────────────────────────────────────

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
