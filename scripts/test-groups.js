#!/usr/bin/env node
/**
 * HAQIQIY guruhlarni terminalda sinash: ulanadi, oxirgi N xabarni o'qiydi,
 * har birini tahlil qiladi va natijani ko'rsatadi.
 *
 * MUHIM: Telegram session faqat BITTA joyda ishlashi mumkin.
 *   Ishlatishdan oldin cloud scraper'ni to'xtating (yoki cloud server.js'ni pauza qiling),
 *   aks holda AUTH_KEY_DUPLICATED bo'ladi.
 *
 * Ishlatish:
 *   node scripts/test-groups.js            (o'qiydi + tahlil + Supabase'ga saqlaydi)
 *   node scripts/test-groups.js --dry      (faqat tahlil, saqlamaydi)
 *   node scripts/test-groups.js --limit=30 (har guruhdan 30 ta xabar)
 */
require('../config/env');

const { TelegramClient, utils } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { Logger } = require('telegram/extensions');

const { parseCargoMessage } = require('../lib/gemini');
const { insertOrder } = require('../lib/orders');
const { CARGO_GROUPS } = require('../config/constants');
const { loadSession } = require('../lib/session');

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : 15;

function extractMessageText(message) {
  return String(message.text || message.message || message.rawText || '').trim();
}

async function main() {
  if (CARGO_GROUPS.length === 0) {
    console.error('❌ CARGO_GROUPS bo\'sh. karvon.env ni tekshiring.');
    process.exit(1);
  }

  const session = loadSession();
  if (!session) {
    console.error('❌ Session yo\'q. Avval: node scraper.js → login');
    process.exit(1);
  }

  console.log(`\n[test-groups] ${CARGO_GROUPS.length} ta guruh | har biridan ${LIMIT} ta xabar | ${DRY ? 'DRY (saqlamaydi)' : 'saqlaydi'}\n`);

  const client = new TelegramClient(new StringSession(session), parseInt(process.env.API_ID, 10), process.env.API_HASH, {
    connectionRetries: 3,
    useWSS: process.env.TELEGRAM_USE_WSS === '1',
    baseLogger: new Logger('error'),
  });

  try {
    await client.connect();
  } catch (err) {
    if (/AUTH_KEY_DUPLICATED/i.test(err.message)) {
      console.error('❌ AUTH_KEY_DUPLICATED — session boshqa joyda ochiq (cloud).');
      console.error('   Cloud scraper\'ni to\'xtating va 2 daqiqa kuting, keyin qayta uriniб ko\'ring.');
      process.exit(1);
    }
    throw err;
  }

  if (!(await client.checkAuthorization())) {
    console.error('❌ Session yaroqsiz. Lokalda qayta login: node scraper.js');
    await client.disconnect();
    process.exit(1);
  }

  console.log('✅ Telegramga ulandi (session yaroqli)\n');

  let totalSaved = 0;
  let totalParsed = 0;
  let totalSkipped = 0;

  for (const group of CARGO_GROUPS) {
    let entity;
    try {
      entity = await client.getEntity(group);
    } catch (err) {
      console.error(`❌ Guruh ochilmadi: ${group} — ${err.message}`);
      console.error('   Sabab: akkaunt bu guruhga A\'ZO emas yoki ID noto\'g\'ri.\n');
      continue;
    }

    const label = entity.title || entity.username || group;
    const peerId = utils.getPeerId(entity).toString();
    console.log(`━━━ ${label} (id: ${peerId}) ━━━`);

    let messages;
    try {
      messages = await client.getMessages(entity, { limit: LIMIT });
    } catch (err) {
      console.error(`   Xabar o'qib bo'lmadi: ${err.message}\n`);
      continue;
    }

    let saved = 0;
    let parsedCount = 0;
    let skipped = 0;

    for (const msg of messages) {
      const text = extractMessageText(msg);
      if (!text) continue;

      let parsed;
      try {
        parsed = await parseCargoMessage(text);
      } catch (err) {
        console.log(`   ⚠️ AI xato: ${err.message}`);
        continue;
      }

      if (!parsed) {
        skipped++;
        continue;
      }

      parsedCount++;
      const preview = `${parsed.from_region}→${parsed.to_region} | ${parsed.car_type} | ${parsed.phone_number}`;

      if (DRY) {
        console.log(`   📦 ${preview}`);
        continue;
      }

      try {
        const order = await insertOrder({
          ...parsed,
          source: 'scraper',
          source_group: label,
          source_message_id: msg.id,
          raw_text: text.slice(0, 2000),
        });
        if (order) {
          saved++;
          console.log(`   ✅ #${order.id.slice(0, 8)} ${preview}`);
        } else {
          console.log(`   ↩️ dublikat: ${preview}`);
        }
      } catch (err) {
        console.log(`   ❌ saqlanmadi: ${err.message}`);
      }
    }

    console.log(`   Natija: tahlil ${parsedCount}, saqlandi ${saved}, o'tkazildi ${skipped}\n`);
    totalSaved += saved;
    totalParsed += parsedCount;
    totalSkipped += skipped;
  }

  console.log('═══════════════════════════════════════');
  console.log(`Jami: tahlil ${totalParsed}, saqlandi ${totalSaved}, o'tkazildi ${totalSkipped}`);
  console.log('═══════════════════════════════════════\n');

  await client.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
