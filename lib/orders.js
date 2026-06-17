const { getSupabase } = require('./supabase');

function logSupabaseError(context, error) {
  console.error(`Supabase Error [${context}]:`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
  });
}

/**
 * Insert a new order. Returns null if duplicate.
 */
async function insertOrder(fields) {
  const supabase = getSupabase();

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
  };

  let { data: order, error } = await supabase.from('orders').insert(row).select().single();

  if (error && /sender_|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.sender_username;
    delete fallback.sender_telegram_id;
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
  };

  let { data: order, error } = await supabase.from('orders').insert(row).select().single();

  if (error && /broker_|column/i.test(error.message)) {
    const fallback = { ...row };
    delete fallback.broker_phone;
    delete fallback.broker_user_id;
    delete fallback.sender_telegram_id;
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

module.exports = { insertOrder, insertBrokerOrder, getOrderById, logSupabaseError };
