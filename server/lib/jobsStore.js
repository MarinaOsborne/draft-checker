import { promises as fs } from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { MAX_SINGLE_JOB_DURATION_MS } from "./vibeAiClient.js";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const JOBS_DIR = path.join(DATA_DIR, "jobs");
const LOCKS_DIR = path.join(JOBS_DIR, "active");

// Порог "задание зависло/потеряно" должен быть ЗАВЕДОМО выше худшего случая
// легитимной длительности одного вызова analyzeArticle() (см.
// MAX_SINGLE_JOB_DURATION_MS в vibeAiClient.js) — иначе есть риск признать
// ещё реально работающее задание потерянным и запустить дубль на той же
// статье (см. задачу). +60с — запас на накладные расходы (запись файлов,
// планировщик Node и т.п.), не на ещё одну попытку.
// Переопределяемо переменной окружения — ТОЛЬКО для тестов (чтобы не ждать
// реальные ~5 минут в автоматических прогонах); в проде всегда берётся
// безопасное вычисленное значение.
export const JOB_STALE_THRESHOLD_MS =
  Number(process.env.JOB_STALE_THRESHOLD_MS_OVERRIDE) || MAX_SINGLE_JOB_DURATION_MS + 60_000;

// Задания старше суток подчищаем — журнал не должен расти бесконечно.
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;

async function ensureDirs() {
  await fs.mkdir(LOCKS_DIR, { recursive: true });
}

export function fingerprintFor({ username, language, finalFilename, draftText, finalText }) {
  const h = createHash("sha256");
  h.update(String(username || ""));
  h.update("::");
  h.update(String(language || ""));
  h.update("::");
  h.update(String(finalFilename || ""));
  h.update("::");
  h.update(String(draftText || ""));
  h.update("::");
  h.update(String(finalText || ""));
  return h.digest("hex").slice(0, 32);
}

function jobPath(jobId) {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function lockPath(fingerprint) {
  return path.join(LOCKS_DIR, `${fingerprint}.lock`);
}

// Атомарная запись (временный файл + rename) — rename на одной файловой
// системе атомарен, так что крэш посреди записи никогда не оставляет
// наполовину записанный повреждённый файл задания: читающий либо увидит
// старое полное содержимое, либо новое полное, третьего не дано.
async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmpPath, filePath);
}

async function readJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function isStale(createdAt) {
  return Date.now() - createdAt > JOB_STALE_THRESHOLD_MS;
}

// Пытается атомарно захватить блокировку для fingerprint. Если блокировка
// уже есть и ещё не "протухла" — возвращает её jobId (вызывающий код должен
// отдать клиенту ЕГО, не создавать новое задание — это и есть защита от
// дублей). Если блокировка протухла (владевший ею процесс не дожил до
// освобождения — рестарт/краш) — перехватывает её под новое задание.
//
// Небольшая, осознанно принятая гонка: между удалением протухшей блокировки
// и созданием новой теоретически может вклиниться другой запрос. Для
// внутреннего инструмента на несколько редакторов (не банковская система)
// это приемлемый риск — проще и честнее, чем городить распределённый лок.
export async function claimOrGetExisting(fingerprint) {
  await ensureDirs();
  const lp = lockPath(fingerprint);
  const newJobId = randomUUID();

  try {
    const handle = await fs.open(lp, "wx");
    await handle.writeFile(JSON.stringify({ jobId: newJobId, createdAt: Date.now() }));
    await handle.close();
    return { claimed: true, jobId: newJobId };
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }

  const existing = await readJson(lp);
  if (!existing) {
    // Блокировка исчезла между проверкой и чтением (конкурентная гонка) —
    // просто считаем, что мы её не получили, пусть вызывающий код повторит;
    // в худшем случае вызывающий увидит это как "server_busy"-подобную
    // ситуацию один раз.
    return { claimed: false, jobId: null };
  }
  if (isStale(existing.createdAt)) {
    await fs.rm(lp, { force: true });
    const handle = await fs.open(lp, "wx").catch(() => null);
    if (handle) {
      await handle.writeFile(JSON.stringify({ jobId: newJobId, createdAt: Date.now() }));
      await handle.close();
      return { claimed: true, jobId: newJobId, reclaimedFrom: existing.jobId };
    }
  }
  return { claimed: false, jobId: existing.jobId };
}

export async function releaseLock(fingerprint) {
  await fs.rm(lockPath(fingerprint), { force: true });
}

export async function createPendingJob(jobId, meta) {
  await ensureDirs();
  await writeJsonAtomic(jobPath(jobId), {
    jobId,
    status: "pending",
    username: meta.username || null,
    language: meta.language || null,
    finalFilename: meta.finalFilename || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null,
    errorCode: null,
  });
}

// ВАЖНО по порядку операций (см. задачу): сначала пишем готовый результат
// В ФАЙЛ ЗАДАНИЯ, и только ПОСЛЕ этого вызывающий код (analyze.js)
// увеличивает счётчик прогонов. Если процесс упадёт МЕЖДУ этими двумя
// шагами — пользователь не потеряет отчёт (он уже на диске), максимум не
// спишется попытка за этот прогон. Это осознанно выбранное смещение риска:
// "недосписанная попытка" никому не вредит, "списанная попytka без отчёта" —
// именно то, от чего просили защититься. Абсолютной гарантии ровно одного
// списания без транзакционного хранилища мы дать не можем — см. ограничения
// в итоговом отчёте.
export async function writeJobDone(jobId, result) {
  const existing = await readJson(jobPath(jobId));
  await writeJsonAtomic(jobPath(jobId), {
    ...(existing || { jobId }),
    status: "done",
    result,
    errorCode: null,
    updatedAt: Date.now(),
  });
}

export async function writeJobError(jobId, errorCode) {
  const existing = await readJson(jobPath(jobId));
  await writeJsonAtomic(jobPath(jobId), {
    ...(existing || { jobId }),
    status: "error",
    result: null,
    errorCode,
    updatedAt: Date.now(),
  });
}

// null — задания никогда не было (или уже подчищено по возрасту).
// "lost" подставляется на лету для застрявшего pending — ничего не
// переписывает на диске, чистая интерпретация при чтении.
export async function getJob(jobId) {
  const job = await readJson(jobPath(jobId));
  if (!job) return null;
  if (job.status === "pending" && isStale(job.createdAt)) {
    return { ...job, status: "lost" };
  }
  return job;
}

export async function pruneOldJobs() {
  await ensureDirs();
  const now = Date.now();
  for (const dir of [JOBS_DIR, LOCKS_DIR]) {
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === "active") continue; // подпапка locks внутри jobs/
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        if (!stat.isFile()) continue;
        const maxAge = dir === LOCKS_DIR ? JOB_STALE_THRESHOLD_MS : JOB_RETENTION_MS;
        if (now - stat.mtimeMs > maxAge) await fs.rm(full, { force: true });
      } catch {
        // гонка с параллельным удалением/записью — не критично, пропускаем
      }
    }
  }
}
