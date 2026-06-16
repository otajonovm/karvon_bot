const { getSupabase } = require('./supabase');

/**
 * Haydovchi jonli joylashuvini saqlash (har yangilanish — yangi qator).
 */
async function recordPosition(orderId, latitude, longitude) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_tracking')
    .insert({
      order_id: orderId,
      latitude,
      longitude,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Buyurtma bo'yicha eng so'nggi joylashuv.
 */
async function getLatestPosition(orderId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_tracking')
    .select('*')
    .eq('order_id', orderId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Buyurtma tracking tarixi.
 */
async function getTrackingHistory(orderId, limit = 20) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('order_tracking')
    .select('*')
    .eq('order_id', orderId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

module.exports = { recordPosition, getLatestPosition, getTrackingHistory };
