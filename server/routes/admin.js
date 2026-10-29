import { Router } from "express";
import fs from "fs/promises";
import { getAllLogs, LOG_FILE as ANALYTICS_FILE } from "../lib/analyticsStore.js";
import { getAllDiagnostics, DIAGNOSTICS_FILE } from "../lib/diagnosticsStore.js";
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

// Технический журнал этапов /api/analyze (успехи и сбои) — см.
// diagnosticsStore.js. Никогда не содержит текста документов/ответа
// модели/цитат — только служебные метаданные, поэтому безопасно выводить
// прямо в HTML как есть (через escapeHtml, как и остальные поля).
function diagnosticsRows(diagnostics) {
  return (
    diagnostics
      .slice(-200)
      .reverse()
      .map((d) => {
        const errorTitle = d.outcome === "error" && d.errorType ? ` title="${escapeHtml(d.errorType)}"` : "";
        const outcomeStyle = d.outcome === "error" ? "color:#a32d2d;font-weight:600" : "color:#2d8a3e";
        // Показываем только первые 8 символов UUID (как у git-хэшей) — этого
        // достаточно, чтобы глазами сгруппировать строки одного requestId в
        // пределах таблицы из 200 записей; полный id — в title для копирования.
        const shortId = d.requestId ? d.requestId.slice(0, 8) : "—";
        const idTitle = d.requestId ? ` title="${escapeHtml(d.requestId)}"` : "";
        return `<tr>
          <td>${escapeHtml(d.timestamp)}</td>
          <td${idTitle} style="cursor:${d.requestId ? "help" : "default"};font-family:monospace">${escapeHtml(shortId)}</td>
          <td>${escapeHtml(d.stage)}</td>
          <td style="${outcomeStyle}"${errorTitle}>${escapeHtml(d.outcome)}</td>
          <td>${d.durationMs ?? "—"}</td>
          <td>${d.httpStatus ?? "—"}</td>
          <td${errorTitle} style="cursor:${errorTitle ? "help" : "default"}">${escapeHtml(d.errorType || "—")}</td>
          <td>${escapeHtml(d.finishReason || "—")}</td>
          <td>${d.modelResponded ? "да" : "нет"}</td>
          <td>${d.draftWords ?? "—"}</td>
          <td>${d.finalWords ?? "—"}</td>
          <td>${escapeHtml(d.language || "—")}</td>
          <td>${escapeHtml(d.username || "—")}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="13">Нет данных</td></tr>`
  );
}

function statsPage(logs, diagnostics) {
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

  <h2>Технические ошибки и этапы выполнения (до 200)</h2>
  <table>
    <thead><tr>
      <th>Дата/время</th><th>ID запроса</th><th>Этап</th><th>Исход</th><th>Длительность, мс</th><th>HTTP</th>
      <th>Тип ошибки</th><th>finish_reason</th><th>Ответ модели</th><th>Слов (черновик)</th><th>Слов (финал)</th>
      <th>Язык</th><th>Пользователь</th>
    </tr></thead>
    <tbody>${diagnosticsRows(diagnostics)}</tbody>
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
  const diagnostics = await getAllDiagnostics();
  res.send(statsPage(logs, diagnostics));
});

function requireAdminHeader(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).send("ADMIN_PASSWORD не задан на сервере — админ-панель отключена.");
    return false;
  }
  if (req.headers["x-admin-password"] !== expected) {
    res.status(401).send("Неверный пароль");
    return false;
  }
  return true;
}

async function sendRawFile(res, filePath, emptyValue) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    res.send(content);
  } catch (e) {
    if (e.code === "ENOENT") return res.send(emptyValue);
    console.error(`Не удалось прочитать ${filePath}:`, e);
    res.status(500).send("Ошибка чтения файла.");
  }
}

