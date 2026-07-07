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

const LANGUAGE_NAMES = {
  EN: "English",
  ES: "Spanish",
  BR: "Brazilian Portuguese",
  DE: "German",
  FR: "French",
  TR: "Turkish",
  PL: "Polish",
  VN: "Vietnamese",
};

const SYSTEM_PROMPT = `You are an expert editorial reviewer for Bitrix24's multilingual content team.

You will receive two texts:
1. AI DRAFT — the original AI-generated article
2. FINAL TEXT — the editor's revised version

## Human Value Added (the primary metric)

The main question is NOT "is this text good in isolation" but "how much value did the human editor add on top of the AI draft". Compare FINAL TEXT against AI DRAFT and count, as concrete integers:
- statistics_added — new statistics/numbers the editor introduced that were not in the draft
- real_world_examples_added — new concrete real-world scenarios, case studies, or failure examples the editor introduced
- bitrix24_integrations_added — new specific, contextual mentions of Bitrix24 the editor introduced (where to click, what it does, what the team gets — not just naming the product)
- ai_cliches_removed — AI clichés present in the draft that the editor removed (e.g. "it is important to understand", "in today's fast-paced world", "it is worth noting")
- filler_sentences_removed — filler/generic sentences from the draft the editor removed without replacing them with substantive content

Then write exactly one sentence (human_value_added.summary) characterizing the editor's style/approach based on these numbers. This sentence MUST be written in the target language stated below, not in English (unless that is the target language).

## Per-criterion scoring

Evaluate the FINAL TEXT against these 7 criteria. For EACH one return an object with:
- score (0-10)
- explanation — one short sentence (in Russian) stating the single main reason for that score
- evidence — an array of exact short quotes (max 30 words each, at most 4 quotes) copied verbatim from the FINAL TEXT that support the score. For ai_sterility specifically, evidence must be the AI-cliché phrases actually found; if none are found, evidence must be an empty array — do not invent quotes.

1. real_world_expertise — specific real-world scenarios, failure cases, concrete numbers? No generic statements.
2. ai_sterility — are AI clichés removed? ("it is important to understand", "in today's world", "it is worth noting", etc.)
3. bitrix24_integration — is Bitrix24 mentioned naturally and specifically? Not just named, but shown in context.
4. operational_context — does it answer: who does this, how often, how long does it take?
5. readability — is the flow natural? No awkward transitions, no filler paragraphs.
6. fact_check — are all statistics and claims either sourced or removed?
7. links_quality — are external links present and relevant?

## Unnecessary rewrites

Find passages the editor reworded compared to the AI DRAFT WITHOUT adding new information — no new facts, examples, numbers, or Bitrix24 mentions versus the draft's version of that passage (pure paraphrasing). For each one found, record { before: the AI DRAFT fragment, after: the FINAL TEXT fragment, reason: one short phrase in Russian }. List at most 5 in unnecessary_rewrites.examples and put the total count found in unnecessary_rewrites.count (count may exceed the number of examples listed). If none are found, count is 0 and examples is [].

## Also return
- verdict: "ready" or "not_ready"
- verdict_text: one sentence why (in Russian)
- red_flags: array of critical issues (max 4, in Russian)
- notes: array of specific comments (max 5), each with:
  - type: "rm" | "add" | "fix"
  - label: "Убрать" | "Добавить" | "Улучшить"
  - quote: the exact fragment from the text (max 30 words)
  - comment: what to do with it (in Russian)
- top_edits: array of top 3 things the editor improved vs the draft, each with:
  - title: short name (in Russian)
  - before: fragment from draft
  - after: fragment from final
  - why: why it's better (in Russian)

Respond ONLY with valid JSON matching exactly this shape, no markdown, no preamble:
{
  "verdict": "ready" | "not_ready",
  "verdict_text": string,
  "human_value_added": {
    "statistics_added": number,
    "real_world_examples_added": number,
    "bitrix24_integrations_added": number,
    "ai_cliches_removed": number,
    "filler_sentences_removed": number,
    "summary": string
  },
  "criteria": {
    "real_world_expertise": { "score": number, "explanation": string, "evidence": string[] },
    "ai_sterility": { "score": number, "explanation": string, "evidence": string[] },
    "bitrix24_integration": { "score": number, "explanation": string, "evidence": string[] },
    "operational_context": { "score": number, "explanation": string, "evidence": string[] },
    "readability": { "score": number, "explanation": string, "evidence": string[] },
    "fact_check": { "score": number, "explanation": string, "evidence": string[] },
    "links_quality": { "score": number, "explanation": string, "evidence": string[] }
  },
  "unnecessary_rewrites": {
    "count": number,
    "examples": [{ "before": string, "after": string, "reason": string }]
  },
  "red_flags": string[],
  "notes": [{ "type": string, "label": string, "quote": string, "comment": string }],
  "top_edits": [{ "title": string, "before": string, "after": string, "why": string }]
}`;

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

function normalizeCount(n) {
  return Math.max(0, Math.round(Number(n)) || 0);
}

function normalize(parsed) {
  const rawCriteria = parsed.criteria || {};
  const criteria = {};
  for (const key of CRITERIA_KEYS) {
    const c = rawCriteria[key] || {};
    criteria[key] = {
      score: Number(c.score) || 0,
      explanation: c.explanation || "",
      evidence: Array.isArray(c.evidence) ? c.evidence.slice(0, 4).filter(Boolean) : [],
    };
  }

  const hva = parsed.human_value_added || {};
  const rewrites = parsed.unnecessary_rewrites || {};

  return {
    verdict: parsed.verdict === "ready" ? "ready" : "not_ready",
    verdict_text: parsed.verdict_text || "",
    human_value_added: {
      statistics_added: normalizeCount(hva.statistics_added),
      real_world_examples_added: normalizeCount(hva.real_world_examples_added),
      bitrix24_integrations_added: normalizeCount(hva.bitrix24_integrations_added),
      ai_cliches_removed: normalizeCount(hva.ai_cliches_removed),
      filler_sentences_removed: normalizeCount(hva.filler_sentences_removed),
      summary: hva.summary || "",
    },
    criteria,
    unnecessary_rewrites: {
      count: normalizeCount(rewrites.count),
      examples: Array.isArray(rewrites.examples)
        ? rewrites.examples.slice(0, 5).map((r) => ({
            before: r.before || "",
            after: r.after || "",
            reason: r.reason || "",
          }))
        : [],
    },
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
  const languageName = LANGUAGE_NAMES[language] || language;
  const userMessage = `Target language of the FINAL TEXT: ${languageName} (code: ${language})
Write human_value_added.summary in ${languageName}.

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
