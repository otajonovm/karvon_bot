const { getSupabase } = require('./supabase');
const { buildRoute } = require('./normalize');

/**
 * Insert a new order. Returns null if duplicate.
 */
async function insertOrder(fields) {
  const supabase = getSupabase();

  if (fields.source_group && fields.source_message_id) {
    const { data: existing } = await supabase
      .from('orders')
      .select('id')
      .eq('source_group', fields.source_group)
      .eq('source_message_id', fields.source_message_id)
      .maybeSingle();

    if (existing) {
      console.log(`[orders] Duplicate skipped: ${fields.source_group}#${fields.source_message_id}`);
      return null;
    }
  }

  const { data: order, error } = await supabase
    .from('orders')
    .insert({
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
    })
    .select()
    .single();

  if (error) throw error;
  return order;
}

module.exports = { insertOrder };
