import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import {
  getRuns,
  incrementRuns,
  getMonthlyRuns,
  incrementMonthlyRuns,
  nextMonthlyResetDate,
  saveAnalysisRecord,
} from "../lib/store.js";
import { analyzeArticle } from "../lib/vibeAiClient.js";
import { logAnalysis } from "../lib/analyticsStore.js";
import { MAX_RUNS, MAX_MONTHLY_RUNS } from "../lib/constants.js";

const router = Router();

router.post("/analyze", requirePin, async (req, res) => {
  const { draftText, finalText, language, finalFilename, draftLinks, finalLinks } = req.body || {};
  let username = "";
  try {
    username = decodeURIComponent(req.headers["x-username"] || "").trim();
  } catch {
    username = "";
  }
  if (!draftText || !finalText || !language || !finalFilename || !username) {
    return res.status(400).json({
      error: "draftText, finalText, language, finalFilename и имя пользователя обязательны",
      code: "bad_request",
    });
  }

  const monthlyRuns = await getMonthlyRuns();
  if (monthlyRuns >= MAX_MONTHLY_RUNS) {
    return res.status(429).json({
      error: "Monthly limit reached",
      code: "monthly_limit_exceeded",
      resetDate: nextMonthlyResetDate(),
    });
  }

  const currentRuns = await getRuns(language, finalFilename);
  if (currentRuns >= MAX_RUNS) {
    return res.status(429).json({
      error: "Лимит прогонов исчерпан. Обратитесь к менеджеру для сброса.",
      code: "limit_exceeded",
    });
  }

  // Платформа (гейтвей VibeCode) может оборвать соединение с браузером по
  // тайм-ауту раньше, чем этот запрос успеет завершиться (особенно с учётом
  // ретраев ниже) — пользователь увидит 503, а Node-процесс тем временем
  // доработает и получит успешный ответ от AI Router. Раньше в этот момент
  // прогон всё равно списывался, хотя клиент уже не получил результат.
  // Флаг ниже отслеживает обрыв именно СЕТЕВОГО соединения (res.on("close")
  // срабатывает, когда сокет закрылся раньше, чем res.end()/res.json()
  // успел записать ответ) — и мы пропускаем increment, если клиент уже
  // отключился. req.on("close") здесь НЕ работает так же надёжно — было
  // проверено на практике (тестовый запрос с обрывом соединения всё равно
  // списывал прогон, пока не заменили на res.on("close")).
  let clientDisconnected = false;
  res.on("close", () => {
    if (!res.writableEnded) clientDisconnected = true;
  });

  try {
    const { analysis, usage } = await analyzeArticle({
      draftText,
      finalText,
      language,
      draftLinks: Array.isArray(draftLinks) ? draftLinks : [],
      finalLinks: Array.isArray(finalLinks) ? finalLinks : [],
    });
    if (clientDisconnected) {
      console.warn("Клиент отключился до получения ответа — прогон не списан.");
      return;
    }
    const runsCount = await incrementRuns(language, finalFilename);
    const monthlyRunsCount = await incrementMonthlyRuns();

    try {
      await saveAnalysisRecord({
        timestamp: new Date().toISOString(),
        language,
        draftText,
        finalText,
        verdict: analysis.verdict,
        finalScore: analysis.final_article_quality,
        draftScore: analysis.ai_draft_quality,
        // Обоснования, которые модель обязана давать под каждый холистический
        // балл (см. system-промпт в vibeAiClient.js) — раньше терялись
        // (печатались только в консоль сервера, к которой нет доступа на
        // платформе). Без них нельзя было проверить, реально ли модель
        // сопоставила счёт с текстом или "заякорилась" на правдоподобном
        // числе — см. жалобу "+14 при изменении одного слова".
        draftScoreReasoning: analysis.ai_draft_quality_reasoning || "",
        finalScoreReasoning: analysis.final_article_quality_reasoning || "",
        runNumber: runsCount,
        hva: {
          stats: analysis.human_value_added.statistics_added,
          examples: analysis.human_value_added.real_world_examples_added,
          bitrix: analysis.human_value_added.bitrix24_integrations_added,
          cliches: analysis.human_value_added.ai_cliches_removed,
          filler: analysis.human_value_added.filler_sentences_removed,
        },
        bestEdits: analysis.top_edits,
        unnecessaryRewrites: analysis.unnecessary_rewrites,
      });
    } catch (e) {
      // Не роняем прогон редактора из-за ошибки записи лога — только логируем.
      console.error("Не удалось сохранить запись в data/analysis-log.jsonl:", e);
    }

    await logAnalysis({
      username,
      language,
      filename: finalFilename,
      tokens: usage.total_tokens,
      verdict: analysis.verdict,
      draftScore: analysis.ai_draft_quality,
      finalScore: analysis.final_article_quality,
      draftScoreReasoning: analysis.ai_draft_quality_reasoning,
      finalScoreReasoning: analysis.final_article_quality_reasoning,
      runNumber: runsCount,
      hva: analysis.human_value_added,
      topEdits: analysis.top_edits,
    });
    res.json({ result: analysis, runsCount, monthlyRunsCount });
  } catch (e) {
    console.error("AI Router analyze failed:", e.status || "", e.message, e.error || "");
    // Прогон НЕ списывается — increment выше выполняется только при успехе.
    // Статус намеренно 500, не 502/503 — см. комментарий в articles.js:
    // на проде подтверждено (curl -v), что VibeCode nginx перехватывает
    // именно 502 от апстрима (переписывает статус на 503 и обрывает тело,
    // не досылая заявленный Content-Length), тогда как 500 проходит
    // насквозь без изменений. Фронтенд всё равно берёт код ошибки из
    // тела (body.code), а не из HTTP-статуса, так что на поведении для
    // пользователя это никак не сказывается — только чинит доставку тела.
    if (e.status === 502) {
      res.status(500).json({ error: "AI Router is not responding", code: "ai_unavailable" });
    } else {
      res.status(500).json({ error: "Не удалось получить оценку от AI Router VibeCode", code: "analyze_failed" });
    }
  }
});

export default router;
