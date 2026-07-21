// Вызывает модель через AI Router платформы VibeCode (vibecode.bitrix24.tech),
// а не напрямую OpenAI/Anthropic — используется тот же ключ VIBE_KEY, что и
// для деплоя. Роутер OpenAI-совместим, поэтому берём готовый SDK `openai` и
// просто указываем ему другой baseURL/ключ.
//
// Возврат к этому провайдеру: прямой OpenAI не работает с серверов VibeCode
// (403 геоблок по IP), см. диагностику через /api/health.openaiTest в
// истории коммитов перед этим.
//
// ⚠️ ПРЕДПОЛОЖЕНИЕ: VIBE_AI_BASE_URL и формат аутентификации ниже не были
// проверены — у автора не было сетевого доступа к vibecode.bitrx24.tech
// (заблокировано политикой песочницы). Судя по остальным эндпоинтам платформы
// (deploy/deploy.sh использует `${API}/infra/...` c заголовком `X-Api-Key`),
// путь роутера, скорее всего, `${API}/ai`, а сам роутер — OpenAI-совместимый
// `/chat/completions`. Если запросы будут падать (404/401) — проверь
// настоящий путь и заголовок авторизации в личном кабинете VibeCode
// (документация: https://vibecode.bitrix24.tech/v1/me) и поправь
// VIBE_AI_BASE_URL / заголовок ниже. Используй /api/health.aiTest, чтобы
// быстро проверить это без доступа к логам платформы.

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
  IT: "Italian",
};

