/**
 * "Kelishdingizmi?" feedback tizimi.
 *
 * Haydovchi raqamni ochganidan 30 daqiqa so'ng bot:
 *   "Eshmat aka, [from] → [to] yuki bo'yicha kelishdingizmi?"
 * tugmalar: [🤝 Ha, reysni oldim] [❌ Kelisha olmadik]
 *
 * "Ha" bosish:
 *   - order.status = 'taken'
 *   - driver.status = 'busy'
 *   - driver.completed_trips + 1
 */

const { getSupabase } = require('./supabase');
const { logSupabaseError } = require('./orders');

const FEEDBACK_DELAY_MS = 30 * 60 * 1000; // 30 daqiqa
const POLL_INTERVAL_MS  = 2  * 60 * 1000; // har 2 daqiqa tekshiruv

/**
 * Feedback yozuvini DB ga qo'shadi.
 * Agar allaqachon mavjud bo'lsa — xotirjam skip.
 */
async function scheduleFeedback(orderId, driverId) {
  const supabase = getSupabase();
  const scheduledAt = new Date(Date.now() + FEEDBACK_DELAY_MS).toISOString();

  const { error } = await supabase
    .from('deal_feedback')
    .upsert(
      {
        order_id: orderId,
        driver_id: driverId,
        status: 'pending',
        scheduled_at: scheduledAt,
      },
      { onConflict: 'order_id,driver_id', ignoreDuplicates: true }
    );

  if (error) {
    // deal_feedback jadvali yo'q bo'lsa — migration ishga tushirilmagan,
    // jim o'tamiz (crash qilmaymiz)
    if (!/deal_feedback|relation|does not exist/i.test(error.message)) {
      logSupabaseError('dealFeedback.schedule', error);
    }
  }
}

/**
 * Kutilayotgan feedbacklarni Telegram orqali yuboradi.
 * telegram — bot.telegram instance.
 */
async function processPendingFeedbacks(telegram) {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: rows, error } = await supabase
    .from('deal_feedback')
    .select('id, order_id, driver_id')
    .eq('status', 'pending')
    .lte('scheduled_at', now)
    .limit(20);

  if (error) {
    if (!/deal_feedback|relation|does not exist/i.test(error.message)) {
      logSupabaseError('dealFeedback.fetchPending', error);
    }
    return;
  }

  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    try {
      await sendFeedbackMessage(telegram, row);

      await supabase
        .from('deal_feedback')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
    } catch (err) {
      if (/bot was blocked|chat not found|user is deactivated/i.test(err.message)) {
        // Haydovchi botti bloklagan — timeout sifatida belgilaymiz
        await supabase
          .from('deal_feedback')
          .update({ status: 'timeout' })
          .eq('id', row.id)
          .catch(() => {});
      } else {
        console.error(`[feedback] send ${row.driver_id}:`, err.message);
      }
    }
  }
}

async function sendFeedbackMessage(telegram, row) {
  const supabase = getSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, from_region, to_region, status')
    .eq('id', row.order_id)
    .maybeSingle();

  if (!order || order.status === 'expired') {
    await supabase
      .from('deal_feedback')
      .update({ status: 'timeout' })
      .eq('id', row.id)
      .catch(() => {});
    return;
  }

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('id', row.driver_id)
    .maybeSingle();

  const name = user ? 'Haydovchi' : 'Haydovchi';

  const text =
    `${name}, <b>${order.from_region}</b> ➔ <b>${order.to_region}</b> ` +
    `yuki bo'yicha mijoz bilan kelishdingizmi?`;

  const { Markup } = require('telegraf');
  await telegram.sendMessage(row.driver_id, text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('🤝 Ha, reysni oldim', `deal_success_${row.order_id}`),
        Markup.button.callback('❌ Kelisha olmadik', `deal_failed_${row.order_id}`),
      ],
    ]),
  });
}

/**
 * Haydovchi "Ha" bosdi:
 *   order → taken, driver → busy, completed_trips++
 */
async function confirmDeal(orderId, driverId) {
  const supabase = getSupabase();

  // Order taken
  await supabase
    .from('orders')
    .update({ status: 'taken', taken_by: driverId })
    .eq('id', orderId)
    .in('status', ['active', 'expired'])
    .catch((e) => logSupabaseError('dealFeedback.confirmOrder', e));

  // Driver busy
  await supabase
    .from('drivers')
    .update({ status: 'busy', updated_at: new Date().toISOString() })
    .eq('user_id', driverId)
    .catch((e) => logSupabaseError('dealFeedback.driverBusy', e));

  // completed_trips++
  const { error: incErr } = await supabase.rpc('increment_completed_trips', {
    driver_user_id: driverId,
  });
  if (incErr) {
    // rpc yo'q bo'lsa fallback
    const { data: drv } = await supabase
      .from('drivers')
      .select('completed_trips')
      .eq('user_id', driverId)
      .maybeSingle();
    if (drv) {
      await supabase
        .from('drivers')
        .update({ completed_trips: (drv.completed_trips || 0) + 1 })
        .eq('user_id', driverId)
        .catch(() => {});
    }
  }

  // Feedback yozuvi yopiladi
  await supabase
    .from('deal_feedback')
    .update({ status: 'success', answered_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('driver_id', driverId)
    .catch(() => {});
}

/**
 * Haydovchi "Kelisha olmadik" bosdi.
 */
async function rejectDeal(orderId, driverId) {
  const supabase = getSupabase();
  await supabase
    .from('deal_feedback')
    .update({ status: 'failed', answered_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('driver_id', driverId)
    .catch(() => {});
}

let feedbackTimer = null;

function startFeedbackLoop(telegram) {
  if (feedbackTimer) return;

  feedbackTimer = setInterval(() => {
    processPendingFeedbacks(telegram).catch((err) =>
      console.error('[feedback] loop xato:', err.message)
    );
  }, POLL_INTERVAL_MS);

  feedbackTimer.unref();
  console.log('[feedback] Feedback loop ishga tushdi (har 2 daqiqa)');
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
