import { BLUE, DARK } from "../constants.js";

function InfoBox({ title, wordCount, color, t }) {
  return (
    <div
      style={{
        background: "#e8f4fc",
        border: `1px solid ${color}`,
        borderRadius: 12,
        padding: "14px 16px",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: DARK,
          marginBottom: 7,
        }}
      >
        {title}
      </div>
      <div style={{ fontWeight: 500, color: "#1a1a1a", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15 }}>✓</span>
        {t.upload.uploaded(wordCount ?? "…")}
      </div>
    </div>
  );
}

export default function ArticlePicker({ articles, selectedId, onSelect, draft, final, loadingList, loadingContent, t }) {
  const ready = Boolean(draft.text) && Boolean(final.text);

  return (
    <div style={{ padding: "0 20px", marginBottom: 14 }}>
      <select
        value={selectedId || ""}
        onChange={(e) => e.target.value && onSelect(e.target.value)}
        disabled={loadingList || loadingContent}
        style={{
          width: "100%",
          padding: "12px 14px",
          fontSize: 13,
          borderRadius: 12,
          border: `1px solid ${selectedId ? BLUE : "#e5e5e5"}`,
          background: selectedId ? "#e8f4fc" : "#fafafa",
          color: "#1a1a1a",
          cursor: loadingList || loadingContent ? "not-allowed" : "pointer",
        }}
      >
        <option value="" disabled>
          {loadingList ? t.articlePicker.loadingList : t.articlePicker.placeholder}
        </option>
        {articles.map((a) => (
          <option key={a.id} value={a.id}>
            {a.title}
          </option>
        ))}
      </select>

      {loadingContent && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#aaa" }}>{t.articlePicker.loadingContent}</div>
      )}

      {ready && !loadingContent && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
          <InfoBox title={t.upload.aiDraftTitle} wordCount={draft.wordCount} color={BLUE} t={t} />
          <InfoBox title={t.upload.finalTitle} wordCount={final.wordCount} color={DARK} t={t} />
        </div>
      )}
    </div>
  );
}
