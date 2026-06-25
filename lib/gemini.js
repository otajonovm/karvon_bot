const { normalizeParsedOrder, normalizePhone, extractPhoneFromText } = require('./normalize');
const { isSpamMessage } = require('./spamFilter');
const { parseWithRegex } = require('./regexParser');
const { isStrictFilters } = require('../config/constants');

const AI_PROMPT_STRICT =
  "JSON only: from_region,to_region,car_type,cargo_details,phone_number. " +
  "Regions:Toshkent,Farg'ona,Andijon,Namangan,Samarqand,Buxoro,Qashqadaryo,Surxondaryo. " +
  "Qo'qon/Marg'ilon→Farg'ona;Asaka→Andijon;Chust/Pop→Namangan;Termiz→Surxondaryo. " +
  "Cars:Labo/Damas,Gazel,Isuzu,Fura. Phone:+998. Spam:{\"error\":\"spam\"}";

const AI_PROMPT_RELAXED =
  "JSON only: from_region,to_region,car_type,cargo_details,phone_number. " +
  "Regions:Toshkent,Farg'ona,Andijon,Namangan,Samarqand,Buxoro,Qashqadaryo,Surxondaryo. " +
  "Qo'qon/Kokand/Marg'ilon→Farg'ona;Navoiy/Jizzax/Sirdaryo/Guliston→Qashqadaryo;Xiva/Urganch→Qashqadaryo. " +
  "Cars:Labo/Damas,Gazel,Isuzu,Fura,chakman,kamaz→Fura. " +
  "If to_region unknown use nearest city name. Always extract phone +998 if present.";

const MAX_INPUT_CHARS = 800;
const aiCache = new Map();
const CACHE_MAX = 500;

let aiStats = { regex: 0, cache: 0, ai: 0, spam: 0 };

let geminiClient = null;

function getGemini() {
  if (geminiClient) return geminiClient;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY must be set');
  // Og'ir kutubxona faqat Gemini ishlatilganda yuklanadi (xotira tejash)
  const { GoogleGenAI } = require('@google/genai');
  geminiClient = new GoogleGenAI({ apiKey });
  return geminiClient;
}

function cacheKey(text) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function aiPrompt() {
  return isStrictFilters() ? AI_PROMPT_STRICT : AI_PROMPT_RELAXED;
}

function parseJsonResponse(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (isStrictFilters() && parsed.error === 'spam') return null;
    return normalizeParsedOrder(parsed);
  } catch {
    return null;
  }
}

async function parseWithDeepSeek(text) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY must be set');

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: aiPrompt() },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 120,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek ${res.status}: ${errText.slice(0, 150)}`);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function parseWithGemini(text) {
  const gemini = getGemini();
  const response = await gemini.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: text,
    config: { systemInstruction: aiPrompt(), temperature: 0, maxOutputTokens: 180 },
  });
  return (response.text || '').trim();
}

async function parseWithAI(text) {
  const truncated = text.slice(0, MAX_INPUT_CHARS);
  const useGemini = !!process.env.GEMINI_API_KEY;
  const raw = useGemini ? await parseWithGemini(truncated) : await parseWithDeepSeek(truncated);
  return parseJsonResponse(raw);
}

/**
 * 1) Spam filter (0 token)
 * 2) Regex parser (0 token)
 * 3) Cache (0 token)
 * 4) AI faqat qolganlarida
 */
async function parseCargoMessage(text) {
  if (!text?.trim()) return null;

  if (isSpamMessage(text)) {
    aiStats.spam++;
    return null;
  }

  const regexResult = parseWithRegex(text);
  if (regexResult) {
    aiStats.regex++;
    return regexResult;
  }

  const key = cacheKey(text);
  if (aiCache.has(key)) {
    aiStats.cache++;
    return aiCache.get(key);
  }

  if (!process.env.GEMINI_API_KEY && !process.env.DEEPSEEK_API_KEY) {
    throw new Error('Set GEMINI_API_KEY or DEEPSEEK_API_KEY');
  }

  aiStats.ai++;
  let result = await parseWithAI(text);

  if (result && !String(result.cargo_details || '').trim()) {
    result = { ...result, cargo_details: text.slice(0, 800) };
  }
  if (result && !normalizePhone(result.phone_number)) {
    const phone = extractPhoneFromText(text);
    if (phone) result = { ...result, phone_number: phone };
  }

  if (aiCache.size >= CACHE_MAX) {
    const first = aiCache.keys().next().value;
    aiCache.delete(first);
  }
  aiCache.set(key, result);

  return result;
}

function getAiStats() {
  return { ...aiStats };
}

function logAiStats() {
  const s = aiStats;
  const total = s.regex + s.cache + s.ai + s.spam;
  if (total === 0) return;
  console.log(
    `[ai] Stat: regex=${s.regex} cache=${s.cache} ai=${s.ai} spam=${s.spam} ` +
      `(AI ${total ? Math.round((s.ai / total) * 100) : 0}% chaqiruv)`
  );
}

module.exports = { parseCargoMessage, getAiStats, logAiStats };
