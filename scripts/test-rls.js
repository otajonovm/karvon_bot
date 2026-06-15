require('../config/env');
const { getSupabase } = require('../lib/supabase');

async function main() {
  const supabase = getSupabase();
  const testId = 999999999;

  const { error: insertError } = await supabase.from('users').upsert({
    id: testId,
    phone: '+998900000000',
    updated_at: new Date().toISOString(),
  });

  if (insertError) {
    console.log('RLS_FAIL:', insertError.message);
    console.log('FIX: Supabase SQL Editor da supabase/policies.sql ni ishga tushiring');
    process.exit(1);
  }

  await supabase.from('users').delete().eq('id', testId);
  console.log('RLS_OK: users jadvaliga yozish mumkin');
}

main();
