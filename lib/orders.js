const { getSupabase } = require('./supabase');
const { calcExpiresAt, isLiveOrder, EXPIRED_USER_MSG } = require('./orderExpiry');
const { normalizePhone, normalizeRegion } = require('./normalize');

function logSupabaseError(context, error) {
  console.error(`Supabase Error [${context}]:`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

const DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;

async function findPhoneRouteDuplicate(supabase, fields) {
  const phone = normalizePhone(fields.phone_number) || fields.phone_number;
  if (!phone || !fields.from_region || !fields.to_region) return null;

  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, status')
    .eq('phone_number', phone)
    .eq('from_region', fields.from_region)
    .eq('to_region', fields.to_region)
    .eq('status', 'active')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logSupabaseError('orders.phone_dedup_check', error);
    return null;
  }
  return data || null;
}

async function touchOrder(supabase, orderId) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('orders').update({ updated_at: now }).eq('id', orderId);
  if (error && /updated_at|column/i.test(error.message)) {
    await supabase.from('orders').update({ expires_at: calcExpiresAt('scraper') }).eq('id', orderId);
  }
}

/**
 * Insert a new order. Returns null if duplicate (group+msgId OR phone+route).
 */
async function insertOrder(fields) {
  const supabase = getSupabase();
  const phone = normalizePhone(fields.phone_number) || fields.phone_number;

  if (fields.source_group && fields.source_message_id) {
    const { data: existing, error: dupErr } = await supabase
      .from('orders')
      .select('id')
      .eq('source_group', fields.source_group)
      .eq('source_message_id', fields.source_message_id)
      .maybeSingle();

    if (dupErr) {
      logSupabaseError('orders.duplicate_check', dupErr);
    } else if (existing) {
      console.log(`[orders] Duplicate skipped: ${fields.source_group}#${fields.source_message_id}`);
      return null;
    }
  }

  if (fields.source === 'scraper') {
    const phoneDup = await findPhoneRouteDuplicate(supabase, {
      ...fields,
      phone_number: phone,
    });
    if (phoneDup) {
      console.log(
        `[orders] Phone+route dup skipped: ${phone} ${fields.from_region}→${fields.to_region} (${phoneDup.id})`
      );
      try {
        await touchOrder(supabase, phoneDup.id);
      } catch (err) {
        console.error('[orders] touch dup:', err.message);
      }
      return null;
    }
  }

  const expiresAt = calcExpiresAt(fields.source || 'bot');

  const row = {
    from_region: normalizeRegion(fields.from_region) || fields.from_region,
    to_region: normalizeRegion(fields.to_region) || fields.to_region,
    car_type: fields.car_type,
    cargo_details: fields.cargo_details,
    phone_number: phone,
    status: 'active',
    source: fields.source || 'bot',
    source_group: fields.source_group || null,
    source_message_id: fields.source_message_id || null,
    raw_text: fields.raw_text || null,
    sender_username: fields.sender_username || null,
    sender_telegram_id: fields.sender_telegram_id || null,
    expires_at: expiresAt,
  };

  let { data: order, error } = await supabase.from('orders').insert(row).select().single();

  if (error && /expires_at|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.expires_at;
    ({ data: order, error } = await supabase.from('orders').insert(fallback).select().single());
  }

  if (error && /sender_|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.sender_username;
    delete fallback.sender_telegram_id;
    delete fallback.expires_at;
    ({ data: order, error } = await supabase.from('orders').insert(fallback).select().single());
  }

  if (error) {
    if (error.code === '23505' || /duplicate key|idx_orders_scraper_dedup/i.test(error.message)) {
      console.log(`[orders] Duplicate skipped (DB): ${fields.source_group}#${fields.source_message_id}`);
      return null;
    }
    logSupabaseError('orders.insert', error);
    throw error;
  }

  return order;
}

async function insertBrokerOrder({
  truck_type,
  from_region,
  to_region,
  cargo_details,
  broker_phone,
  broker_user_id,
}) {
  const supabase = getSupabase();
  const expiresAt = calcExpiresAt('bot');
  const phone = normalizePhone(broker_phone) || broker_phone;

  const row = {
    from_region: normalizeRegion(from_region) || from_region,
    to_region: normalizeRegion(to_region) || to_region,
    car_type: truck_type,
    cargo_details,
    phone_number: phone,
    broker_phone: phone,
    broker_user_id,
    sender_telegram_id: broker_user_id || null,
    status: 'active',
    source: 'bot',
    expires_at: expiresAt,
  };

  let { data: order, error } = await supabase.from('orders').insert(row).select().single();

  if (error && /expires_at|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.expires_at;
    ({ data: order, error } = await supabase.from('orders').insert(fallback).select().single());
  }

  if (error && /broker_|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.broker_phone;
    delete fallback.broker_user_id;
    delete fallback.sender_telegram_id;
    delete fallback.expires_at;
    ({ data: order, error } = await supabase.from('orders').insert(fallback).select().single());
  }

  if (error) {
    logSupabaseError('orders.broker_insert', error);
    throw error;
  }

  return order;
}

async function getOrderById(orderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    logSupabaseError('orders.getById', error);
    throw error;
  }

  return data;
}

async function isOrderActive(orderId) {
  try {
    const data = await getOrderById(orderId);
    if (!data) return { active: false, reason: 'not_found', order: null };
    if (data.status === 'taken') return { active: false, reason: 'taken', order: data };
    if (!isLiveOrder(data)) {
      if (data.status === 'active') {
        getSupabase()
          .from('orders')
          .update({ status: 'expired' })
          .eq('id', orderId)
          .eq('status', 'active')
          .then(() => {})
          .catch(() => {});
      }
      return { active: false, reason: 'expired', order: data };
    }
    return { active: true, reason: null, order: data };
  } catch (err) {
    logSupabaseError('orders.isOrderActive', err);
    return { active: false, reason: 'error', order: null };
  }
}

module.exports = {
  insertOrder,
  insertBrokerOrder,
  getOrderById,
  isOrderActive,
  logSupabaseError,
  EXPIRED_USER_MSG,
};
