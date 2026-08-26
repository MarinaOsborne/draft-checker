# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Vissarion" (package name `draft-checker`) — an internal editorial review tool
for Bitrix24's multilingual content team. An editor picks an article by title
from a dropdown (backed by a Google Sheet that lists every article, each row
linking to its AI-draft and edited-final Google Docs — see "Google Docs
integration" below), and the app scores both holistically, breaks down 7
quality criteria + 5 "AI search readiness" criteria, flags unnecessary
rewrites, and renders a word-level diff, all via a single LLM call to
VibeCode's AI Router (`bitrix/bitrixgpt-5.5`). It's deployed as a single
Node/Express process on the VibeCode platform (Galaxy container), not a
static site.

## Commands

```bash
npm run dev      # concurrently runs vite (frontend, with /api proxied to Express) + node --watch server/index.js
npm run build    # vite build -> dist/
npm start        # node server/index.js — serves dist/ AND /api/* from one process (production mode)
```

There is no test suite (`npm test` is a stub) and no linter configured.
Verification is done by hand: `node --check <file>` per changed server file,
then a full `rm -rf dist data && npm run build`, then exercising the route
with `curl` against a real `node server/index.js` pointed at either the real
`VIBE_AI_BASE_URL` or a local mock HTTP server standing in for it (see
"Testing conventions" below).

## Architecture

**One process serves both halves.** `server/index.js` mounts every API route
under `/api` (`pin`, `parse`, `articles`, `runs`, `analyze`, `health`), mounts
`server/routes/admin.js` unprefixed (it owns `/admin/stats`), then serves
`dist/` as static files and falls back to `dist/index.html` for everything
else (SPA routing). In dev, Vite proxies `/api` to this same Express server
(see `vite.config.js`) so the two run as separate processes only locally.

**Auth is a single shared PIN, not per-user accounts.** `ACCESS_PIN` (env,
default `2847`) gates every route via `requirePin` middleware
(`X-Access-Pin` header). There's no password/session system — "username" is
just a free-text name typed into the client and sent as `X-Username` on every
request (URL-encoded client-side in `src/api.js` because raw Cyrillic breaks
under Node's header parsing), used purely to attribute runs in the stats log.
`getUsername().toLowerCase() === "admin"` is what unlocks the "Admin" link
and reset button in the UI — it is not a real permission system.

**Two independent text-ingestion paths feed the same shape into `/api/analyze`.**
Both ultimately produce `{ text, wordCount, links }` per side (draft/final) —
`links` because plain-text extraction always drops hyperlinks and keeps only
the anchor text, so both paths recover the real URLs through a second,
separate channel:
- `.docx` upload (`server/routes/parse.js`, still present server-side but no
  longer wired into the UI — see below): `mammoth.extractRawText()` for the
  text, *separately* `mammoth.convertToHtml()` + cheerio to pull out real
  `<a href>` URLs (`extractLinks`).
- Google Docs (`server/lib/googleClient.js::getDocContent`, what the UI
  actually uses today — see "Google Docs integration" below): a single Docs
  API `documents.get` call already exposes both the text (`textRun.content`)
  and any hyperlink (`textRun.textStyle.link.url`) in the same structure, so
  one walk of `document.body.content` produces both.

Both channels (`draftText`/`finalText` and `draftLinks`/`finalLinks`) are
sent to the model, but **`DiffView` only ever receives the plain text** — a
link-only edit (e.g. turning existing prose into a hyperlink to a Bitrix24
feature page) is real signal to the model but invisible in the diff UI. Keep
this in mind before assuming a scoring jump with "no visible diff" is a bug.

**Google Docs integration — how an editor picks an article.** Editors no
longer upload files by hand; `ArticlePicker` (`src/components/ArticlePicker.jsx`)
shows a `<select>` of article titles fetched from `GET /api/article-list`,
backed by a Google Sheet (`GOOGLE_SHEET_ID`) — **one spreadsheet, one tab per
language**, tab names matching the UI's language codes exactly (`EN`, `ES`,
`BR`, `DE`, `FR`, `TR`, `PL`, `VN`, `IT` — see `LANGS` in both
`src/constants.js` and its server-side duplicate `server/lib/constants.js`).
The client sends the currently selected UI language as a `language` query
param on every `/api/article-list*` request; the server resolves it to a
tab name (`sheetTabForLanguage` in `server/lib/googleClient.js`, identity
mapping by default — override an individual entry there if some tab's real
name doesn't match its code exactly, since Sheets API ranges are
case-sensitive) and builds the range as `` `${tab}!A:Z` `` on the fly. This
replaced an earlier single static `GOOGLE_SHEET_RANGE` env var (one
hardcoded tab for every language) once the sheet grew a tab per language —
switching the language dropdown now re-fetches the article list from that
language's tab and clears any already-selected article, since a selection
from one language's tab means nothing on another. Each tab has header
columns `id`, `Title`, `draft` (AI draft doc), `Link to content` (editor's
edited/final doc) — the reverse of what the column names alone suggest,
confirmed against the real sheet after an initial mix-up that had draft and
final swapped in the UI. `server/lib/googleClient.js::listArticles` reads
the header row to find these columns by name (not fixed letters) so
reordering columns in the sheet doesn't break it. Choosing a title calls
`GET /api/article-list/:id/content`, which looks the row up again, extracts both
Google Doc IDs from their share-link URLs (`extractDocId`), fetches each via
the Docs API, and returns `{ draft: {text, wordCount, links}, final: {...} }` —
from there it's fed into the *same* `handleRun`/`/api/analyze` pipeline
described below, using the article's `title` as the `finalFilename` run-limit
key (`server/lib/store.js` keys are opaque strings, so a title works exactly
like a filename did). **Auth is one read-only service account**
(`GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`, scopes `spreadsheets.readonly` +
`documents.readonly` — no Drive scope, since the Docs API can fetch any
document ID it's been granted Viewer access to directly), not per-editor
OAuth — the sheet AND every linked doc must each be individually shared with
that service account's `client_email`, or `/api/article-list*` 500s
(`sheet_unavailable`/`docs_unavailable` — see below for why 500 and not the
more conventional 502/503). Nothing is ever written back to the
sheet or the docs — the analysis result lives only in this app, same as
before.

**Why `/api/article-list` and not the more obvious `/api/articles`, and the
real story behind it** — it used to be `/api/articles`, renamed after that
exact path started returning a static-looking 503 in production (same
unchanging ETag across 15+ minutes, `?nocache=1` didn't bust it) while every
other route — including a throwaway `/api/ping-test` added specifically to
test this — kept working fine. The rename was tried as a first guess (stuck
edge cache keyed on the literal path string) and turned out to be a red
herring: **the actual cause, confirmed via `curl -v` against the live app,
is that VibeCode's nginx intercepts any upstream response with HTTP status
502 specifically** — it rewrites the status to 503 and the Content-Type to
`text/html`, but does NOT deliver a body, while still declaring the
*original* (correct) `Content-Length` from our real response — so the
client sees a truncated transfer (`curl: (18) end of response with N bytes
missing`) instead of our actual JSON error. This was proven, not assumed: a
request that made `server/routes/analyze.js` return its own 500 (malformed
JSON body) passed through the same nginx completely intact — identical
`ETag`/`Content-Length` to a local reproduction of the same error — while an
otherwise-identical 502 response got mangled exactly as described. Since the
error body is deterministic (same Google-auth failure → same JSON → same
weak ETag every time), this alone fully explains the original "unchanging
ETag for 15+ minutes" symptom, with no caching involved anywhere. **The
actual fix was switching every route that used to answer with status 502
(`server/routes/articles.js`'s `sheet_unavailable`/`docs_unavailable`,
`server/routes/analyze.js`'s `ai_unavailable`/`analyze_failed`) to 500
instead** — safe because `src/api.js`'s `request()` already reads the error
`code` from the parsed JSON body first, falling back to the raw HTTP status
only when `body.code` is absent, so this doesn't change any user-facing
behavior, only whether the body actually arrives. The `/api/article-list`
rename turned out to be unnecessary — the original `/api/articles` also
returned 502 on this same error path, so it would have hit the exact same
nginx interception regardless of its name; there was never a real per-path
caching issue. The rename was kept anyway (reverting it back to `/api/articles`
now would add risk for zero benefit), but if a future session wonders why
the route isn't called the "obvious" name, this is the full, resolved
reason — not an open question.

**Two layers of timeout, because one wasn't enough.** `server/lib/withTimeout.js`
is a shared `Promise.race`-against-a-timer helper used at two different
levels:
- `authorizedFetch` in `googleClient.js` bounds each *individual* Google API
  call to `GOOGLE_API_TIMEOUT_MS` (8s) — covers a hang in either leg (the
  OAuth token exchange with `oauth2.googleapis.com`, which never even
  reaches `fetch`, or the actual Sheets/Docs call).
- `ROUTE_TIMEOUT_MS` (9s) in `server/routes/articles.js` wraps each route
  handler's *entire* body in a second, outer deadline. This layer exists
  because per-call bounding alone was NOT sufficient: `GET
  /article-list/:id/content` makes two Google API calls *sequentially* (find
  the row via `listArticles()`, only then fetch both docs), so two individually-
  fast-but-slow-ish calls could still add up past the VibeCode gateway's own
  (~10s, per production observation) cutoff even though neither call
  individually hit its own timeout — confirmed by re-reading the actual code
  path, not assumed, after a report of `/api/articles` (this route's name at
  the time) intermittently surfacing the generic "server_unavailable" instead
  of a specific error. The
  route wrapper tracks which phase (`"sheet"` vs `"docs"`) was in flight when
  the outer deadline fires, so a timeout during either phase still reports
  the same specific `sheet_unavailable`/`docs_unavailable` code its own
  try/catch would have produced.

Without either layer, a hang would block the response until the platform
gateway gives up on its own unknown/unconfigurable timeout, and the browser
would see a bare 502/503 with no body, surfaced by `src/api.js` as the
generic, unhelpful "server_unavailable" instead of our specific translated
error. `withTimeout`'s timer calls `reject()` with its own clear message
*before* calling the caller-supplied `onTimeout` (e.g. an
`AbortController.abort()` to cancel an in-flight `fetch`) — not after:
aborting first would synchronously fire `fetch`'s own `AbortError`
rejection, which (its reaction microtask being scheduled before our own
`reject()` gets a chance to run) would then win the `Promise.race` and leak
a generic "This operation was aborted" instead of our clear message.
Confirmed with an isolated harness replicating this exact ordering (not just
assumed) before trusting it, and separately confirmed that a second,
outer `withTimeout` call correctly cuts off a two-phase sequential
operation that individually-fast legs would otherwise let run past the
outer deadline — see git history for `server/lib/withTimeout.js` and
`server/lib/googleClient.js`.

**Scoring is holistic per-version, not diff-sized.** The single LLM call in
`server/lib/vibeAiClient.js` scores `ai_draft_quality` and
`final_article_quality` (0-100) by reading each *entire* text version on its
own merits — these are independent judgments, not derived from how much text
changed. A tiny edit (one added link, one removed clause) can legitimately
swing the score a lot if it's high-impact; conversely two very different
"drafts" should never coincidentally land on the same score. The system
prompt enforces calibration bands (0-25/26-50/51-70/71-90/91-100) and
requires a one-sentence, text-specific `ai_draft_quality_reasoning` /
`final_article_quality_reasoning` before each score, specifically to fight
LLM anchoring (defaulting to a "safe" middle number) — these reasoning
strings are persisted (see below) precisely so a large score delta can be
sanity-checked against what the model actually claims changed, without
server/log access.

**"Human Value Added" is two different metrics wearing the same name** — do
not conflate them:
- The main UI's `+N` badge = `final_article_quality - ai_draft_quality` (a
  holistic delta).
- `human_value_added.{statistics_added, real_world_examples_added,
  bitrix24_integrations_added, ai_cliches_removed, filler_sentences_removed}`
  = a separate sum-of-counters breakdown shown in the UI's "Details" section.

The admin dashboard's "HVA" column intentionally shows the *first* one
(`scoreDelta()` in `server/routes/admin.js`), per explicit product decision —
it used to sum the five counters instead, which looked like a bug but wasn't
(just the wrong metric for that context).

**Run limits are per-file AND monthly, tracked server-side only.**
`server/lib/store.js` keys a per-(language, filename) counter (`MAX_RUNS = 3`,
`server/lib/constants.js`) plus a global calendar-month counter
(`MAX_MONTHLY_RUNS = 412`, resets automatically because the key is
`monthly::YYYY-MM` and a new month is simply an unwritten key — no cron).
`incrementRuns`/`incrementMonthlyRuns` only fire *after* a successful
`/api/analyze` call, gated by a `res.on("close")` check (not
`req.on("close")`, which was verified in practice to be unreliable) so a
client that disconnects mid-request before the response is written doesn't
burn one of their 3 attempts.

**Two persistence layers, different purposes, both on local disk:**
- `data/analysis-log.jsonl` (`server/lib/store.js::saveAnalysisRecord`) —
  append-only, one JSON object per line, includes the **full**
  `draftText`/`finalText` plus every score/reasoning/hva/edit — meant as raw
  material for future prompt iteration or fine-tuning.
- `data/analytics.json` (`server/lib/analyticsStore.js::logAnalysis`) — one
  JSON array, lighter (no full text), powers `/admin/stats`.

Both are written from `server/routes/analyze.js` after a successful
`analyzeArticle()` call, each entry stamped with `runNumber` (the
`incrementRuns()` return value) so admin aggregation can tell "3 draft
attempts on one file" apart from "3 different articles" — see
`lastAttemptPerFile()` in `admin.js`, which the per-user quality metrics
(avg Final Score, avg delta, Ready %) are deliberately computed from, while
the raw "Прогонов" count and the "Последние прогоны" table intentionally
still show every attempt.

**`data/` does not survive a redeploy.** VibeCode Galaxy deploys are a fresh
container each time (see `deploy/deploy.sh`) — there is no persistent volume
today, confirmed empirically (an admin-stats redeploy reset the run counter
to 1). Any plan to accumulate `analysis-log.jsonl` over time for fine-tuning
needs to push data out of the container as it's generated (e.g. a webhook to
n8n right after `saveAnalysisRecord`), not rely on the local file surviving
until someone remembers to export it.

**`/admin/stats` is the only diagnostic surface reachable in production** —
there is no console/file access on the deployed platform. It's a
server-rendered HTML page (password-gated via `ADMIN_PASSWORD`, POST-only so
the password never lands in browser history), not a JSON API. Reasoning
strings are surfaced as a native `title` tooltip on the HVA cell rather than
new columns, to avoid cluttering the table; the tooltip text distinguishes
"field doesn't exist on this record" (logged before the reasoning fields
existed) from "field exists but the model returned an empty string" (model
didn't comply with the prompt) — see `hasReasoningField` in `admin.js`.

## Deployment

`bash deploy/deploy.sh` builds, packages `server/` + `dist/` + production
`node_modules`, writes secrets into a `.env` **inside the deploy archive**
(never into VibeCode's own env-var mechanism, never into git), and pushes it
as one JSON request (base64 source) to the Galaxy API — see comments at the
top of the script for the multipart-vs-JSON and `runtime`-required gotchas
that were discovered the hard way. Needs `VIBE_KEY` (from env, or
`deploy/.env.deploy`, or an interactive prompt — checked in that order) and
should be given the *current* `ADMIN_PASSWORD`/`ACCESS_PIN` on redeploy or
those reset. Deploying is a real, billed, production action — never run it
without the user's explicit go-ahead, and never paste secrets you don't
already have from the user into it. `deploy/.vibe-server` (gitignored) holds
the existing app id so a redeploy updates in place instead of creating a
duplicate app; without it the script defaults to creating a new one.

**`GET /api/health` reports which commit is actually live** (`gitCommit`,
`server/lib/version.js`) — added after a real incident where a brand-new
route (`/api/articles`, since renamed to `/api/article-list` — see above)
consistently 502/503'd in production while older routes worked fine, and it
was impossible to rule out "the running container predates this route"
without this. The deploy archive never includes `.git`
(only `server/` + `dist/` + `package.json`/`package-lock.json` + a generated
`.env` are copied into it), so `git rev-parse` can't run at runtime in
production — `deploy/deploy.sh` instead computes the hash once at package
time (while still inside the real repo) and bakes it into the archive's
`.env` as `GIT_COMMIT`. `version.js`'s own `git rev-parse HEAD` fallback only
ever fires in local dev (`npm run dev`/`npm start`), where `.git` actually
exists and `GIT_COMMIT` isn't set.

The AI Router's exact base path/auth header in `server/lib/vibeAiClient.js`
(`VIBE_AI_BASE_URL`, defaults to `https://vibecode.bitrix24.tech/v1/ai`) was
never verified against real platform docs (see the `⚠️ ПРЕДПОЛОЖЕНИЕ`
comment at the top of that file) — if `/api/analyze` starts responding with
`ai_unavailable`/`analyze_failed` after a platform change, that's the first
thing to re-check via `/api/health`.
Direct OpenAI is not an option: OpenAI geo-blocks VibeCode's Russian server
IPs (403).

## Testing conventions

For any server-side change, verify end-to-end rather than trusting
`node --check` alone: stand up a throwaway Node `http.createServer` mock (no
Express) returning a controlled JSON payload, run the real server against it
via `VIBE_AI_BASE_URL=http://localhost:PORT/v1`, hit it with `curl` (URL-encode
`X-Username` if it contains non-ASCII), inspect the output, then kill both
processes and delete every temp file/mock script/`data/` dir before
committing — confirm with `git status --short`. This session has no network
access to the real `vibecode.bitrix24.tech` (confirmed via
`curl "$HTTPS_PROXY/__agentproxy/status"`: outbound to that host is denied by
sandbox policy, not a transient failure) — mocks are the only way to test the
analyze pipeline from here, so anything that depends on the *real* model's
actual behavior (e.g., whether it reliably fills in a reasoning field) can
only be confirmed by the user on the deployed app, never assumed from a mock.

**Testing `server/lib/googleClient.js` is the opposite situation** — outbound
network access to `sheets.googleapis.com`/`docs.googleapis.com`/
`oauth2.googleapis.com` IS available here (confirmed with plain `curl`), but
there's no real service-account key, sheet, or shared doc to authenticate
with from this environment, so a genuine happy-path call can't be made
either way. That's why the row→article and Docs-JSON→text/links logic is
split into pure, directly-importable functions (`parseArticleRows`,
`parseDocument`, `extractDocId`) separate from the `fetch`-performing
`listArticles`/`getDocContent` — they can be unit-tested against a
hand-built fake Sheets/Docs API response without any network or credentials,
the same way `extractLinks(html)` in `parse.js` is already a standalone,
directly-testable function. Confirmed working during development: (1) the
pure functions against synthetic API payloads (column reordering, table
cells, multi-run hyperlink text accumulation, same-URL-non-contiguous
dedup); (2) the real `/api/article-list*` routes against a live but
unconfigured/invalid service account — Google's real OAuth endpoint
correctly rejects a fake account (`invalid_grant`) over the network, and the
route still 500s cleanly (`sheet_unavailable`/`docs_unavailable`) instead of
crashing the process. What's NOT been confirmed from here: a real successful
sheet read or doc fetch — that only the user can verify once real
`GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`/`GOOGLE_SHEET_ID` are set and the sheet
+ every linked doc are actually shared with the service account.
