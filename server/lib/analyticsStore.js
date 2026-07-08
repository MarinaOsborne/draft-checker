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
export function logAnalysis({ username, language, filename, tokens }) {
  return withLock(async () => {
    const all = await readAll();
    const entry = {
      username: (username || "").trim() || "unknown",
      timestamp: new Date().toISOString(),
      language: language || "",
      filename: filename || "",
      tokens: Number.isFinite(tokens) ? tokens : null,
    };
    all.push(entry);
    await fs.writeFile(LOG_FILE, JSON.stringify(all, null, 2), "utf8");
    return entry;
  });
}

export async function getAllLogs() {
  return readAll();
}
