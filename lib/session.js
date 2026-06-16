const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'session.txt');

function decodeSessionB64(value) {
  try {
    return Buffer.from(value.trim(), 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

function loadSession() {
  const plain = process.env.TELEGRAM_SESSION?.trim();
  if (plain) return plain;

  const b64 = process.env.TELEGRAM_SESSION_B64?.trim();
  if (b64) {
    const decoded = decodeSessionB64(b64);
    if (decoded) return decoded;
    console.warn('[session] TELEGRAM_SESSION_B64 noto\'g\'ri — qayta nusxalang');
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
  const plain = process.env.TELEGRAM_SESSION?.trim() || '';
  const b64 = process.env.TELEGRAM_SESSION_B64?.trim() || '';
  const fromFile = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf8').trim()
    : '';
  const active = loadSession();

  let source = 'none';
  if (plain) source = 'TELEGRAM_SESSION';
  else if (b64 && active) source = 'TELEGRAM_SESSION_B64';
  else if (fromFile && active) source = 'session.txt';

  return {
    plainChars: plain.length,
    b64Chars: b64.length,
    fileChars: fromFile.length,
    activeChars: active.length,
    source,
  };
}

function isProductionCloud() {
  return (
    process.env.NODE_ENV === 'production' ||
    !!(process.env.DO_APP_ID || process.env.DIGITALOCEAN_APP_ID || process.env.PORT)
  );
}

function saveSessionToFile(sessionString) {
  if (process.env.TELEGRAM_SESSION || process.env.TELEGRAM_SESSION_B64) {
    console.log('[session] Yangi session — DO da TELEGRAM_SESSION yoki TELEGRAM_SESSION_B64 ni yangilang');
    return;
  }
  fs.writeFileSync(SESSION_FILE, sessionString, 'utf8');
  console.log(`[session] Saved to ${SESSION_FILE}`);
}

function encodeSessionB64(sessionString) {
  return Buffer.from(sessionString, 'utf8').toString('base64');
}

module.exports = {
  loadSession,
  saveSessionToFile,
  sessionDiagnostics,
  isProductionCloud,
  encodeSessionB64,
  SESSION_FILE,
};
