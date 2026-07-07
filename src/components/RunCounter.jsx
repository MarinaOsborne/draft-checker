import { MAX_RUNS, DARK } from "../constants.js";

export default function RunCounter({ filename, runs, onReset, resetting, isAdmin, t }) {
  const remaining = MAX_RUNS - runs;
  const exhausted = remaining <= 0;
  const bg = exhausted ? "#fce8e8" : remaining === 1 ? "#fff8e6" : "#e8f4fc";
  const border = exhausted ? "#f09595" : remaining === 1 ? "#f5d97a" : "#a8d8f0";
  const col = exhausted ? "#a32d2d" : remaining === 1 ? "#a05c00" : DARK;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", gap: 5 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: i < runs ? (exhausted ? "#e24b4a" : DARK) : "#dde3ef",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>
      <span style={{ color: col, fontWeight: 500 }}>
        {exhausted ? t.runCounter.exhausted : t.runCounter.remaining(remaining, MAX_RUNS)}
      </span>
      {filename && <span style={{ color: "#888", fontSize: 11 }}>· {filename}</span>}
      {exhausted && isAdmin && (
        <button
          onClick={onReset}
          disabled={resetting}
          style={{
            marginLeft: "auto",
            fontSize: 11,
            padding: "2px 9px",
            background: "white",
            border: "1px solid #f09595",
            borderRadius: 6,
            color: "#a32d2d",
            cursor: resetting ? "not-allowed" : "pointer",
          }}
        >
          {resetting ? t.runCounter.resetting : t.runCounter.reset}
        </button>
      )}
    </div>
  );
}
