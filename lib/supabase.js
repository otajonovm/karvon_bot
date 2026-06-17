const { createClient } = require('@supabase/supabase-js');

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_KEY?.trim();
}

let client = null;

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = getSupabaseKey();

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) must be set');
  }

  client = createClient(url, key);
  return client;
}

module.exports = { getSupabase, getSupabaseKey };
