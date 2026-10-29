import { useEffect, useRef, useState } from "react";
import PinScreen from "./components/PinScreen.jsx";
import Header from "./components/Header.jsx";
import ArticlePicker from "./components/ArticlePicker.jsx";
import RunCounter from "./components/RunCounter.jsx";
import ScoreCard from "./components/ScoreCard.jsx";
import NotesList from "./components/NotesList.jsx";
import TopEdits from "./components/TopEdits.jsx";
import UnnecessaryRewrites from "./components/UnnecessaryRewrites.jsx";
import DiffView from "./components/DiffView.jsx";
import {
  getArticles,
  getArticleContent,
  getRunCount,
  resetRunCount,
  startAnalysis,
  getAnalysisStatus,
  getMonthlyStatus,
  clearPin,
  isLoggedIn,
} from "./api.js";
import { LANGS, MAX_RUNS, MAX_MONTHLY_RUNS, DARK } from "./constants.js";
import { getTranslations, formatDate } from "./i18n.js";

const EMPTY_FILE = { file: null, text: "", wordCount: 0, links: [] };

// Переживает обновление страницы (в отличие от React state) — чтобы
// GET /api/analyze/:jobId можно было доспросить после F5, пока задание ещё
// выполняется в фоне на сервере или уже готово, но ответ пока не долетел.
const ACTIVE_JOB_KEY = "vissarion_active_job";
const POLL_INTERVAL_MS = 2000;
// Чуть больше серверного порога "задание потеряно" (см. JOB_STALE_THRESHOLD_MS
// в server/lib/jobsStore.js) — сервер должен сам перевести статус в "lost"
// первым; этот потолок — подстраховка на случай, если опрос почему-то не
// получил ни одного ответа вовсе.
const CLIENT_POLL_CEILING_MS = 6 * 60 * 1000;