// Выгрузка сырого data/analysis-log.jsonl для n8n/скриптов — постоянный
// инструмент (не миграционный), поэтому не гейтится ENABLE_DATA_MIGRATION,
// в отличие от export-analytics/export-diagnostics/restore-data ниже.
router.post("/admin/export-analysis", async (req, res) => {
  if (!requireAdminHeader(req, res)) return;
  res.set("Content-Type", "application/x-ndjson; charset=utf-8");
  await sendRawFile(res, ANALYSIS_LOG_FILE, "");
});

// ВРЕМЕННЫЕ инструменты миграции — только для одноразового переноса уже
// накопленных данных при переключении DATA_DIR на постоянный том (см.
// задачу). Как и /admin/env-check*, подключены "по умолчанию выключено":
// без ENABLE_DATA_MIGRATION=true эти три маршрута отвечают обычным 404 —
// отключить после миграции можно без изменения кода, просто убрав
// переменную (и из команды запуска, И из deploy/.env.deploy — см. ниже)
// на следующем деплое. Сам файл стоит почистить от них, когда миграция
// завершена и подтверждена.
function requireMigrationEnabled(req, res) {
  if (process.env.ENABLE_DATA_MIGRATION !== "true") {
    res.status(404).send("Not found");
    return false;
  }
  return true;
}

router.post("/admin/export-analytics", async (req, res) => {
  if (!requireMigrationEnabled(req, res)) return;
  if (!requireAdminHeader(req, res)) return;
  res.set("Content-Type", "application/json; charset=utf-8");
  await sendRawFile(res, ANALYTICS_FILE, "[]");
});

router.post("/admin/export-diagnostics", async (req, res) => {
  if (!requireMigrationEnabled(req, res)) return;
  if (!requireAdminHeader(req, res)) return;
  res.set("Content-Type", "application/json; charset=utf-8");
  await sendRawFile(res, DIAGNOSTICS_FILE, "[]");
});

// Принимает то, что ранее забрали через export-*, и перезаписывает ими файлы
// по ТЕКУЩЕМУ DATA_DIR (то есть уже новому, если DATA_DIR=/data на этом
// деплое). Требует явного { confirm: "REPLACE" } в теле — защита от
// случайного повторного вызова (например, дубль отправки из скрипта/
// curl-истории), которая бы молча затёрла то, что уже накопилось на новом
// месте данными из более старой резервной копии. Лёгкая проверка формы
// (массив/строка), не полноценная валидация схемы — этого достаточно, раз
// эндпоинт только для администратора и только для содержимого, которое он
// сам только что выгрузил этими же export-*.
router.post("/admin/restore-data", async (req, res) => {
  if (!requireMigrationEnabled(req, res)) return;
  if (!requireAdminHeader(req, res)) return;
  const { analytics, analysisLog, diagnostics, confirm } = req.body || {};
  if (confirm !== "REPLACE") {
    return res.status(400).json({
      ok: false,
      error: 'Требуется подтверждение: добавь в тело запроса "confirm": "REPLACE" — это необратимо перезапишет текущие файлы.',
    });
  }
  const written = [];
  try {
    if (analytics !== undefined) {
      if (!Array.isArray(analytics)) throw new Error("analytics должен быть массивом");
      await fs.writeFile(ANALYTICS_FILE, JSON.stringify(analytics, null, 2), "utf8");
      written.push("analytics");
    }
    if (analysisLog !== undefined) {
      if (typeof analysisLog !== "string") throw new Error("analysisLog должен быть строкой (NDJSON)");
      await fs.writeFile(ANALYSIS_LOG_FILE, analysisLog, "utf8");
      written.push("analysisLog");
    }
    if (diagnostics !== undefined) {
      if (!Array.isArray(diagnostics)) throw new Error("diagnostics должен быть массивом");
      await fs.writeFile(DIAGNOSTICS_FILE, JSON.stringify(diagnostics, null, 2), "utf8");
      written.push("diagnostics");
    }
    res.json({ ok: true, written });
  } catch (e) {
    console.error("Не удалось восстановить данные:", e);
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default router;
