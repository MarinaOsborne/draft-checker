import { Router } from "express";
import { getAllLogs } from "../lib/analyticsStore.js";

const router = Router();

function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const PAGE_STYLE = `
  body { font-family: system-ui, sans-serif; color: #1a1a1a; }
  table { border-collapse: collapse; font-size: 13px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #eee; text-align: left; }
  th { background: #fafafa; font-weight: 600; }
`;

function passwordForm(wrongPassword) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Admin — Article Quality Checker</title>
<style>
  ${PAGE_STYLE}
  body { display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f5f7fa; }
  form { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 28px 32px; display: flex; flex-direction: column; gap: 14px; width: 260px; }
  input { font-size: 15px; padding: 10px 12px; border-radius: 8px; border: 1px solid #ddd; outline: none; }
  button { background: #1a1a2e; color: #fff; border: none; padding: 10px 0; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .error { color: #a32d2d; font-size: 12px; }
</style></head>
<body>
  <form method="POST" action="/admin/stats">
    <div style="font-weight:600;font-size:14px">Admin — Article Quality Checker</div>
    <input type="password" name="password" placeholder="Admin password" autofocus />
    ${wrongPassword ? '<div class="error">Неверный пароль</div>' : ""}
    <button type="submit">Войти</button>
  </form>
</body></html>`;
}

// То же самое "+20" (Wartość dodana przez człowieka / Human Value Added),
// что видит редактор в интерфейсе: finalScore - draftScore. Не сумма
// счётчиков из блока "Details" — это отдельная, более мелкая метрика.
function scoreDelta(entry) {
  if (!Number.isFinite(entry.finalScore) || !Number.isFinite(entry.draftScore)) return null;
  return entry.finalScore - entry.draftScore;
}

function formatDelta(delta) {
  if (delta === null) return "—";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function statsPage(logs) {
  const byUser = new Map();
  let totalTokens = 0;
  for (const entry of logs) {
    const key = entry.username || "unknown";
    if (!byUser.has(key)) {
      byUser.set(key, {
        count: 0,
        tokens: 0,
        last: entry.timestamp,
        readyCount: 0,
        finalScoreSum: 0,
        finalScoreCount: 0,
        deltaSum: 0,
        deltaCount: 0,
      });
    }
    const u = byUser.get(key);
    u.count += 1;
    u.tokens += Number(entry.tokens) || 0;
    if (entry.timestamp > u.last) u.last = entry.timestamp;
    totalTokens += Number(entry.tokens) || 0;

    if (entry.verdict === "ready") u.readyCount += 1;

    if (Number.isFinite(entry.finalScore)) {
      u.finalScoreSum += entry.finalScore;
      u.finalScoreCount += 1;
    }

    const delta = scoreDelta(entry);
    if (delta !== null) {
      u.deltaSum += delta;
      u.deltaCount += 1;
    }
  }

  const userRows =
    [...byUser.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([name, u]) => {
        const avgFinalScore = u.finalScoreCount > 0 ? (u.finalScoreSum / u.finalScoreCount).toFixed(1) : "—";
        const avgDeltaValue = u.deltaCount > 0 ? Number((u.deltaSum / u.deltaCount).toFixed(1)) : null;
        const avgDelta = avgDeltaValue === null ? "—" : avgDeltaValue > 0 ? `+${avgDeltaValue}` : `${avgDeltaValue}`;
        const readyRate = u.count > 0 ? Math.round((u.readyCount / u.count) * 100) : 0;
        return `<tr><td>${escapeHtml(name)}</td><td>${u.count}</td><td>${u.tokens}</td><td>${avgFinalScore}</td><td>${avgDelta}</td><td>${readyRate}%</td><td>${escapeHtml(u.last)}</td></tr>`;
      })
      .join("") || `<tr><td colspan="7">Нет данных</td></tr>`;

  const recentRows =
    logs
      .slice(-200)
      .reverse()
      .map((e) => {
        const delta = scoreDelta(e);
        const reasoningLines = [
          e.draftScoreReasoning ? `Draft (${e.draftScore ?? "—"}): ${e.draftScoreReasoning}` : "",
          e.finalScoreReasoning ? `Final (${e.finalScore ?? "—"}): ${e.finalScoreReasoning}` : "",
        ].filter(Boolean);
        const tooltip = reasoningLines.length > 0 ? ` title="${escapeHtml(reasoningLines.join("\n"))}"` : "";
        return `<tr><td>${escapeHtml(e.timestamp)}</td><td>${escapeHtml(e.username)}</td><td>${escapeHtml(e.language)}</td><td>${escapeHtml(e.filename)}</td><td${tooltip} style="cursor:${tooltip ? "help" : "default"}">${formatDelta(delta)}</td><td>${e.tokens ?? "—"}</td></tr>`;
      })
      .join("") || `<tr><td colspan="6">Нет данных</td></tr>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Admin stats — Article Quality Checker</title>
<style>
  ${PAGE_STYLE}
  body { padding: 24px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #888; margin-top: 32px; }
  table { width: 100%; margin-top: 10px; }
  .summary { display: flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
  .summary div { background: #fafafa; border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px 18px; }
  .summary b { display: block; font-size: 20px; }
</style></head>
<body>
  <h1>Article Quality Checker — статистика</h1>
  <div class="summary">
    <div><b>${logs.length}</b>всего прогонов</div>
    <div><b>${byUser.size}</b>уникальных пользователей</div>
    <div><b>${totalTokens}</b>токенов суммарно</div>
  </div>

  <h2>По пользователям</h2>
  <table>
    <thead><tr><th>Имя</th><th>Прогонов</th><th>Токенов</th><th>Средний Final Score</th><th>Средний HVA</th><th>Ready %</th><th>Последняя активность</th></tr></thead>
    <tbody>${userRows}</tbody>
  </table>

  <h2>Последние прогоны (до 200)</h2>
  <table>
    <thead><tr><th>Дата/время</th><th>Имя</th><th>Язык</th><th>Файл</th><th>HVA</th><th>Токены</th></tr></thead>
    <tbody>${recentRows}</tbody>
  </table>
</body></html>`;
}

// GET показывает только форму пароля — сам пароль передаётся POST-ом, не
// query-параметром, чтобы не оседать в истории браузера и логах доступа.
router.get("/admin/stats", (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(passwordForm(false));
});

router.post("/admin/stats", async (req, res) => {
  res.set("Content-Type", "text/html; charset=utf-8");
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).send("ADMIN_PASSWORD не задан на сервере — админ-панель отключена.");
  }
  const provided = req.body?.password;
  if (provided !== expected) {
    return res.status(401).send(passwordForm(true));
  }
  const logs = await getAllLogs();
  res.send(statsPage(logs));
});

export default router;
