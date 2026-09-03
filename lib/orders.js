const { getSupabase } = require('./supabase');
const { calcExpiresAt } = require('./orderExpiry');

function logSupabaseError(context, error) {
  console.error(`Supabase Error [${context}]:`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

// ─── Dublikat tekshiruv: telefon + marshrut (3 soat) ─────────────────────────
// Bir xil phone+from+to yuklarni qayta yozmaydi, faqat updated_at yangilaydi.
const DEDUP_WINDOW_MS = 3 * 60 * 60 * 1000;

async function findPhoneRouteDuplicate(supabase, fields) {
  if (!fields.phone_number || !fields.from_region || !fields.to_region) return null;

  const since = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, status')
    .eq('phone_number', fields.phone_number)
    .eq('from_region', fields.from_region)
    .eq('to_region', fields.to_region)
    .in('status', ['active', 'taken'])
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

/**
 * Insert a new order. Returns null if duplicate (group+msgId OR phone+route).
 */
async function insertOrder(fields) {
  const supabase = getSupabase();

  // 1-qadam: exact guruh xabar dedup (tezkor)
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

  // 2-qadam: telefon+marshrut dedup (3 soat, faqat scraper uchun)
  if (fields.source === 'scraper') {
    const phoneDup = await findPhoneRouteDuplicate(supabase, fields);
    if (phoneDup) {
      console.log(
        `[orders] Phone+route dup skipped: ${fields.phone_number} ${fields.from_region}→${fields.to_region} (${phoneDup.id})`
      );
      // updated_at yangilaymiz — eskirishini keyinlashtiramiz
      await supabase
        .from('orders')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', phoneDup.id)
        .catch(() => {});
      return null;
    }
  }

  const expiresAt = calcExpiresAt(fields.source || 'bot');

  const row = {
    from_region: fields.from_region,
    to_region: fields.to_region,
    car_type: fields.car_type,
    cargo_details: fields.cargo_details,
    phone_number: fields.phone_number,
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

/** Broker yuk joylash (2-bosqich) */
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

  const row = {
    from_region,
    to_region,
    car_type: truck_type,
    cargo_details,
    phone_number: broker_phone,
    broker_phone,
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

/**
 * Yuk hali aktiv (muddati o'tmagan) ekanini tekshiradi.
 * Returns: { active: bool, reason: 'expired'|'taken'|'not_found'|null }
 */
async function isOrderActive(orderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, expires_at')
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    logSupabaseError('orders.isOrderActive', error);
    return { active: false, reason: 'error' };
  }
  if (!data) return { active: false, reason: 'not_found' };
  if (data.status === 'expired') return { active: false, reason: 'expired' };
  if (data.status === 'taken') return { active: false, reason: 'taken' };

  // Expires_at bo'lsa va o'tgan bo'lsa
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    // Lazy mark
    getSupabase()
      .from('orders')
      .update({ status: 'expired' })
      .eq('id', orderId)
      .eq('status', 'active')
      .then(() => {})
      .catch(() => {});
    return { active: false, reason: 'expired' };
  }

  return { active: true, reason: null };
}

module.exports = {
  insertOrder,
  insertBrokerOrder,
  getOrderById,
  isOrderActive,
  logSupabaseError,
};
