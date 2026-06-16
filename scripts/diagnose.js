#!/usr/bin/env node
/**
 * Karvon to'liq diagnostika: Supabase jadvallari, RLS, AI kaliti.
 * Ishlatish: node scripts/diagnose.js
 */
require('../config/env');
const { getSupabase } = require('../lib/supabase');

const TEST_USER = 999000001;

async function checkTable(supabase, table, cols) {
  const { error } = await supabase.from(table).select(cols).limit(1);
  if (error) return { ok: false, msg: error.message };
  return { ok: true };
}

async function checkInsert(supabase) {
  const { error: upErr } = await supabase.from('users').upsert({
    id: TEST_USER,
    phone: '+998900000000',
    updated_at: new Date().toISOString(),
  });
  if (upErr) return { ok: false, msg: upErr.message };

  const { data, error: ordErr } = await supabase
    .from('orders')
    .insert({
      from_region: 'Toshkent',
      to_region: 'Samarqand',
      car_type: 'Isuzu',
      cargo_details: 'TEST diagnostika',
      phone_number: '+998900000000',
      status: 'active',
      source: 'bot',
    })
    .select()
    .single();

  if (ordErr) {
    await supabase.from('users').delete().eq('id', TEST_USER);
    return { ok: false, msg: ordErr.message };
  }

  await supabase.from('orders').delete().eq('id', data.id);
  await supabase.from('users').delete().eq('id', TEST_USER);
  return { ok: true };
}

async function checkDeepSeek() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return { ok: false, msg: 'DEEPSEEK_API_KEY yo\'q' };
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, msg: `${res.status}: ${t.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

function line(label, r) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${label}${r.ok ? '' : ' — ' + r.msg}`);
  return r.ok;
}

async function main() {
  console.log('\n[karvon] Diagnostika\n');
  const supabase = getSupabase();

  console.log('Supabase jadvallar:');
  let dbOk = true;
  dbOk &= line('users', await checkTable(supabase, 'users', 'id, phone, role'));
  dbOk &= line(
    'drivers (truck_type, status, is_verified)',
    await checkTable(supabase, 'drivers', 'user_id, car_type, truck_type, status, is_verified, passport_file_id')
  );
  dbOk &= line(
    'orders (source_group, raw_text, notification_refs)',
    await checkTable(supabase, 'orders', 'id, from_region, car_type, source_group, source_message_id, raw_text, notification_refs')
  );
  dbOk &= line('order_tracking', await checkTable(supabase, 'order_tracking', 'id, order_id, latitude'));

  console.log('\nRLS / yozish (test insert):');
  const ins = await checkInsert(supabase);
  line('users + orders insert', ins);
  if (!ins.ok && /row-level security/i.test(ins.msg)) {
    console.log('     FIX: Supabase SQL Editor → supabase/policies.sql ni ishga tushiring');
  }
  if (!ins.ok && /column|schema cache/i.test(ins.msg)) {
    console.log('     FIX: schema.sql + migration_scraper.sql + migration_phase1_universal.sql ni ishga tushiring');
  }

  console.log('\nAI (cargo matnni tahlil qilish):');
  line('DeepSeek API', await checkDeepSeek());

  console.log('');
  if (dbOk && ins.ok) {
    console.log('[karvon] DB tayyor. Agar guruh analiz qilinmasa — scraper loglarini tekshiring.\n');
  } else {
    console.log('[karvon] DB muammosi bor — yuqoridagi FIX larni bajaring.\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[karvon] Diagnostika xatosi:', err.message);
  process.exit(1);
});
