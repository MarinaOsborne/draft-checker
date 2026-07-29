import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { listArticles, getArticleById, getDocContent } from "../lib/googleClient.js";
import { withTimeout } from "../lib/withTimeout.js";
import { LANGS } from "../lib/constants.js";

const router = Router();

// One sheet, one tab per language (GOOGLE_SHEET_RANGE used to be a single
// static "A:Z"-style env var, which meant every language read the same
// tab) — the client now sends the language it has selected in the UI, and
// googleClient.js builds the range from it (`${tab}!A:Z`, see
// sheetTabForLanguage).
function validLanguage(req, res) {
  const { language } = req.query;
  if (!language || !LANGS.includes(language)) {
    res.status(400).json({ error: "language обязателен и должен быть одним из поддерживаемых кодов", code: "bad_request" });
    return null;
  }
  return language;
}

// Whole-route deadline — deliberately separate from GOOGLE_API_TIMEOUT_MS in
// googleClient.js, which only bounds one individual Google API call at a
// time. GET /article-list/:id/content below makes two such calls *sequentially*
// (find the row, then fetch the two docs), so bounding each call alone still
// let worst-case total time add up past the VibeCode gateway's own (~10s,
// per production observation) cutoff — the client would see the gateway's
// bare, generic 502/503 instead of our translated error. This wraps the
// ENTIRE handler body in one deadline instead, regardless of how many Google
// API calls happen inside or whether they're sequential or parallel.
const ROUTE_TIMEOUT_MS = 9000;

// Every error response below uses status 500, not 502/503 — confirmed on
// the deployed app (curl -v) that VibeCode's nginx intercepts responses
// with status 502 specifically: it rewrites the status to 503 and the
// Content-Type to text/html, but does NOT actually deliver a body — it
// keeps the original (correct) Content-Length header from our real
// response while sending zero bytes of content, so the client sees a
// truncated transfer (curl: "end of response with N bytes missing")
// instead of our JSON error. The exact same 500 response (from a
// malformed-JSON body-parser error) was confirmed to pass through this
// same nginx completely intact. The frontend (src/api.js) already reads
// the error `code` from the JSON body, not the raw HTTP status, so this
// has no effect on user-facing behavior beyond actually delivering the body.
router.get("/article-list", requirePin, async (req, res) => {
  const language = validLanguage(req, res);
  if (!language) return;
  try {
    const articles = await withTimeout(
      listArticles(language),
      ROUTE_TIMEOUT_MS,
      `Article list route timeout after ${ROUTE_TIMEOUT_MS}ms`
    );
    res.json({ articles: articles.map(({ id, title }) => ({ id, title })) });
  } catch (e) {
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    // TEMPORARY DEBUG — remove `debug` field once the real cause behind
    // sheet_unavailable is confirmed; no server-side log access in
    // production, so this is the only way to see e.message right now.
    res.status(500).json({
      error: "Не удалось получить список статей из Google Таблицы",
      code: "sheet_unavailable",
      debug: e.message,
    });
  }
});

router.get("/article-list/:id/content", requirePin, async (req, res) => {
  const { id } = req.params;
  const language = validLanguage(req, res);
  if (!language) return;
  // Tracks which phase was in flight if the outer deadline fires, so a
  // timeout during either phase still gets the same specific error code
  // (sheet_unavailable / docs_unavailable) it would have gotten from that
  // phase's own try/catch before this route-level wrapper existed.
  let phase = "sheet";
  try {
    const result = await withTimeout(
      (async () => {
        const article = await getArticleById(id, language);
        if (!article) {
          const err = new Error("Статья не найдена");
          err.articleNotFound = true;
          throw err;
        }
        phase = "docs";
        const [draft, final] = await Promise.all([getDocContent(article.draftDocId), getDocContent(article.finalDocId)]);
        return { id: article.id, title: article.title, draft, final };
      })(),
      ROUTE_TIMEOUT_MS,
      `Article content route timeout after ${ROUTE_TIMEOUT_MS}ms`
    );
    res.json(result);
  } catch (e) {
    if (e.articleNotFound) {
      return res.status(404).json({ error: "Статья не найдена", code: "article_not_found" });
    }
    if (phase === "docs") {
      console.error("Не удалось получить содержимое документов Google Docs:", e.message);
      return res.status(500).json({ error: "Не удалось получить содержимое документов Google Docs", code: "docs_unavailable" });
    }
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    res.status(500).json({ error: "Не удалось получить список статей из Google Таблицы", code: "sheet_unavailable" });
  }
});

export default router;
