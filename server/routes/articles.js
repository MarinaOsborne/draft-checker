import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { listArticles, getArticleById, getDocContent } from "../lib/googleClient.js";
import { withTimeout } from "../lib/withTimeout.js";

const router = Router();

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

router.get("/article-list", requirePin, async (req, res) => {
  try {
    const articles = await withTimeout(
      listArticles(),
      ROUTE_TIMEOUT_MS,
      `Article list route timeout after ${ROUTE_TIMEOUT_MS}ms`
    );
    res.json({ articles: articles.map(({ id, title }) => ({ id, title })) });
  } catch (e) {
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    res.status(502).json({ error: "Не удалось получить список статей из Google Таблицы", code: "sheet_unavailable" });
  }
});

router.get("/article-list/:id/content", requirePin, async (req, res) => {
  const { id } = req.params;
  // Tracks which phase was in flight if the outer deadline fires, so a
  // timeout during either phase still gets the same specific error code
  // (sheet_unavailable / docs_unavailable) it would have gotten from that
  // phase's own try/catch before this route-level wrapper existed.
  let phase = "sheet";
  try {
    const result = await withTimeout(
      (async () => {
        const article = await getArticleById(id);
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
      return res.status(502).json({ error: "Не удалось получить содержимое документов Google Docs", code: "docs_unavailable" });
    }
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    res.status(502).json({ error: "Не удалось получить список статей из Google Таблицы", code: "sheet_unavailable" });
  }
});

export default router;
