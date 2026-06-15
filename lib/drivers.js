const { getSupabase } = require('./supabase');
const { DRIVER_STATUS } = require('../config/constants');

const DRIVER_COLS_BASE = 'user_id, car_type, preferred_route';

async function fetchDrivers(buildQuery) {
  const supabase = getSupabase();

  for (const withStatus of [true, false]) {
    const cols = withStatus ? `${DRIVER_COLS_BASE}, status` : DRIVER_COLS_BASE;
    const { data, error } = await buildQuery(supabase, cols);

    if (!error) {
      return (data || []).map((row) => ({
        ...row,
        status: row.status ?? DRIVER_STATUS.ACTIVE,
      }));
    }

    if (!withStatus || !/status/i.test(error.message)) {
      throw error;
    }

    console.warn('[drivers] status ustuni yo\'q — supabase/migration_driver_status.sql ni ishga tushiring');
  }

  return [];
}

function activeOnly(drivers) {
  return drivers.filter((d) => d.status !== DRIVER_STATUS.BUSY);
}

async function setDriverStatus(userId, status) {
  const supabase = getSupabase();
  const payload = { status, updated_at: new Date().toISOString() };

  let { error } = await supabase.from('drivers').update(payload).eq('user_id', userId);

  if (error && /status/i.test(error.message)) {
    console.warn('[drivers] status saqlanmadi — migration kerak');
    return;
  }

  if (error) throw error;
}

async function getDriverProfile(userId) {
  const supabase = getSupabase();

  let { data, error } = await supabase
    .from('drivers')
    .select(`${DRIVER_COLS_BASE}, status`)
    .eq('user_id', userId)
    .maybeSingle();

  if (error && /status/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('drivers')
      .select(DRIVER_COLS_BASE)
      .eq('user_id', userId)
      .maybeSingle());
    if (data) data.status = DRIVER_STATUS.ACTIVE;
  }

  if (error) throw error;
  return data;
}

module.exports = {
  fetchDrivers,
  activeOnly,
  setDriverStatus,
  getDriverProfile,
};
