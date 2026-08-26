import { Router } from "express";

// Diagnostic-only route: isolates whether a BRAND NEW path (added and
// deployed after the app slot's initial creation) reaches this Express
// process at all, independent of anything Google-related — /api/articles
// was seen returning a static, cached-looking 503 from the platform's own
// nginx/edge layer while older routes worked fine. No pin required, on
// purpose, so it's a single plain `curl` with no headers. Safe to delete
// once that platform-routing question is settled.
const router = Router();

router.get("/ping-test", (req, res) => {
  res.json({ ok: true });
});

export default router;
