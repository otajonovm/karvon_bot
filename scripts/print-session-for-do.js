#!/usr/bin/env node
/**
 * session.txt ni DigitalOcean ga nusxalash uchun chiqaradi.
 */
const fs = require('fs');
const path = require('path');
const { encodeSessionB64 } = require('../lib/session');

const file = path.join(__dirname, '..', 'session.txt');
const useB64 = process.argv.includes('--b64');

if (!fs.existsSync(file)) {
  console.error('session.txt topilmadi. Avval: node scraper.js → login');
  process.exit(1);
}

const session = fs.readFileSync(file, 'utf8').trim();

if (!session) {
  console.error('session.txt bo\'sh');
  process.exit(1);
}

const b64 = encodeSessionB64(session);

console.log('\n[karvon] DigitalOcean → App-Level Environment Variables\n');
console.log(`session.txt uzunligi: ${session.length} belgi (logda shu raqam bo\'lishi kerak)`);
console.log(`base64 uzunligi:      ${b64.length} belgi\n`);

if (useB64) {
  console.log('=== Kalit: TELEGRAM_SESSION_B64 (Encrypt) ===');
  console.log(b64);
} else {
  console.log('=== Kalit: TELEGRAM_SESSION (Encrypt) — ENG OSON ===');
  console.log(session);
  console.log('\n(Base64 kerak bo\'lsa: node scripts/print-session-for-do.js --b64)');
}

console.log('\nMUHIM: session.txt ni TELEGRAM_SESSION_B64 ga QO\'YMASLIK!');
console.log('Save → Deploy → Log: [karvon] Session: OK (369 belgi, TELEGRAM_SESSION)\n');
