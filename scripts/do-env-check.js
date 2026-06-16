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
const { loadSession, encodeSessionB64 } = require('../lib/session');

function has(key) {
  return Boolean(process.env[key]?.trim());
}

const session = loadSession();
const hasSession = Boolean(session);

console.log('\n[karvon] DigitalOcean App-Level Environment Variables tekshiruvi\n');

let ok = 0;
for (const key of KEYS) {
  const ready = has(key);
  if (ready) ok += 1;
  console.log(`  ${ready ? '✓' : '✗'} ${key}${ready ? '' : ' — karvon.env da yo\'q'}`);
}

console.log(
  `  ${hasSession ? '✓' : '✗'} TELEGRAM_SESSION_B64${hasSession ? ` (${session.length} belgi session, b64: ${encodeSessionB64(session).length})` : ' — session.txt yo\'q'}`
);

console.log(`\n  Lokal: ${ok}/${KEYS.length} + session ${hasSession ? 'OK' : 'YO\'Q'}`);

if (ok < KEYS.length || !hasSession) {
  console.log('\n  Avval lokal fayllarni to\'ldiring, keyin DO ga nusxalang.\n');
  process.exit(1);
}

console.log(`
  Keyingi qadam (DO dashboard):
  1. Apps → karvon-bot → Settings → App-Level Environment Variables → Edit
  2. Kalitlar (Encrypt ✓, Run time): ${KEYS.join(', ')}, TELEGRAM_SESSION_B64
  3. Session: node scripts/print-session-for-do.js → b64 ni DO ga qo'ying
  4. Qolganlari: karvon.env dan
  5. Save → Actions → Deploy

  Eslatma: GitHubga secret push qilmang — faqat DO dashboard.
`);
