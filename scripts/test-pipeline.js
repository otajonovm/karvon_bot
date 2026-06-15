require('../config/env');

const { parseCargoMessage } = require('../lib/gemini');
const { insertOrder } = require('../lib/orders');

const SAMPLES = [
  'Toshkentdan Vodiyga 5 tonna yuk bor. Isuzu kerak. Narxi 2 mln. Tel: +998901234567',
  'Samarqand - Buxoro. Gazel kerak. Mebel. 998771112233',
  'Reklama! Eng arzon narxlarda telefon sotamiz. Murojaat: @sotuvchi',
];

async function main() {
  console.log('AI kaliti:', process.env.GEMINI_API_KEY ? 'Gemini' : process.env.DEEPSEEK_API_KEY ? 'DeepSeek' : 'YO\'Q');
  console.log('─────────────────────────────────────\n');

  for (const text of SAMPLES) {
    console.log('XABAR:', text);
    let parsed;
    try {
      parsed = await parseCargoMessage(text);
    } catch (err) {
      console.log('  AI XATO:', err.message, '\n');
      continue;
    }

    if (!parsed) {
      console.log('  NATIJA: spam yoki normalizatsiya rad etdi (saqlanmaydi)\n');
      continue;
    }

    console.log('  AI NATIJA:', JSON.stringify(parsed));

    try {
      const order = await insertOrder({
        ...parsed,
        source: 'scraper',
        source_group: 'TEST',
        source_message_id: Date.now(),
        raw_text: text,
      });
      if (order) {
        console.log('  SAQLANDI: order #' + order.id);
      } else {
        console.log('  DUBLIKAT: saqlanmadi');
      }
    } catch (err) {
      const rls = /row-level security/i.test(err.message);
      console.log('  BAZA XATO:', err.message, rls ? '→ policies.sql kerak' : '');
    }
    console.log('');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
