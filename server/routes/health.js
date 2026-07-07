import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    openai: process.env.OPENAI_API_KEY ? "set" : "not set",
  });
});

export default router;
