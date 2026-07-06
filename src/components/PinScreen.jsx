import { useState } from "react";
import logo from "../assets/bitrix24-logo.png";
import { verifyPin, setPin } from "../api.js";
import { DARK, BLUE, ERROR } from "../constants.js";

export default function PinScreen({ onSuccess }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setChecking(true);
    setError(false);
    const ok = await verifyPin(value);
    setChecking(false);
    if (ok) {
      setPin(value);
      onSuccess();
    } else {
      setError(true);
    }
  }

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
      <img src={logo} alt="Bitrix24" style={{ height: 48, marginBottom: 28 }} />
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
          type="password"
          inputMode="numeric"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Пин-код"
          style={{
            fontSize: 15,
            padding: "10px 12px",
            borderRadius: 8,
            border: `1px solid ${error ? ERROR : "#ddd"}`,
            outline: "none",
            textAlign: "center",
            letterSpacing: "0.2em",
          }}
        />
        {error && (
          <div style={{ color: ERROR, fontSize: 12, textAlign: "center" }}>
            Неверный пин-код
          </div>
        )}
        <button
          type="submit"
          disabled={checking || !value}
          style={{
            background: DARK,
            color: "#fff",
            border: "none",
            padding: "10px 0",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: checking || !value ? "not-allowed" : "pointer",
            opacity: checking || !value ? 0.6 : 1,
          }}
        >
          {checking ? "Проверка…" : "Войти"}
        </button>
      </form>
      <div style={{ marginTop: 20, fontSize: 11, color: "#aaa" }}>
        <span style={{ color: BLUE }}>Article Quality Checker</span> · Editorial review tool
      </div>
    </div>
  );
}
