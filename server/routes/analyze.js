import { Router } from "express";
import { randomUUID } from "crypto";
import { requirePin } from "../middleware/requirePin.js";
import { getRuns, incrementRuns, getMonthlyRuns, incrementMonthlyRuns, nextMonthlyResetDate, saveAnalysisRecord } from "../lib/store.js";
import { analyzeArticle } from "../lib/vibeAiClient.js";
import { logAnalysis } from "../lib/analyticsStore.js";
import { logDiagnostic } from "../lib/diagnosticsStore.js";
import {
  fingerprintFor,
  claimOrGetExisting,
  releaseLock,
  createPendingJob,
  writeJobDone,
  writeJobError,
  getJob,
  pruneOldJobs,
} from "../lib/jobsStore.js";
import { MAX_RUNS, MAX_MONTHLY_RUNS } from "../lib/constants.js";

const router = Router();

// Потолок одновременно выполняющихся заданий НА ЭТОТ ПРОЦЕСС — защищает и
// сам процесс, и (косвенно) AI Router от всплеска нагрузки. Если окажется,
// что VibeCode всё же поднимает несколько экземпляров, каждый считает
// независимо — реальный потолок может быть выше в N раз; для внутреннего
// инструмента на несколько редакторов это приемлемо (см. задачу).
const MAX_CONCURRENT_JOBS = 5;
let activeJobCount = 0;

// Разовая уборка старых заданий/протухших блокировок — не завязана на то,
// заходит ли кто-то в /admin, иначе data/jobs росла бы без присмотра, пока
// никто не анализирует статьи.
setInterval(() => {
  pruneOldJobs().catch((e) => console.error("pruneOldJobs упал (не критично):", e));
}, 30 * 60 * 1000).unref();

const ERROR_MESSAGES = {
  ai_unavailable: "AI Router is not responding",
  analyze_failed: "Не удалось получить оценку от AI Router VibeCode",
};

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

  if (activeJobCount >= MAX_CONCURRENT_JOBS) {
    return res.status(429).json({
      error: "Сервер сейчас обрабатывает максимум одновременных анализов. Попробуйте через минуту.",
      code: "server_busy",
    });
  }
  // Резервируем место СРАЗУ, синхронно с проверкой выше (между ними нет ни
  // одного await) — иначе несколько параллельных запросов могут пройти
  // проверку одновременно, пока ни один ещё не успел увеличить счётчик
  // (это реальная гонка, найдена и исправлена при тестировании: await'ы
  // ниже — claimOrGetExisting/createPendingJob — дают возможность другим
  // запросам вклиниться, если инкремент стоит после них). Если в итоге
  // настоящее фоновое задание не запускается (см. return'ы ниже) —
  // немедленно освобождаем резерв.
  activeJobCount += 1;

  // Дедуп: одинаковый черновик+финал+язык+файл+пользователь, пока предыдущее
  // задание ещё активно — получает ТОТ ЖЕ jobId, а не второе задание (см.
  // задачу, требование 5). Как только задание завершится (успехом или
  // ошибкой) и освободит блокировку, то же самое содержимое можно запускать
  // заново как совершенно новое задание — дедуп не постоянный, а только на
  // время реальной работы.
  const fingerprint = fingerprintFor({ username, language, finalFilename, draftText, finalText });
  const claim = await claimOrGetExisting(fingerprint);
  if (!claim.jobId) {
    activeJobCount -= 1;
    return res.status(429).json({ error: "Повторите запрос через несколько секунд.", code: "server_busy" });
  }
  if (!claim.claimed) {
    activeJobCount -= 1;
    return res.json({ jobId: claim.jobId });
  }

  const jobId = claim.jobId;
  const requestId = randomUUID();
  const draftWords = draftText.trim() ? draftText.trim().split(/\s+/).length : 0;
  const finalWords = finalText.trim() ? finalText.trim().split(/\s+/).length : 0;

  await createPendingJob(jobId, { username, language, finalFilename });
  res.json({ jobId });

  runAnalysisJob({
    jobId,
    fingerprint,
    requestId,
    draftText,
    finalText,
    language,
    finalFilename,
    draftLinks: Array.isArray(draftLinks) ? draftLinks : [],
    finalLinks: Array.isArray(finalLinks) ? finalLinks : [],
    username,
    draftWords,
    finalWords,
  }).finally(() => {
    activeJobCount -= 1;
  });
});

