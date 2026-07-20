const { getSupabase } = require('./supabase');
const { DRIVER_STATUS, ORDER_STATUS } = require('../config/constants');

async function countTable(supabase, table, filters = []) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [col, op, val] of filters) {
    if (op === 'eq') q = q.eq(col, val);
    else if (op === 'gte') q = q.gte(col, val);
  }
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

async function countDrivers(supabase, filters = []) {
  let q = supabase.from('drivers').select('user_id', { count: 'exact', head: true });
  for (const [col, op, val] of filters) {
    if (op === 'eq') q = q.eq(col, val);
  }
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/**
 * Admin panel statistikasi.
 */
async function collectAdminStats() {
  const supabase = getSupabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  const [
    usersTotal,
    driversTotal,
    driversActive,
    driversBusy,
    ordersTotal,
    ordersActive,
    ordersTaken,
    ordersBot,
    ordersScraper,
    ordersTakenBot,
    ordersToday,
    ordersTakenToday,
  ] = await Promise.all([
    countTable(supabase, 'users'),
    countDrivers(supabase),
    countDrivers(supabase, [['status', 'eq', DRIVER_STATUS.ACTIVE]]),
    countDrivers(supabase, [['status', 'eq', DRIVER_STATUS.BUSY]]),
    countTable(supabase, 'orders'),
    countTable(supabase, 'orders', [['status', 'eq', ORDER_STATUS.ACTIVE]]),
    countTable(supabase, 'orders', [['status', 'eq', ORDER_STATUS.TAKEN]]),
    countTable(supabase, 'orders', [['source', 'eq', 'bot']]),
    countTable(supabase, 'orders', [['source', 'eq', 'scraper']]),
    countTable(supabase, 'orders', [
      ['status', 'eq', ORDER_STATUS.TAKEN],
      ['source', 'eq', 'bot'],
    ]),
    countTable(supabase, 'orders', [['created_at', 'gte', todayIso]]),
    countTable(supabase, 'orders', [
      ['status', 'eq', ORDER_STATUS.TAKEN],
      ['created_at', 'gte', todayIso],
    ]),
  ]);

  // Faol haydovchilar ro'yxati (qisqa)
  const { data: activeDrivers } = await supabase
    .from('drivers')
    .select('user_id, from_region, to_region, car_type, truck_type, status')
    .eq('status', DRIVER_STATUS.ACTIVE)
    .limit(15);

  return {
    usersTotal,
    driversTotal,
    driversActive,
    driversBusy,
    ordersTotal,
    ordersActive,
    ordersTaken,
    ordersBot,
    ordersScraper,
    ordersTakenBot,
    ordersToday,
    ordersTakenToday,
    activeDrivers: activeDrivers || [],
  };
}

function formatAdminPanel(stats) {
  const lines = [
    '📊 <b>KARVON ADMIN PANEL</b>',
    '━━━━━━━━━━━━━━━',
    '',
    '👥 <b>Foydalanuvchilar</b>',
    `• Jami: <b>${stats.usersTotal}</b>`,
    '',
    '🚚 <b>Haydovchilar (mashina)</b>',
    `• Jami: <b>${stats.driversTotal}</b>`,
    `• 🟢 Aktiv (yuk qidiryapti): <b>${stats.driversActive}</b>`,
    `• 🔴 Band (yo'lda): <b>${stats.driversBusy}</b>`,
    '',
    '📦 <b>Yuklar</b>',
    `• Jami: <b>${stats.ordersTotal}</b>`,
    `• ⏳ Olinmagan (aktiv): <b>${stats.ordersActive}</b>`,
    `• ✅ Bot orqali olingan: <b>${stats.ordersTaken}</b>`,
    `   └ shundan broker/bot manba: <b>${stats.ordersTakenBot}</b>`,
    `• 📥 Scraper (guruh): <b>${stats.ordersScraper}</b>`,
    `• 📤 Bot (broker): <b>${stats.ordersBot}</b>`,
    '',
    '📅 <b>Bugun</b>',
    `• Yangi yuk: <b>${stats.ordersToday}</b>`,
    `• Olingan: <b>${stats.ordersTakenToday}</b>`,
  ];

  if (stats.activeDrivers.length > 0) {
    lines.push('', '🟢 <b>Aktiv haydovchilar</b>');
    for (const d of stats.activeDrivers.slice(0, 10)) {
      const car = d.car_type || d.truck_type || '—';
      const route =
        d.from_region && d.to_region ? `${d.from_region}⇄${d.to_region}` : 'yo‘nalish yo‘q';
      lines.push(`• <code>${d.user_id}</code> — ${car} — ${route}`);
    }
    if (stats.activeDrivers.length > 10) {
      lines.push(`… va yana ${stats.activeDrivers.length - 10} ta`);
    }
  }

  lines.push('', '<i>Yangilash: 「📊 Admin」 tugmasi</i>');
  return lines.join('\n');
}

module.exports = { collectAdminStats, formatAdminPanel };