const SYSTEM_PROMPT = `You are an expert editorial reviewer for Bitrix24's multilingual content team.

You will receive two texts:
1. AI DRAFT — the original AI-generated article
2. FINAL TEXT — the editor's revised version

## Overall quality scores (the primary metric)

Score each version holistically on a 0-100 scale — how good would this article be if published as-is, considering real-world expertise, factual grounding, natural Bitrix24 integration, readability, and absence of AI clichés:
- ai_draft_quality — overall quality of the AI DRAFT alone, judged on its own merits (ignore that it's a draft — score it as if it were the final published text)
- final_article_quality — overall quality of the FINAL TEXT alone, same holistic judgment

These are independent holistic scores, not an average of the per-criterion breakdown below. A final text that meaningfully improved on the draft should score meaningfully higher.

Calibration — DO NOT default to a "safe" middle number regardless of content. Actually read the text and let the score swing across the full range based on what's really there:
- 0-25: generic AI filler, no real expertise, cliché-heavy, could be about any product
- 26-50: some substance but mostly generic, weak or missing examples, noticeable AI patterns
- 51-70: competent and usable but unremarkable — nothing that couldn't be written by a template
- 71-90: specific, concrete, clearly edited by someone who knows the product and audience
- 91-100: exceptional, publication-ready with no notable weaknesses

Before writing the score, write one short sentence (ai_draft_quality_reasoning / final_article_quality_reasoning) citing something SPECIFIC from that version of the text that justifies the number — not a generic statement that could apply to any draft. Two different drafts should essentially never land on the same score unless they are genuinely, specifically comparable in quality.

## Human value added detail (supporting metrics, shown below the main score — not the primary metric)

Compare FINAL TEXT against AI DRAFT and count, as concrete integers:
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
7. links_quality — judge this from the explicit "FINAL TEXT LINKS" list provided below (extracted from the actual hyperlinks in the document), not by scanning the prose for URLs — plain text never contains the underlying href. Are there any links at all, and are they relevant to the surrounding content? If FINAL TEXT LINKS is empty, that itself means no links are present.

## AI Search Readiness (secondary block — evaluates FINAL TEXT only)

Score the FINAL TEXT on how ready it is to be surfaced or quoted by AI search engines and AI assistants. Score each of these 5 criteria 0-10:
1. answer_first_clarity — is the main answer/point given within the first 2-5 paragraphs, making it immediately clear who this is for, when to use it, and why?
2. structure_and_formatting — are headings clear and descriptive? Are there lists, tables, or step-by-step sections where the content calls for them?
3. definitions_and_terminology — are key terms defined at their first mention, rather than assumed as prior knowledge?
4. extractability_and_quotability — are there self-contained passages that could be quoted verbatim, without further editing, as a direct answer?
5. specificity_and_accuracy — are claims specific rather than vague, with caveats and edge cases noted where relevant?

For each of these 5 criteria also write one concrete, actionable recommendation for improving THIS specific text on that criterion — write it even if the score is already high (it is only shown to the user when the total score across all 5 is low). This recommendation MUST be written in the target language stated below, not in English (unless that is the target language).

## Unnecessary rewrites

Find passages the editor reworded compared to the AI DRAFT WITHOUT adding new information — no new facts, examples, numbers, or Bitrix24 mentions versus the draft's version of that passage (pure paraphrasing). For each one found, record { before: the AI DRAFT fragment, after: the FINAL TEXT fragment, reason: one short phrase in Russian }. List at most 5 in unnecessary_rewrites.examples and put the total count found in unnecessary_rewrites.count (count may exceed the number of examples listed). If none are found, count is 0 and examples is [].

## Also return

When deciding verdict, weigh all 7 criteria together — do not let a single
weak criterion (especially links_quality or fact_check when the article
genuinely has no external claims to source) force "not_ready" on its own if
the other 6 criteria are strong. Reflect a low links_quality or fact_check
score in red_flags instead, so the user sees it, without it single-handedly
overriding an otherwise ready article.

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
  "ai_draft_quality": number,
  "ai_draft_quality_reasoning": string,
  "final_article_quality": number,
  "final_article_quality_reasoning": string,
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
  "ai_search_readiness": {
    "answer_first_clarity": { "score": number, "recommendation": string },
    "structure_and_formatting": { "score": number, "recommendation": string },
    "definitions_and_terminology": { "score": number, "recommendation": string },
    "extractability_and_quotability": { "score": number, "recommendation": string },
    "specificity_and_accuracy": { "score": number, "recommendation": string }
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

const AI_SEARCH_KEYS = [
  "answer_first_clarity",
  "structure_and_formatting",
  "definitions_and_terminology",
  "extractability_and_quotability",
  "specificity_and_accuracy",
];

const AI_SEARCH_READINESS_THRESHOLD = 38;

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

function normalizeScore100(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n)) || 0));
}

function normalizeScore10(n) {
  return Math.max(0, Math.min(10, Math.round(Number(n)) || 0));
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

  const rawSearch = parsed.ai_search_readiness || {};
  const searchCriteria = {};
  let searchTotal = 0;
  for (const key of AI_SEARCH_KEYS) {
    const c = rawSearch[key] || {};
    const score = normalizeScore10(c.score);
    searchCriteria[key] = { score, recommendation: c.recommendation || "" };
    searchTotal += score;
  }
  const weakPoints =
    searchTotal < AI_SEARCH_READINESS_THRESHOLD
      ? AI_SEARCH_KEYS.map((key) => ({ key, ...searchCriteria[key] }))
          .sort((a, b) => a.score - b.score)
          .slice(0, 3)
      : [];

  return {
    verdict: parsed.verdict === "ready" ? "ready" : "not_ready",
    verdict_text: parsed.verdict_text || "",
    ai_draft_quality: normalizeScore100(parsed.ai_draft_quality),
    ai_draft_quality_reasoning: parsed.ai_draft_quality_reasoning || "",
    final_article_quality: normalizeScore100(parsed.final_article_quality),
    final_article_quality_reasoning: parsed.final_article_quality_reasoning || "",
    human_value_added: {
      statistics_added: normalizeCount(hva.statistics_added),
      real_world_examples_added: normalizeCount(hva.real_world_examples_added),
      bitrix24_integrations_added: normalizeCount(hva.bitrix24_integrations_added),
      ai_cliches_removed: normalizeCount(hva.ai_cliches_removed),
      filler_sentences_removed: normalizeCount(hva.filler_sentences_removed),
      summary: hva.summary || "",
    },
    criteria,
    ai_search_readiness: {
      criteria: searchCriteria,
      total: searchTotal,
      weak_points: weakPoints,
    },
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

// SDK по умолчанию ждёт ответа до 10 минут — с учётом наших собственных
// ретраев (см. callWithRetry) это могло растягивать один /api/analyze на
// десятки минут, что почти гарантированно упирается в тайм-аут гейтвея
// платформы (гейтвей рвёт соединение с браузером и отдаёт 503, а сервер
// внутри тем временем доводит попытку до конца) — см. также проверку
// clientDisconnected в server/routes/analyze.js.
const REQUEST_TIMEOUT_MS = 45000;

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
      timeout: REQUEST_TIMEOUT_MS,
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

function formatLinks(links) {
  if (!links || links.length === 0) return "(none)";
  return links.map((l) => `- ${l.url}${l.text ? ` (anchor text: "${l.text}")` : ""}`).join("\n");
}

export async function analyzeArticle({ draftText, finalText, language, draftLinks, finalLinks }) {
  const model = process.env.VIBE_AI_MODEL || "bitrix/bitrixgpt-5.5";
  const languageName = LANGUAGE_NAMES[language] || language;
  const userMessage = `Target language of the FINAL TEXT: ${languageName} (code: ${language})
