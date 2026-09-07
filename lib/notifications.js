const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');
const { ORDER_STATUS, notifyAllDrivers } = require('../config/constants');
const { extractPrice } = require('./normalize');
const { fetchDrivers, activeOnly } = require('./drivers');
const { regionsTextMatch } = require('./routeMatch');
const { logSupabaseError } = require('./orders');
const { isLiveOrder, liveSinceIso } = require('./orderExpiry');
const { hasAllRoutes, driverMatchesOrder } = require('./driverRoutes');
const { sendDispatcherReport } = require('./dispatchReport');

const NOTIFY_DELAY_MS = 150;

const EMPTY_PUSH = {
  matchedCount: 0,
  notifiedCount: 0,
  notifiedDriverIds: [],
  matchType: 'none',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOrderMessage(order, driver) {
  const price = extractPrice(order.cargo_details);
  const cargo = order.cargo_details || '—';
  const truckNum = driver?.truck_number || '—';

  return (
    '🚚 <b>KARVON — YANGI YUK</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `📍 <b>Qayerdan:</b> ${order.from_region}\n` +
    `🏁 <b>Qayerga:</b> ${order.to_region}\n` +
    `📦 <b>Yuk:</b> ${cargo}\n` +
    `🔢 <b>Mashina:</b> ${order.car_type || '—'} · ${truckNum}\n` +
    `💰 <b>Narx:</b> ${price}\n` +
    '━━━━━━━━━━━━━━━\n' +
    '<b>Raqamni ochish / qo\'ng\'iroq qilish — pastdagi tugma</b>'
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

function orderActionKeyboard(
  order,
  { includeDm = false, acceptAction = 'accept_order' } = {}
) {
  const rows = [];
  // Telegram Bot API inline URL tugmalarida tel: sxemasini qo'llamaydi.
  // Raqamni faqat ro'yxatdan o'tgan haydovchiga callback orqali ochamiz.
  rows.push([Markup.button.callback('📞 Qo\'ng\'iroq Qilish', `call_order_${order.id}`)]);

  const dm = includeDm ? buildDmUrl(order) : null;
  if (dm) {
    rows.push([Markup.button.url('💬 Mijoz lichkasi', dm)]);
  }

  rows.push([Markup.button.callback('✅ Yukni olaman', `${acceptAction}_${order.id}`)]);
  return Markup.inlineKeyboard(rows);
}

async function findMatchingDrivers(order) {
  const candidates = activeOnly(
    await fetchDrivers((supabase, cols) => supabase.from('drivers').select(cols))
  );

  if (notifyAllDrivers()) {
    return {
      drivers: candidates,
      route: `${order.from_region}→${order.to_region}`,
      matchType: 'broadcast',
    };
  }

  const drivers = candidates.filter((d) => driverMatchesOrder(d, order));

  return {
    drivers,
    route: `${order.from_region}→${order.to_region}`,
    matchType: drivers.length > 0 ? 'strict' : 'none',
  };
}

async function sendDriverPush(telegram, driver, order) {
  const text = formatOrderMessage(order, driver);
  const opts = { parse_mode: 'HTML' };

  try {
    const msg = await telegram.sendMessage(driver.user_id, text, {
      ...opts,
      ...orderActionKeyboard(order, { includeTel: true, includeDm: false }),
    });
    return msg;
  } catch (err) {
    const isButtonError =
      /tel:|Wrong port number|inline keyboard|BUTTON_USER_INVALID|BUTTON_URL_INVALID|BUTTON_TYPE_INVALID|button_data_invalid/i.test(
        err.message
      );
    if (!isButtonError) {
      throw err;
    }

    console.warn(`[notify] ${driver.user_id}: tel tugma xato (${err.message}) — callback bilan qayta`);
    return telegram.sendMessage(driver.user_id, text, {
      ...opts,
      ...orderActionKeyboard(order, { includeTel: false, includeDm: false }),
    });
  }
}

async function notifyMatchingDrivers(telegram, order, { reportTo } = {}) {
  const empty = { ...EMPTY_PUSH };
  try {
    if (!isLiveOrder(order)) {
      console.log(`[notify] Skip expired/stale order ${order?.id}`);
      return { ...empty, matchType: 'expired' };
    }

    let drivers = [];
    let matchType = 'none';
    try {
      ({ drivers, matchType } = await findMatchingDrivers(order));
    } catch (err) {
      console.error('[notify] Driver query failed:', err.message);
      return empty;
    }

    const matchedCount = drivers.length;
    if (matchedCount === 0) {
      console.log(
        `[notify] Mos haydovchi yo'q: ${order.from_region}→${order.to_region}, ${order.car_type}`
      );
      const result = { ...empty, matchedCount: 0, matchType: matchType || 'none' };
      if (reportTo) await sendDispatcherReport(telegram, reportTo, order, result);
      return result;
    }

    console.log(
      `[notify] Instant push ${order.from_region}→${order.to_region} (${order.car_type}) → ${matchedCount} haydovchi`
    );

    const settled = await Promise.allSettled(
      drivers.map(async (driver, i) => {
        if (i > 0) await sleep(NOTIFY_DELAY_MS * i);
        const msg = await sendDriverPush(telegram, driver, order);
        console.log(
          `[notify] Yuborildi → ${driver.user_id} (${driver.from_region}→${driver.to_region})`
        );
        return {
          driver_id: driver.user_id,
          chat_id: msg.chat.id,
          message_id: msg.message_id,
        };
      })
    );

    const refs = [];
    for (let i = 0; i < settled.length; i++) {
      const item = settled[i];
      if (item.status === 'fulfilled' && item.value) {
        refs.push(item.value);
        continue;
      }
      const err = item.reason;
      const hint = /bot was blocked|chat not found|user is deactivated/i.test(err?.message || '')
        ? ' — /start kerak'
        : '';
      console.error(`[notify] ${drivers[i]?.user_id}:${hint}`, err?.message || err);
    }

    if (refs.length > 0) {
      try {
        const supabase = getSupabase();
        const { error } = await supabase
          .from('orders')
          .update({ notification_refs: refs })
          .eq('id', order.id);
        if (error) logSupabaseError('orders.notification_refs', error);
      } catch (err) {
        console.error('[notify] notification_refs:', err.message);
      }
    }

    const notifiedDriverIds = refs.map((r) => r.driver_id);
    const result = {
      matchedCount,
      notifiedCount: notifiedDriverIds.length,
      notifiedDriverIds,
      matchType: matchType || 'strict',
    };
    console.log(`[notify] #${order.id} → ${result.notifiedCount}/${matchedCount} haydovchi`);

    if (reportTo) await sendDispatcherReport(telegram, reportTo, order, result);
    return result;
  } catch (err) {
    console.error('[notify] notifyMatchingDrivers:', err.message);
    return empty;
  }
}

const matchAndNotifyDrivers = notifyMatchingDrivers;

async function pushRecentMatchingOrders(telegram, driver, { limit = 8 } = {}) {
  if (!driver?.user_id) {
    return 0;
  }
  if (
    !hasAllRoutes(driver) &&
    !driver.current_location &&
    !driver.from_region
  ) {
    console.warn(`[notify] recent push skip: profil to'liq emas (user=${driver.user_id})`);
    return 0;
  }

  const sinceIso = liveSinceIso('bot');
  const supabase = getSupabase();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('status', ORDER_STATUS.ACTIVE)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error) {
    logSupabaseError('orders.recent_match', error);
    return 0;
  }

  const pool = (orders || []).filter(isLiveOrder);
  const matches = pool.filter((o) => driverMatchesOrder(driver, o)).slice(0, limit);

  if (matches.length === 0) {
    console.log(
      `[notify] recent push 0: ${driver.user_id} ${driver.from_region}→${driver.to_region} pool=${pool.length}`
    );
    return 0;
  }

  let sent = 0;
  for (const order of matches) {
    if (sent > 0) await sleep(NOTIFY_DELAY_MS);
    try {
      await sendDriverPush(telegram, driver, order);
      sent++;
    } catch (err) {
      console.error(`[notify] recent push ${driver.user_id}:`, err.message);
    }
  }

  if (sent > 0) {
    console.log(`[notify] Catch-up: ${sent} ta tirik yuk → ${driver.user_id}`);
  }
  return sent;
}

async function markOrderTakenForOthers(telegram, order, acceptingDriverId) {
  const refs = order.notification_refs || [];

  for (const ref of refs) {
    if (String(ref.driver_id) === String(acceptingDriverId)) continue;
    try {
      await telegram.editMessageReplyMarkup(
        ref.chat_id,
        ref.message_id,
        undefined,
        Markup.inlineKeyboard([[Markup.button.callback('🔴 Yuk olindi', 'order_taken')]]).reply_markup
      );
    } catch (err) {
      console.error(`[notify] msg update ${ref.driver_id}:`, err.message);
    }
  }
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

  if (!isLiveOrder(order)) {
    return { success: false, reason: order.status === 'taken' ? 'already_taken' : 'expired', order };
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
    const { data: current } = await supabase.from('orders').select('*').eq('id', orderId).single();
    return { success: false, reason: 'already_taken', order: current };
  }

  return { success: true, order: updated };
}

async function fetchLiveOrdersFromRegion(fromRegion, limit = 5) {
  try {
    const supabase = getSupabase();
    const sinceIso = liveSinceIso('bot');
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('status', ORDER_STATUS.ACTIVE)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      logSupabaseError('orders.vitrina', error);
      return [];
    }
    return (data || [])
      .filter(isLiveOrder)
      .filter((o) => regionsTextMatch(o.from_region, fromRegion))
      .slice(0, limit);
  } catch (err) {
    console.error('[notify] fetchLiveOrdersFromRegion:', err.message);
    return [];
  }
}

module.exports = {
  formatOrderMessage,
  orderActionKeyboard,
  findMatchingDrivers,
  notifyMatchingDrivers,
  matchAndNotifyDrivers,
  pushRecentMatchingOrders,
  markOrderTakenForOthers,
  acceptOrder,
  fetchLiveOrdersFromRegion,
};
