import { useState } from "react";
import logo from "../assets/bitrix24-logo.png";
import { verifyPin, setPin, setUsername } from "../api.js";
import { DARK, ERROR, BRAND_FONT } from "../constants.js";

export default function PinScreen({ onSuccess, t }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !value) return;
    setChecking(true);
    setError(false);
    const ok = await verifyPin(value);
    setChecking(false);
    if (ok) {
      setUsername(name.trim());
      setPin(value);
      onSuccess();
    } else {
      setError(true);
    }
  }

  const inputStyle = {
    fontSize: 15,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #ddd",
    outline: "none",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui,sans-serif",
        background: "#f5f7fa",
      }}
    >
      <img src={logo} alt="Bitrix24" style={{ height: 48, marginBottom: 14 }} />
      <div
        style={{
          fontFamily: BRAND_FONT,
          fontStyle: "italic",
          fontWeight: 700,
          fontSize: 34,
          color: DARK,
          lineHeight: 1.15,
        }}
      >
        Vissarion
      </div>
      <div style={{ fontSize: 11, color: "#aaa", marginBottom: 28, letterSpacing: "0.02em" }}>
        Editorial Intelligence by Bitrix24
      </div>
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          border: "1px solid #e5e5e5",
          borderRadius: 12,
          padding: "28px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          width: 260,
        }}
      >
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.pin.namePlaceholder}
          required
          style={inputStyle}
        />
        <input
          type="password"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t.pin.placeholder}
          style={{
            ...inputStyle,
            border: `1px solid ${error ? ERROR : "#ddd"}`,
            textAlign: "center",
            letterSpacing: "0.2em",
          }}
        />
        {error && (
          <div style={{ color: ERROR, fontSize: 12, textAlign: "center" }}>
            {t.pin.error}
          </div>
        )}
        <button
          type="submit"
          disabled={checking || !value || !name.trim()}
          style={{
            background: DARK,
            color: "#fff",
            border: "none",
            padding: "10px 0",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: checking || !value || !name.trim() ? "not-allowed" : "pointer",
            opacity: checking || !value || !name.trim() ? 0.6 : 1,
          }}
        >
          {checking ? t.pin.checking : t.pin.submit}
        </button>
      </form>
    </div>
  );
}
