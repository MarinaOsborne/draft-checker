import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { getRuns, resetRuns } from "../lib/store.js";

const router = Router();

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
