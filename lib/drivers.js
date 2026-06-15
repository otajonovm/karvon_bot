const { getSupabase } = require('./supabase');
const { DRIVER_STATUS } = require('../config/constants');

async function setDriverStatus(userId, status) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('drivers')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw error;
}

async function getDriverProfile(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('drivers')
    .select('user_id, car_type, preferred_route, status')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

module.exports = { setDriverStatus, getDriverProfile };
