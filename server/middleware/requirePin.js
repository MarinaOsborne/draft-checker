const ACCESS_PIN = process.env.ACCESS_PIN || "2847";

export function requirePin(req, res, next) {
  if (req.header("X-Access-Pin") !== ACCESS_PIN) {
    return res.status(401).json({ error: "Неверный пин-код", code: "unauthorized" });
  }
  next();
}

export { ACCESS_PIN };
