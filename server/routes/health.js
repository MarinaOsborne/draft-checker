import { Router } from "express";
import { testConnection } from "../lib/vibeAiClient.js";
import { getGitCommit } from "../lib/version.js";

const router = Router();

router.get("/health", async (req, res) => {
  const aiTest = await testConnection();
  res.json({
    status: "ok",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    vibeKey: process.env.VIBE_KEY ? "set" : "not set",
    gitCommit: getGitCommit(),
    aiTest,
  });
});

export default router;