function readActiveJob() {
  try {
    const raw = localStorage.getItem(ACTIVE_JOB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeActiveJob(data) {
  try {
    localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(data));
  } catch {
    // приватный режим браузера и т.п. — не критично, просто не переживёт refresh
  }
}

function clearActiveJob() {
  try {
    localStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {
    // не критично
  }
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => isLoggedIn());
  const [activeLang, setActiveLang] = useState(LANGS[0]);
  const t = getTranslations(activeLang);
  const [articles, setArticles] = useState([]);
  const [selectedArticleId, setSelectedArticleId] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [draft, setDraft] = useState(EMPTY_FILE);
  const [final, setFinal] = useState(EMPTY_FILE);
  const [runsCount, setRunsCount] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [error, setError] = useState(null);
  const [monthlyExhausted, setMonthlyExhausted] = useState(false);
  const [monthlyResetDate, setMonthlyResetDate] = useState(null);

  const exhausted = runsCount >= MAX_RUNS;
  const bothReady = Boolean(draft.text) && Boolean(final.text);
  const isAdmin = new URLSearchParams(window.location.search).get("admin") === "true";
  // jobId опрашиваемого сейчас задания — в ref, а не в state: должен быть
  // виден синхронно внутри самого себя (рекурсивный setTimeout), и служит
  // флагом отмены, если пользователь переключил язык/статью посреди опроса.
  const pollingJobIdRef = useRef(null);

  useEffect(() => {
    if (!authenticated) return;
    getMonthlyStatus()
      .then((r) => {
        setMonthlyExhausted(r.runs >= r.max);
        setMonthlyResetDate(r.resetDate);
      })
      .catch((e) => handleAuthError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    setLoadingList(true);
    getArticles(activeLang)
      .then((r) => setArticles(r.articles))
      .catch((e) => handleAuthError(e))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeLang]);

  useEffect(() => {
    if (!authenticated || !final.file) {
      setRunsCount(0);
      return;
    }
    getRunCount(activeLang, final.file.name)
      .then((r) => setRunsCount(r.runs))
      .catch((e) => handleAuthError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeLang, final.file]);

  // Восстановление после обновления страницы: jobId лежит в localStorage
  // (переживает F5, в отличие от React state), поэтому сразу после логина
  // можно доспросить задание, которое выполнялось или уже завершилось, пока
  // вкладка была закрыта/перезагружена. Текст статьи для DiffView при этом
  // перезапрашивается заново через getArticleContent — сам текст нигде не
  // хранился (ни в localStorage, ни на сервере в задании), только итоговый
  // отчёт (result) и метаданные.
  useEffect(() => {
    if (!authenticated) return;
    const saved = readActiveJob();
    if (!saved || !saved.jobId) return;

    (async () => {
      if (saved.language && saved.language !== activeLang) setActiveLang(saved.language);
      if (saved.articleId) {
        setSelectedArticleId(saved.articleId);
        setLoadingContent(true);
        try {
          const content = await getArticleContent(saved.articleId, saved.language || activeLang);
          const fileRef = { name: content.title };
          setDraft({ file: fileRef, text: content.draft.text, wordCount: content.draft.wordCount, links: content.draft.links });
          setFinal({ file: fileRef, text: content.final.text, wordCount: content.final.wordCount, links: content.final.links });
        } catch {
          // Не получилось восстановить текст для DiffView (например, статью
          // удалили из таблицы) — не критично, сам отчёт из задания всё
          // равно попробуем получить ниже.
        } finally {
          setLoadingContent(false);
        }
      }
      setAnalyzing(true);
      pollingJobIdRef.current = saved.jobId;
      pollJob(saved.jobId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const ERROR_CODE_KEYS = {
    bad_request: "badRequest",
    analyze_failed: "analyzeFailed",
    ai_unavailable: "aiUnavailable",
    server_unavailable: "serverUnavailable",
    internal_error: "internalError",
    sheet_unavailable: "sheetUnavailable",
    docs_unavailable: "docsUnavailable",
    article_not_found: "articleNotFound",
    server_busy: "serverBusy",
    job_lost: "jobLost",
  };

  function handleAuthError(e) {
    if (e.status === 401) {
      clearPin();
      setAuthenticated(false);
      return;
    }
    const key = ERROR_CODE_KEYS[e.code];
    setError(key ? t.errors[key] : e.message);
  }

  // Рекурсивный опрос статуса задания (а не setInterval) — следующий запрос
  // планируется только после того, как предыдущий действительно завершился,
  // так что опросы никогда не накладываются друг на друга. pollingJobIdRef
  // одновременно служит и источником истины "что сейчас опрашиваем", и
  // флагом отмены: если он поменялся (пользователь переключил язык/статью)
  // или стал null, функция просто перестаёт обновлять состояние — тихо,
  // без ошибки.
  async function pollJob(jobId, startedAt = Date.now()) {
    if (pollingJobIdRef.current !== jobId) return;

    if (Date.now() - startedAt > CLIENT_POLL_CEILING_MS) {
      pollingJobIdRef.current = null;
      clearActiveJob();
      setAnalyzing(false);
      setError(t.errors.jobLost);
      return;
    }

    let status;
    try {
      status = await getAnalysisStatus(jobId);
    } catch (e) {
      if (pollingJobIdRef.current !== jobId) return;
      if (e.status === 401) {
        handleAuthError(e);
        return;
      }
      if (e.code === "job_not_found") {
        pollingJobIdRef.current = null;
        clearActiveJob();
        setAnalyzing(false);
        setError(t.errors.jobLost);
        return;
      }
      // Временный сбой самого опроса (не статуса задания) — пробуем ещё раз
      // на следующем тике, не сдаёмся с первого раза.
      setTimeout(() => pollJob(jobId, startedAt), POLL_INTERVAL_MS);
      return;
    }

    if (pollingJobIdRef.current !== jobId) return;

    if (status.status === "pending") {
      setTimeout(() => pollJob(jobId, startedAt), POLL_INTERVAL_MS);
      return;
    }

    pollingJobIdRef.current = null;
    clearActiveJob();
    setAnalyzing(false);

    if (status.status === "done") {
      setResult(status.result);
      setRunsCount(status.runsCount);
      if (status.monthlyRunsCount >= MAX_MONTHLY_RUNS) setMonthlyExhausted(true);
      setShowResult(true);
      return;
    }

    // status.status === "error" | "lost"
    const key = ERROR_CODE_KEYS[status.code];
    setError(key ? t.errors[key] : status.error || t.errors.analyzeFailed);
  }

  async function handleArticleSelect(articleId) {
    pollingJobIdRef.current = null;
    clearActiveJob();
    setAnalyzing(false);
    setError(null);
    setShowResult(false);
    setResult(null);
    setSelectedArticleId(articleId);
    setLoadingContent(true);
    try {
      const content = await getArticleContent(articleId, activeLang);
      const fileRef = { name: content.title };
      setDraft({ file: fileRef, text: content.draft.text, wordCount: content.draft.wordCount, links: content.draft.links });
      setFinal({ file: fileRef, text: content.final.text, wordCount: content.final.wordCount, links: content.final.links });
    } catch (e) {
      setDraft(EMPTY_FILE);
      setFinal(EMPTY_FILE);
      handleAuthError(e);
    } finally {
      setLoadingContent(false);
    }
  }

  function handleLangChange(lang) {
    pollingJobIdRef.current = null;
    clearActiveJob();
    setAnalyzing(false);
    setActiveLang(lang);
    setShowResult(false);
    setResult(null);
    // Each language reads a different sheet tab (see ArticlePicker's fetch
    // effect above), so a previously selected article belongs to the old
    // language's list and no longer applies.
    setSelectedArticleId(null);
    setDraft(EMPTY_FILE);
    setFinal(EMPTY_FILE);
  }

  async function handleRun() {
    if (exhausted || monthlyExhausted || !bothReady || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const { jobId } = await startAnalysis({
        draftText: draft.text,
        finalText: final.text,
        language: activeLang,
        finalFilename: final.file.name,
        draftLinks: draft.links,
        finalLinks: final.links,
      });
      pollingJobIdRef.current = jobId;
      writeActiveJob({ jobId, articleId: selectedArticleId, language: activeLang });
      pollJob(jobId);
    } catch (e) {
      setAnalyzing(false);
      if (e.code === "limit_exceeded") {
        setRunsCount(MAX_RUNS);
      } else if (e.code === "monthly_limit_exceeded") {
        setMonthlyExhausted(true);
        setMonthlyResetDate(e.resetDate);
      } else {
        handleAuthError(e);
      }
    }
  }

  async function handleReset() {
    if (!final.file) return;
    setResetting(true);
    try {
      const res = await resetRunCount(activeLang, final.file.name);
      setRunsCount(res.runs);
      setShowResult(false);
      setResult(null);
    } catch (e) {
      handleAuthError(e);
    } finally {
      setResetting(false);
    }
  }

  if (!authenticated) {
    return <PinScreen onSuccess={() => setAuthenticated(true)} t={t} />;
  }

  return (
    <div
      style={{
        fontFamily: "system-ui,sans-serif",
        fontSize: 13,
        color: "#1a1a1a",
        maxWidth: 700,
        margin: "0 auto",
        padding: "0 0 2rem",
      }}
    >
      <Header activeLang={activeLang} onLangChange={handleLangChange} t={t} />

      {monthlyExhausted && (
        <div
          style={{
            margin: "0 20px 14px",
            padding: "10px 14px",
            background: "#fce8e8",
            border: "1px solid #f09595",
            borderRadius: 8,
            fontSize: 12,
            color: "#a32d2d",
            fontWeight: 500,
          }}
        >
          {t.monthlyLimit.reached(monthlyResetDate ? formatDate(monthlyResetDate, activeLang) : "…")}
        </div>
      )}

      <ArticlePicker
        articles={articles}
        selectedId={selectedArticleId}
        onSelect={handleArticleSelect}
        draft={draft}
        final={final}
        loadingList={loadingList}
        loadingContent={loadingContent}
        t={t}
      />

      {error && (
        <div
          style={{
            margin: "0 20px 12px",
            padding: "8px 14px",
            background: "#fce8e8",
            border: "1px solid #f09595",
            borderRadius: 8,
            fontSize: 12,
            color: "#a32d2d",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ padding: "0 20px", marginBottom: 12 }}>
        <RunCounter
          filename={final.file?.name}
          runs={runsCount}
          onReset={handleReset}
          resetting={resetting}
          isAdmin={isAdmin}
          t={t}
        />
      </div>

      <div style={{ padding: "0 20px", marginBottom: 20, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleRun}
          disabled={exhausted || monthlyExhausted || !bothReady || analyzing}
          style={{
            background: exhausted || monthlyExhausted || !bothReady ? "#ccc" : DARK,
            color: "#fff",
            border: "none",
            padding: "9px 22px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            cursor: exhausted || monthlyExhausted || !bothReady || analyzing ? "not-allowed" : "pointer",
            opacity: exhausted || monthlyExhausted || !bothReady ? 0.7 : 1,
            display: "flex",
            alignItems: "center",
            gap: 7,
            transition: "all 0.15s",
          }}
        >
          ✦ {analyzing ? t.runButton.analyzing : exhausted || monthlyExhausted ? t.runButton.exhausted : t.runButton.cta}
        </button>
        {!exhausted && !monthlyExhausted && bothReady && !analyzing && (
          <span style={{ fontSize: 12, color: "#aaa" }}>{t.runButton.eta}</span>
        )}
        {exhausted && !monthlyExhausted && <span style={{ fontSize: 12, color: "#a32d2d" }}>{t.runButton.contactAdmin}</span>}
      </div>

      {showResult && result && (
        <>
          <ScoreCard result={result} t={t} />
          <NotesList notes={result.notes} t={t} />
          <TopEdits edits={result.top_edits} t={t} />
          <UnnecessaryRewrites data={result.unnecessary_rewrites} t={t} />
          <DiffView draftText={draft.text} finalText={final.text} t={t} />
        </>
      )}

      {!showResult && !exhausted && !monthlyExhausted && (
        <div style={{ padding: "40px 20px", textAlign: "center", color: "#aaa", fontSize: 13 }}>
          {bothReady ? t.placeholder.ready : t.placeholder.notReady}
        </div>
      )}

      {exhausted && !showResult && (
        <div
          style={{
            margin: "0 20px",
            padding: "24px",
            background: "#fce8e8",
            border: "1px solid #f09595",
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 8 }}>🚫</div>
          <div style={{ fontWeight: 600, color: "#a32d2d", marginBottom: 4 }}>{t.exhaustedPanel.title}</div>
          <div style={{ fontSize: 12, color: "#c0392b" }}>
            {t.exhaustedPanel.body(final.file?.name, MAX_RUNS)}
            <br />
            {t.exhaustedPanel.contact}
          </div>
        </div>
      )}
    </div>
  );
}
