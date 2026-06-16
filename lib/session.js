const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, '..', 'session.txt');

/** GramJS StringSession — odatda "1" bilan boshlanadi, 300+ belgi */
function looksLikeGramJsSession(value) {
  const s = value?.trim() || '';
  return s.length >= 280 && /^1[A-Za-z0-9+/=_-]+$/.test(s);
}

function decodeSessionB64(value) {
  try {
    const raw = value.trim();
    if (!raw || !/^[A-Za-z0-9+/=]+$/.test(raw)) return '';
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    if (!decoded || decoded.includes('\u0000')) return '';
    return decoded;
  } catch {
    return '';
  }
}

function loadSession() {
  const plain = process.env.TELEGRAM_SESSION?.trim();
  if (plain) return plain;

  const b64Env = process.env.TELEGRAM_SESSION_B64?.trim();
  if (b64Env) {
    // Ko'p hollarda session.txt ni noto'g'ri B64 kalitiga qo'yishadi
    if (looksLikeGramJsSession(b64Env)) {
      console.warn(
        '[session] TELEGRAM_SESSION_B64 ichida plain session.txt topildi — to\'g\'ridan ishlatilmoqda'
      );
      console.warn(
        '[session] Tavsiya: DO da kalit nomini TELEGRAM_SESSION qiling (yoki haqiqiy base64: node scripts/print-session-for-do.js)'
      );
      return b64Env;
    }

    const decoded = decodeSessionB64(b64Env);
    if (decoded && looksLikeGramJsSession(decoded)) {
      return decoded;
    }

    if (decoded) {
      console.warn(
        `[session] TELEGRAM_SESSION_B64 decode qilindi (${decoded.length} belgi) lekin session formatiga o\'xshamaydi`
      );
      return decoded;
    }

    console.warn('[session] TELEGRAM_SESSION_B64 noto\'g\'ri — node scripts/print-session-for-do.js');
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
  else if (b64 && looksLikeGramJsSession(b64)) source = 'TELEGRAM_SESSION_B64 (plain xato kalitda)';
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
    console.log('[session] Yangi session — DO da TELEGRAM_SESSION ni yangilang');
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
  looksLikeGramJsSession,
  SESSION_FILE,
};
