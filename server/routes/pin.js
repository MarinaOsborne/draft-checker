import { Router } from "express";
import { ACCESS_PIN } from "../middleware/requirePin.js";

const router = Router();

const attempts = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

router.post("/verify-pin", (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) {
    return res.status(429).json({ error: "Слишком много попыток, попробуйте позже", code: "rate_limited" });
  }
  const { pin } = req.body || {};
  if (pin === ACCESS_PIN) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Неверный пин-код", code: "unauthorized" });
});

export default router;
