import { useRef } from "react";
import { BLUE, DARK } from "../constants.js";

function FileSlot({ title, subtitle, file, wordCount, accentColor, onSelect, t }) {
  const inputRef = useRef(null);
  const filled = Boolean(file);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      style={{
        background: filled ? "#e8f4fc" : "#fafafa",
        border: `1px solid ${filled ? BLUE : "#e5e5e5"}`,
        borderRadius: 12,
        padding: "14px 16px",
        cursor: "pointer",
        minWidth: 0,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
          e.target.value = "";
        }}
      />
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          color: filled ? DARK : accentColor,
          marginBottom: 7,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontWeight: 500,
          color: filled ? "#1a1a1a" : "#555",
          display: "flex",
          alignItems: "center",
          gap: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 15 }}>{filled ? "✓" : "📄"}</span>
        {filled ? file.name : t.upload.cta}
      </div>
      <div style={{ fontSize: 11, color: filled ? DARK : "#aaa", marginTop: 3 }}>
        {filled ? t.upload.uploaded(wordCount ?? "…") : subtitle}
      </div>
    </div>
  );
}

export default function UploadZone({ draft, final, onDraftSelect, onFinalSelect, t }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
        padding: "0 20px",
        marginBottom: 14,
      }}
    >
      <FileSlot
        title={t.upload.aiDraftTitle}
        subtitle={t.upload.aiDraftSubtitle}
        accentColor={BLUE}
        file={draft.file}
        wordCount={draft.wordCount}
        onSelect={onDraftSelect}
        t={t}
      />
      <FileSlot
        title={t.upload.finalTitle}
        subtitle={t.upload.finalSubtitle}
        accentColor={DARK}
        file={final.file}
        wordCount={final.wordCount}
        onSelect={onFinalSelect}
        t={t}
      />
    </div>
  );
}
