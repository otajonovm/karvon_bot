const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');
const { ORDER_STATUS, notifyAllDrivers, DRIVER_STATUS } = require('../config/constants');
const { extractPrice, normalizePhone, phoneToTel } = require('./normalize');
const { fetchActiveDrivers, markDriverInactive, driverTelegramId } = require('./drivers');
const { routeMatchesOrder, orderTruckType } = require('./routeMatch');
const { logSupabaseError } = require('./orders');

/** Telegram FloodWait oldini olish: 50–100ms oraliq */
const PUSH_GAP_MS = 75;
const FLOOD_MAX_RETRIES = 2;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function orderPhone(order) {
  return order.phone || order.phone_number || order.broker_phone || '';
}

function orderPrice(order) {
  if (order.price) return order.price;
  return extractPrice(order.cargo_details);
}

function formatOrderMessage(order) {
  const cargo = order.cargo_details || 'Mavjud';
  const price = orderPrice(order) || 'Kelishiladi';
  const truck = orderTruckType(order) || '—';
  const from = order.from_region || '—';
  const to = order.to_region || '—';

  return (
    '🚨 YANGI YUK TOPIB BERILDI!\n' +
    '━━━━━━━━━━━━━━━\n' +
    `📍 Yo'nalish: ${from} ➔ ${to}\n` +
    `📦 Yuk: ${cargo}\n` +
    `💰 Narxi: ${price}\n` +
    `🚚 Mashina: ${truck}\n` +
    '━━━━━━━━━━━━━━━'
  );
}

function buildDmUrl(order) {
  if (order.sender_username) {
    return `https://t.me/${String(order.sender_username).replace(/^@/, '')}`;
  }
  const tgId = order.sender_telegram_id || order.broker_user_id;
  if (tgId) {
    return `tg://user?id=${tgId}`;
  }
  return null;
}

function orderActionKeyboard(order, { includeTel = true, includeDm = false } = {}) {
  const rows = [];
  const contactRow = [];

  if (includeTel) {
    const tel = phoneToTel(orderPhone(order));
    if (tel) contactRow.push(Markup.button.url("📞 Mijozga Qo'ng'iroq Qilish", tel));
  }

  if (includeDm) {
    const dm = buildDmUrl(order);
    if (dm) contactRow.push(Markup.button.url("💬 Mijoz Lichkasiga O'tish", dm));
  }

  if (contactRow.length > 0) rows.push(contactRow);
  rows.push([Markup.button.callback('✅ Yukni olaman', `accept_order_${order.id}`)]);

  return Markup.inlineKeyboard(rows);
}

async function findMatchingDrivers(order) {
  const candidates = await fetchActiveDrivers();

  if (notifyAllDrivers()) {
    return {
      drivers: candidates,
      route: `${order.from_region}→${order.to_region}`,
      matchType: 'broadcast',
    };
  }

  const drivers = candidates.filter((d) => routeMatchesOrder(d, order));

  return {
    drivers,
    route: `${order.from_region}→${order.to_region}`,
    matchType: drivers.length > 0 ? 'strict' : 'none',
  };
}

function telegramErrorCode(err) {
  return Number(err?.code || err?.response?.error_code || err?.error_code || 0);
}

function isBotBlockedError(err) {
  const code = telegramErrorCode(err);
  const msg = String(err?.message || err?.description || err?.response?.description || '');
  if (code === 403) return true;
  return /403|forbidden|bot was blocked|user is deactivated|chat not found|PEER_ID_INVALID/i.test(msg);
}

function floodWaitMs(err) {
  const code = telegramErrorCode(err);
  const msg = String(err?.message || err?.description || '');
  const retry =
    err?.retry_after ||
    err?.parameters?.retry_after ||
    err?.response?.parameters?.retry_after;
  if (retry) return Number(retry) * 1000;
  const m = msg.match(/retry after (\d+)/i);
  if (m) return Number(m[1]) * 1000;
  if (code === 429 || /FLOOD|Too Many Requests/i.test(msg)) return 1000;
  return 0;
}

function isButtonError(err) {
  return /tel:|Wrong port number|inline keyboard|BUTTON_USER_INVALID|BUTTON_URL_INVALID|BUTTON_TYPE_INVALID|button_data_invalid/i.test(
    String(err?.message || '')
  );
}

