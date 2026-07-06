import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

import pinRoutes from "./routes/pin.js";
import parseRoutes from "./routes/parse.js";
import runsRoutes from "./routes/runs.js";
import analyzeRoutes from "./routes/analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "..", "dist");

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "5mb" }));

app.use("/api", pinRoutes);
app.use("/api", parseRoutes);
app.use("/api", runsRoutes);
app.use("/api", analyzeRoutes);

app.use(express.static(DIST_DIR));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Article Quality Checker listening on port ${PORT}`);
});
