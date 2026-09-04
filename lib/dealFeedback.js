/**
 * 30 daqiqalik "kelishdingizmi?" feedback.
 * Push yuborilgandan / raqam ochilgandan keyin scheduled_at.
 */
const { Markup } = require('telegraf');
const { getSupabase } = require('./supabase');

const FEEDBACK_DELAY_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 2 * 60 * 1000;

function logFb(context, error) {
  if (!error) return;
  const msg = error.message || String(error);
  if (/deal_feedback|relation|does not exist/i.test(msg)) {
    console.warn('[feedback] deal_feedback jadvali yo\'q — supabase/migration_production_v2.sql ni Run qiling');
    return;
  }
  console.error(`[feedback] ${context}:`, msg);
}

async function scheduleFeedback(orderId, driverId) {
  if (!orderId || !driverId) return;
  try {
    const supabase = getSupabase();
    const scheduledAt = new Date(Date.now() + FEEDBACK_DELAY_MS).toISOString();

    const { error } = await supabase.from('deal_feedback').upsert(
      {
        order_id: orderId,
        driver_id: driverId,
        status: 'pending',
        scheduled_at: scheduledAt,
        sent_at: null,
      },
      { onConflict: 'order_id,driver_id', ignoreDuplicates: true }
    );

    if (error) logFb('schedule', error);
  } catch (err) {
    logFb('schedule.catch', err);
  }
}

async function driverAkaName(telegram, driverId) {
  try {
    const chat = await telegram.getChat(driverId);
    const first = String(chat.first_name || '').trim();
    if (first) return `${first} aka`;
  } catch {
    /* ignore */
  }
  return 'Aka';
}

async function sendFeedbackMessage(telegram, row) {
  const supabase = getSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, from_region, to_region, status, source, created_at, expires_at')
    .eq('id', row.order_id)
    .maybeSingle();

  if (!order || order.status === 'expired' || order.status === 'taken') {
    await supabase.from('deal_feedback').update({ status: 'timeout' }).eq('id', row.id);
    return;
  }

  const name = await driverAkaName(telegram, row.driver_id);
  const text =
    `${name}, <b>${order.from_region}</b> ➔ <b>${order.to_region}</b> ` +
    `yuki bo'yicha mijoz bilan kelishdingizmi?`;

  await telegram.sendMessage(row.driver_id, text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('🤝 Ha, yukni oldim', `deal_taken_${row.order_id}`),
        Markup.button.callback('❌ Narx to\'g\'ri kelmadi', `deal_failed_${row.order_id}`),
      ],
    ]),
  });
}

async function processPendingFeedbacks(telegram) {
  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();

    const { data: rows, error } = await supabase
      .from('deal_feedback')
      .select('id, order_id, driver_id')
      .eq('status', 'pending')
      .is('sent_at', null)
      .lte('scheduled_at', now)
      .limit(20);

    if (error) {
      logFb('fetchPending', error);
      return;
    }
    if (!rows?.length) return;

    for (const row of rows) {
      try {
        await sendFeedbackMessage(telegram, row);
        await supabase
          .from('deal_feedback')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', row.id);
      } catch (err) {
        if (/bot was blocked|chat not found|user is deactivated/i.test(err.message)) {
          await supabase.from('deal_feedback').update({ status: 'timeout' }).eq('id', row.id);
        } else {
          console.error(`[feedback] send ${row.driver_id}:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[feedback] processPending:', err.message);
  }
}

async function confirmDeal(orderId, driverId) {
  const supabase = getSupabase();

  try {
    const { error: orderErr } = await supabase
      .from('orders')
      .update({ status: 'taken', taken_by: driverId })
      .eq('id', orderId)
      .in('status', ['active', 'expired']);
    if (orderErr) logFb('confirmOrder', orderErr);
  } catch (err) {
    logFb('confirmOrder.catch', err);
  }

  try {
    const { error: drvErr } = await supabase
      .from('drivers')
      .update({ status: 'busy', updated_at: new Date().toISOString() })
      .eq('user_id', driverId);
    if (drvErr) logFb('driverBusy', drvErr);
  } catch (err) {
    logFb('driverBusy.catch', err);
  }

  try {
    const { error: incErr } = await supabase.rpc('increment_completed_trips', {
      driver_user_id: driverId,
    });
    if (incErr) {
      const { data: drv } = await supabase
        .from('drivers')
        .select('completed_trips')
        .eq('user_id', driverId)
        .maybeSingle();
      if (drv) {
        await supabase
          .from('drivers')
          .update({ completed_trips: (drv.completed_trips || 0) + 1 })
          .eq('user_id', driverId);
      }
    }
  } catch (err) {
    logFb('completed_trips', err);
  }

  try {
    await supabase
      .from('deal_feedback')
      .update({ status: 'success', answered_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .eq('driver_id', driverId);
  } catch (err) {
    logFb('feedbackSuccess', err);
  }
}

async function rejectDeal(orderId, driverId) {
  try {
    await getSupabase()
      .from('deal_feedback')
      .update({ status: 'failed', answered_at: new Date().toISOString() })
      .eq('order_id', orderId)
      .eq('driver_id', driverId);
  } catch (err) {
    logFb('rejectDeal', err);
  }
}

let feedbackTimer = null;

function startFeedbackLoop(telegram) {
  if (feedbackTimer) return;
  if (!telegram) {
    console.error('[feedback] telegram yo\'q — loop start qilinmadi');
    return;
  }

  processPendingFeedbacks(telegram).catch((err) =>
    console.error('[feedback] first tick:', err.message)
  );

  feedbackTimer = setInterval(() => {
    processPendingFeedbacks(telegram).catch((err) =>
      console.error('[feedback] loop:', err.message)
    );
  }, POLL_INTERVAL_MS);
  feedbackTimer.unref();
  console.log('[feedback] 30 daqiqa loop ishga tushdi (poll 2 daqiqa)');
}

function stopFeedbackLoop() {
  if (feedbackTimer) {
    clearInterval(feedbackTimer);
    feedbackTimer = null;
  }
}

module.exports = {
  scheduleFeedback,
  processPendingFeedbacks,
  confirmDeal,
  rejectDeal,
  startFeedbackLoop,
  stopFeedbackLoop,
};
