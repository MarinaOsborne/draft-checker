// Surfaces which commit is actually running — the deploy archive
// (deploy/deploy.sh) never includes .git, so `git rev-parse` can't work at
// runtime in production; deploy.sh instead stamps GIT_COMMIT into the .env
// it bakes into the archive at package time, when .git is still available.
// The `git rev-parse` fallback below only ever fires in local dev
// (`npm run dev`/`npm start`, no GIT_COMMIT env var set, .git present).
import { execSync } from "child_process";

let gitCommit;

export function getGitCommit() {
  if (gitCommit !== undefined) return gitCommit;
  if (process.env.GIT_COMMIT) {
    gitCommit = process.env.GIT_COMMIT.trim();
    return gitCommit;
  }
  try {
    gitCommit = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    gitCommit = null;
  }
  return gitCommit;
}
