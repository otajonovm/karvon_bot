/**
 * DigitalOcean va production uchun yagona entrypoint.
 * Bot (Telegraf) va scraper (GramJS) bir processda parallel ishlaydi.
 */
require('./config/env');

const { validateEnv, printEnvHelp } = require('./lib/validateEnv');
const { startHealthServer } = require('./lib/healthServer');
const { startScraperLoop, stopScraperLoop } = require('./scraper');

const { loadSession, sessionDiagnostics } = require('./lib/session');

const sessionInfo = sessionDiagnostics();
const session = loadSession();

console.log('[karvon] Tizim parallel ishga tushmoqda...');
console.log(
  `[karvon] Session: ${
    session
      ? `OK (${session.length} belgi, ${sessionInfo.source})`
      : 'YO\'Q — deploy to\'xtatiladi'
  }`
);

const missing = validateEnv({ requireSession: true });
if (missing.length || !session) {
  if (!session && !missing.includes('TELEGRAM_SESSION yoki TELEGRAM_SESSION_B64')) {
    console.error('Missing required env variable: TELEGRAM_SESSION yoki TELEGRAM_SESSION_B64');
  }
  for (const key of missing) {
    console.error(`Missing required env variable: ${key}`);
  }
  printEnvHelp(missing);
  process.exit(1);
}

if (process.env.PORT) {
  startHealthServer();
}

process.env.KARVON_CHILD = '1';
process.env.KARVON_COMBINED = '1';

require('./index.js');

console.log('[karvon] Scraper qismi ishga tushirilmoqda (bot bilan bir processda)...');
startScraperLoop().catch((err) => {
  console.error('[karvon] Scraper loop xatosi:', err.message);
});

async function gracefulShutdown(signal) {
  console.log(`\n[karvon] ${signal} — to'xtatilmoqda...`);
  stopScraperLoop();
  try {
    const { deleteWebhook } = require('./lib/botApi');
    await deleteWebhook();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 3000).unref();
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
