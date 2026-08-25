/**
 * Nexora dev stack launcher — starts the API (:4000) and both Vite portals
 * (Company :5173, Platform Owner :5174) as one supervised process group.
 *
 * Zero dependencies: plain Node child_process. Output is line-prefixed per
 * process so a single VS Code terminal/task shows everything; stopping this
 * process (Ctrl+C or task end) stops the whole tree on Windows and POSIX.
 *
 * Used by the ".vscode/tasks.json" task "Nexora: Dev Servers (API + Portals)"
 * — see docs/PREVIEW.md for the embedded-live-preview workflow.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SERVICES = [
  { label: "api", cwd: path.join(ROOT, "packages/server"), args: ["run", "dev"] },
  { label: "portal ", cwd: path.join(ROOT, "packages/web"), args: ["run", "dev"] },
  { label: "platform", cwd: path.join(ROOT, "packages/platform-web"), args: ["run", "dev"] }
];

const children = [];
let shuttingDown = false;

function log(label, chunk) {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) console.log(`[${label}] ${line}`);
  }
}

for (const svc of SERVICES) {
  const child = spawn("npm", svc.args, {
    cwd: svc.cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" }
  });
  children.push(child);
  child.stdout.on("data", (c) => log(svc.label, c));
  child.stderr.on("data", (c) => log(svc.label, c));
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.log(`[${svc.label}] exited unexpectedly (code ${code}) — shutting down stack`);
      shutdown(code ?? 1);
    }
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => shutdown(0));

console.log("[dev-all] API :4000 · Company portal :5173 · Platform portal :5174");
console.log('[dev-all] Open http://127.0.0.1:5173/ and/or http://127.0.0.1:5174/ in the VS Code Simple Browser');
