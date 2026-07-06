import { useRef } from "react";
import { BLUE, DARK } from "../constants.js";

function FileSlot({ title, subtitle, file, wordCount, accentColor, onSelect }) {
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
        {filled ? file.name : `Загрузить .docx`}
      </div>
      <div style={{ fontSize: 11, color: filled ? DARK : "#aaa", marginTop: 3 }}>
        {filled ? `Загружено · ${wordCount ?? "…"} слов` : subtitle}
      </div>
    </div>
  );
}

export default function UploadZone({ draft, final, onDraftSelect, onFinalSelect }) {
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
        title="AI draft"
        subtitle="Файл, который редактор получил от тебя"
        accentColor={BLUE}
        file={draft.file}
        wordCount={draft.wordCount}
        onSelect={onDraftSelect}
      />
      <FileSlot
        title="Готовый текст"
        subtitle="Отредактированная версия редактора"
        accentColor={DARK}
        file={final.file}
        wordCount={final.wordCount}
        onSelect={onFinalSelect}
      />
    </div>
  );
}
