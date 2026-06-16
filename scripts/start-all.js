/**
 * Bot + Scraper ni bir vaqtda ishga tushiradi.
 * 409 / AUTH_KEY_DUPLICATED conflict oldini olish uchun ehtiyotkor restart.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { killStaleKarvonProcesses } = require('./stop-karvon');
const { deleteWebhook } = require('../lib/botApi');
const { startHealthServer } = require('../lib/healthServer');
const { validateEnv, printEnvHelp } = require('../lib/validateEnv');

require('../config/env');

const ROOT = path.join(__dirname, '..');
const LOCK_FILE = path.join(ROOT, '.karvon-start.lock');
const IS_CLOUD = !!(process.env.DO_APP_ID || process.env.PORT);
const EXIT_AUTH_DUP = 42;

const procs = new Map();
const restartTimers = new Map();
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

function restartDelay(name, code, attempt = 1) {
  if (code === 0) return null;
  if (name === 'scraper' && code === EXIT_AUTH_DUP) {
    return Math.min(120_000 * attempt, 600_000);
  }
  if (name === 'scraper') return 45_000;
  if (name === 'bot' && code === 1) return 20_000;
  return 10_000;
}

const restartAttempts = new Map();

function startService(name, script, delayMs = 0) {
  if (shuttingDown) return;

  const launch = () => {
    if (shuttingDown) return;
    if (procs.has(name)) return;

    log(`${name} ishga tushirilmoqda...`);

    const child = spawn(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });

    procs.set(name, child);

    child.on('exit', (code, signal) => {
      procs.delete(name);
      if (shuttingDown || signal === 'SIGINT' || signal === 'SIGTERM') return;
      if (process.env.KARVON_ENV_INVALID === '1') return;

      const attempts = (restartAttempts.get(name) || 0) + 1;
      if (code !== EXIT_AUTH_DUP) restartAttempts.set(name, 0);
      else restartAttempts.set(name, attempts);

      const wait = restartDelay(name, code, attempts);
      if (wait === null) {
        log(`${name} to'xtadi (kod: 0) — qayta ishga tushirilmaydi.`);
        return;
      }

      if (name === 'scraper' && code === EXIT_AUTH_DUP) {
        log(
          `${name}: AUTH_KEY_DUPLICATED — session boshqa joyda ochiq. ${wait / 1000}s kutamiz...`
        );
      } else {
        log(`${name} to'xtadi (kod: ${code}). ${wait / 1000}s dan keyin qayta ishga tushadi...`);
      }

      if (name === 'bot' && !IS_CLOUD) {
        killStaleKarvonProcesses();
        deleteWebhook().catch(() => {});
      }

      if (restartTimers.has(name)) {
        clearTimeout(restartTimers.get(name));
      }

      const timer = setTimeout(() => {
        restartTimers.delete(name);
        startService(name, script);
      }, wait);
      restartTimers.set(name, timer);
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
  for (const timer of restartTimers.values()) {
    clearTimeout(timer);
  }
  restartTimers.clear();
  for (const [, child] of procs) {
    child.kill('SIGTERM');
  }
  releaseLock();
  setTimeout(() => process.exit(0), 3000);
}

async function main() {
  startHealthServer();

  const missing = validateEnv({ requireSession: IS_CLOUD });
  if (missing.length > 0) {
    process.env.KARVON_ENV_INVALID = '1';
    printEnvHelp(missing);
    log('Bot va scraper ishga tushirilmadi — avval env larni to\'ldiring.');
    return;
  }

  if (!IS_CLOUD) {
    await ensureSingleInstance();
    log('Eski jarayonlar tekshirilmoqda...');
    killStaleKarvonProcesses();
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    log('Cloud: eski Telegram session yopilishi uchun 20s kutilmoqda...');
    await new Promise((r) => setTimeout(r, 20_000));
  }

  await deleteWebhook();

  log('═══════════════════════════════════════');
  log('Karvon tizimi ishga tushmoqda (LOKAL)');
  log('  • Cloud uchun: node index.js + node scraper.js alohida');
  log('═══════════════════════════════════════\n');

  startService('bot', 'index.js');
  startService('scraper', 'scraper.js', IS_CLOUD ? 90_000 : 10_000);
}

main().catch((err) => {
  console.error('[karvon] Fatal:', err.message);
  process.exit(1);
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
