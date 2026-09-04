/**
 * DigitalOcean va production uchun yagona entrypoint.
 * Bot (Telegraf) va scraper (GramJS) bir processda parallel ishlaydi.
 */
require('./config/env');

const { validateEnv, printEnvHelp } = require('./lib/validateEnv');
const { startHealthServer } = require('./lib/healthServer');
const { startScraperLoop, stopScraperLoop, disconnectActiveClient } = require('./scraper');
const { startExpiryLoop, stopExpiryLoop } = require('./lib/orderExpiry');

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

// TTL expiry engine (har 15 daqiqa)
startExpiryLoop();

console.log('[karvon] Scraper qismi ishga tushirilmoqda (bot bilan bir processda)...');
startScraperLoop().catch((err) => {
  console.error('[karvon] Scraper loop xatosi (crash emas):', err.message);
});

let shuttingDown = false;

async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[karvon] ${signal} — to'xtatilmoqda...`);
  stopScraperLoop();
  stopExpiryLoop();
  try {
    const { stopFeedbackLoop } = require('./lib/dealFeedback');
    stopFeedbackLoop();
  } catch (err) {
    console.error('[karvon] stopFeedbackLoop:', err.message);
  }
  try {
    await disconnectActiveClient();
    console.log('[karvon] GramJS session uzildi');
  } catch (err) {
    console.error('[karvon] client.disconnect:', err.message);
  }
  try {
    const { deleteWebhook } = require('./lib/botApi');
    await deleteWebhook();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 2500).unref();
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
