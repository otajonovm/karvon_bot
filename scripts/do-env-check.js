#!/usr/bin/env node
/**
 * Lokal karvon.env + session.txt tayyorligini tekshiradi.
 * Qiymatlarni chiqarmaydi — faqat DO dashboard ga nima qo'shish kerakligini ko'rsatadi.
 */
const fs = require('fs');
const path = require('path');

require('../config/env');

const ROOT = path.join(__dirname, '..');
const KEYS = [
  'BOT_TOKEN',
  'API_ID',
  'API_HASH',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'DEEPSEEK_API_KEY',
  'CARGO_GROUPS',
];
const SESSION_KEY = 'TELEGRAM_SESSION';

function has(key) {
  return Boolean(process.env[key]?.trim());
}

const sessionFile = path.join(ROOT, 'session.txt');
const sessionFromFile = fs.existsSync(sessionFile)
  ? fs.readFileSync(sessionFile, 'utf8').trim()
  : '';
const hasSession = has(SESSION_KEY) || Boolean(sessionFromFile);

console.log('\n[karvon] DigitalOcean App-Level Environment Variables tekshiruvi\n');

let ok = 0;
for (const key of KEYS) {
  const ready = has(key);
  if (ready) ok += 1;
  console.log(`  ${ready ? '✓' : '✗'} ${key}${ready ? '' : ' — karvon.env da yo\'q'}`);
}

console.log(
  `  ${hasSession ? '✓' : '✗'} ${SESSION_KEY}${
    hasSession ? ` (${(process.env.TELEGRAM_SESSION?.trim() || sessionFromFile).length} belgi)` : ' — session.txt yo\'q'
  }`
);

console.log(`\n  Lokal: ${ok}/${KEYS.length} + session ${hasSession ? 'OK' : 'YO\'Q'}`);

if (ok < KEYS.length || !hasSession) {
  console.log('\n  Avval lokal fayllarni to\'ldiring, keyin DO ga nusxalang.\n');
  process.exit(1);
}

console.log(`
  Keyingi qadam (DO dashboard):
  1. Apps → karvon-bot → Settings → App-Level Environment Variables → Edit
  2. Quyidagi 8 ta kalitni qo'shing (Encrypt ✓, Scope: Run time):
     ${[...KEYS, SESSION_KEY].join(', ')}
  3. TELEGRAM_SESSION: node scripts/print-session-for-do.js → butun matnni DO ga
  4. Qolganlari: karvon.env dan
  5. Save → Actions → Deploy

  Eslatma: GitHubga secret push qilmang — faqat DO dashboard.
`);
