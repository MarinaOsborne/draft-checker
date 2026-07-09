import logo from "../assets/bitrix24-logo.png";
import { LANGS, BLUE, DARK, BRAND_FONT } from "../constants.js";

export default function Header({ activeLang, onLangChange, t }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 20px",
        borderBottom: `2px solid ${BLUE}`,
        marginBottom: 16,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={logo} alt="Bitrix24" style={{ height: 36, width: "auto" }} />
        <div style={{ borderLeft: "1px solid #ddd", paddingLeft: 12 }}>
          <div style={{ fontFamily: BRAND_FONT, fontStyle: "italic", fontWeight: 700, fontSize: 20, color: DARK, lineHeight: 1.1 }}>
            Vissarion
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>{t.tagline}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {LANGS.map((l) => (
          <span
            key={l}
            onClick={() => onLangChange(l)}
            style={{
              fontSize: 11,
              padding: "3px 9px",
              borderRadius: 20,
              cursor: "pointer",
              border: activeLang === l ? `1px solid ${BLUE}` : "1px solid #e0e0e0",
              color: activeLang === l ? "#fff" : "#555",
              background: activeLang === l ? BLUE : "#fafafa",
              fontWeight: activeLang === l ? 600 : 400,
              transition: "all 0.15s",
            }}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
