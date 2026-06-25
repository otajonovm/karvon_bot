/**
 * Production health — scraper, Supabase, bot process holati.
 */
const { getSupabase } = require('./supabase');
const { getActiveClient } = require('./userbotClient');
const { getBotHealth } = require('./botHealth');

const BOT_STALE_MS = 6 * 60_000;

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

function checkBot() {
  const { launchedAt, lastOkAt, lastError } = getBotHealth();
  // Hali ishga tushmagan bo'lsa — startup grace (DO initial_delay qoplaydi)
  if (!launchedAt) return { ok: true, note: 'ishga tushmoqda' };

  const age = Date.now() - (lastOkAt || 0);
  if (age > BOT_STALE_MS) {
    return { ok: false, stale_ms: age, error: lastError || 'bot uzoq vaqt javob bermadi' };
  }
  return { ok: true, last_ok_ms_ago: age };
}

async function collectHealth() {
  const [supabase] = await Promise.all([checkSupabase()]);
  const userbot = checkUserbot();
  const botProc = checkBot();

  const checks = {
    process: { ok: true },
    supabase,
    bot: botProc,
    userbot,
  };

  const ok = checks.supabase.ok && checks.process.ok && checks.bot.ok;
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
