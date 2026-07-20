require('../config/env');
const { getSupabase } = require('../lib/supabase');

(async () => {
  const s = getSupabase();
  const o = await s.from('orders').select('id', { count: 'exact', head: true });
  console.log('orders count:', o.count, 'error:', o.error?.message || 'none');

  const recent = await s
    .from('orders')
    .select('from_region,to_region,status,source,created_at')
    .order('created_at', { ascending: false })
    .limit(6);
  const now = Date.now();
  for (const r of recent.data || []) {
    const ageMin = Math.round((now - new Date(r.created_at).getTime()) / 60000);
    console.log(`  ${ageMin} min oldin | ${r.from_region}->${r.to_region} | ${r.status} | ${r.source}`);
  }
})();
