const { getSupabase, getSupabaseKey } = require('./supabase');
const { DRIVER_STATUS } = require('../config/constants');

const DRIVER_COLS_BASE = 'user_id, car_type, preferred_route';
const DRIVER_COLS_EXTENDED =
  'user_id, car_type, truck_type, preferred_route, from_region, to_region, truck_number, status, is_verified, passport_file_id';

const PAGE_SIZE = 1000;

function normalizeDriverRow(row) {
  if (!row) return null;
  const truckType = row.truck_type ?? row.car_type;
  return {
    ...row,
    telegram_id: row.telegram_id ?? row.user_id,
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

function isMissingColumnError(error) {
  return error && /column|truck_type|is_verified|passport|status|from_region|to_region|truck_number|schema cache/i.test(
    error.message || ''
  );
}

async function fetchDrivers(buildQuery) {
  const supabase = getSupabase();

  for (const cols of DRIVER_COL_SETS) {
    const { data, error } = await buildQuery(supabase, cols);
    if (!error) {
      return (data || []).map(normalizeDriverRow);
    }
    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  return [];
}

const DRIVER_COL_SETS = [
  DRIVER_COLS_EXTENDED,
  `${DRIVER_COLS_BASE}, from_region, to_region, truck_number, status`,
  `${DRIVER_COLS_BASE}, status`,
  DRIVER_COLS_BASE,
];

function activeOnly(drivers) {
  return drivers.filter((d) => (d.status || DRIVER_STATUS.ACTIVE) === DRIVER_STATUS.ACTIVE);
}

/**
 * Faqat status='active' haydovchilar — matching/push uchun asosiy so'rov.
 * status ustuni bo'lmasa, in-memory filtrga tushadi.
 */
async function fetchActiveDrivers() {
  const supabase = getSupabase();
  let filterByStatus = true;

  for (const cols of DRIVER_COL_SETS) {
    const all = [];
    let from = 0;

    while (true) {
      let query = supabase.from('drivers').select(cols);
      if (filterByStatus) query = query.eq('status', DRIVER_STATUS.ACTIVE);

      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

      if (error) {
        const msg = error.message || '';
        if (filterByStatus && /status/i.test(msg) && isMissingColumnError(error)) {
          filterByStatus = false;
          from = 0;
          all.length = 0;
          continue;
        }
        if (isMissingColumnError(error)) break;
        throw error;
      }

      all.push(...(data || []).map(normalizeDriverRow));
      if ((data || []).length < PAGE_SIZE) return activeOnly(all);
      from += PAGE_SIZE;
    }
  }

  return [];
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

  if (error && /status|check|inactive/i.test(error.message || '')) {
    console.warn(`[drivers] status=${status} saqlanmadi:`, error.message);
    return false;
  }

  if (error) throw error;
  return true;
}

async function markDriverInactive(userId, reason = 'bot_blocked') {
  console.warn(`[push-engine] Haydovchi ${userId} inactive qilindi (${reason})`);
  try {
    if (!getSupabaseKey()) return;
    await setDriverStatus(userId, DRIVER_STATUS.INACTIVE);
  } catch (err) {
    console.error(`[push-engine] inactive update ${userId}:`, err.message);
  }
}

function driverTelegramId(driver) {
  return driver?.telegram_id || driver?.user_id;
}

async function getDriverProfile(userId) {
  const supabase = getSupabase();

  for (const cols of DRIVER_COL_SETS) {
    const { data, error } = await supabase
      .from('drivers')
      .select(cols)
      .eq('user_id', userId)
      .maybeSingle();

    if (!error) return normalizeDriverRow(data);
    if (!isMissingColumnError(error)) {
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
  fetchActiveDrivers,
  activeOnly,
  upsertDriverProfile,
  setDriverStatus,
  markDriverInactive,
  getDriverProfile,
  setPassportFileId,
  normalizeDriverRow,
  driverTelegramId,
};
