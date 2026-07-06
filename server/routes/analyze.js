import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { getRuns, incrementRuns } from "../lib/store.js";
import { analyzeArticle } from "../lib/openaiClient.js";
import { MAX_RUNS } from "../lib/constants.js";

const router = Router();

router.post("/analyze", requirePin, async (req, res) => {
  const { draftText, finalText, language, finalFilename } = req.body || {};
  if (!draftText || !finalText || !language || !finalFilename) {
    return res.status(400).json({
      error: "draftText, finalText, language и finalFilename обязательны",
      code: "bad_request",
    });
  }

  const currentRuns = await getRuns(language, finalFilename);
  if (currentRuns >= MAX_RUNS) {
    return res.status(429).json({
      error: "Лимит прогонов исчерпан. Обратитесь к Marina для сброса.",
      code: "limit_exceeded",
    });
  }

  try {
    const result = await analyzeArticle({ draftText, finalText, language });
    const runsCount = await incrementRuns(language, finalFilename);
    res.json({ result, runsCount });
  } catch (e) {
    console.error("OpenAI analyze failed:", e);
    res.status(502).json({ error: "Не удалось получить оценку от OpenAI", code: "analyze_failed" });
  }
});

export default router;
