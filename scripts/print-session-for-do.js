#!/usr/bin/env node
/**
 * session.txt ni DigitalOcean TELEGRAM_SESSION ga nusxalash uchun chiqaradi.
 * Faqat lokalda ishlating — GitHubga push qilmang.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'session.txt');

if (!fs.existsSync(file)) {
  console.error('session.txt topilmadi. Avval: node scraper.js → login');
  process.exit(1);
}

const session = fs.readFileSync(file, 'utf8').trim();

if (!session) {
  console.error('session.txt bo\'sh');
  process.exit(1);
}

console.log('\n[karvon] DigitalOcean → App-Level → TELEGRAM_SESSION (Encrypt)\n');
console.log(`Uzunlik: ${session.length} belgi (logda shu raqamni tekshiring)\n`);
console.log('--- nusxalash boshlanadi ---');
console.log(session);
console.log('--- nusxalash tugadi ---\n');
console.log('Save → Deploy. Lokal scraper to\'xtating: node scripts/stop-karvon.js\n');
