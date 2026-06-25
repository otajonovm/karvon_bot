#!/usr/bin/env node
/**
 * Supabase migratsiyalar qo'llanilganini tekshiradi.
 * Ishlatish: node scripts/verify-migrations.js
 */
require('../config/env');

const { getSupabase } = require('../lib/supabase');

const REQUIRED = {
  drivers: ['from_region', 'to_region', 'truck_number', 'status'],
  orders: [
    'sender_username',
    'sender_telegram_id',
    'broker_phone',
    'broker_user_id',
    'notification_refs',
  ],
};

async function probeTable(table, columns) {
  const supabase = getSupabase();
  const missing = [];

  for (const col of columns) {
    const { error } = await supabase.from(table).select(col).limit(0);
    if (error && /column|schema|does not exist/i.test(error.message)) {
      missing.push(col);
    } else if (error && !/column/i.test(error.message)) {
      throw new Error(`${table}: ${error.message}`);
    }
  }

  return missing;
}

async function probeBrokersTable() {
  const supabase = getSupabase();
  const { error } = await supabase.from('brokers').select('user_id').limit(0);
  if (error && /relation|brokers|does not exist/i.test(error.message)) {
    return false;
  }
  if (error) throw new Error(`brokers: ${error.message}`);
  return true;
}

async function main() {
  console.log('[verify] Supabase migratsiyalar tekshirilmoqda...\n');

  let ok = true;

  for (const [table, cols] of Object.entries(REQUIRED)) {
    const missing = await probeTable(table, cols);
    if (missing.length) {
      ok = false;
      console.error(`❌ ${table}: yo'q ustunlar → ${missing.join(', ')}`);
    } else {
      console.log(`✅ ${table}: barcha ustunlar mavjud`);
    }
  }

  const brokersOk = await probeBrokersTable();
  if (!brokersOk) {
    ok = false;
    console.error('❌ brokers jadvali topilmadi');
  } else {
    console.log('✅ brokers: jadval mavjud');
  }

  console.log('');
  if (!ok) {
    console.error('→ Yangi loyiha: supabase/setup_fresh.sql ni SQL Editor da ishga tushiring\n');
    process.exit(1);
  }

  console.log('✅ Barcha migratsiyalar qo\'llanilgan (production tayyor)\n');
}

main().catch((err) => {
  console.error('[verify] Xato:', err.message);
  process.exit(1);
});
