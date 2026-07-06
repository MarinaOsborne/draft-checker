import { useMemo } from "react";
import { diffWords } from "diff";

export default function DiffView({ draftText, finalText, t }) {
  const parts = useMemo(() => diffWords(draftText || "", finalText || ""), [draftText, finalText]);
  const legend = [
    ["#eaf3de", "#97c459", t.diff.added],
    ["#fce8e8", "#f09595", t.diff.removed],
    ["#f0f0f0", "#ccc", t.diff.unchanged],
  ];

  return (
    <>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "#aaa",
          padding: "0 20px",
          marginBottom: 10,
        }}
      >
        {t.diff.heading}
      </div>
      <div
        style={{
          margin: "0 20px 24px",
          background: "#fafafa",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "center",
            padding: "8px 16px",
            background: "#f0f7fd",
            borderBottom: "1px solid #ddeef8",
          }}
        >
          {legend.map(([bg, br, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888" }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: bg, border: `1px solid ${br}`, flexShrink: 0 }} />
              {label}
            </div>
          ))}
        </div>
        <div style={{ padding: "14px 16px", fontSize: 12, lineHeight: 2.1, maxHeight: 420, overflowY: "auto" }}>
          {parts.map((p, i) => {
            if (p.added) {
              return (
                <span key={i} style={{ background: "#eaf3de", color: "#3b6d11", borderRadius: 2, padding: "1px 3px" }}>
                  {p.value}
                </span>
              );
            }
            if (p.removed) {
              return (
                <span
                  key={i}
                  style={{ background: "#fce8e8", color: "#a32d2d", borderRadius: 2, padding: "1px 3px", textDecoration: "line-through" }}
                >
                  {p.value}
                </span>
              );
            }
            return (
              <span key={i} style={{ color: "#888" }}>
                {p.value}
              </span>
            );
          })}
        </div>
      </div>
    </>
  );
}
