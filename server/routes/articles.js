import { Router } from "express";
import { requirePin } from "../middleware/requirePin.js";
import { listArticles, getArticleById, getDocContent } from "../lib/googleClient.js";

const router = Router();

router.get("/articles", requirePin, async (req, res) => {
  try {
    const articles = await listArticles();
    res.json({ articles: articles.map(({ id, title }) => ({ id, title })) });
  } catch (e) {
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    res.status(502).json({ error: "Не удалось получить список статей из Google Таблицы", code: "sheet_unavailable" });
  }
});

router.get("/articles/:id/content", requirePin, async (req, res) => {
  const { id } = req.params;
  let article;
  try {
    article = await getArticleById(id);
  } catch (e) {
    console.error("Не удалось получить список статей из Google Таблицы:", e.message);
    return res.status(502).json({ error: "Не удалось получить список статей из Google Таблицы", code: "sheet_unavailable" });
  }
  if (!article) {
    return res.status(404).json({ error: "Статья не найдена", code: "article_not_found" });
  }
  try {
    const [draft, final] = await Promise.all([getDocContent(article.draftDocId), getDocContent(article.finalDocId)]);
    res.json({ id: article.id, title: article.title, draft, final });
  } catch (e) {
    console.error("Не удалось получить содержимое документов Google Docs:", e.message);
    res.status(502).json({ error: "Не удалось получить содержимое документов Google Docs", code: "docs_unavailable" });
  }
});

export default router;
