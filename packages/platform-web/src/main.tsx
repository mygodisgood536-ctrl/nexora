import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "@nexora/ui/styles.css";
import "./styles/portal.css";

/* RULE 13.4.2 - the Platform Owner portal is green, scoped under `.nxp`. */
document.documentElement.classList.add("nxp");
document.title = "Nexora Platform - Owner Console";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
