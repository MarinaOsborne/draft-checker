import { Router } from "express";
import fs from "fs/promises";
import { getAllLogs } from "../lib/analyticsStore.js";
import { ANALYSIS_LOG_FILE } from "../lib/store.js";

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

// Прогонов 2/3 на один и тот же файл — это черновые попытки редактора, а не
// отдельные статьи; качество (score/delta/ready) должно оцениваться по
// последней попытке на файл, иначе правки "довели до готовности за 3
// прогона" размывают среднее так, как будто все 3 — окончательный результат.
function runNumberOf(entry) {
  return Number.isFinite(entry.runNumber) ? entry.runNumber : 1;
}

function lastAttemptPerFile(logs) {
  const latest = new Map();
  for (const entry of logs) {
    const key = `${entry.username}::${entry.language}::${entry.filename}`;
    const prev = latest.get(key);
    if (!prev || runNumberOf(entry) >= runNumberOf(prev)) {
      latest.set(key, entry);
    }
  }
  return [...latest.values()];
}

function statsPage(logs) {
  const byUser = new Map();
  let totalTokens = 0;

  function getUser(key, timestamp) {
    if (!byUser.has(key)) {
      byUser.set(key, {
        count: 0,
        tokens: 0,
        last: timestamp,
        readyCount: 0,
        lastAttemptCount: 0,
        finalScoreSum: 0,
        finalScoreCount: 0,
        deltaSum: 0,
        deltaCount: 0,
      });
    }
    return byUser.get(key);
  }

  for (const entry of logs) {
    const u = getUser(entry.username || "unknown", entry.timestamp);
    u.count += 1;
    u.tokens += Number(entry.tokens) || 0;
    if (entry.timestamp > u.last) u.last = entry.timestamp;
    totalTokens += Number(entry.tokens) || 0;
  }

  // Метрики качества (Final Score / HVA / Ready %) — только по последней
  // попытке на каждый файл, а не по всем черновым прогонам подряд.
  for (const entry of lastAttemptPerFile(logs)) {
    const u = getUser(entry.username || "unknown", entry.timestamp);
    u.lastAttemptCount += 1;
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
        const readyRate = u.lastAttemptCount > 0 ? Math.round((u.readyCount / u.lastAttemptCount) * 100) : 0;
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
        // Явный текст на случай, когда модель НЕ прислала обоснование (обе
        // строки пустые) — раньше в этом случае title-атрибут просто не
        // появлялся, и было неотличимо от "запись сделана до этого фикса".
        // has(e, "draftScoreReasoning") отличает "поля вообще нет в записи"
        // (старый прогон, до фикса) от "поле есть, но модель прислала пустую
        // строку" (сам прогон уже новый, но модель не выполнила инструкцию).
        const hasReasoningField = Object.prototype.hasOwnProperty.call(e, "draftScoreReasoning");
        const tooltipText =
          reasoningLines.length > 0
            ? reasoningLines.join("\n")
            : hasReasoningField
              ? "Модель не вернула обоснование для этого прогона"
              : "";
        const tooltip = tooltipText ? ` title="${escapeHtml(tooltipText)}"` : "";
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

// Выгрузка сырого data/analysis-log.jsonl для n8n/скриптов — дёргается
// curl'ом, не браузером, поэтому пароль в заголовке (X-Admin-Password), а не
// в теле формы, и ответ — не HTML, а сам файл как есть (application/x-ndjson,
// стандартный MIME для JSONL/NDJSON).
router.post("/admin/export-analysis", async (req, res) => {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).send("ADMIN_PASSWORD не задан на сервере — админ-панель отключена.");
  }
  const provided = req.headers["x-admin-password"];
  if (provided !== expected) {
    return res.status(401).send("Неверный пароль");
  }
  try {
    const content = await fs.readFile(ANALYSIS_LOG_FILE, "utf8");
    res.set("Content-Type", "application/x-ndjson; charset=utf-8");
    res.send(content);
  } catch (e) {
    if (e.code === "ENOENT") {
      res.set("Content-Type", "application/x-ndjson; charset=utf-8");
      return res.send("");
    }
    console.error("Не удалось прочитать data/analysis-log.jsonl:", e);
    res.status(500).send("Ошибка чтения файла.");
  }
});

export default router;
