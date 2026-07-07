import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { getRuns, resetRuns, getMonthlyRuns, nextMonthlyResetDate } from "../lib/store.js";
import { MAX_MONTHLY_RUNS } from "../lib/constants.js";

const router = Router();

router.get("/runs/monthly", requirePin, async (req, res) => {
  const runs = await getMonthlyRuns();
  res.json({ runs, max: MAX_MONTHLY_RUNS, resetDate: nextMonthlyResetDate() });
});

router.get("/runs", requirePin, async (req, res) => {
  const { language, filename } = req.query;
  if (!language || !filename) {
    return res.status(400).json({ error: "language и filename обязательны", code: "bad_request" });
  }
  const runs = await getRuns(language, filename);
  res.json({ runs });
});

router.post("/runs/reset", requirePin, async (req, res) => {
  const { language, filename } = req.body || {};
  if (!language || !filename) {
    return res.status(400).json({ error: "language и filename обязательны", code: "bad_request" });
  }
  const runs = await resetRuns(language, filename);
  res.json({ runs });
});

export default router;
