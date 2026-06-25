require('../config/env');
const { parseWithRegex } = require('../lib/regexParser');
const { parseCargoMessage } = require('../lib/gemini');

const samples = [
  "TOSHKENT     ANDIJON    TENT  REF   KERAK    771030307",
  "FARG'ONA___SIRDARYO  10 T ISUZY   939626016",
  "NAMANGAN NAVOIY   TENT  KK   781228146",
  "📍: СИРДАРЁ   🏁: КАШКАДАРЁ КУК ДАЛА   🚚: ФУРА КЕРАК   📦: СОМОН  919792008",
  "Fargonadan qoqonga chakman kerak 950242002",
  "**TOSHKENT ->. SAMARQAND  TOSHKENT ->. NAMANGAN  🚛 Plasha 970741477",
];

(async () => {
  for (const text of samples) {
    const rx = parseWithRegex(text);
    console.log('\n---', text.slice(0, 60));
    console.log('regex:', rx ? `${rx.from_region}->${rx.to_region} ${rx.car_type}` : 'NO');
  }
})();