async function sendWithFloodRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= FLOOD_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = floodWaitMs(err);
      if (!wait || attempt === FLOOD_MAX_RETRIES) throw err;
      console.warn(`[push-engine] FloodWait ${Math.ceil(wait / 1000)}s — qayta urinish ${attempt + 1}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

async function sendDriverPush(telegram, driver, order) {
  const chatId = driverTelegramId(driver);
  const text = formatOrderMessage(order);
  const opts = { parse_mode: 'HTML' };

  try {
    return await sendWithFloodRetry(() =>
      telegram.sendMessage(chatId, text, {
        ...opts,
        ...orderActionKeyboard(order, { includeTel: true, includeDm: false }),
      })
    );
  } catch (err) {
    if (!isButtonError(err)) throw err;

    const phone = normalizePhone(orderPhone(order)) || orderPhone(order) || '—';
    const fallbackText = `${text}\n📞 Tel: ${phone}`;
    console.warn(`[push-engine] ${chatId}: tugma xatosi (${err.message}) — tel tugmasiz qayta`);
    return sendWithFloodRetry(() =>
      telegram.sendMessage(chatId, fallbackText, {
        ...opts,
        ...orderActionKeyboard(order, { includeTel: false, includeDm: false }),
      })
    );
  }
}

async function mapWithStagger(items, gapMs, mapper) {
  if (items.length === 0) return [];
  return Promise.all(
    items.map(async (item, i) => {
      if (i > 0) await sleep(i * gapMs);
      return mapper(item, i);
    })
  );
}

async function deliverPushToDrivers(telegram, order, drivers, { persistRefs = false } = {}) {
  const refs = [];
  let sentCount = 0;

  const results = await mapWithStagger(drivers, PUSH_GAP_MS, async (driver) => {
    const chatId = driverTelegramId(driver);
    try {
      const msg = await sendDriverPush(telegram, driver, order);
      sentCount += 1;
      const ref = {
        driver_id: driver.user_id,
        chat_id: msg.chat?.id ?? chatId,
        message_id: msg.message_id,
      };
      refs.push(ref);
      console.log(
        `[push-engine] OK → ${chatId} (${driver.from_region}⇄${driver.to_region})`
      );
      return { ok: true, ref };
    } catch (err) {
      if (isBotBlockedError(err)) {
        console.warn(`[push-engine] 403 Forbidden: ${chatId} botni bloklagan`);
        void markDriverInactive(driver.user_id, '403_forbidden');
        return { ok: false, blocked: true };
      }
      console.error(`[push-engine] ${chatId}:`, err.message);
      return { ok: false };
    }
  });

  if (persistRefs && refs.length > 0) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('orders')
      .update({ notification_refs: refs })
      .eq('id', order.id);

    if (error) logSupabaseError('orders.notification_refs', error);
  }

  console.log(
    `[push-engine] Order #${order.id} -> ${sentCount} ta mos haydovchiga muvaffaqiyatli yuborildi.`
  );

  return { sentCount, refs, results };
}

/**
 * Yangi yuk → mos faol haydovchilarga instant parallel push.
 */
async function notifyMatchingDrivers(telegram, order) {
  let drivers;

  try {
    ({ drivers } = await findMatchingDrivers(order));
  } catch (err) {
    console.error('[push-engine] Driver query failed:', err.message);
    return { sentCount: 0, drivers: [] };
  }

  if (drivers.length === 0) {
    console.log(
      `[push-engine] Mos haydovchi yo'q: ${order.from_region}→${order.to_region}, ${orderTruckType(order)}`
    );
    console.log(`[push-engine] Order #${order.id} -> 0 ta mos haydovchiga muvaffaqiyatli yuborildi.`);
    return { sentCount: 0, drivers };
  }

  if (notifyAllDrivers()) {
    console.log(
      `[push-engine] Barcha faol haydovchilarga: ${order.from_region}→${order.to_region} (${drivers.length} ta)`
    );
  } else {
    console.log(
      `[push-engine] ${drivers.length} ta mos haydovchi: ${order.from_region}⇄${order.to_region} (${orderTruckType(order)})`
    );
  }

  const delivered = await deliverPushToDrivers(telegram, order, drivers, { persistRefs: true });
  return { ...delivered, drivers };
}

