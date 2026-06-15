require('../config/env');

const { getSupabase } = require('../lib/supabase');
const { Telegraf } = require('telegraf');

async function main() {
  const checks = [];

  const envKeys = ['BOT_TOKEN', 'API_ID', 'API_HASH', 'SUPABASE_URL', 'SUPABASE_KEY'];
  for (const key of envKeys) {
    checks.push({ name: key, ok: !!process.env[key] });
  }
  checks.push({
    name: 'AI_KEY',
    ok: !!(process.env.GEMINI_API_KEY || process.env.DEEPSEEK_API_KEY),
  });

  try {
    const bot = new Telegraf(process.env.BOT_TOKEN);
    const me = await bot.telegram.getMe();
    checks.push({ name: 'TELEGRAM_BOT', ok: true, detail: `@${me.username}` });
  } catch (err) {
    checks.push({ name: 'TELEGRAM_BOT', ok: false, detail: err.message });
  }

  try {
    const supabase = getSupabase();
    for (const table of ['users', 'drivers', 'orders']) {
      const { error } = await supabase.from(table).select('*').limit(1);
      checks.push({
        name: `TABLE_${table}`,
        ok: !error,
        detail: error?.message,
      });
    }
  } catch (err) {
    checks.push({ name: 'SUPABASE', ok: false, detail: err.message });
  }

  for (const c of checks) {
    const icon = c.ok ? 'OK' : 'FAIL';
    const extra = c.detail ? ` — ${c.detail}` : '';
    console.log(`[${icon}] ${c.name}${extra}`);
  }

  const failed = checks.filter((c) => !c.ok);
  process.exit(failed.length ? 1 : 0);
}

main();
