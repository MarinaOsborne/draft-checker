import { DARK, SUCCESS } from "../constants.js";

export default function UnnecessaryRewrites({ data, t }) {
  if (!data) return null;
  const { count, examples } = data;

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
        {t.unnecessaryRewrites.heading}
        {count > 0 ? ` (${count})` : ""}
      </div>

      {count === 0 ? (
        <div
          style={{
            margin: "0 20px 20px",
            padding: "10px 14px",
            background: "#e8f5e9",
            border: "1px solid #a8d8a8",
            borderRadius: 8,
            fontSize: 12,
            color: SUCCESS,
          }}
        >
          {t.unnecessaryRewrites.none}
        </div>
      ) : (
        <div style={{ padding: "0 20px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {examples.map((ex, i) => (
            <div key={i} style={{ background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ padding: "10px 14px", borderRight: "1px solid #eee" }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#aaa",
                      marginBottom: 5,
                    }}
                  >
                    {t.topEdits.before}
                  </div>
                  <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>{ex.before}</div>
                </div>
                <div style={{ padding: "10px 14px" }}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "#aaa",
                      marginBottom: 5,
                    }}
                  >
                    {t.topEdits.after}
                  </div>
                  <div style={{ fontSize: 11, color: "#1a1a1a", lineHeight: 1.5 }}>{ex.after}</div>
                </div>
              </div>
              {ex.reason && (
                <div style={{ padding: "8px 14px", borderTop: "1px solid #eee", fontSize: 11, color: DARK }}>{ex.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
