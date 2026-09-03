/**
 * Yuk TTL va avtomatik expiry engine.
 *
 * Scraper yuklar: 6 soat
 * Broker/bot yuklar: 12 soat
 *
 * startExpiryLoop() — server.js da chaqiriladi (har 15 daqiqa).
 */
const { getSupabase } = require('./supabase');

function logExpiryError(context, error) {
  console.error(`Supabase Error [${context}]:`, {
    message: error?.message,
    code: error?.code,
    details: error?.details,
  });
}

const TTL_SCRAPER_MS  = 6  * 60 * 60 * 1000;
const TTL_BOT_MS      = 12 * 60 * 60 * 1000;
const CRON_INTERVAL_MS = 15 * 60 * 1000;

/** Yangi order uchun expires_at hisoblaydi */
function calcExpiresAt(source) {
  const ttlMs = source === 'scraper' ? TTL_SCRAPER_MS : TTL_BOT_MS;
  return new Date(Date.now() + ttlMs).toISOString();
}

/**
 * Muddati o'tgan 'active' yuklar → 'expired'.
 * Returns: nechta qator yangilangan.
 */
async function expireOldOrders() {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // expires_at NULL bo'lsa ham eski qatorlar uchun fallback TTL
  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .or(`expires_at.lte.${now},and(expires_at.is.null,created_at.lte.${new Date(Date.now() - TTL_BOT_MS).toISOString()})`)
    .select('id');

  if (error) {
    logExpiryError('orderExpiry.expire', error);
    return 0;
  }

  const count = (data || []).length;
  if (count > 0) {
    console.log(`[expiry] ${count} ta yuk expired holatiga o'tdi`);
  }
  return count;
}

let expiryTimer = null;

function startExpiryLoop() {
  if (expiryTimer) return;

  // Darhol bir marta ishga tushirish
  expireOldOrders().catch((err) =>
    console.error('[expiry] Boshlang\'ich tekshiruv xato:', err.message)
  );

  expiryTimer = setInterval(() => {
    expireOldOrders().catch((err) =>
      console.error('[expiry] Cron xato:', err.message)
    );
  }, CRON_INTERVAL_MS);

  expiryTimer.unref(); // Server shutdown'ni bloklamas
  console.log(`[expiry] TTL engine ishga tushdi (har ${CRON_INTERVAL_MS / 60000} daqiqa)`);
}

function stopExpiryLoop() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

module.exports = { calcExpiresAt, expireOldOrders, startExpiryLoop, stopExpiryLoop };
