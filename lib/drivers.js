const { getSupabase } = require('./supabase');
const { DRIVER_STATUS } = require('../config/constants');

const DRIVER_COLS_BASE = 'user_id, car_type, preferred_route';
const DRIVER_COLS_EXTENDED =
  'user_id, car_type, truck_type, preferred_route, status, is_verified, passport_file_id';

function normalizeDriverRow(row) {
  if (!row) return null;
  const truckType = row.truck_type ?? row.car_type;
  return {
    ...row,
    truck_type: truckType,
    car_type: row.car_type ?? truckType,
    status: row.status ?? DRIVER_STATUS.ACTIVE,
    is_verified: row.is_verified ?? false,
    passport_file_id: row.passport_file_id ?? null,
  };
}

async function fetchDrivers(buildQuery) {
  const supabase = getSupabase();

  for (const cols of [DRIVER_COLS_EXTENDED, `${DRIVER_COLS_BASE}, status`, DRIVER_COLS_BASE]) {
    const { data, error } = await buildQuery(supabase, cols);
    if (!error) {
      return (data || []).map(normalizeDriverRow);
    }
    if (!/column|truck_type|is_verified|passport|status/i.test(error.message)) {
      throw error;
    }
  }

  return [];
}

function activeOnly(drivers) {
  return drivers.filter((d) => d.status !== DRIVER_STATUS.BUSY);
}

async function upsertDriverProfile(userId, { truck_type, preferred_route, status = DRIVER_STATUS.ACTIVE }) {
  const supabase = getSupabase();
  const existing = await getDriverProfile(userId);
  const now = new Date().toISOString();

  const row = {
    user_id: userId,
    car_type: truck_type,
    truck_type,
    preferred_route,
    status,
    updated_at: now,
  };

  if (existing) {
    let { data, error } = await supabase
      .from('drivers')
      .update(row)
      .eq('user_id', userId)
      .select()
      .single();

    if (error && /truck_type/i.test(error.message)) {
      delete row.truck_type;
      ({ data, error } = await supabase
        .from('drivers')
        .update(row)
        .eq('user_id', userId)
        .select()
        .single());
    }

    if (error) throw error;
    return normalizeDriverRow(data);
  }

  const insertRow = { ...row, is_verified: false };

  let { data, error } = await supabase.from('drivers').insert(insertRow).select().single();

  if (error && /truck_type|is_verified/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('drivers')
      .insert(row)
      .select()
      .single());
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

  for (const cols of [DRIVER_COLS_EXTENDED, `${DRIVER_COLS_BASE}, status`, DRIVER_COLS_BASE]) {
    const { data, error } = await supabase
      .from('drivers')
      .select(cols)
      .eq('user_id', userId)
      .maybeSingle();

    if (!error) return normalizeDriverRow(data);
    if (!/column|truck_type|is_verified|passport|status/i.test(error.message)) {
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
