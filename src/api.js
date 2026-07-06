const PIN_STORAGE_KEY = "aqc_pin";

function getPin() {
  return sessionStorage.getItem(PIN_STORAGE_KEY) || "";
}

export function setPin(pin) {
  sessionStorage.setItem(PIN_STORAGE_KEY, pin);
}

export function clearPin() {
  sessionStorage.removeItem(PIN_STORAGE_KEY);
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Access-Pin": getPin(),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    err.code = body.code;
    throw err;
  }
  return res.json();
}

export async function verifyPin(pin) {
  const res = await fetch("/api/verify-pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  return res.ok;
}

export async function parseDocx(file) {
  const form = new FormData();
  form.append("file", file);
  return request("/api/parse", { method: "POST", body: form });
}

export async function getRunCount(language, filename) {
  const q = new URLSearchParams({ language, filename });
  return request(`/api/runs?${q.toString()}`);
}

export async function resetRunCount(language, filename) {
  return request("/api/runs/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, filename }),
  });
}

export async function analyzeArticle({ draftText, finalText, language, finalFilename }) {
  return request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftText, finalText, language, finalFilename }),
  });
}
