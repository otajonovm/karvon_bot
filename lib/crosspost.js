const { Button } = require('telegram/tl/custom/button');
const { CROSSPOST_GROUPS, CROSSPOST_DM_IDS } = require('../config/constants');

const BOT_HANDLE = (process.env.BOT_USERNAME || 'karvongo_bot').replace(/^@/, '');
const BOT_URL = process.env.BOT_PUBLIC_URL || 'https://t.me/Karvongo_bot';

const PROMO_LINE = '━━━━━━━━━━━━━━━━━';
const PROMO_FOOTER = `${PROMO_LINE}\n🤖 Ushbu yuk @${BOT_HANDLE} orqali maklerlarsiz, 1 daqiqada TEKIN joylandi!`;

const GROUP_BTN_LABEL = '🚚 Men ham yuk qidiryapman (Botga kirish)';
const CROSSPOST_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUserDmId(ref) {
  return /^\d+$/.test(String(ref).trim());
}

function isEntityNotFoundError(err) {
  const msg = err?.message || err?.errorMessage || String(err);
  return /could not find the input entity/i.test(msg) || /peer id invalid/i.test(msg);
}

function logCrosspostFailure(targetRef, err) {
  const id = String(targetRef).trim();
  if (isUserDmId(id) && isEntityNotFoundError(err)) {
    console.warn(
      `[crosspost] ✗ Lichka ${id} topilmadi. Userbot ushbu akkaunt bilan kamida 1 marta Telegramda chat ochgan bo'lishi shart!`
    );
    return;
  }
  console.error(`[crosspost] ✗ ${id}:`, err?.message || err);
}

/** Broker yuk matni + brending footer */
function buildCrosspostMessage(order) {
  const phone = order.broker_phone || order.phone_number || '';
  const lines = [
    '📦 YUK E\'LONI',
    '',
    `🚛 ${order.car_type}`,
    `📍 ${order.from_region} → ${order.to_region}`,
    `📝 ${order.cargo_details}`,
  ];
  if (phone) lines.push(`📞 ${phone}`);
  lines.push('', PROMO_FOOTER);
  return lines.join('\n');
}

function groupInlineButtons() {
  return [[Button.url(GROUP_BTN_LABEL, BOT_URL)]];
}

function parseFloodWaitSeconds(err) {
  const msg = err?.message || err?.errorMessage || String(err);
  const match = msg.match(/FLOOD_WAIT_(\d+)/i) || msg.match(/wait of (\d+) seconds/i);
  return match ? parseInt(match[1], 10) : null;
}

async function resolveTarget(client, targetRef) {
  const ref = String(targetRef).trim();
  const strategies = [];

  if (/^-?\d+$/.test(ref)) {
    strategies.push(() => client.getInputEntity(BigInt(ref)));
  }
  strategies.push(() => client.getInputEntity(ref));
  strategies.push(() => client.getEntity(ref));

  let lastErr;
  for (const run of strategies) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error(`Could not find the input entity for ${ref}`);
}

async function postToTarget(client, targetRef, text) {
  const entity = await resolveTarget(client, targetRef);
  return client.sendMessage(entity, {
    message: text,
    buttons: groupInlineButtons(),
    linkPreview: false,
  });
}

async function sendWithRetry(client, targetRef, text) {
  try {
    await postToTarget(client, targetRef, text);
    return { ok: true };
  } catch (err) {
    const floodSec = parseFloodWaitSeconds(err);
    if (floodSec) {
      console.warn(`[crosspost] FloodWait ${floodSec}s — ${targetRef}`);
      await sleep(floodSec * 1000 + 1000);
      try {
        await postToTarget(client, targetRef, text);
        return { ok: true };
      } catch (retryErr) {
        logCrosspostFailure(targetRef, retryErr);
        return { ok: false, error: retryErr?.message || String(retryErr) };
      }
    }

    logCrosspostFailure(targetRef, err);
    return { ok: false, error: err?.message || String(err) };
  }
}

function buildCrosspostTargets(groups = CROSSPOST_GROUPS) {
  return [...groups];
}

/**
 * Userbot orqali yukni guruhlarga ketma-ket tarqatish (2s kechikish + FloodWait himoya).
 * @returns {{ sent: number, failed: number, errors: Array<{ group: string, error: string }> }}
 */
async function crosspostOrder(client, order, groups = CROSSPOST_GROUPS) {
  if (!client?.connected) {
    throw new Error('USERBOT_OFFLINE');
  }

  const targets = buildCrosspostTargets(groups);
  if (!targets.length) {
    throw new Error('CROSSPOST_GROUPS_EMPTY');
  }

  const text = buildCrosspostMessage(order);
  const results = { sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (i > 0) {
      await sleep(CROSSPOST_DELAY_MS);
    }

    try {
      const outcome = await sendWithRetry(client, target, text);
      if (outcome.ok) {
        results.sent += 1;
        console.log(`[crosspost] ✓ ${target}`);
      } else {
        results.failed += 1;
        results.errors.push({ group: target, error: outcome.error });
      }
    } catch (err) {
      results.failed += 1;
      results.errors.push({ group: target, error: err?.message || String(err) });
      logCrosspostFailure(target, err);
    }
  }

  return results;
}

/** Broker yuk saqlanganda barcha lichkalarga avtomat yuborish */
async function crosspostToDm(client, order) {
  if (!CROSSPOST_DM_IDS.length || !client?.connected) {
    return { sent: 0, failed: 0, errors: [] };
  }

  const text = buildCrosspostMessage(order);
  const results = { sent: 0, failed: 0, errors: [] };

  for (let i = 0; i < CROSSPOST_DM_IDS.length; i++) {
    const dmId = CROSSPOST_DM_IDS[i];
    if (i > 0) {
      await sleep(CROSSPOST_DELAY_MS);
    }

    try {
      const outcome = await sendWithRetry(client, dmId, text);
      if (outcome.ok) {
        results.sent += 1;
        console.log(`[crosspost] ✓ lichka ${dmId}`);
      } else {
        results.failed += 1;
        results.errors.push({ group: dmId, error: outcome.error });
      }
    } catch (err) {
      results.failed += 1;
      results.errors.push({ group: dmId, error: err?.message || String(err) });
      logCrosspostFailure(dmId, err);
    }
  }

  return results;
}

module.exports = {
  BOT_URL,
  PROMO_FOOTER,
  buildCrosspostMessage,
  crosspostOrder,
  crosspostToDm,
};
