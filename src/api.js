const PIN_STORAGE_KEY = "aqc_pin";
const USERNAME_STORAGE_KEY = "aqc_username";

function getPin() {
  return sessionStorage.getItem(PIN_STORAGE_KEY) || "";
}

export function setPin(pin) {
  sessionStorage.setItem(PIN_STORAGE_KEY, pin);
}

export function clearPin() {
  sessionStorage.removeItem(PIN_STORAGE_KEY);
}

export function getUsername() {
  return sessionStorage.getItem(USERNAME_STORAGE_KEY) || "";
}

export function setUsername(name) {
  sessionStorage.setItem(USERNAME_STORAGE_KEY, name);
}

export function isLoggedIn() {
  return Boolean(getPin()) && Boolean(getUsername());
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-Access-Pin": getPin(),
      // HTTP-заголовки по спеке — ASCII/Latin-1, а Node парсит их как
      // latin1 — кириллица и другие не-ASCII имена приходят на сервер
      // побитово испорченными без encodeURIComponent (проверено на
      // практике: "Мария Иванова" превращалось в мусор).
      "X-Username": encodeURIComponent(getUsername()),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `Request failed: ${res.status}`);
    err.status = res.status;
    // Гейтвей платформы VibeCode может оборвать запрос по тайм-ауту и
    // вернуть свой собственный 502/503 без JSON-тела в нашем формате (наше
    // приложение само 503 никогда не отдаёт) — в этом случае body.code
    // пустой, и раньше пользователь видел сырое "Request failed: 503"
    // вместо перевода. Подставляем общий код только когда наш сервер сам
    // не прислал более конкретный (например ai_unavailable/analyze_failed).
    err.code = body.code || (res.status === 502 || res.status === 503 ? "server_unavailable" : undefined);
    err.resetDate = body.resetDate;
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

export async function getArticles(language) {
  const q = new URLSearchParams({ language });
  return request(`/api/article-list?${q.toString()}`);
}

export async function getArticleContent(id, language) {
  const q = new URLSearchParams({ language });
  return request(`/api/article-list/${encodeURIComponent(id)}/content?${q.toString()}`);
}

export async function getRunCount(language, filename) {
  const q = new URLSearchParams({ language, filename });
  return request(`/api/runs?${q.toString()}`);
}

export async function getMonthlyStatus() {
  return request("/api/runs/monthly");
}

export async function resetRunCount(language, filename) {
  return request("/api/runs/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, filename }),
  });
}

export async function analyzeArticle({ draftText, finalText, language, finalFilename, draftLinks, finalLinks }) {
  return request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftText, finalText, language, finalFilename, draftLinks, finalLinks }),
  });
}
