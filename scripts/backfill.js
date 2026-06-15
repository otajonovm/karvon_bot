require('../config/env');

const { TelegramClient, utils } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');

const { parseCargoMessage } = require('../lib/gemini');
const { insertOrder } = require('../lib/orders');
const { CARGO_GROUPS } = require('../config/constants');

const SESSION_FILE = path.join(__dirname, '..', 'session.txt');

function extractMessageText(message) {
  return String(message.text || message.message || message.rawText || '').trim();
}

async function main() {
  const session = fs.existsSync(SESSION_FILE) ? fs.readFileSync(SESSION_FILE, 'utf8').trim() : '';
  const client = new TelegramClient(
    new StringSession(session),
    parseInt(process.env.API_ID, 10),
    process.env.API_HASH,
    { connectionRetries: 5 }
  );

  await client.connect();
  if (!(await client.checkAuthorization())) {
    console.error('Session yo\'q. Avval: node scraper.js');
    process.exit(1);
  }

  console.log('Oxirgi 15 ta xabarni har guruhdan o\'qiyapman...\n');

  for (const group of CARGO_GROUPS) {
    const entity = await client.getEntity(group);
    const label = entity.title || entity.username || group;
    const messages = await client.getMessages(entity, { limit: 15 });
    let saved = 0;
    let skipped = 0;

    for (const msg of messages) {
      const text = extractMessageText(msg);
      if (!text) continue;

      const parsed = await parseCargoMessage(text);
      if (!parsed) {
        skipped++;
        continue;
      }

      const order = await insertOrder({
        ...parsed,
        source: 'scraper',
        source_group: label,
        source_message_id: msg.id,
        raw_text: text.slice(0, 2000),
      });

      if (order) {
        saved++;
        console.log(`  ✅ ${label}: ${parsed.from_region}→${parsed.to_region} #${order.id.slice(0, 8)}`);
      }
    }

    console.log(`[${label}] saqlandi: ${saved}, o'tkazildi: ${skipped}\n`);
  }

  await client.disconnect();
  console.log('Tugadi. Supabase orders jadvalini tekshiring.');
}

main().catch((e) => {
  console.error('Xato:', e.message);
  process.exit(1);
});
