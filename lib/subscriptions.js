const { getSupabase } = require('./supabase');

const PAYMENT_PLANS = {
  pro_weekly: {
    label: 'Haftalik PRO',
    amount: 19000,
    durationDays: 7,
  },
  pro_monthly: {
    label: 'Oylik PRO',
    amount: 49000,
    durationDays: 30,
  },
  single_order: {
    label: 'Bittalik e’lon',
    amount: 5000,
    durationDays: 0,
  },
};

// Productionda ENV orqali almashtiriladi.
const PAYMENT_CARD = process.env.PAYMENT_CARD || '8600 0000 0000 0000';
const PAYMENT_CARD_HOLDER = process.env.PAYMENT_CARD_HOLDER || 'Ism Familiya';
const ADMIN_CHAT_ID =
  process.env.ADMIN_CHAT_ID || (process.env.ADMIN_IDS || '').split(',')[0].trim();
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function isProActive(user) {
  return (
    user?.subscription_plan &&
    user.subscription_plan !== 'free' &&
    user.subscription_expires_at &&
    new Date(user.subscription_expires_at).getTime() > Date.now()
  );
}

function normalizeSubscriptionUser(user) {
  const today = todayUtc();
  const count = user?.last_order_date === today ? Number(user.daily_orders_count) || 0 : 0;
  return {
    ...user,
    subscription_plan: user?.subscription_plan || 'free',
    daily_orders_count: count,
    last_order_date: today,
    single_order_credits: Number(user?.single_order_credits) || 0,
    is_pro: isProActive(user),
  };
}

async function getSubscriptionUser(userId) {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from('users')
    .select(
      'id, phone, role, subscription_plan, subscription_expires_at, daily_orders_count, last_order_date, single_order_credits'
    )
    .eq('id', userId)
    .maybeSingle();
  if (error && /subscription_plan|subscription_expires_at|daily_orders_count|last_order_date|single_order_credits|column/i.test(error.message)) {
    const fallback = await supabase
      .from('users')
      .select('id, phone, role')
      .eq('id', userId)
      .maybeSingle();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;
  return normalizeSubscriptionUser(data);
}

function eligibility(user) {
  const normalized = normalizeSubscriptionUser(user);
  if (normalized.is_pro || normalized.single_order_credits > 0) {
    return { allowed: true, user: normalized, reason: 'paid' };
  }
  if (normalized.daily_orders_count < 1) {
    return { allowed: true, user: normalized, reason: 'free' };
  }
  return { allowed: false, user: normalized, reason: 'daily_limit' };
}

async function canPublishOrder(userId) {
  return eligibility(await getSubscriptionUser(userId));
}

/**
 * Atomically reserves one order slot when the migration RPC is available.
 * The direct-update fallback keeps older installations usable.
 */
async function reserveOrderSlot(userId) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('consume_order_slot', {
      p_user_id: userId,
    });
    if (!error && data) {
      const row = Array.isArray(data) ? data[0] : data;
      return {
        allowed: Boolean(row?.allowed),
        reason: row?.reason || (row?.allowed ? 'free' : 'daily_limit'),
        reserved: Boolean(row?.allowed),
      };
    }
    if (error && !/consume_order_slot|function|does not exist/i.test(error.message)) {
      throw error;
    }
  } catch (err) {
    console.warn('[subscriptions] RPC fallback:', err.message);
  }

  const current = await getSubscriptionUser(userId);
  const result = eligibility(current);
  if (!result.allowed) return { ...result, reserved: false };

  const payload = {
    last_order_date: todayUtc(),
    updated_at: new Date().toISOString(),
  };
  if (result.user.is_pro) {
    // Pro is unlimited; no daily counter mutation is needed.
  } else if (result.user.single_order_credits > 0) {
    payload.single_order_credits = result.user.single_order_credits - 1;
  } else {
    payload.daily_orders_count = result.user.daily_orders_count + 1;
  }
  const { error } = await supabase.from('users').update(payload).eq('id', userId);
  if (error) throw error;
  return { allowed: true, reason: result.reason, reserved: true };
}

async function releaseOrderSlot(userId, reason) {
  if (!reason || reason === 'paid') return;
  try {
    const user = await getSubscriptionUser(userId);
    const payload = { updated_at: new Date().toISOString() };
    if (reason === 'free') {
      payload.daily_orders_count = Math.max(0, user.daily_orders_count - 1);
    } else if (reason === 'single_order') {
      payload.single_order_credits = user.single_order_credits + 1;
    } else {
      return;
    }
    await getSupabase().from('users').update(payload).eq('id', userId);
  } catch (err) {
    console.error('[subscriptions] release slot:', err.message);
  }
}

async function createPayment({ userId, plan, receiptPhotoId, firstName, username }) {
  const config = PAYMENT_PLANS[plan];
  if (!config) throw new Error('Invalid payment plan');
  const { data, error } = await getSupabase()
    .from('payments')
    .insert({
      user_id: userId,
      plan,
      amount_uzs: config.amount,
      receipt_photo_id: receiptPhotoId,
      payer_first_name: firstName || null,
      payer_username: username || null,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getPayment(paymentId) {
  const { data, error } = await getSupabase()
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function approvePayment(paymentId) {
  const supabase = getSupabase();
  try {
    const { data, error } = await supabase.rpc('approve_payment', {
      p_payment_id: paymentId,
    });
    if (!error) {
      const payment = Array.isArray(data) ? data[0] : data;
      return payment
        ? { ok: true, payment }
        : { ok: false, reason: 'already_processed' };
    }
    if (!/approve_payment|function|does not exist/i.test(error.message)) {
      throw error;
    }
  } catch (err) {
    console.warn('[subscriptions] approve RPC fallback:', err.message);
  }

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .update({ status: 'approved' })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (paymentError) throw paymentError;
  if (!payment) return { ok: false, reason: 'already_processed' };

  const now = new Date();
  const plan = PAYMENT_PLANS[payment.plan];
  const userPayload = { updated_at: now.toISOString() };
  if (payment.plan === 'single_order') {
    const user = await getSubscriptionUser(payment.user_id);
    userPayload.single_order_credits = user.single_order_credits + 1;
  } else {
    userPayload.subscription_plan = payment.plan;
    userPayload.subscription_expires_at = new Date(
      now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000
    ).toISOString();
  }
  const { error: userError } = await supabase
    .from('users')
    .update(userPayload)
    .eq('id', payment.user_id);
  if (userError) throw userError;
  return { ok: true, payment };
}

async function rejectPayment(paymentId) {
  const { data, error } = await getSupabase()
    .from('payments')
    .update({ status: 'rejected' })
    .eq('id', paymentId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? { ok: true, payment: data } : { ok: false, reason: 'already_processed' };
}

function paymentPlanLabel(plan) {
  return PAYMENT_PLANS[plan]?.label || plan || '—';
}

module.exports = {
  PAYMENT_PLANS,
  PAYMENT_CARD,
  PAYMENT_CARD_HOLDER,
  ADMIN_CHAT_ID,
  ADMIN_USERNAME,
  getSubscriptionUser,
  canPublishOrder,
  reserveOrderSlot,
  releaseOrderSlot,
  createPayment,
  getPayment,
  approvePayment,
  rejectPayment,
  paymentPlanLabel,
};
