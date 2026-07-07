import { Router } from "express";
import { testConnection } from "../lib/openaiClient.js";

const router = Router();

router.get("/health", async (req, res) => {
  const openaiTest = await testConnection();
  res.json({
    status: "ok",
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    openai: process.env.OPENAI_API_KEY ? "set" : "not set",
    openaiTest,
  });
});

export default router;
