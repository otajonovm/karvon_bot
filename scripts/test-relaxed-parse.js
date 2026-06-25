require('../config/env');
const { normalizeParsedOrder } = require('../lib/normalize');

const cases = [
  {
    from_region: "Farg'ona",
    to_region: "Qo'qon",
    car_type: 'chakman',
    cargo_details: 'Fargonadan qoqonga chakman kerak 939626016',
    phone_number: null,
  },
  {
    from_region: 'Namangan',
    to_region: '',
    car_type: 'ref labo',
    cargo_details: 'Ref labo xizmati Namangandan +998946666269',
    phone_number: '+998946666269',
  },
];

for (const c of cases) {
  const r = normalizeParsedOrder(c);
  console.log(c.from_region, '->', c.to_region || '(empty)', '=>', r ? `${r.from_region}->${r.to_region} ${r.phone_number}` : 'REJECTED');
}
