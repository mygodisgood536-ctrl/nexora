# Nexora Embedded Live Preview (VS Code)

View the real, running Nexora frontends **inside VS Code** — no external
Chrome/Edge window — while Cline edits code and Vite HMR updates the preview
automatically.

## What this uses

- **VS Code's built-in "Simple Browser"** (`simpleBrowser.show` command). It is
  part of VS Code core — **no extension installation is required**.
- Vite dev servers with fixed ports (`strictPort`) so the preview URLs never
  change:
  | Surface | URL | Notes |
  |---|---|---|
  | Company Portal (`packages/web`) | `http://127.0.0.1:5173/` | proxies `/api` → API :4000 |
  | Platform Owner Portal (`packages/platform-web`) | `http://127.0.0.1:5174/` | proxies `/platform` → API :4000 |
  | API (`packages/server`) | `http://localhost:4000` | `tsx watch`, needs Postgres |

## One-time setup (already done in this repo)

- `packages/*/vite.config.ts`: `host 127.0.0.1`, `port 5173|5174`,
  `strictPort: true`.
- `scripts/dev-all.mjs`: starts API + both portals as one supervised process
  group (Ctrl+C stops all three).
- `.vscode/tasks.json`: task **"Nexora: Dev Servers (API + Portals)"** plus
  single-server variants under Terminal → Run Task….

## Daily workflow (side-by-side layout)

1. Start Postgres if it is not running: `npm run db:start`.
2. **Terminal → Run Task… → "Nexora: Dev Servers (API + Portals)"**
   (keep that terminal open; it shows prefixed `[api] [portal] [platform]`
   logs).
3. Press `F1` → run **"Simple Browser: Show"** → enter
   `http://127.0.0.1:5174/` (Platform Owner Portal) or
   `http://127.0.0.1:5173/` (Company Portal).
4. The preview opens as an editor tab. **Drag the tab to the left edge** of the
   window so the layout becomes `preview | code`. VS Code remembers this
   editor-group layout for the workspace across restarts.
5. Edit any file under `packages/*/src` — Vite HMR pushes the update into the
   embedded preview instantly (full reload only when needed).

### Switching between the two previews

- Open a second Simple Browser tab with the other URL and pin both; or
- Re-run "Simple Browser: Show" and type the other URL.
Both can stay docked side by side (preview column holds multiple tabs).

### Stopping

Focus the dev-stack terminal and press `Ctrl+C` (kills API + both Vite
servers), or kill the "Nexora: Dev Servers" task from the Terminal panel.

## Why not an extension?

The built-in Simple Browser already renders arbitrary local URLs (including
Vite's HMR websocket) inside an editor tab, so no third-party extension is
needed. Microsoft's "Live Preview" extension was considered and rejected: its
embedded preview serves files through its own static server, which cannot run
a transformed React/Vite app or honor the `/api` + `/platform` proxies.

## Troubleshooting

- *Preview shows connection error* → the dev stack isn't running (step 2) or
  Postgres is down; check the `[api]` log lines.
- *Port already in use* → a previous server instance is still alive:
  `for /f "tokens=5" %a in ('netstat -ano ^| findstr :5174') do @taskkill /PID %a /F`
  (repeat for 5173/4000 as needed).
- *Login doesn't work in preview* → seed data lives in `nexora_dev`; run the
  bootstrap script once (`node packages/server/scripts/bootstrap-platform-owner.mjs`).
