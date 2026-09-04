/**
 * Yuk TTL va avtomatik expiry.
 * Scraper: 6 soat. Broker/bot: 12 soat.
 * Cron: har 10 daqiqa, batch update — 75k qatorni bir so'rovda qulflamaslik.
 */
const { getSupabase } = require('./supabase');

const TTL_SCRAPER_MS = 6 * 60 * 60 * 1000;
const TTL_BOT_MS = 12 * 60 * 60 * 1000;
const CRON_INTERVAL_MS = 10 * 60 * 1000;
const BATCH = 400;
const MAX_BATCHES = 50;

const EXPIRED_USER_MSG =
  '⚠️ Ushbu yuk muddati tugagan yoki allaqachon ketib bo\'lgan';

function logExpiryError(context, error) {
  console.error(`[expiry] ${context}:`, error?.message || error, error?.code || '');
}

function ttlMsForSource(source) {
  return source === 'scraper' ? TTL_SCRAPER_MS : TTL_BOT_MS;
}

function calcExpiresAt(source) {
  return new Date(Date.now() + ttlMsForSource(source)).toISOString();
}

function liveSinceIso(source) {
  return new Date(Date.now() - ttlMsForSource(source)).toISOString();
}

/** Qidiruv/push uchun: active + source TTL ichida */
function isLiveOrder(order) {
  if (!order || order.status !== 'active') return false;
  const created = Date.parse(order.created_at);
  if (!Number.isFinite(created)) return false;
  if (Date.now() - created > ttlMsForSource(order.source)) return false;
  if (order.expires_at && Date.parse(order.expires_at) < Date.now()) return false;
  return true;
}

async function expireBatch(filterFn) {
  const supabase = getSupabase();
  let total = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    let q = supabase
      .from('orders')
      .update({ status: 'expired' })
      .eq('status', 'active');
    q = filterFn(q);
    const { data, error } = await q.select('id').limit(BATCH);

    if (error) {
      logExpiryError('batch', error);
      break;
    }
    const n = (data || []).length;
    total += n;
    if (n < BATCH) break;
  }
  return total;
}

async function expireOldOrders() {
  try {
    const scraperCut = liveSinceIso('scraper');
    const botCut = liveSinceIso('bot');
    const now = new Date().toISOString();

    const nScraper = await expireBatch((q) =>
      q.eq('source', 'scraper').lt('created_at', scraperCut)
    );
    const nBot = await expireBatch((q) =>
      q.eq('source', 'bot').lt('created_at', botCut)
    );
    const nExpires = await expireBatch((q) => q.lte('expires_at', now));

    const total = nScraper + nBot + nExpires;
    if (total > 0) {
      console.log(
        `[expiry] expired: scraper=${nScraper} bot=${nBot} expires_at=${nExpires} jami=${total}`
      );
    }
    return total;
  } catch (err) {
    console.error('[expiry] expireOldOrders:', err.message);
    return 0;
  }
}

let expiryTimer = null;

function startExpiryLoop() {
  if (expiryTimer) {
    console.log('[expiry] Loop allaqachon ishlamoqda');
    return;
  }

  expireOldOrders().catch((err) => console.error('[expiry] start:', err.message));

  expiryTimer = setInterval(() => {
    expireOldOrders().catch((err) => console.error('[expiry] cron:', err.message));
  }, CRON_INTERVAL_MS);
  expiryTimer.unref();
  console.log(`[expiry] TTL engine: har ${CRON_INTERVAL_MS / 60000} daqiqa (scraper 6h / bot 12h)`);
}

function stopExpiryLoop() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

module.exports = {
  TTL_SCRAPER_MS,
  TTL_BOT_MS,
  EXPIRED_USER_MSG,
  calcExpiresAt,
  ttlMsForSource,
  liveSinceIso,
  isLiveOrder,
  expireOldOrders,
  startExpiryLoop,
  stopExpiryLoop,
};
