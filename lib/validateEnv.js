const REQUIRED = ['BOT_TOKEN', 'API_ID', 'API_HASH', 'SUPABASE_URL', 'SUPABASE_KEY', 'CARGO_GROUPS'];

function validateEnv({ requireSession = false } = {}) {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.DEEPSEEK_API_KEY?.trim()) {
    missing.push('DEEPSEEK_API_KEY (yoki GEMINI_API_KEY)');
  }

  if (requireSession && !process.env.TELEGRAM_SESSION?.trim()) {
    missing.push('TELEGRAM_SESSION (session.txt dan butun qator)');
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
  console.error('       8 ta kalit (Encrypt): BOT_TOKEN, API_ID, API_HASH, SUPABASE_URL,');
  console.error('       SUPABASE_KEY, DEEPSEEK_API_KEY, CARGO_GROUPS, TELEGRAM_SESSION');
  console.error('       TELEGRAM_SESSION: node scripts/print-session-for-do.js → DO ga nusxala');
  console.error('       Tekshiruv: node scripts/do-env-check.js\n');
}

module.exports = { validateEnv, printEnvHelp };
