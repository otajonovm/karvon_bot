const { normalizeParsedOrder } = require('./normalize');
const { isSpamMessage } = require('./spamFilter');
const { parseWithRegex } = require('./regexParser');

/** Qisqa prompt — token tejash */
const AI_PROMPT =
  'JSON only: from_region,to_region,car_type,cargo_details,phone_number. Regions:Toshkent,Vodiy,Samarqand,Buxoro,Voha. Cars:Labo/Damas,Gazel,Isuzu,Fura. Phone:+998. Spam:{"error":"spam"}';

const MAX_INPUT_CHARS = 350;
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

function parseJsonResponse(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed.error === 'spam') return null;
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
        { role: 'system', content: AI_PROMPT },
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
    config: { systemInstruction: AI_PROMPT, temperature: 0, maxOutputTokens: 120 },
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
  const result = await parseWithAI(text);

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
