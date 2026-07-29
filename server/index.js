import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import pinRoutes from "./routes/pin.js";
import parseRoutes from "./routes/parse.js";
import articlesRoutes from "./routes/articles.js";
import runsRoutes from "./routes/runs.js";
import analyzeRoutes from "./routes/analyze.js";
import healthRoutes from "./routes/health.js";
import adminRoutes from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

app.use("/api", pinRoutes);
app.use("/api", parseRoutes);
app.use("/api", articlesRoutes);
app.use("/api", runsRoutes);
app.use("/api", analyzeRoutes);
app.use("/api", healthRoutes);
app.use(adminRoutes);

app.use(express.static(DIST_DIR));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

// Безопасная сеть: любая ошибка, не пойманная внутри роута (например, JSON
// body-parser не смог разобрать вход), должна вернуть JSON, а не уронить
// процесс и не отдать HTML-страницу ошибки, которую фронтенд не сможет распарсить.
app.use((err, req, res, next) => {
  console.error("Unhandled request error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Внутренняя ошибка сервера", code: "internal_error" });
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled promise rejection:", err);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Article Quality Checker listening on port ${PORT}`);
  const key = process.env.VIBE_KEY || "";
  console.log(key ? `VIBE_KEY: set (${key.slice(0, 8)}…, length ${key.length})` : "VIBE_KEY: NOT SET");
});
