const { getSupabase } = require('./supabase');
const { fetchDrivers, activeOnly } = require('./drivers');
const { routeMatchesOrder } = require('./routeMatch');

async function findDriversForBroker({ truck_type, from_region, to_region }) {
  const order = { car_type: truck_type, from_region, to_region };
  const matched = activeOnly(
    await fetchDrivers((supabase, cols) => supabase.from('drivers').select(cols))
  ).filter((d) => routeMatchesOrder(d, order));

  if (matched.length === 0) return [];

  const supabase = getSupabase();
  const ids = matched.map((d) => d.user_id);
  const { data: users } = await supabase.from('users').select('id, phone').in('id', ids);
  const phones = new Map((users || []).map((u) => [u.id, u.phone]));

  return matched.map((d) => ({
    truck_type: d.truck_type || d.car_type,
    truck_number: d.truck_number || '—',
    phone: phones.get(d.user_id) || '—',
  }));
}

function formatDriverList(drivers) {
  return drivers
    .map(
      (d, i) =>
        `${i + 1}. ${d.truck_type} (${d.truck_number}) — Tel: ${d.phone}`
    )
    .join('\n');
}

module.exports = { findDriversForBroker, formatDriverList };
