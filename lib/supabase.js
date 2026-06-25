const { createClient } = require('@supabase/supabase-js');

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_KEY?.trim();
}

/** JWT ref dan to'g'ri URL (typo oldini olish) */
function resolveSupabaseUrl() {
  const fromEnv = process.env.SUPABASE_URL?.trim();
  const key = getSupabaseKey();

  if (!key) return fromEnv;

  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    const ref = payload?.ref;
    if (!ref) return fromEnv;

    const canonical = `https://${ref}.supabase.co`;
    if (fromEnv && fromEnv !== canonical) {
      console.warn('[supabase] SUPABASE_URL JWT ref bilan mos emas — avtomat tuzatildi');
    }
    return canonical;
  } catch {
    return fromEnv;
  }
}

let client = null;

function getSupabase() {
  if (client) return client;

  const url = resolveSupabaseUrl();
  const key = getSupabaseKey();

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_KEY (or SUPABASE_SERVICE_KEY) must be set');
  }

  // Node < 22 da native WebSocket yo'q — Supabase realtime client uchun "ws" beramiz.
  // (Realtime ishlatilmasa ham, createClient RealtimeClient ni yaratadi.)
  const ws = require('ws');

  client = createClient(url, key, {
    realtime: { transport: ws },
  });
  return client;
}

module.exports = { getSupabase, getSupabaseKey, resolveSupabaseUrl };