/**
 * Haydovchi "Yuk qidiryapman" qilganda / yangi profil ochganda —
 * bazadagi aktiv + mos yo'nalishdagi yuklarni darhol yuboradi
 * (busy paytida o'tib ketgan yoki scraperdan oldin kelgan yuklar uchun).
 */
async function pushRecentMatchingOrders(
  telegram,
  driver,
  { sinceMinutes = 7 * 24 * 60, limit = 8 } = {}
) {
  if (!driver?.user_id || !driver.from_region || !driver.to_region) {
    console.warn(
      `[push-engine] recent skip: profil to'liq emas (user=${driver?.user_id}, ` +
        `${driver?.from_region}→${driver?.to_region})`
    );
    return 0;
  }

  if ((driver.status || DRIVER_STATUS.ACTIVE) !== DRIVER_STATUS.ACTIVE) {
    return 0;
  }

  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const supabase = getSupabase();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('status', ORDER_STATUS.ACTIVE)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(150);

  if (error) {
    logSupabaseError('orders.recent_match', error);
    return 0;
  }

  const pool = orders || [];
  const matches = pool.filter((o) => routeMatchesOrder(driver, o)).slice(0, limit);

  if (matches.length === 0) {
    console.log(
      `[push-engine] recent 0: ${driver.user_id} ${driver.from_region}→${driver.to_region} ` +
        `(${orderTruckType(driver)}), pool=${pool.length}, window=${sinceMinutes}m`
    );
    return 0;
  }

  let sent = 0;
  let blocked = false;
  await mapWithStagger(matches, PUSH_GAP_MS, async (order) => {
    if (blocked) return;
    try {
      await sendDriverPush(telegram, driver, order);
      sent += 1;
    } catch (err) {
      if (isBotBlockedError(err)) {
        blocked = true;
        void markDriverInactive(driver.user_id, '403_forbidden');
        return;
      }
      console.error(`[push-engine] recent ${driver.user_id}:`, err.message);
    }
  });

  if (sent > 0) {
    console.log(
      `[push-engine] Catch-up: ${sent} ta mos yuk → ${driver.user_id} ` +
        `(${driver.from_region}→${driver.to_region})`
    );
  }
  return sent;
}

async function markOrderTakenForOthers(telegram, order, acceptingDriverId) {
  const refs = order.notification_refs || [];

  await mapWithStagger(refs, PUSH_GAP_MS, async (ref) => {
    if (String(ref.driver_id) === String(acceptingDriverId)) return;
    try {
      await telegram.editMessageReplyMarkup(
        ref.chat_id,
        ref.message_id,
        undefined,
        Markup.inlineKeyboard([[Markup.button.callback('🔴 Yuk olindi', 'order_taken')]]).reply_markup
      );
    } catch (err) {
      console.error(`[push-engine] msg update ${ref.driver_id}:`, err.message);
    }
  });
}

async function acceptOrder(orderId, driverId) {
  const supabase = getSupabase();

  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (fetchError || !order) {
    return { success: false, reason: 'not_found' };
  }

  if (order.status !== ORDER_STATUS.ACTIVE) {
    return { success: false, reason: 'already_taken', order };
  }

  const { data: updated, error: updateError } = await supabase
    .from('orders')
    .update({
      status: ORDER_STATUS.TAKEN,
      taken_by: driverId,
    })
    .eq('id', orderId)
    .eq('status', ORDER_STATUS.ACTIVE)
    .select()
    .single();

  if (updateError || !updated) {
    logSupabaseError('orders.accept', updateError);
    const { data: current } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    return { success: false, reason: 'already_taken', order: current };
  }

  return { success: true, order: updated };
}

module.exports = {
  formatOrderMessage,
  orderActionKeyboard,
  findMatchingDrivers,
  notifyMatchingDrivers,
  pushRecentMatchingOrders,
  markOrderTakenForOthers,
  acceptOrder,
  isBotBlockedError,
  deliverPushToDrivers,
  PUSH_GAP_MS,
};
