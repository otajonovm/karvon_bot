/**
 * Production health — scraper, Supabase, bot process holati.
 */
const { getSupabase } = require('./supabase');
const { getActiveClient } = require('./userbotClient');

async function checkSupabase() {
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('users').select('id').limit(1);
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkUserbot() {
  try {
    const client = getActiveClient();
    if (!client) {
      return { ok: false, connected: false, note: 'scraper hali ulanmagan yoki ishlamayapti' };
    }
    return { ok: client.connected, connected: Boolean(client.connected) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function collectHealth() {
  const [supabase] = await Promise.all([checkSupabase()]);
  const userbot = checkUserbot();

  const checks = {
    process: { ok: true },
    supabase,
    userbot,
  };

  const ok = checks.supabase.ok && checks.process.ok;
  const degraded = ok && !checks.userbot.ok;

  return {
    status: ok ? (degraded ? 'degraded' : 'ok') : 'unhealthy',
    ok,
    service: 'karvon',
    timestamp: new Date().toISOString(),
    checks,
  };
}

module.exports = { collectHealth };
