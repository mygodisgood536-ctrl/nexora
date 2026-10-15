import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

/* The reference site's three-font system, self-hosted:
   Fraunces for display, Inter for UI and body, JetBrains Mono for eyebrows,
   labels and figures. Variable builds, so every weight is one file. */
import "@fontsource-variable/inter";
import "@fontsource-variable/fraunces/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";

import { ToastProvider } from "@nexora/ui";
import App from "./App";
import { SessionProvider } from "./auth/SessionProvider";
import "@nexora/ui/styles.css";
import "./styles/portal.css";
import { applyCompanyTheme } from "./lib/theme";
import { ROUTER_BASENAME } from "./lib/tenant-path";

/**
 * RULE 13.4.1 / Part 1 section 26 - the portal host's stored theme is applied
 * as CSS custom properties BEFORE first paint, so even the login screen
 * carries the company identity. Nexora's neutral defaults stay in effect for
 * any token not returned (or on any failure/timeout).
 */
void (async () => {
  await applyCompanyTheme();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ToastProvider>
        <SessionProvider>
          {/* basename carries the tenant prefix so every route stays written as
              `/money`, `/people`, … while the address remains
              `example.vercel.app/acme/money`. (Vision Part 1 A2.3) */}
          <BrowserRouter basename={ROUTER_BASENAME || undefined}>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </React.StrictMode>
  );
})();