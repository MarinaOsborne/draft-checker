import { useMemo } from "react";
import { diffSentences, diffWords } from "diff";

// Ниже 35% пересечения слов — считаем, что предложение переписано целиком, и
// не пытаемся искать словесные совпадения внутри него. Иначе на сильно
// переписанных абзацах word-diff цепляется за случайные предлоги/союзы
// (напр. "di", "a", "e") в обоих предложениях, и удалённый кусок из середины
// старого предложения визуально "всплывает" посреди нового — вместо
// естественного порядка "было → стало" получается нечитаемая мешанина.
const SENTENCE_OVERLAP_THRESHOLD = 0.35;

function tokenizeWords(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}

// Overlap coefficient (|A∩B| / min(|A|,|B|)), а не Jaccard — иначе короткое
// предложение, полностью "растворившееся" в длинном переписанном абзаце,
// давало бы заниженный процент только из-за разницы в длине.
function wordOverlapRatio(a, b) {
  const setA = new Set(tokenizeWords(a));
  const setB = new Set(tokenizeWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let common = 0;
  for (const w of setA) if (setB.has(w)) common++;
  return common / Math.min(setA.size, setB.size);
}

function smartDiff(draftText, finalText) {
  const sentenceParts = diffSentences(draftText || "", finalText || "");
  const result = [];
  let i = 0;
  while (i < sentenceParts.length) {
    const part = sentenceParts[i];
    const next = sentenceParts[i + 1];
    const removedThenAdded = part?.removed && next?.added;
    const addedThenRemoved = part?.added && next?.removed;

    if (removedThenAdded || addedThenRemoved) {
      const removedPart = removedThenAdded ? part : next;
      const addedPart = removedThenAdded ? next : part;
      const overlap = wordOverlapRatio(removedPart.value, addedPart.value);
      if (overlap >= SENTENCE_OVERLAP_THRESHOLD) {
        // Похожие предложения — уточняем разницу на уровне слов внутри пары.
        result.push(...diffWords(removedPart.value, addedPart.value));
      } else {
        // Разные по сути предложения — оставляем целыми блоками, без
        // ложного якорения на общих предлогах/частицах.
        result.push(part, next);
      }
      i += 2;
      continue;
    }

    result.push(part);
    i += 1;
  }
  return result;
}

export default function DiffView({ draftText, finalText, t }) {
  const parts = useMemo(() => smartDiff(draftText, finalText), [draftText, finalText]);
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
