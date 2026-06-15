/**
 * Bot + Scraper ni bir vaqtda ishga tushiradi.
 * 409 conflict oldini olish uchun avval eski jarayonlar to'xtatiladi.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { killStaleKarvonProcesses } = require('./stop-karvon');
const { deleteWebhook } = require('../lib/botApi');

require('../config/env');

const ROOT = path.join(__dirname, '..');
const LOCK_FILE = path.join(ROOT, '.karvon-start.lock');
const procs = new Map();
let shuttingDown = false;

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureSingleInstance() {
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (oldPid && oldPid !== process.pid && isRunning(oldPid)) {
      log(`Eski start-all (PID ${oldPid}) to'xtatilmoqda...`);
      const { killPidTree } = require('./stop-karvon');
      killPidTree(oldPid);
      for (let i = 0; i < 20 && isRunning(oldPid); i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
      if (pid === process.pid) fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    /* ignore */
  }
}

function log(msg) {
  console.log(`[karvon] ${msg}`);
}

function startService(name, script, delayMs = 0) {
  if (procs.has(name) || shuttingDown) return;

  const launch = () => {
    if (procs.has(name) || shuttingDown) return;
    log(`${name} ishga tushirilmoqda...`);

    const child = spawn(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });

    procs.set(name, child);

    child.on('exit', (code, signal) => {
      procs.delete(name);
      if (shuttingDown || signal === 'SIGINT' || signal === 'SIGTERM') return;

      const wait = name === 'bot' && code === 1 ? 20_000 : 5_000;
      log(`${name} to'xtadi (kod: ${code}). ${wait / 1000}s dan keyin qayta ishga tushadi...`);

      if (name === 'bot') {
        killStaleKarvonProcesses();
        deleteWebhook().catch(() => {});
      }

      setTimeout(() => startService(name, script), wait);
    });

    child.on('error', (err) => {
      log(`${name} xato: ${err.message}`);
    });
  };

  if (delayMs > 0) setTimeout(launch, delayMs);
  else launch();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("To'xtatilmoqda...");
  for (const [, child] of procs) {
    child.kill('SIGTERM');
  }
  releaseLock();
  setTimeout(() => process.exit(0), 1500);
}

async function main() {
  await ensureSingleInstance();
  log('Eski jarayonlar tekshirilmoqda...');
  killStaleKarvonProcesses();
  await new Promise((r) => setTimeout(r, 3000));
  await deleteWebhook();

  log('═══════════════════════════════════════');
  log('Karvon tizimi ishga tushmoqda');
  log('  • Bot      → mijoz/haydovchi');
  log('  • Scraper  → guruhlardan yuk olish');
  log('═══════════════════════════════════════\n');

  // Avval scraper, 3 soniyadan keyin bot (409 oldini olish)
  startService('scraper', 'scraper.js');
  startService('bot', 'index.js', 3000);
}

main().catch((err) => {
  console.error('[karvon] Fatal:', err.message);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
