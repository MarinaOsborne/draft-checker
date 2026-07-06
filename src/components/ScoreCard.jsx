import { CRITERIA_KEYS, BLUE, DARK, SUCCESS, WARNING, ERROR } from "../constants.js";

const pillStyle = {
  ok: { background: "#e8f5e9", color: "#2e7d32" },
  warn: { background: "#fff8e6", color: "#a05c00" },
  crit: { background: "#fce8e8", color: "#a32d2d" },
};

function bucket(val, t) {
  if (val >= 7) return { color: SUCCESS, type: "ok", tag: val >= 8.25 ? t.tag.excellent : t.tag.good };
  if (val >= 5) return { color: WARNING, type: "warn", tag: t.tag.couldBeBetter };
  return { color: ERROR, type: "crit", tag: t.tag.weak };
}

export default function ScoreCard({ result, t }) {
  const isReady = result.verdict === "ready";

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
        {t.score.heading}
      </div>

      <div
        style={{
          margin: "0 20px 20px",
          background: "#fafafa",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid #eee",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: "50%",
                border: `3px solid ${BLUE}`,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 19, fontWeight: 700, color: BLUE, lineHeight: 1 }}>
                {result.overall_score}
              </span>
              <span style={{ fontSize: 10, color: "#aaa" }}>/100</span>
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: DARK }}>{result.grade}</span>
              </div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>{result.verdict_text}</div>
            </div>
          </div>
          <div
            style={{
              fontSize: 11,
              padding: "5px 12px",
              background: isReady ? "#e8f5e9" : "#fff8e6",
              color: isReady ? "#2e7d32" : "#a05c00",
              borderRadius: 20,
              border: `1px solid ${isReady ? "#a8d8a8" : "#f5d97a"}`,
              whiteSpace: "nowrap",
            }}
          >
            {isReady ? t.score.ready : t.score.notReady}
          </div>
        </div>

        {CRITERIA_KEYS.map((key, i) => {
          const val = result.scores?.[key] ?? 0;
          const { color, type, tag } = bucket(val, t);
          return (
            <div
              key={key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 18px",
                borderTop: i === 0 ? "none" : "1px solid #f0f0f0",
              }}
            >
              <span style={{ fontSize: 12, color: "#666", minWidth: 190 }}>{t.criteria[key]}</span>
              <div
                style={{
                  flex: 1,
                  height: 4,
                  background: "#ebebeb",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${val * 10}%`,
                    height: "100%",
                    background: color,
                    borderRadius: 2,
                  }}
                />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 30, textAlign: "right" }}>
                {val}
              </span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, ...pillStyle[type] }}>
                {tag}
              </span>
            </div>
          );
        })}

        {result.red_flags?.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 7,
              flexWrap: "wrap",
              padding: "12px 18px",
              borderTop: "1px solid #eee",
            }}
          >
            {result.red_flags.map((f, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  background: "#fce8e8",
                  border: "1px solid #f09595",
                  borderRadius: 7,
                  padding: "5px 10px",
                  fontSize: 11,
                  color: "#7a1f1f",
                }}
              >
                ⚠ {f}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
