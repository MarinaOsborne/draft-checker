import { useEffect, useState } from "react";
import PinScreen from "./components/PinScreen.jsx";
import Header from "./components/Header.jsx";
import UploadZone from "./components/UploadZone.jsx";
import RunCounter from "./components/RunCounter.jsx";
import ScoreCard from "./components/ScoreCard.jsx";
import NotesList from "./components/NotesList.jsx";
import TopEdits from "./components/TopEdits.jsx";
import UnnecessaryRewrites from "./components/UnnecessaryRewrites.jsx";
import DiffView from "./components/DiffView.jsx";
import { parseDocx, getRunCount, resetRunCount, analyzeArticle, getMonthlyStatus, clearPin } from "./api.js";
import { LANGS, MAX_RUNS, MAX_MONTHLY_RUNS, DARK } from "./constants.js";
import { getTranslations, formatDate } from "./i18n.js";

const EMPTY_FILE = { file: null, text: "", wordCount: 0, links: [] };

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem("aqc_pin")));
  const [activeLang, setActiveLang] = useState(LANGS[0]);
  const t = getTranslations(activeLang);
  const [draft, setDraft] = useState(EMPTY_FILE);
  const [final, setFinal] = useState(EMPTY_FILE);
  const [runsCount, setRunsCount] = useState(0);
  const [uploading, setUploading] = useState(null); // "draft" | "final" | null
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
    if (!authenticated || !final.file) {
      setRunsCount(0);
      return;
    }
    getRunCount(activeLang, final.file.name)
      .then((r) => setRunsCount(r.runs))
      .catch((e) => handleAuthError(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeLang, final.file]);

  const ERROR_CODE_KEYS = {
    no_file: "noFile",
    bad_format: "badFormat",
    parse_failed: "parseFailed",
    bad_request: "badRequest",
    analyze_failed: "analyzeFailed",
    ai_unavailable: "aiUnavailable",
    server_unavailable: "serverUnavailable",
    file_too_large: "fileTooLarge",
    upload_failed: "uploadFailed",
    internal_error: "internalError",
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

  async function handleFileSelect(slot, file) {
    setError(null);
    setShowResult(false);
    setUploading(slot);
    try {
      const parsed = await parseDocx(file);
      const entry = { file, text: parsed.text, wordCount: parsed.wordCount, links: parsed.links || [] };
      if (slot === "draft") setDraft(entry);
      else setFinal(entry);
    } catch (e) {
      handleAuthError(e);
    } finally {
      setUploading(null);
    }
  }

  function handleLangChange(lang) {
    setActiveLang(lang);
    setShowResult(false);
    setResult(null);
  }

  async function handleRun() {
    if (exhausted || monthlyExhausted || !bothReady || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await analyzeArticle({
        draftText: draft.text,
        finalText: final.text,
        language: activeLang,
        finalFilename: final.file.name,
        draftLinks: draft.links,
        finalLinks: final.links,
      });
      setResult(res.result);
      setRunsCount(res.runsCount);
      if (res.monthlyRunsCount >= MAX_MONTHLY_RUNS) setMonthlyExhausted(true);
      setShowResult(true);
    } catch (e) {
      if (e.code === "limit_exceeded") {
        setRunsCount(MAX_RUNS);
      } else if (e.code === "monthly_limit_exceeded") {
        setMonthlyExhausted(true);
        setMonthlyResetDate(e.resetDate);
      } else {
        handleAuthError(e);
      }
    } finally {
      setAnalyzing(false);
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

      <UploadZone
        draft={draft}
        final={final}
        onDraftSelect={(f) => handleFileSelect("draft", f)}
        onFinalSelect={(f) => handleFileSelect("final", f)}
        t={t}
      />

      {uploading && (
        <div style={{ padding: "0 20px", marginBottom: 12, fontSize: 12, color: "#aaa" }}>
          {t.parsing.label(uploading === "draft" ? t.parsing.draft : t.parsing.final)}
        </div>
      )}

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
