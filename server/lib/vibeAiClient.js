// Вызывает модель через AI Router платформы VibeCode (vibecode.bitrix24.tech),
// а не напрямую OpenAI/Anthropic — используется тот же ключ VIBE_KEY, что и
// для деплоя. Роутер OpenAI-совместим, поэтому берём готовый SDK `openai` и
// просто указываем ему другой baseURL/ключ.
//
// ⚠️ ПРЕДПОЛОЖЕНИЕ: VIBE_AI_BASE_URL и формат аутентификации ниже не были
// проверены — у автора не было сетевого доступа к vibecode.bitrix24.tech
// (заблокировано политикой песочницы). Судя по остальным эндпоинтам платформы
// (deploy/deploy.sh использует `${API}/infra/...` c заголовком `X-Api-Key`),
// путь роутера, скорее всего, `${API}/ai`, а сам роутер — OpenAI-совместимый
// `/chat/completions`. Если запросы будут падать (404/401) — проверь
// настоящий путь и заголовок авторизации в личном кабинете VibeCode
// (документация: https://vibecode.bitrix24.tech/v1/me) и поправь
// VIBE_AI_BASE_URL / заголовок ниже.

import OpenAI from "openai";

const SYSTEM_PROMPT = `You are an expert editorial reviewer for Bitrix24's multilingual content team.

You will receive two texts:
1. AI DRAFT — the original AI-generated article
2. FINAL TEXT — the editor's revised version

Evaluate the FINAL TEXT against these criteria (score each 0-10):

1. real_world_expertise — Does it contain specific real-world scenarios, failure cases, concrete numbers? No generic statements.
2. ai_sterility — Are AI clichés removed? ("it is important to understand", "in today's world", "it is worth noting", etc.)
3. bitrix24_integration — Is Bitrix24 mentioned naturally and specifically? Not just named, but shown in context (where to click, what it does, what the team gets).
4. operational_context — Does it answer: who does this, how often, how long does it take?
5. readability — Is the flow natural? No awkward transitions, no filler paragraphs.
6. fact_check — Are all statistics and claims either sourced or removed?
7. links_quality — Are external links present and relevant?

Also return:
- overall_score (0-100)
- grade (A / B+ / B / B- / C / D)
- verdict: "ready" or "not_ready"
- verdict_text: one sentence why
- red_flags: array of critical issues (max 4)
- notes: array of specific comments (max 5), each with:
  - type: "rm" | "add" | "fix"
  - label: "Убрать" | "Добавить" | "Улучшить"
  - quote: the exact fragment from the text (max 30 words)
  - comment: what to do with it (in Russian)
- top_edits: array of top 3 things the editor improved vs the draft, each with:
  - title: short name
  - before: fragment from draft
  - after: fragment from final
  - why: why it's better

Respond ONLY with valid JSON, no markdown, no preamble.`;

const CRITERIA_KEYS = [
  "real_world_expertise",
  "ai_sterility",
  "bitrix24_integration",
  "operational_context",
  "readability",
  "fact_check",
  "links_quality",
];

const NOTE_LABELS = { rm: "Убрать", add: "Добавить", fix: "Улучшить" };

function extractJson(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

function normalize(parsed) {
  const scores = {};
  for (const key of CRITERIA_KEYS) {
    scores[key] = Number(parsed[key]) || 0;
  }
  return {
    overall_score: Number(parsed.overall_score) || 0,
    grade: parsed.grade || "",
    verdict: parsed.verdict === "ready" ? "ready" : "not_ready",
    verdict_text: parsed.verdict_text || "",
    scores,
    red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.slice(0, 4) : [],
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.slice(0, 5).map((n) => ({
          type: n.type,
          label: n.label || NOTE_LABELS[n.type] || "",
          quote: n.quote || "",
          comment: n.comment || "",
        }))
      : [],
    top_edits: Array.isArray(parsed.top_edits)
      ? parsed.top_edits.slice(0, 3).map((e) => ({
          title: e.title || "",
          before: e.before || "",
          after: e.after || "",
          why: e.why || "",
        }))
      : [],
  };
}

let client;
function getClient() {
  if (!client) {
    const baseURL = process.env.VIBE_AI_BASE_URL || "https://vibecode.bitrix24.tech/v1/ai";
    client = new OpenAI({
      apiKey: process.env.VIBE_KEY || "vibecode",
      baseURL,
      // Шлём ключ и как Bearer (стандарт для OpenAI SDK), и как X-Api-Key
      // (формат остальных эндпоинтов VibeCode) — на случай, если роутер
      // ожидает именно его.
      defaultHeaders: { "X-Api-Key": process.env.VIBE_KEY || "" },
      // Ретраи делаем сами (см. callWithRetry) — со своим количеством попыток
      // и паузой, а не встроенным поведением SDK.
      maxRetries: 0,
    });
  }
  return client;
}

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function callWithRetry(fn) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (e?.status !== 502 || attempt === RETRY_ATTEMPTS) throw e;
      console.warn(`AI Router вернул 502, попытка ${attempt}/${RETRY_ATTEMPTS}, повтор через ${RETRY_DELAY_MS}мс…`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

export async function analyzeArticle({ draftText, finalText, language }) {
  const model = process.env.VIBE_AI_MODEL || "bitrix/bitrixgpt-5.5";
  const userMessage = `Target language of the FINAL TEXT: ${language}

AI DRAFT:
"""
${draftText}
"""

FINAL TEXT:
"""
${finalText}
"""`;

  const response = await callWithRetry(() =>
    getClient().chat.completions.create({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    })
  );

  const text = response.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("AI Router не вернул текстовый ответ");
  }
  const parsed = extractJson(text);
  return normalize(parsed);
}
