const REQUIRED = ['BOT_TOKEN', 'API_ID', 'API_HASH', 'SUPABASE_URL', 'SUPABASE_KEY', 'CARGO_GROUPS'];

function validateEnv({ requireSession = false } = {}) {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());

  if (!process.env.GEMINI_API_KEY?.trim() && !process.env.DEEPSEEK_API_KEY?.trim()) {
    missing.push('DEEPSEEK_API_KEY (yoki GEMINI_API_KEY)');
  }

  if (requireSession && !process.env.TELEGRAM_SESSION?.trim()) {
    missing.push('TELEGRAM_SESSION');
  }

  return missing;
}

function printEnvHelp(missing) {
  console.error('\n[karvon] ❌ Environment variables topilmadi:');
  for (const key of missing) {
    console.error(`       • ${key}`);
  }
  console.error('\n[karvon] DigitalOcean da to\'ldirish:');
  console.error('       Apps → lobster-app → Settings → App-Level Environment Variables');
  console.error('       Har birini Encrypt qilib qo\'shing → Save → Redeploy\n');
}

module.exports = { validateEnv, printEnvHelp };
