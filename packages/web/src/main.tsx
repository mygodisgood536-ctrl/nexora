import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/theme.css";

/**
 * Session-start theming (Part 1 §26): resolve this portal host's stored theme
 * record and apply it as CSS custom properties BEFORE first paint, so even
 * the login screen renders the company identity. Nexora's stylesheet defaults
 * stay in effect for any token not returned (or on any failure/timeout).
 */
async function applyCompanyTheme(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch("/api/v1/theme", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return;
    const body = (await res.json()) as { tokens?: Record<string, string> };
    if (!body.tokens) return;
    for (const [name, value] of Object.entries(body.tokens)) {
      document.documentElement.style.setProperty(name, value);
    }
  } catch {
    /* keep Nexora defaults */
  }
}

void (async () => {
  await applyCompanyTheme();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
})();
