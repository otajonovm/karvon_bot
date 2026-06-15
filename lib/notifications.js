const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');
const { ORDER_STATUS } = require('../config/constants');
const { buildRoute, reverseRoute } = require('./normalize');

function formatOrderMessage(order) {
  const sourceLabel =
    order.source === 'scraper'
      ? `📡 <b>Manba:</b> Guruhdan${order.source_group ? ` (${order.source_group})` : ''}\n`
      : '📡 <b>Manba:</b> Karvon bot\n';

  return (
    `📦 <b>Yangi yuk!</b>\n\n` +
    sourceLabel +
    `📍 <b>Qayerdan:</b> ${order.from_region}\n` +
    `🏁 <b>Qayerga:</b> ${order.to_region}\n` +
    `🚛 <b>Mashina:</b> ${order.car_type}\n` +
    `📝 <b>Tavsif:</b> ${order.cargo_details}\n` +
    `📞 <b>Telefon:</b> ${order.phone_number}`
  );
}

/**
 * Find drivers: avval yo'nalish + mashina, topilmasa faqat mashina turi bo'yicha.
 */
async function findMatchingDrivers(order) {
  const supabase = getSupabase();
  const route = buildRoute(order.from_region, order.to_region);
  const reverse = reverseRoute(route);

  const { data: exact, error: exactErr } = await supabase
    .from('drivers')
    .select('user_id, car_type, preferred_route')
    .eq('car_type', order.car_type)
    .in('preferred_route', [route, reverse].filter(Boolean));

  if (exactErr) throw exactErr;

  if (exact && exact.length > 0) {
    return { drivers: exact, route, reverse, matchType: 'route' };
  }

  const { data: byCar, error: carErr } = await supabase
    .from('drivers')
    .select('user_id, car_type, preferred_route')
    .eq('car_type', order.car_type);

  if (carErr) throw carErr;

  if (byCar && byCar.length > 0) {
    console.log(
      `[notify] Yo'nalish mos kelmadi, lekin ${byCar.length} ta ${order.car_type} haydovchi topildi`
    );
    return { drivers: byCar, route, reverse, matchType: 'car_type' };
  }

  return { drivers: [], route, reverse, matchType: 'none' };
}

/**
 * Notify all matching drivers for a new order.
 */
async function notifyMatchingDrivers(telegram, order) {
  let drivers;
  let route;
  let reverse;

  try {
    const result = await findMatchingDrivers(order);
    drivers = result.drivers;
    route = result.route;
    reverse = result.reverse;
  } catch (err) {
    console.error('[notify] Driver query failed:', err.message);
    return;
  }

  if (drivers.length === 0) {
    console.log(`[notify] Haydovchi yo'q: ${order.car_type}, ${route}`);
    console.log('[notify] Haydovchi @karvongo_bot da /start → Haydovchi → /profile qilishi kerak');
    return;
  }

  const text = formatOrderMessage(order);
  const refs = [];

  for (const driver of drivers) {
    try {
      const msg = await telegram.sendMessage(driver.user_id, text, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          Markup.button.callback("📞 Mijoz bilan bog'lanish", `accept_order_${order.id}`),
        ]),
      });

      refs.push({
        driver_id: driver.user_id,
        chat_id: msg.chat.id,
        message_id: msg.message_id,
      });
      console.log(`[notify] Yuborildi → haydovchi ${driver.user_id} (${driver.preferred_route})`);
    } catch (err) {
      const hint = /bot was blocked|chat not found|user is deactivated/i.test(err.message)
        ? ' — haydovchi botni /start qilmagan'
        : '';
      console.error(`[notify] Haydovchi ${driver.user_id} ga yuborib bo'lmadi:${hint}`, err.message);
    }
  }

  if (refs.length > 0) {
    const supabase = getSupabase();
    const { error: updateError } = await supabase
      .from('orders')
      .update({ notification_refs: refs })
      .eq('id', order.id);

    if (updateError) {
      console.error('[notify] notification_refs saqlanmadi:', updateError.message);
    }
  }

  console.log(`[notify] Buyurtma #${order.id} → ${refs.length}/${drivers.length} haydovchiga yuborildi`);
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
        Markup.inlineKeyboard([
          Markup.button.callback('🔴 Yuk olindi', 'order_taken'),
        ]).reply_markup
      );
    } catch (err) {
      console.error(`[notify] Failed to update msg for driver ${ref.driver_id}:`, err.message);
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
  findMatchingDrivers,
  notifyMatchingDrivers,
  markOrderTakenForOthers,
  acceptOrder,
};
