#!/usr/bin/env node
/**
 * Smart matching: two-way, tuman→viloyat, mashina sig'imi.
 * Env kerak emas: node scripts/test-route-match.js
 */
const { routeMatchesOrder, carTypesMatch, regionsTextMatch, provinceIds } = require('../lib/routeMatch');
const { formatOrderMessage, orderActionKeyboard, isBotBlockedError, deliverPushToDrivers } = require('../lib/notifications');
const { normalizeRegion } = require('../lib/normalize');

let failed = 0;
let passed = 0;

function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}`);
  }
}

function driver(partial) {
  return {
    user_id: 1,
    status: 'active',
    truck_type: 'Fura',
    from_region: 'Toshkent',
    to_region: "Farg'ona",
    ...partial,
  };
}

function order(partial) {
  return {
    id: 'ord-1',
    truck_type: 'Fura',
    car_type: 'Fura',
    from_region: 'Toshkent',
    to_region: "Farg'ona",
    cargo_details: "Mebel, 20tn, 6 mln so'm",
    phone_number: '+998901234567',
    ...partial,
  };
}

console.log('1) Viloyat / tuman ID');
assert("Qo'qon → Farg'ona", normalizeRegion("Qo'qon") === "Farg'ona");
assert('Chirchiq → Toshkent', normalizeRegion('Chirchiq') === 'Toshkent');
assert('Termiz → Surxondaryo', normalizeRegion('Termiz') === 'Surxondaryo');
assert('Yozyovon → Farg\'ona', provinceIds('Yozyovon').includes("Farg'ona"));
assert('Toshkent, Chirchiq → Toshkent', provinceIds('Toshkent, Chirchiq').includes('Toshkent'));
assert('tuman vs viloyat match', regionsTextMatch("Qo'qon", "Farg'ona"));
assert('boshqa viloyat emas', !regionsTextMatch('Chirchiq', 'Samarqand'));

console.log('\n2) Two-way / backhaul');
assert(
  'to‘g‘ri yo‘nalish',
  routeMatchesOrder(driver(), order())
);
assert(
  'qaytish yuk (backhaul)',
  routeMatchesOrder(
    driver({ from_region: "Farg'ona", to_region: 'Toshkent' }),
    order({ from_region: 'Toshkent', to_region: "Farg'ona" })
  )
);
assert(
  'boshqa marshrut emas',
  !routeMatchesOrder(
    driver({ from_region: 'Toshkent', to_region: 'Buxoro' }),
    order({ from_region: 'Toshkent', to_region: "Farg'ona" })
  )
);
assert(
  'tuman buyurtma vs viloyat haydovchi',
  routeMatchesOrder(
    driver({ from_region: 'Toshkent', to_region: "Farg'ona", truck_type: 'Isuzu' }),
    order({ from_region: 'Chirchiq', to_region: "Qo'qon", truck_type: 'Isuzu', car_type: 'Isuzu' })
  )
);

console.log('\n3) Mashina turi / sig‘im');
assert('Fura === Fura', carTypesMatch('Fura', 'Fura'));
assert('Labo === Damas', carTypesMatch('Labo', 'Damas'));
assert('Isuzu haydovchi Fura yuk olmaydi', !carTypesMatch('Fura', 'Isuzu'));
assert('Fura haydovchi Isuzu yukni oladi (bir pog‘ona)', carTypesMatch('Isuzu', 'Fura'));
assert('Gazel haydovchi Isuzu yuk olmaydi', !carTypesMatch('Isuzu', 'Gazel'));
assert('Gazel haydovchi Labo yukni oladi', carTypesMatch('Labo/Damas', 'Gazel'));
assert('Fura haydovchiga Labo ketmaydi', !carTypesMatch('Labo', 'Fura'));
assert(
  'tur mos emas — yo‘nalish mos bo‘lsa ham',
  !routeMatchesOrder(driver({ truck_type: 'Labo/Damas' }), order({ truck_type: 'Fura', car_type: 'Fura' }))
);

console.log('\n4) Push xabar formati');
const text = formatOrderMessage(order({ price: "6 mln so'm" }));
assert('sarlavha', text.includes('🚨 YANGI YUK TOPIB BERILDI!'));
assert('yo‘nalish', text.includes('Toshkent ➔ Farg\'ona') || text.includes("Toshkent ➔ Farg'ona"));
assert('yuk', text.includes('Mebel'));
assert('narx', text.includes("6 mln so'm"));
assert('mashina', text.includes('Fura'));

const kb = orderActionKeyboard(order());
const rows = kb.reply_markup?.inline_keyboard || [];
const flat = rows.flat();
assert(
  "qo‘ng‘iroq tugmasi",
  flat.some((b) => /Qo'ng'iroq Qilish/i.test(b.text) && String(b.url || '').startsWith('tel:'))
);
assert(
  'accept tugmasi saqlanadi',
  flat.some((b) => b.callback_data === 'accept_order_ord-1')
);

console.log('\n5) 403 / blok aniqlash (to‘xtamaslik)');
assert('403 code', isBotBlockedError({ code: 403, message: 'Forbidden' }));
assert('bot was blocked', isBotBlockedError({ message: 'Forbidden: bot was blocked by the user' }));
assert('oddiy xato emas', !isBotBlockedError({ code: 400, message: 'Bad Request' }));

async function testDeliverContinuesAfter403() {
  console.log('\n6) Parallel push 403 dan keyin davom etadi');
  const attempted = [];
  const telegram = {
    sendMessage: async (id) => {
      attempted.push(Number(id));
      if (Number(id) === 403) {
        const err = new Error('Forbidden: bot was blocked by the user');
        err.code = 403;
        throw err;
      }
      return { chat: { id }, message_id: 11 };
    },
  };

  const result = await deliverPushToDrivers(
    telegram,
    order(),
    [
      driver({ user_id: 403, telegram_id: 403 }),
      driver({ user_id: 111, telegram_id: 111 }),
    ],
    { persistRefs: false }
  );

  assert('ikkalasiga ham urinildi', attempted.includes(403) && attempted.includes(111));
  assert('faqat bloklanmagan yuborildi', result.sentCount === 1);
  assert('403 loopni to‘xtatmadi', result.results.some((r) => r.blocked) && result.results.some((r) => r.ok));
}

testDeliverContinuesAfter403()
  .then(() => {
    console.log(`\n${passed} o'tdi, ${failed} yiqildi`);
    process.exit(failed ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
