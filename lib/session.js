const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'session.txt');

function loadSession() {
  if (process.env.TELEGRAM_SESSION?.trim()) {
    return process.env.TELEGRAM_SESSION.trim();
  }
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return fs.readFileSync(SESSION_FILE, 'utf8').trim();
    }
  } catch (err) {
    console.warn('[session] Faylni o\'qib bo\'lmadi:', err.message);
  }
  return '';
}

function sessionDiagnostics() {
  const fromEnv = process.env.TELEGRAM_SESSION?.trim() || '';
  const fromFile = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf8').trim()
    : '';
  const active = loadSession();
  return {
    envChars: fromEnv.length,
    fileChars: fromFile.length,
    activeChars: active.length,
    source: fromEnv ? 'env' : fromFile ? 'file' : 'none',
  };
}

function isProductionCloud() {
  return (
    process.env.NODE_ENV === 'production' ||
    !!(process.env.DO_APP_ID || process.env.DIGITALOCEAN_APP_ID || process.env.PORT)
  );
}

function saveSessionToFile(sessionString) {
  if (process.env.TELEGRAM_SESSION) {
    console.log('[session] Yangi session — DigitalOcean da TELEGRAM_SESSION secret ni yangilang');
    return;
  }
  fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
  console.log(`[session] Saved to ${SESSION_FILE}`);
}

module.exports = { loadSession, saveSessionToFile, sessionDiagnostics, isProductionCloud, SESSION_FILE };
