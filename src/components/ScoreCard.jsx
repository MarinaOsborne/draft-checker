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

const sectionLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "#aaa",
  padding: "0 20px",
  marginBottom: 10,
};

function HumanValueAdded({ hva, verdict, verdictText, t }) {
  const isReady = verdict === "ready";
  const metrics = [
    [hva.statistics_added, t.humanValueAdded.statisticsAdded],
    [hva.real_world_examples_added, t.humanValueAdded.realWorldExamplesAdded],
    [hva.bitrix24_integrations_added, t.humanValueAdded.bitrix24IntegrationsAdded],
    [hva.ai_cliches_removed, t.humanValueAdded.aiClichesRemoved],
    [hva.filler_sentences_removed, t.humanValueAdded.fillerSentencesRemoved],
  ];
  const total = metrics.reduce((sum, [n]) => sum + n, 0);

  return (
    <>
      <div style={sectionLabelStyle}>{t.humanValueAdded.heading}</div>
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
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 22, fontWeight: 700, color: BLUE, lineHeight: 1 }}>{total}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: DARK }}>{t.humanValueAdded.heading}</div>
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

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 1,
            background: "#eee",
          }}
        >
          {metrics.map(([n, label]) => (
            <div key={label} style={{ background: "#fafafa", padding: "10px 14px" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: DARK }}>{n}</div>
              <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
            </div>
          ))}
        </div>

        {(hva.summary || verdictText) && (
          <div
            style={{
              padding: "12px 18px",
              borderTop: "1px solid #eee",
              fontSize: 12,
              color: "#555",
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            {hva.summary || verdictText}
          </div>
        )}
      </div>
    </>
  );
}

function CriteriaBreakdown({ criteria, redFlags, t }) {
  return (
    <div style={{ margin: "0 20px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
      {CRITERIA_KEYS.map((key) => {
        const c = criteria[key] || { score: 0, explanation: "", evidence: [] };
        const { color, type, tag } = bucket(c.score, t);
        const noEvidenceText = key === "ai_sterility" ? t.criteriaEvidence.noAiPatterns : t.criteriaEvidence.noneGeneric;
        return (
          <div key={key} style={{ background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "#666", minWidth: 190 }}>{t.criteria[key]}</span>
              <div style={{ flex: 1, height: 4, background: "#ebebeb", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${c.score * 10}%`, height: "100%", background: color, borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, minWidth: 30, textAlign: "right" }}>{c.score}</span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, ...pillStyle[type] }}>{tag}</span>
            </div>

            {c.explanation && (
              <div style={{ fontSize: 12, color: "#555", marginTop: 8 }}>
                {t.criteria[key]} {c.score}/10 — {c.explanation}
              </div>
            )}

            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {c.evidence.length > 0 ? (
                c.evidence.map((q, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: 11,
                      color: "#888",
                      borderLeft: `2px solid ${BLUE}`,
                      paddingLeft: 8,
                      fontStyle: "italic",
                      lineHeight: 1.5,
                    }}
                  >
                    „{q}"
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 11, color: "#bbb", fontStyle: "italic" }}>{noEvidenceText}</div>
              )}
            </div>
          </div>
        );
      })}

      {redFlags?.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {redFlags.map((f, i) => (
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
  );
}

export default function ScoreCard({ result, t }) {
  return (
    <>
      <HumanValueAdded hva={result.human_value_added} verdict={result.verdict} verdictText={result.verdict_text} t={t} />
      <CriteriaBreakdown criteria={result.criteria} redFlags={result.red_flags} t={t} />
    </>
  );
}
