// ВРЕМЕННЫЕ диагностические эндпоинты для разовой проверки окружения VibeCode
// Galaxy (см. задачу про тайм-ауты/асинхронность: нужно было эмпирически
// выяснить, есть ли постоянный том /data, один ли это инстанс, и продолжает
// ли процесс фоновую работу после ответа на HTTP-запрос — прежде чем
// проектировать асинхронную обработку анализа).
//
// Не трогают ничего из реальной логики анализа, не вызывают AI Router и не
// принимают от клиента ни путей, ни команд — только фиксированные,
// заранее заданные проверки. Админ-защищены тем же ADMIN_PASSWORD, что и
// остальная админка, через заголовок (как /admin/export-analysis) — рассчитаны
// на curl, а не на браузер.
//
// Включаются только при ENABLE_ENV_PROBES=true (см. deploy/deploy.sh) — по
// умолчанию этот роут вообще не подключается в server/index.js, так что
// отключить после проверки можно без изменения кода: просто не передавать
// ENABLE_ENV_PROBES на следующем деплое. Сам файл и его подключение в
// index.js стоит удалить позже, когда вопрос окружения будет закрыт.
import { Router } from "express";
import { promises as fsp, constants as fsConstants, existsSync } from "fs";
import { access } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const router = Router();

// Один на весь процесс (не на запрос) — меняется только при рестарте/новом
// экземпляре. Сравнивая это значение между несколькими запросами (особенно
// параллельными), можно судить о числе работающих экземпляров — но см.
// предупреждение в ответе ниже: это не железная гарантия, а наблюдение в
// протестированных условиях.
const INSTANCE_ID = randomUUID();
const PROCESS_STARTED_AT = new Date().toISOString();

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: "ADMIN_PASSWORD не задан на сервере." });
    return false;
  }
  if (req.headers["x-admin-password"] !== expected) {
    res.status(401).json({ error: "Неверный пароль" });
    return false;
  }
  return true;
}

// Реальная проверка записи — но безопасная: уникальное имя (не пересекается
// ни с чем существующим), удаляется сразу после теста. Подходит только для
// кандидата на НОВЫЙ путь (/data), где пока ничего настоящего не лежит.
async function checkWritable(dirPath) {
  if (!existsSync(dirPath)) return { exists: false, writable: false };
  const probeFile = path.join(dirPath, `.env-probe-${randomUUID()}.tmp`);
  try {
    await fsp.writeFile(probeFile, "probe", "utf8");
    await fsp.unlink(probeFile);
    return { exists: true, writable: true };
  } catch (e) {
    return { exists: true, writable: false, error: e.code || e.message };
  }
}

// Для УЖЕ используемой директории с реальными данными — только проверка прав
// доступа (W_OK), БЕЗ фактической записи, чтобы не было ни малейшего риска
// задеть существующие файлы (analytics.json, analysis-log.jsonl и т.д.).
async function checkAccessOnly(dirPath) {
  if (!existsSync(dirPath)) return { exists: false, writable: false };
  try {
    await access(dirPath, fsConstants.W_OK);
    return { exists: true, writable: true };
  } catch (e) {
    return { exists: true, writable: false, error: e.code || e.message };
  }
}

router.post("/admin/env-check", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const cwd = process.cwd();
  const currentDataDir = process.env.DATA_DIR || path.join(cwd, "data");

  const [persistentVolumeCheck, currentDataDirCheck] = await Promise.all([
    checkWritable("/data"),
    checkAccessOnly(currentDataDir),
  ]);

  res.json({
    instanceId: INSTANCE_ID,
    pid: process.pid,
    processStartedAt: PROCESS_STARTED_AT,
    cwd,
    currentDataDir,
    currentDataDirCheck, // только проверка прав (W_OK), без записи
    persistentVolumeCandidate: "/data",
    persistentVolumeCheck, // реальный безопасный тест: запись + немедленное удаление
  });
});

// In-memory — только для этого пробника, не связано ни с одним реальным
// хранилищем приложения.
const testJobs = new Map();
const TEST_JOB_DURATION_MS = 5000;

router.post("/admin/env-check/job", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const jobId = randomUUID();
  const startedAt = Date.now();
  testJobs.set(jobId, { status: "pending", startedAt });
  setTimeout(() => {
    const job = testJobs.get(jobId);
    if (job) job.status = "done";
  }, TEST_JOB_DURATION_MS);
  res.json({ jobId, instanceId: INSTANCE_ID, status: "pending" });
});

router.get("/admin/env-check/job/:jobId", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const job = testJobs.get(req.params.jobId);
  if (!job) {
    // "unknown" для реально созданного только что задания — прямое
    // свидетельство, что этот запрос обслужил ДРУГОЙ экземпляр процесса,
    // у которого нет общей с первым памяти.
    return res.json({ status: "unknown", instanceId: INSTANCE_ID });
  }
  res.json({ status: job.status, instanceId: INSTANCE_ID, elapsedMs: Date.now() - job.startedAt });
});

export default router;
