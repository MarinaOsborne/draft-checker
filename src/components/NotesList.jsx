import { BLUE } from "../constants.js";

const tagStyle = {
  rm: { background: "#fce8e8", color: "#a32d2d" },
  add: { background: "#e8f5e9", color: "#2e7d32" },
  fix: { background: "#fff8e6", color: "#a05c00" },
};

export default function NotesList({ notes, t }) {
  if (!notes?.length) return null;
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
        {t.notes.heading}
      </div>
      <div style={{ padding: "0 20px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {notes.map((n, i) => (
          <div
            key={i}
            style={{
              background: "#fafafa",
              border: "1px solid #e5e5e5",
              borderRadius: 10,
              padding: "12px 14px",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                padding: "2px 7px",
                borderRadius: 4,
                display: "inline-block",
                marginBottom: 7,
                ...tagStyle[n.type],
              }}
            >
              {t.notes.label[n.type] || n.label}
            </span>
            <div
              style={{
                fontSize: 12,
                color: "#888",
                borderLeft: `2px solid ${BLUE}`,
                paddingLeft: 9,
                marginBottom: 5,
                fontStyle: "italic",
                lineHeight: 1.5,
              }}
            >
              {n.quote}
            </div>
            <div style={{ fontSize: 12, color: "#1a1a1a", lineHeight: 1.5 }}>{n.comment}</div>
          </div>
        ))}
      </div>
    </>
  );
}
