/** AI chaqirilmasdan rad etiladigan aniq spam/reklama belgilari */
const SPAM_PATTERNS = [
  /to[''`]?lov qil/i,
  /guruhga yozish uchun/i,
  /1 oy:\s*\d/i,
  /HAYDOVCHILAR DIQQAT/i,
  /ADR va CHIP/i,
  /sertifikat tayyor/i,
  /telefon sotamiz/i,
  /reklama/i,
  /obuna bo[''`]?ling/i,
  /тарки адаб/i,
  /ALLAH BUYUK/i,
  /^@[\w]+,\s*guruhga/i,
  /pul olish uchun/i,
  /admin @/i,
  /lorry_filter_bot/i,
];

/** Yuk e'loni bo'lishi uchun kamida bitta belgi */
const CARGO_HINTS = [
  /yuk/i,
  /fura/i,
  /gazel/i,
  /isuzu/i,
  /labo/i,
  /damas/i,
  /тент/i,
  /tent/i,
  /тонн/i,
  /tonna/i,
  /керак/i,
  /kerek/i,
  /kerak/i,
  /машина/i,
  /юк/i,
  /🚛/,
  /📦/,
  /📱/,
  /tel/i,
  /тел/i,
  /\+998/,
  /\b9\d{8}\b/,
];

function isSpamMessage(text) {
  if (!text || text.length < 15) return true;
  const t = text.trim();

  for (const p of SPAM_PATTERNS) {
    if (p.test(t)) return true;
  }

  // Yuk belgisi yo'q va telefon ham yo'q → ehtimol spam
  const hasHint = CARGO_HINTS.some((p) => p.test(t));
  if (!hasHint) return true;

  return false;
}

module.exports = { isSpamMessage };
