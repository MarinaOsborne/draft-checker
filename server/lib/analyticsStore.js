import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const LOG_FILE = path.join(DATA_DIR, "analytics.json");

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
    await fs.access(LOG_FILE);
  } catch {
    await fs.writeFile(LOG_FILE, "[]", "utf8");
  }
}

async function readAll() {
  await ensureFile();
  const raw = await fs.readFile(LOG_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Пишем построчно в JSON-массив (тот же паттерн write-lock, что и в store.js)
// — при небольшом внутреннем инструменте это проще, чем поднимать БД.
export function logAnalysis({
  username,
  language,
  filename,
  tokens,
  verdict,
  draftScore,
  finalScore,
  draftScoreReasoning,
  finalScoreReasoning,
  runNumber,
  hva,
  topEdits,
}) {
  return withLock(async () => {
    const all = await readAll();
    const entry = {
      username: (username || "").trim() || "unknown",
      timestamp: new Date().toISOString(),
      language: language || "",
      filename: filename || "",
      tokens: Number.isFinite(tokens) ? tokens : null,
      verdict: verdict || null, // "ready" | "not_ready"
      draftScore: Number.isFinite(draftScore) ? draftScore : null, // ai_draft_quality
      finalScore: Number.isFinite(finalScore) ? finalScore : null, // final_article_quality
      // Обоснование модели под каждый холистический балл — нужно, чтобы
      // проверять подозрительные скачки (напр. "+14 при изменении одного
      // слова") прямо с /admin/stats, без доступа к файлам/логам сервера.
      draftScoreReasoning: draftScoreReasoning || "",
      finalScoreReasoning: finalScoreReasoning || "",
      // Номер попытки для пары язык+файл (значение incrementRuns на момент
      // этого прогона) — нужен, чтобы в статистике по пользователю агрегировать
      // только по последнему прогону на файл, а не по всем черновым попыткам.
      runNumber: Number.isFinite(runNumber) ? runNumber : null,
      hva: hva || null, // весь объект human_value_added как есть
      topEdits: Array.isArray(topEdits) ? topEdits : [], // top_edits как есть
    };
    all.push(entry);
    await fs.writeFile(LOG_FILE, JSON.stringify(all, null, 2), "utf8");
    return entry;
  });
}

export async function getAllLogs() {
  return readAll();
}
