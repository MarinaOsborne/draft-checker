import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const RUNS_FILE = path.join(DATA_DIR, "runs.json");

let writeQueue = Promise.resolve();

function keyFor(language, filename) {
  return `${language}::${filename}`;
}

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(RUNS_FILE);
  } catch {
    await fs.writeFile(RUNS_FILE, "{}", "utf8");
  }
}

async function readAll() {
  await ensureFile();
  const raw = await fs.readFile(RUNS_FILE, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function withLock(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function getRuns(language, filename) {
  const all = await readAll();
  return all[keyFor(language, filename)] || 0;
}

export function incrementRuns(language, filename) {
  return withLock(async () => {
    const all = await readAll();
    const key = keyFor(language, filename);
    const next = (all[key] || 0) + 1;
    all[key] = next;
    await fs.writeFile(RUNS_FILE, JSON.stringify(all, null, 2), "utf8");
    return next;
  });
}

export function resetRuns(language, filename) {
  return withLock(async () => {
    const all = await readAll();
    const key = keyFor(language, filename);
    delete all[key];
    await fs.writeFile(RUNS_FILE, JSON.stringify(all, null, 2), "utf8");
    return 0;
  });
}
