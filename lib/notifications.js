const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');
const { ORDER_STATUS } = require('../config/constants');
const { extractPrice, normalizePhone } = require('./normalize');
const { fetchDrivers, activeOnly } = require('./drivers');
const { routeMatchesOrder } = require('./routeMatch');

function formatOrderMessage(order) {
  const price = extractPrice(order.cargo_details);
  const cargo = order.cargo_details || '—';

  return (
    `📦 <b>Yangi yuk!</b>\n\n` +
    `📍 <b>Dan:</b> ${order.from_region}\n` +
    `🏁 <b>Ga:</b> ${order.to_region}\n` +
    `💎 <b>Yuk:</b> ${cargo}\n` +
    `💰 <b>Narx:</b> ${price}\n` +
    `🚛 <b>Mashina:</b> ${order.car_type}`
  );
}

function contactButton(order) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("📞 Bog'lanish", `contact_order_${order.id}`)],
  ]);
}

/**
 * Qat'iy filtr: order from/to haydovchi from/to ga mos (yoki backhaul).
 * Boshqa holatda hech kimga yuborilmaydi.
 */
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

  const text = formatOrderMessage(order);
  const keyboard = contactButton(order);
  const refs = [];

  for (const driver of drivers) {
    try {
      let msg;
      try {
        msg = await telegram.sendMessage(driver.user_id, text, {
          parse_mode: 'HTML',
          ...keyboard,
        });
      } catch (sendErr) {
        const phone = normalizePhone(order.phone_number) || order.phone_number;
        console.warn(`[notify] Tugma bilan yuborib bo'lmadi: ${sendErr.message}`);
        msg = await telegram.sendMessage(
          driver.user_id,
          `${text}\n\n📞 <b>Telefon:</b> <a href="tel:${phone.replace(/\s/g, '')}">${phone}</a>`,
          { parse_mode: 'HTML' }
        );
      }

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

    if (error) console.error('[notify] notification_refs:', error.message);
  }

  console.log(`[notify] #${order.id} → ${refs.length}/${drivers.length} haydovchi`);
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
  contactButton,
  findMatchingDrivers,
  notifyMatchingDrivers,
  markOrderTakenForOthers,
  acceptOrder,
};
