#!/usr/bin/env node
/**
 * session.txt ni DigitalOcean ga nusxalash uchun chiqaradi.
 * TELEGRAM_SESSION_B64 tavsiya etiladi (paste xatolari kamroq).
 */
const fs = require('fs');
const path = require('path');
const { encodeSessionB64 } = require('../lib/session');

const file = path.join(__dirname, '..', 'session.txt');
const usePlain = process.argv.includes('--plain');

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
console.log(`Session uzunligi: ${session.length} belgi`);
console.log(`Base64 uzunligi:  ${b64.length} belgi\n`);

if (usePlain) {
  console.log('=== TELEGRAM_SESSION (Encrypt) ===');
  console.log(session);
} else {
  console.log('=== TELEGRAM_SESSION_B64 (Encrypt) — TAVSIYA ===');
  console.log(b64);
  console.log('\n(Plain kerak bo\'lsa: node scripts/print-session-for-do.js --plain)');
}

console.log('\nSave → Deploy. Logda: [karvon] Session: OK (369 belgi, TELEGRAM_SESSION_B64)');
console.log('Lokal scraper to\'xtating: node scripts/stop-karvon.js\n');
