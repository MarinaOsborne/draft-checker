import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import { requirePin } from "../middleware/requirePin.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router();

router.post("/parse", requirePin, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Файл не передан", code: "no_file" });
  }
  if (!req.file.originalname.toLowerCase().endsWith(".docx")) {
    return res.status(400).json({ error: "Поддерживаются только .docx файлы", code: "bad_format" });
  }
  try {
    const { value: text } = await mammoth.extractRawText({ buffer: req.file.buffer });
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    res.json({ text, wordCount, filename: req.file.originalname });
  } catch (e) {
    res.status(500).json({ error: "Не удалось разобрать файл", code: "parse_failed" });
  }
});

export default router;
