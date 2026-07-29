// Reads the editorial article list from a Google Sheet and the linked
// AI-draft/edited-draft text from Google Docs — the Google Docs analogue of
// what server/routes/parse.js does for uploaded .docx files via mammoth
// (extractRawText + hyperlink extraction), so the rest of the pipeline
// (/api/analyze) sees the same shape and never needs to know which source
// the text came from.
//
// Auth is a single read-only service account (Sheets + Docs "readonly"
// scopes), not per-editor OAuth — the sheet and every linked doc must be
// shared with the service account's email as a viewer. No Drive scope is
// needed: the Docs API can fetch any document ID the service account has
// read access to directly.

import { GoogleAuth } from "google-auth-library";
import { withTimeout } from "./withTimeout.js";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
];

let auth;
function getAuth() {
  if (!auth) {
    const encoded = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
    if (!encoded) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not set");
    }
    let credentials;
    try {
      credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch (e) {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is not valid base64-encoded JSON");
    }
    auth = new GoogleAuth({ credentials, scopes: SCOPES });
  }
  return auth;
}

// Bounds each *individual* Google API call — without it, a hang in either
// leg (the OAuth token exchange with oauth2.googleapis.com, which never even
// reaches `fetch`, or the actual Sheets/Docs call) would hang indefinitely.
// This alone is NOT enough to keep a whole request under the VibeCode
// gateway's own timeout, though: server/routes/articles.js's
// GET /articles/:id/content makes two of these calls *sequentially* (find
// the row via listArticles(), only then fetch the two docs) — up to
// GOOGLE_API_TIMEOUT_MS twice adds up past a gateway that (per production
// observation) appears to cut around 10s. See ROUTE_TIMEOUT_MS in
// articles.js for the outer, whole-route deadline that actually guarantees
// the client gets our translated sheet_unavailable/docs_unavailable error
// instead of the gateway's own bare, generic 502/503.
const GOOGLE_API_TIMEOUT_MS = 8000;

async function authorizedFetch(url) {
  const controller = new AbortController();
  const request = (async () => {
    const client = await getAuth().getClient();
    const { token } = await client.getAccessToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Google API request failed: ${res.status} ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  })();

  return withTimeout(request, GOOGLE_API_TIMEOUT_MS, `Google API timeout after ${GOOGLE_API_TIMEOUT_MS}ms`, {
    onTimeout: () => controller.abort(),
  });
}

// Sheet cells hold full "https://docs.google.com/document/d/<id>/edit" URLs —
// pull out just the ID that the Docs API expects.
export function extractDocId(urlOrId) {
  if (!urlOrId) return null;
  const match = String(urlOrId).match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : String(urlOrId).trim() || null;
}

const REQUIRED_COLUMNS = ["id", "title", "link to content", "draft"];

// Pure: turns raw `values.get` rows into { id, title, draftDocId, finalDocId }
// objects, keyed off header names (case-insensitive) rather than fixed
// column letters, so reordering columns in the sheet doesn't silently break
// this — split out from listArticles() so it's unit-testable without a live
// Sheets API call.
//
// Column semantics (confirmed against the real sheet, corrected after an
// initial mix-up): "draft" holds the AI-generated draft doc, "link to
// content" holds the editor's edited/final doc — the reverse of what the
// column names alone would suggest.
export function parseArticleRows(rows) {
  if (!rows || rows.length === 0) return [];

  const header = rows[0].map((h) => String(h || "").trim().toLowerCase());
  const colIndex = {};
  for (const col of REQUIRED_COLUMNS) {
    const idx = header.indexOf(col);
    if (idx === -1) throw new Error(`Google Sheet is missing required column "${col}"`);
    colIndex[col] = idx;
  }

  return rows
    .slice(1)
    .map((row) => ({
      id: (row[colIndex["id"]] || "").trim(),
      title: (row[colIndex["title"]] || "").trim(),
      draftDocId: extractDocId(row[colIndex["draft"]]),
      finalDocId: extractDocId(row[colIndex["link to content"]]),
    }))
    .filter((a) => a.id && a.title && a.draftDocId && a.finalDocId);
}

export async function listArticles() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set");
  const range = process.env.GOOGLE_SHEET_RANGE || "A:Z";

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const data = await authorizedFetch(url);
  return parseArticleRows(data.values);
}

export async function getArticleById(id) {
  const all = await listArticles();
  return all.find((a) => a.id === id) || null;
}

// Walks a Docs API paragraph's elements, concatenating textRun content and
// tracking hyperlink URLs — the Docs equivalent of mammoth.extractRawText()
// (for text) + mammoth.convertToHtml()/cheerio (for <a href>) combined,
// since the Docs API exposes both in the same structure already.
function walkParagraph(paragraph, textParts, linkOrder, linkText) {
  let openUrl = null;
  for (const el of paragraph.elements || []) {
    const run = el.textRun;
    if (!run) {
      openUrl = null;
      continue;
    }
    textParts.push(run.content);
    const url = run.textStyle?.link?.url;
    if (!url) {
      openUrl = null;
      continue;
    }
    if (!linkText.has(url)) {
      linkText.set(url, run.content);
      linkOrder.push(url);
    } else if (openUrl === url) {
      // Same hyperlink continuing across adjacent runs (e.g. a formatting
      // change mid-link) — keep accumulating its visible anchor text.
      linkText.set(url, linkText.get(url) + run.content);
    }
    openUrl = url;
  }
}

function walkContent(content, textParts, linkOrder, linkText) {
  for (const el of content || []) {
    if (el.paragraph) {
      walkParagraph(el.paragraph, textParts, linkOrder, linkText);
    } else if (el.table) {
      for (const row of el.table.tableRows || []) {
        for (const cell of row.tableCells || []) {
          walkContent(cell.content, textParts, linkOrder, linkText);
        }
      }
    } else if (el.tableOfContents) {
      walkContent(el.tableOfContents.content, textParts, linkOrder, linkText);
    }
  }
}

// Pure: turns a Docs API `documents.get` response into { text, links,
// wordCount } — split out from getDocContent() so it's unit-testable
// without a live Docs API call.
export function parseDocument(doc) {
  const textParts = [];
  const linkOrder = [];
  const linkText = new Map();
  walkContent(doc.body?.content, textParts, linkOrder, linkText);

  const text = textParts.join("");
  const links = linkOrder.map((url) => ({ url, text: linkText.get(url).trim() }));
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return { text, links, wordCount };
}

export async function getDocContent(docId) {
  const url = `https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`;
  const doc = await authorizedFetch(url);
  return parseDocument(doc);
}
