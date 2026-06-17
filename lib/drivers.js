const { getSupabase } = require('./supabase');
const { DRIVER_STATUS } = require('../config/constants');

const DRIVER_COLS_BASE = 'user_id, car_type, preferred_route';
const DRIVER_COLS_EXTENDED =
  'user_id, car_type, truck_type, preferred_route, from_region, to_region, truck_number, status, is_verified, passport_file_id';

function normalizeDriverRow(row) {
  if (!row) return null;
  const truckType = row.truck_type ?? row.car_type;
  return {
    ...row,
    truck_type: truckType,
    car_type: row.car_type ?? truckType,
    from_region: row.from_region ?? null,
    to_region: row.to_region ?? null,
    truck_number: row.truck_number ?? null,
    status: row.status ?? DRIVER_STATUS.ACTIVE,
    is_verified: row.is_verified ?? false,
    passport_file_id: row.passport_file_id ?? null,
  };
}

async function fetchDrivers(buildQuery) {
  const supabase = getSupabase();

  for (const cols of [
    DRIVER_COLS_EXTENDED,
    `${DRIVER_COLS_BASE}, from_region, to_region, truck_number, status`,
    `${DRIVER_COLS_BASE}, status`,
    DRIVER_COLS_BASE,
  ]) {
    const { data, error } = await buildQuery(supabase, cols);
    if (!error) {
      return (data || []).map(normalizeDriverRow);
    }
    if (!/column|truck_type|is_verified|passport|status|from_region|to_region|truck_number/i.test(error.message)) {
      throw error;
    }
  }

  return [];
}

function activeOnly(drivers) {
  return drivers.filter((d) => d.status !== DRIVER_STATUS.BUSY);
}

async function upsertDriverProfile(
  userId,
  { truck_type, from_region, to_region, truck_number, preferred_route, status = DRIVER_STATUS.ACTIVE }
) {
  const supabase = getSupabase();
  const existing = await getDriverProfile(userId);
  const now = new Date().toISOString();
  const route =
    preferred_route || (from_region && to_region ? `${from_region} → ${to_region}` : '');

  const row = {
    user_id: userId,
    car_type: truck_type,
    truck_type,
    preferred_route: route || existing?.preferred_route || '—',
    from_region,
    to_region,
    truck_number,
    status,
    updated_at: now,
  };

  const save = async (payload) => {
    if (existing) {
      return supabase.from('drivers').update(payload).eq('user_id', userId).select().single();
    }
    return supabase.from('drivers').insert({ ...payload, is_verified: false }).select().single();
  };

  let { data, error } = await save(row);

  if (error && /column/i.test(error.message)) {
    const fallback = { ...row };
    for (const key of ['truck_type', 'from_region', 'to_region', 'truck_number', 'is_verified']) {
      if (error.message.includes(key)) delete fallback[key];
    }
    ({ data, error } = await save(fallback));
  }

  if (error) throw error;
  return normalizeDriverRow(data);
}

async function setDriverStatus(userId, status) {
  const supabase = getSupabase();
  const payload = { status, updated_at: new Date().toISOString() };

  const { error } = await supabase.from('drivers').update(payload).eq('user_id', userId);

  if (error && /status/i.test(error.message)) {
    console.warn('[drivers] status saqlanmadi — migration kerak');
    return;
  }

  if (error) throw error;
}

async function getDriverProfile(userId) {
  const supabase = getSupabase();

  for (const cols of [
    DRIVER_COLS_EXTENDED,
    `${DRIVER_COLS_BASE}, from_region, to_region, truck_number, status`,
    `${DRIVER_COLS_BASE}, status`,
    DRIVER_COLS_BASE,
  ]) {
    const { data, error } = await supabase
      .from('drivers')
      .select(cols)
      .eq('user_id', userId)
      .maybeSingle();

    if (!error) return normalizeDriverRow(data);
    if (!/column|truck_type|is_verified|passport|status|from_region|to_region|truck_number/i.test(error.message)) {
      throw error;
    }
  }

  return null;
}

async function setPassportFileId(userId, fileId) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('drivers')
    .update({
      passport_file_id: fileId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw error;
}

module.exports = {
  fetchDrivers,
  activeOnly,
  upsertDriverProfile,
  setDriverStatus,
  getDriverProfile,
  setPassportFileId,
  normalizeDriverRow,
};
