const { postOrderToRoyalGroup } = require('./royalGroupPost');
const { notifyMatchingDrivers } = require('./notifications');

const ROYAL_GAP_MS = 800;
let lastRoyalAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function paceRoyalPost() {
  const wait = lastRoyalAt + ROYAL_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRoyalAt = Date.now();
}

/**
 * Boshqa guruhlardan kelgan yuk: rasmiy Karvon guruhiga + mos haydovchilarga PUSH.
 * Xatolar oqimni to'xtatmaydi.
 */
async function distributeScrapedOrder(telegram, order) {
  const result = {
    royalOk: false,
    notifiedCount: 0,
    notifiedDriverIds: [],
  };

  try {
    await paceRoyalPost();
    const royal = await postOrderToRoyalGroup(telegram, order);
    result.royalOk = Boolean(royal?.ok);
    if (royal?.ok) {
      console.log(`[distribute] Rasmiy guruhga chiqarildi #${order.id}`);
    } else {
      console.warn(`[distribute] Guruhga chiqmadi #${order.id}: ${royal?.error || 'noma\'lum'}`);
    }
  } catch (err) {
    console.error('[distribute] royal-post:', err.message);
  }

  try {
    const push = await notifyMatchingDrivers(telegram, order);
    result.notifiedCount = push?.notifiedCount || 0;
    result.notifiedDriverIds = push?.notifiedDriverIds || [];
    console.log(
      `[distribute] PUSH #${order.id}: ${result.notifiedCount}/${push?.matchedCount || 0} haydovchi`
    );
  } catch (err) {
    console.error('[distribute] push:', err.message);
  }

  return result;
}

module.exports = { distributeScrapedOrder };
