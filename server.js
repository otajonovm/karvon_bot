/**
 * DigitalOcean va production uchun yagona entrypoint.
 * Bot (Telegraf) va scraper (GramJS) bir processda parallel ishlaydi.
 */
require('./config/env');

const { validateEnv, printEnvHelp } = require('./lib/validateEnv');
const { startHealthServer } = require('./lib/healthServer');
const { startScraperLoop, stopScraperLoop } = require('./scraper');

const { loadSession, sessionDiagnostics, isProductionCloud } = require('./lib/session');

const IS_CLOUD = isProductionCloud();
const sessionInfo = sessionDiagnostics();

console.log('[karvon] Tizim parallel ishga tushmoqda...');
console.log(
  `[karvon] TELEGRAM_SESSION: ${
    sessionInfo.activeChars
      ? `OK (${sessionInfo.activeChars} belgi, manba: ${sessionInfo.source})`
      : 'YO\'Q — scraper guruhlarni o\'qiy olmaydi'
  }`
);

const missing = validateEnv({ requireSession: IS_CLOUD });
if (missing.length) {
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