// Тело — та же самая логика, что раньше была синхронной частью этого
// хендлера (вызов analyzeArticle + списание прогона + сохранение
// статистики), просто теперь не блокирует HTTP-ответ: клиент уже получил
// jobId и узнаёт результат через GET /api/analyze/:jobId.
async function runAnalysisJob({
  jobId,
  fingerprint,
  requestId,
  draftText,
  finalText,
  language,
  finalFilename,
  draftLinks,
  finalLinks,
  username,
  draftWords,
  finalWords,
}) {
  const handlerStartedAt = Date.now();
  let modelSucceeded = false;
  try {
    const { analysis, usage } = await analyzeArticle({ draftText, finalText, language, draftLinks, finalLinks, requestId });
    modelSucceeded = true;
    console.log(`[analyze] job=${jobId} stage=model_succeeded at +${Date.now() - handlerStartedAt}мс`);

    // ВАЖНО по порядку (см. задачу, требование 2): сначала пишем готовый
    // результат в файл задания, и только ПОСЛЕ этого списываем попытку.
    // Если процесс упадёт между этими двумя шагами — отчёт уже на диске
    // (пользователь его получит), максимум не спишется попытка за этот
    // прогон. Абсолютной гарантии ровно одного списания без транзакционного
    // хранилища дать нельзя — см. ограничения в итоговом отчёте; но
    // "недосписанная попытка" безвредна, а именно обратного ("списано, но
    // отчёта нет") эта последовательность и призвана избежать.
    await writeJobDone(jobId, analysis);

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
      console.error("Не удалось сохранить запись в data/analysis-log.jsonl:", e);
      await logDiagnostic({
        stage: "save_analysis_record",
        outcome: "error",
        modelResponded: true,
        errorType: e?.constructor?.name || e?.name || "Error",
        language,
        username,
        requestId,
        draftWords,
        finalWords,
      });
    }

    try {
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
    } catch (e) {
      console.error("Не удалось сохранить запись в data/analytics.json:", e);
      await logDiagnostic({
        stage: "log_analysis",
        outcome: "error",
        modelResponded: true,
        errorType: e?.constructor?.name || e?.name || "Error",
        language,
        username,
        requestId,
        draftWords,
        finalWords,
      });
    }

    console.log(`[analyze] job=${jobId} stage=job_done at +${Date.now() - handlerStartedAt}мс`);
    await logDiagnostic({
      stage: "request",
      outcome: "ok",
      durationMs: Date.now() - handlerStartedAt,
      modelResponded: true,
      language,
      username,
      requestId,
      draftWords,
      finalWords,
    });
  } catch (e) {
    const durationMs = Date.now() - handlerStartedAt;
    console.error(
      `[analyze] job=${jobId} stage=job_failed at +${durationMs}мс — modelSucceeded=${modelSucceeded} ` +
        `(true означает, что AI Router уже успешно ответил, и сбой — в учёте прогона/логировании, не в самой модели)`
    );
    console.error("AI Router analyze failed:", e.status || "", e.message, e.error || "");
    // Прогон НЕ списывается — increment выше выполняется только при успехе.
    const errorCode = e.status === 502 ? "ai_unavailable" : "analyze_failed";
    await writeJobError(jobId, errorCode);
    await logDiagnostic({
      stage: "request",
      outcome: "error",
      durationMs,
      httpStatus: e?.status ?? null,
      errorType: e?.constructor?.name || e?.name || "Error",
      modelResponded: modelSucceeded,
      language,
      username,
      requestId,
      draftWords,
      finalWords,
    });
  } finally {
    await releaseLock(fingerprint).catch((e) => console.error("releaseLock упал (не критично):", e));
  }
}

router.get("/analyze/:jobId", requirePin, async (req, res) => {
  let username = "";
  try {
    username = decodeURIComponent(req.headers["x-username"] || "").trim();
  } catch {
    username = "";
  }

  const job = await getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Задание не найдено", code: "job_not_found" });
  }
  // Мягкая защита от случайного доступа к чужому отчёту — НЕ полноценная
  // авторизация (X-Username полностью подделываем клиентом, как и везде в
  // этом приложении, см. CLAUDE.md). Реальный барьер — непредсказуемость
  // самого jobId (случайный UUID).
  if (job.username && username && job.username !== username) {
    return res.status(404).json({ error: "Задание не найдено", code: "job_not_found" });
  }

  if (job.status === "pending") {
    return res.json({ status: "pending" });
  }
  if (job.status === "lost") {
    return res.json({
      status: "lost",
      error: "Не удалось дождаться ответа — попробуйте запустить анализ заново.",
      code: "job_lost",
    });
  }
  if (job.status === "error") {
    return res.json({
      status: "error",
      error: ERROR_MESSAGES[job.errorCode] || ERROR_MESSAGES.analyze_failed,
      code: job.errorCode || "analyze_failed",
    });
  }

  const runsCount = await getRuns(job.language, job.finalFilename);
  const monthlyRunsCount = await getMonthlyRuns();
  return res.json({ status: "done", result: job.result, runsCount, monthlyRunsCount });
});

export default router;
