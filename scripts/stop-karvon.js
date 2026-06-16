/**
 * Eski Karvon jarayonlarini to'xtatish (409 / AUTH_KEY conflict oldini oladi).
 * To'xtatadi: server.js, index.js, scraper.js, start-all.js, test-groups.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOCK_FILE = path.join(ROOT, '.karvon-start.lock');
const SELF_PID = process.pid;
const PS_KILL = path.join(__dirname, 'kill-windows.ps1');

function killPidTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 10000 });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* already dead */
  }
}

function killStaleKarvonProcesses() {
  if (fs.existsSync(LOCK_FILE)) {
    const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8'), 10);
    if (oldPid && oldPid !== SELF_PID) {
      killPidTree(oldPid);
    }
    try {
      fs.unlinkSync(LOCK_FILE);
    } catch {
      /* ignore */
    }
  }

  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${PS_KILL}" -KeepPid ${SELF_PID} -Root "${ROOT}"`,
        { stdio: 'inherit', timeout: 20000 }
      );
    } catch {
      /* ignore */
    }
  } else {
    try {
      execSync(`pkill -f "${ROOT}/(server|index|scraper|start-all|test-groups)"`, { stdio: 'ignore' });
    } catch {
      /* ignore */
    }
  }
}

if (require.main === module) {
  killStaleKarvonProcesses();
  console.log("[karvon] Eski jarayonlar to'xtatildi.");
}

module.exports = { killStaleKarvonProcesses, killPidTree };
