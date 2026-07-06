import { DARK } from "../constants.js";

export default function TopEdits({ edits, t }) {
  if (!edits?.length) return null;
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
        {t.topEdits.heading}
      </div>
      <div style={{ padding: "0 20px", marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
        {edits.map((e, i) => (
          <div
            key={i}
            style={{
              background: "#fafafa",
              border: "1px solid #e5e5e5",
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                background: "#f0f7fd",
                borderBottom: "1px solid #ddeef8",
              }}
            >
              <div
                style={{
                  width: 19,
                  height: 19,
                  borderRadius: "50%",
                  background: DARK,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{e.title}</span>
              <span style={{ fontSize: 11, color: "#aaa", marginLeft: "auto" }}>{e.why}</span>
            </div>
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
                <div style={{ fontSize: 11, color: "#999", lineHeight: 1.5 }}>{e.before}</div>
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
                <div style={{ fontSize: 11, color: "#1a1a1a", lineHeight: 1.5 }}>{e.after}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