Write human_value_added.summary and all ai_search_readiness recommendations in ${languageName}.

AI DRAFT:
"""
${draftText}
"""

AI DRAFT LINKS (hyperlinks extracted from the .docx, not visible in the text above):
${formatLinks(draftLinks)}

FINAL TEXT:
"""
${finalText}
"""

FINAL TEXT LINKS (hyperlinks extracted from the .docx, not visible in the text above):
${formatLinks(finalLinks)}`;

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
  const analysis = normalize(parsed);
  // Диагностика "подозрительно одинаковых" holistic-оценок (см. историю:
  // жалоба, что ai_draft_quality у разных драфтов выходит одним и тем же
  // числом) — печатаем сырые значения и обоснование модели, чтобы можно
  // было сверить на реальных прогонах, действительно ли модель каждый раз
  // возвращает одно и то же (тогда дело в промпте/модели, а не в коде).
  console.log(
    `[analyze] ai_draft_quality=${analysis.ai_draft_quality} (${analysis.ai_draft_quality_reasoning || "no reasoning"}) ` +
      `final_article_quality=${analysis.final_article_quality} (${analysis.final_article_quality_reasoning || "no reasoning"})`
  );
  return {
    analysis,
    // usage — стандартное OpenAI-совместимое поле; не проверено, что AI
    // Router VibeCode его реально возвращает (см. предупреждение вверху
    // файла) — если нет, logAnalysis запишет tokens: null.
    usage: {
      prompt_tokens: response.usage?.prompt_tokens ?? null,
      completion_tokens: response.usage?.completion_tokens ?? null,
      total_tokens: response.usage?.total_tokens ?? null,
    },
  };
}

const TEST_CONNECTION_TIMEOUT_MS = 8000;

// Диагностический запрос на 1 токен — проверяет, доходят ли запросы с этого
// сервера до AI Router VibeCode (не переиспользует callWithRetry: тут нужен
// быстрый однозначный ответ, а не 3 попытки по 5с).
export async function testConnection() {
  if (!process.env.VIBE_KEY) {
    return { ok: false, error: "VIBE_KEY not set" };
  }
  const model = process.env.VIBE_AI_MODEL || "bitrix/bitrixgpt-5.5";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await getClient().chat.completions.create(
      { model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] },
      { signal: controller.signal }
    );
    return { ok: true, model, ms: Date.now() - startedAt, id: response.id };
  } catch (e) {
    return {
      ok: false,
      model,
      ms: Date.now() - startedAt,
      status: e.status || null,
      error: e.message || String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}
