const { parseWithRegex } = require('../lib/regexParser');

const msgs = [
  "KATTAQO'RG'ON -> FARG'ONA  🚛 Fura  📱 Tel: +998500350035",
  'ANGREN -> NAMANGAN  🚛 Fura  📱 Tel: +998500530035',
  'TOSHKENT -> QARSHI  🚛 Fura  📱 Tel: +998933651234',
  'Samarqand   Namangan   Tent fura kerak   25 T   701060510',
  'TOSHKENT - NAVOIY  🚛 Fura  📱 Tel: +998955448996',
];

for (const m of msgs) {
  const r = parseWithRegex(m);
  console.log(r ? `${r.from_region}→${r.to_region} ${r.car_type} ${r.phone_number}` : 'FAIL', '|', m.slice(0, 50));
}
