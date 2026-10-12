/**
 * Route smoke test against the BUNDLED serverless entrypoint.
 *
 * A passing build only proves the code compiles. This proves the deployed
 * function still resolves its routes, because a wrong rewrite or a lost mount is
 * exactly the defect a compile cannot see.
 *
 * There is no local Postgres by design, so database-dependent endpoints are
 * expected to fail in a specific, meaningful way. Those failures ARE the proof:
 *  - 503 / 401 == the route resolved and the handler ran
 *  - 404       == routing is broken
 *
 *   npx tsx scripts/verify-serverless-routes.ts
 */
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { Express } from "express";

// Quiet request logging for this harness; the assertions are the output.
process.env.LOG_LEVEL ??= "fatal";
process.env.NODE_ENV ??= "test";

const BUNDLE = join(tmpdir(), "nx-verify.cjs");

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const require_ = createRequire(import.meta.url);
const mod = require_(BUNDLE);
const app: Express = mod.default ?? mod.app ?? mod;

const PORT = 4402;

async function call(
  path: string,
  host = "nexora.vercel.app",
  method = "GET",
  body?: unknown
) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { host, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(PORT, () => resolve(s));
  });

  try {
    console.log("--- health reaches the database layer ---");
    // Health lives at /api/v1/healthz (mounted on the /api/v1 router).
    const health = await call("/api/v1/healthz");
    check("health resolves a route", health.status !== 404, `status ${health.status}`);
    check("health reached the handler (db-down is expected)", health.status === 503 || health.status === 200, `status ${health.status}`);

    console.log("\n--- login resolves a route and performs address resolution ---");
    const login = await call("/api/v1/auth/login", "nexora.vercel.app", "POST", { username: "x", password: "y" });
    check("login resolves a route", login.status !== 404, `status ${login.status}`);
    check("login performed address resolution", login.status === 401 || login.status === 503, `status ${login.status}`);

    console.log("\n--- tenant-prefixed addresses reach the SAME handlers ---");
    const prefixedLogin = await call("/acme/api/v1/auth/login", "nexora.vercel.app", "POST", { username: "x", password: "y" });
    check("prefixed login resolves a route", prefixedLogin.status !== 404, `status ${prefixedLogin.status}`);
    // With no tenant prefix and a non-company host, resolution short-circuits to
    // 401 without touching the database. With a prefix it MUST look the company
    // up, so a database outage surfaces as 500 instead. That difference is the
    // proof the prefix is actually selecting a tenant.
    check("prefixed login attempts the tenant lookup", prefixedLogin.status !== 401, `status ${prefixedLogin.status}`);
    check(
      "plain login short-circuits without a tenant",
      login.status === 401,
      `status ${login.status}`
    );

    const prefixedHealth = await call("/acme/api/v1/healthz");
    check("prefixed health resolves", prefixedHealth.status !== 404, `status ${prefixedHealth.status}`);
    check("prefixed health matches plain health", prefixedHealth.status === health.status, `plain ${health.status} vs prefixed ${prefixedHealth.status}`);

    console.log("\n--- webhooks: raw body + signature gate ---");
    // POST /api/v1/webhooks/payments/:provider
    const hook = await call("/acme/api/v1/webhooks/payments/mobile-money", "nexora.vercel.app", "POST", { id: "evt_1" });
    check("prefixed webhook resolves", hook.status !== 404, `status ${hook.status}`);
    check("webhook is gated, never open", hook.status !== 200, `status ${hook.status}`);
    check("webhook rejects an unsigned body", hook.status === 400 || hook.status === 404, `status ${hook.status}`);

    const plainHook = await call("/api/v1/webhooks/payments/mobile-money", "nexora.vercel.app", "POST", { id: "evt_1" });
    check("plain webhook matches prefixed webhook", plainHook.status === hook.status, `plain ${plainHook.status} vs prefixed ${hook.status}`);

    console.log("\n--- platform owner console stays separate ---");
    const po = await call("/platform/v1/companies");
    check("platform route resolves", po.status !== 404, `status ${po.status}`);
    check("platform route requires auth", po.status === 401 || po.status === 503, `status ${po.status}`);

    const poPrefixed = await call("/acme/platform/v1/companies");
    check("prefixed platform route resolves", poPrefixed.status !== 404, `status ${poPrefixed.status}`);
    check("prefixed platform route matches plain", poPrefixed.status === po.status, `plain ${po.status} vs prefixed ${poPrefixed.status}`);

    console.log("\n--- theme (pre-auth branding) resolves on both forms ---");
    const themePlain = await call("/api/v1/theme");
    const themePrefixed = await call("/acme/api/v1/theme");
    check("plain theme resolves", themePlain.status !== 404, `status ${themePlain.status}`);
    check("prefixed theme resolves", themePrefixed.status !== 404, `status ${themePrefixed.status}`);
    check("theme behaves identically on both address forms", themePlain.status === themePrefixed.status, `plain ${themePlain.status} vs prefixed ${themePrefixed.status}`);

    console.log("\n--- unknown API paths still 404 ---");
    const unknown = await call("/api/v1/definitely-not-a-route");
    check("unknown api path 404s", unknown.status === 404, `status ${unknown.status}`);
    const unknownPrefixed = await call("/acme/api/v1/definitely-not-a-route");
    check("unknown prefixed api path 404s", unknownPrefixed.status === 404, `status ${unknownPrefixed.status}`);

    console.log("\n--- SPA page paths are NOT API routes ---");
    // A tenant prefix is only stripped in front of an API root, so a portal page
    // must never reach this server as an API call.
    const page = await call("/acme/money");
    check("prefixed page path is not treated as an API call", page.status === 404, `status ${page.status}`);

    console.log(
      failures === 0
        ? "\nALL SERVERLESS ROUTE CHECKS PASSED"
        : `\n${failures} SERVERLESS ROUTE CHECK(S) FAILED`
    );
  } finally {
    server.close();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
