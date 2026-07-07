import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import { requirePin } from "../middleware/requirePin.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router();

// mammoth.extractRawText() drops hyperlinks entirely (only the anchor text
// survives) — convertToHtml() keeps <a href> so we can recover the URLs.
function extractLinks(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const links = [];
  $("a[href]").each((_, el) => {
    const url = $(el).attr("href").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ url, text: $(el).text().trim() });
  });
  return links;
}

router.post("/parse", requirePin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Файл не передан", code: "no_file" });
  }
  if (!req.file.originalname.toLowerCase().endsWith(".docx")) {
    return res.status(400).json({ error: "Поддерживаются только .docx файлы", code: "bad_format" });
  }
  try {
    const { value: text } = await mammoth.extractRawText({ buffer: req.file.buffer });
    const { value: html } = await mammoth.convertToHtml({ buffer: req.file.buffer });
    const links = extractLinks(html);
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    res.json({ text, wordCount, filename: req.file.originalname, links });
  } catch (e) {
    res.status(500).json({ error: "Не удалось разобрать файл", code: "parse_failed" });
  }
});

export default router;
