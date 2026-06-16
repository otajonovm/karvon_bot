const REQUIRED = ['BOT_TOKEN', 'API_ID', 'API_HASH', 'SUPABASE_URL', 'SUPABASE_KEY', 'CARGO_GROUPS'];

function hasSessionEnv() {
  const { loadSession } = require('./session');
  return Boolean(loadSession());
}

function validateEnv({ requireSession = false } = {}) {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.DEEPSEEK_API_KEY?.trim()) {
    missing.push('DEEPSEEK_API_KEY (yoki GEMINI_API_KEY)');
  }

  if (requireSession && !hasSessionEnv()) {
    missing.push('TELEGRAM_SESSION yoki TELEGRAM_SESSION_B64');
  }

  return missing;
}

function printEnvHelp(missing) {
  console.error('\n[karvon] ❌ Environment variables topilmadi:');
  for (const key of missing) {
    console.error(`       • ${key}`);
  }
  console.error('\n[karvon] DigitalOcean da to\'ldirish:');
  console.error('       Apps → karvon-bot → Settings → App-Level Environment Variables');
  console.error('       Session (tavsiya): TELEGRAM_SESSION_B64');
  console.error('       Lokal: node scripts/print-session-for-do.js');
  console.error('       Tekshiruv: node scripts/do-env-check.js\n');
}

module.exports = { validateEnv, printEnvHelp, hasSessionEnv };
