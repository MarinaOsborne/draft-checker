import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { getRuns, incrementRuns, getMonthlyRuns, incrementMonthlyRuns, nextMonthlyResetDate } from "../lib/store.js";
import { analyzeArticle } from "../lib/vibeAiClient.js";
import { MAX_RUNS, MAX_MONTHLY_RUNS } from "../lib/constants.js";

const router = Router();

router.post("/analyze", requirePin, async (req, res) => {
  const { draftText, finalText, language, finalFilename, draftLinks, finalLinks } = req.body || {};
  if (!draftText || !finalText || !language || !finalFilename) {
    return res.status(400).json({
      error: "draftText, finalText, language и finalFilename обязательны",
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

  try {
    const result = await analyzeArticle({
      draftText,
      finalText,
      language,
      draftLinks: Array.isArray(draftLinks) ? draftLinks : [],
      finalLinks: Array.isArray(finalLinks) ? finalLinks : [],
    });
    const runsCount = await incrementRuns(language, finalFilename);
    const monthlyRunsCount = await incrementMonthlyRuns();
    res.json({ result, runsCount, monthlyRunsCount });
  } catch (e) {
    console.error("AI Router analyze failed:", e.status || "", e.message, e.error || "");
    // Прогон НЕ списывается — increment выше выполняется только при успехе.
    if (e.status === 502) {
      res.status(502).json({ error: "AI Router is not responding", code: "ai_unavailable" });
    } else {
      res.status(502).json({ error: "Не удалось получить оценку от AI Router VibeCode", code: "analyze_failed" });
    }
  }
});

export default router;
