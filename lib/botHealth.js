/**
 * Bot polling tiriklik holati. index.js yozadi, healthCheck.js o'qiydi.
 * Maqsad: process tirik bo'lib, bot polling jimgina o'lib qolgan holatni aniqlash
 * va DO ni qayta ishga tushirishga majburlash.
 */
const state = {
  launchedAt: null,
  lastOkAt: null,
  lastError: null,
};

function markLaunched() {
  const now = Date.now();
  state.launchedAt = now;
  state.lastOkAt = now;
  state.lastError = null;
}

function markOk() {
  state.lastOkAt = Date.now();
}

function markError(message) {
  state.lastError = message || 'unknown';
}

function getBotHealth() {
  return { ...state };
}

module.exports = { markLaunched, markOk, markError, getBotHealth };
