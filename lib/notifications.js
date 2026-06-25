const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');
const { ORDER_STATUS } = require('../config/constants');
const { extractPrice, normalizePhone, phoneToTel } = require('./normalize');
const { fetchDrivers, activeOnly } = require('./drivers');
const { routeMatchesOrder } = require('./routeMatch');
const { logSupabaseError } = require('./orders');

const NOTIFY_DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOrderMessage(order, driver) {
  const phone = normalizePhone(order.phone_number) || order.phone_number || '—';
  const price = extractPrice(order.cargo_details);
  const cargo = order.cargo_details || '—';
  const truckNum = driver?.truck_number || '—';

  return (
    '🚚 <b>KARVON: YANGI YUK</b>\n' +
    '━━━━━━━━━━━━━━━\n' +
    `📍 <b>Qayerdan:</b> ${order.from_region}\n` +
    `🏁 <b>Qayerga:</b> ${order.to_region}\n` +
    `📦 <b>Yuk:</b> ${cargo}\n` +
    `🔢 <b>Mashina raqami:</b> ${truckNum}\n` +
    `💰 <b>Narx:</b> ${price}\n` +
    `📞 <b>Mijoz Tel:</b> ${phone}`
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

function orderActionKeyboard(order, { includeTel = true, includeDm = true } = {}) {
  const rows = [];
  const contactRow = [];

  if (includeTel) {
    const tel = phoneToTel(order.phone_number);
    if (tel) contactRow.push(Markup.button.url('📞 Mijozga Tel Qilish', tel));
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
  const candidates = activeOnly(
    await fetchDrivers((supabase, cols) => supabase.from('drivers').select(cols))
  );

  const drivers = candidates.filter((d) => routeMatchesOrder(d, order));

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
      ...orderActionKeyboard(order),
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

    // Muammoli URL tugmalarni (tel: yoki tg://user?id=) butunlay olib tashlab,
    // faqat "✅ Yukni olaman" tugmasi bilan qayta yuboramiz.
    console.warn(`[notify] ${driver.user_id}: tugma xatosi (${err.message}) — URL tugmalarsiz qayta`);
    return telegram.sendMessage(driver.user_id, text, {
      ...opts,
      ...orderActionKeyboard(order, { includeTel: false, includeDm: false }),
    });
  }
}

async function notifyMatchingDrivers(telegram, order) {
  let drivers;

  try {
    ({ drivers } = await findMatchingDrivers(order));
  } catch (err) {
    console.error('[notify] Driver query failed:', err.message);
    return;
  }

  if (drivers.length === 0) {
    console.log(
      `[notify] Mos haydovchi yo'q: ${order.from_region}→${order.to_region}, ${order.car_type}`
    );
    return;
  }

  const refs = [];

  for (let i = 0; i < drivers.length; i++) {
    const driver = drivers[i];
    if (i > 0) await sleep(NOTIFY_DELAY_MS);

    try {
      const msg = await sendDriverPush(telegram, driver, order);

      refs.push({
        driver_id: driver.user_id,
        chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      console.log(
        `[notify] Yuborildi → ${driver.user_id} (${driver.from_region}→${driver.to_region})`
      );
    } catch (err) {
      const hint = /bot was blocked|chat not found|user is deactivated/i.test(err.message)
        ? ' — /start kerak'
        : '';
      console.error(`[notify] ${driver.user_id}:${hint}`, err.message);
    }
  }

  if (refs.length > 0) {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('orders')
      .update({ notification_refs: refs })
      .eq('id', order.id);

    if (error) logSupabaseError('orders.notification_refs', error);
  }

  console.log(`[notify] #${order.id} → ${refs.length}/${drivers.length} haydovchi`);
}

/**
 * Haydovchi ro'yxatdan o'tganda/"Yuk qidiryapman"ni bosganda — yaqinda kelgan
 * mos yuklarni darhol yuboradi (ro'yxatdan o'tishdan biroz oldin kelgan yuklar
 * yo'qolib qolmasligi uchun).
 */
async function pushRecentMatchingOrders(
  telegram,
  driver,
  { sinceMinutes = 120, limit = 5 } = {}
) {
  if (!driver?.user_id || !driver.from_region || !driver.to_region) return 0;

  const sinceIso = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const supabase = getSupabase();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('status', ORDER_STATUS.ACTIVE)
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    logSupabaseError('orders.recent_match', error);
    return 0;
  }

  const matches = (orders || []).filter((o) => routeMatchesOrder(driver, o)).slice(0, limit);
  if (matches.length === 0) return 0;

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
    console.log(`[notify] Ro'yxatdan keyin ${sent} ta yaqin yuk yuborildi → ${driver.user_id}`);
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
};
