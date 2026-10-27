import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const DIAGNOSTICS_FILE = path.join(DATA_DIR, "diagnostics.json");

// Ограниченный журнал, а не аудит-лог — старые записи вытесняются новыми,
// чтобы файл не разрастался бесконечно (см. требование безопасности в
// задаче). 300 — вчетверо больше, чем "Последние прогоны" в /admin/stats,
// этого достаточно, чтобы поймать серию сбоев за день-два.
const MAX_ENTRIES = 300;

let writeQueue = Promise.resolve();

function withLock(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DIAGNOSTICS_FILE);
  } catch {
    await fs.writeFile(DIAGNOSTICS_FILE, "[]", "utf8");
  }
}

async function readAll() {
  await ensureFile();
  const raw = await fs.readFile(DIAGNOSTICS_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Технический журнал этапов /api/analyze — для диагностики сбоев вроде
// "[object Object]" / "AI Router failed" без доступа к консоли сервера на
// платформе VibeCode (см. /admin/stats — та же идея).
//
// ВАЖНО — что сюда НЕЛЬЗЯ класть (по требованию задачи): текст
// draftText/finalText, сырой ответ модели, любые цитаты/фрагменты из
// статей. Только служебные метаданные: этап, длительность, HTTP-статус,
// ТИП ошибки (например "SyntaxError"), finish_reason, факт успешного
// ответа модели, длина ответа (число, не сам текст). Намеренно НЕТ поля
// для текста сообщения об ошибке (errorMessage) — ошибка от AI Router
// теоретически может эхом вернуть фрагмент входных данных в своём
// сообщении (например в ответе на ошибку валидации), а это ровно то, что
// требование запрещает здесь хранить; тип ошибки для диагностики обычно
// достаточен, полный текст при необходимости смотрим в консоли сервера.
//
// ВАЖНО — эта функция НИКОГДА не бросает исключение наружу: сбой записи
// диагностики не должен мешать анализу редактора, поэтому вызывающий код
// может звать её без своего try/catch.
export async function logDiagnostic(entry) {
  try {
    await withLock(async () => {
      const all = await readAll();
      all.push({
        timestamp: new Date().toISOString(),
        stage: entry.stage || "unknown",
        outcome: entry.outcome === "error" ? "error" : "ok",
        durationMs: Number.isFinite(entry.durationMs) ? Math.round(entry.durationMs) : null,
        httpStatus: Number.isFinite(entry.httpStatus) ? entry.httpStatus : null,
        errorType: entry.errorType ? String(entry.errorType).slice(0, 100) : null,
        finishReason: entry.finishReason || null,
        modelResponded: Boolean(entry.modelResponded),
        contentLength: Number.isFinite(entry.contentLength) ? entry.contentLength : null,
        language: entry.language || null,
        username: entry.username || null,
      });
      const trimmed = all.length > MAX_ENTRIES ? all.slice(-MAX_ENTRIES) : all;
      await fs.writeFile(DIAGNOSTICS_FILE, JSON.stringify(trimmed, null, 2), "utf8");
    });
  } catch (e) {
    console.error("Не удалось записать диагностический журнал (на анализ не влияет):", e);
  }
}

export async function getAllDiagnostics() {
  return readAll();
}
