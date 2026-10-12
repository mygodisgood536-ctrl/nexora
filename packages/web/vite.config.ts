import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Deterministic host/port so the embedded VS Code preview can target this
    // exact URL (see docs/PREVIEW.md). Dev-only settings.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // Tenant-prefixed API calls (`/acme/api/v1/...`) are matched before the
      // plain prefix so a company portal served from a path-based address
      // reaches the API in local development exactly as it does on Vercel.
      // (Vision Part 1 §2.3 — both forms resolve to the same tenant.)
      "^/[a-z0-9][a-z0-9-]*/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
