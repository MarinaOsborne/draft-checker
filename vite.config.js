import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Читаем PORT из .env, чтобы прокси всегда указывал на тот же порт,
  // на котором реально слушает Express-сервер (server/index.js).
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PORT || 3000;

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": `http://localhost:${apiPort}`,
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
