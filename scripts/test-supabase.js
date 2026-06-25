#!/usr/bin/env node
/**
 * Yangi Supabase ulanishini tekshiradi.
 * Ishlatish: node scripts/test-supabase.js
 */
require('../config/env');

const { getSupabase, resolveSupabaseUrl } = require('../lib/supabase');

async function main() {
  const url = resolveSupabaseUrl();
  const key = process.env.SUPABASE_KEY?.trim();

  console.log('\n[karvon] Supabase ulanish testi\n');
  console.log(`  URL: ${url || 'YO\'Q'}`);
  console.log(`  KEY: ${key ? `${key.slice(0, 12)}... (${key.length} belgi)` : 'YO\'Q'}\n`);

  if (!url || !key) {
    console.error('❌ karvon.env da SUPABASE_URL va SUPABASE_KEY to\'ldiring\n');
    process.exit(1);
  }

  const supabase = getSupabase();

  for (const table of ['users', 'drivers', 'orders', 'brokers']) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.error(`❌ ${table}: ${error.message}`);
      if (/relation|does not exist/i.test(error.message)) {
        console.error('\n→ supabase/setup_fresh.sql ni Supabase SQL Editor da ishga tushiring\n');
      }
      process.exit(1);
    }
    console.log(`✅ ${table} — OK`);
  }

  console.log('\n✅ Supabase to\'liq ulangan va jadvallar mavjud!\n');
}

main().catch((err) => {
  const msg = err?.message || String(err);
  console.error('\n❌ Ulanish xatosi:', msg);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    console.error('\n→ Internet/DNS yoki SUPABASE_URL noto\'g\'ri. JWT ref bilan URL mos kelishini tekshiring.\n');
  }
  process.exit(1);
});
