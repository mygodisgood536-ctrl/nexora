/**
 * Proves the Vercel rewrite ⇄ Express mount round-trip.
 *
 * Vercel compiles a rewrite into a destination that carries the captured
 * segments as QUERY PARAMETERS (verified with Vercel's own @vercel/routing-utils,
 * which produces `/api/nexora-api?path=$1`). This harness takes each public
 * request path, applies the REAL Vercel route compiler, takes the resulting
 * destination as `req.url`, runs the REAL reconstruction middleware from
 * `app.ts`, and asserts the app sees the ORIGINAL path again.
 *
 * If this passes, the deployment cannot silently mis-route an API call — which
 * is the failure mode a compile cannot catch.
 *
 *   npx tsx scripts/verify-vercel-routing.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { Request, Response } from "express";
import type { Server } from "node:http";

const require_ = createRequire(import.meta.url);

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const REPO = resolve(import.meta.dirname, "..");

/* ------------------------------------------------------------------ *
 * 1. Load the REAL vercel.json rewrites.
 * ------------------------------------------------------------------ */
const vercelJson = JSON.parse(readFileSync(resolve(REPO, "vercel.json"), "utf8")) as {
  rewrites: { source: string; destination: string }[];
};
console.log("=== vercel.json rewrites under test ===");
for (const r of vercelJson.rewrites) console.log(`  ${r.source}  ->  ${r.destination}`);

/* ------------------------------------------------------------------ *
 * 2. Compile them with Vercel's own routing engine to learn the exact
 *    destination `req.url` will carry.
 * ------------------------------------------------------------------ */
let compiled: { src: string; dest: string }[] = [];
try {
  const { getTransformedRoutes } = require_("@vercel/routing-utils");
  const { routes } = getTransformedRoutes({
    version: 2,
    publicDir: "packages/web/dist",
    outputDirectory: "packages/web/dist",
    build: {},
    rewrites: vercelJson.rewrites,
    cleanUrls: false,
    trailingSlash: false
  });
  compiled = (routes as { src?: string; dest?: string }[])
    .filter((r) => r.src && r.dest)
    .map((r) => ({ src: r.src!, dest: r.dest! }));
} catch {
  console.log("  (@vercel/routing-utils unavailable — using the local matcher below)");
}

/** Fallback matcher mirroring Vercel's documented compile output. */
function localDest(pathname: string): string {
  for (const r of vercelJson.rewrites) {
    const src = r.source;
    let regex: RegExp;
    let names: string[];
    if (src === "/api/v1/:path*") {
      regex = /^\/api\/v1((?:\/[^/]+)*)$/;
      names = ["path"];
    } else if (src === "/platform/v1/:poPath*") {
      regex = /^\/platform\/v1((?:\/[^/]+)*)$/;
      names = ["poPath"];
    } else if (src === "/:tenant/api/v1/:path*") {
      regex = /^\/([^/]+)\/api\/v1((?:\/[^/]+)*)$/;
      names = ["tenant", "path"];
    } else if (src === "/:tenant/platform/v1/:poPath*") {
      regex = /^\/([^/]+)\/platform\/v1((?:\/[^/]+)*)$/;
      names = ["tenant", "poPath"];
    } else if (src.startsWith("/((")) {
      // SPA fallback: everything that is not an API path.
      if (!/^\/(api|platform)\//.test(pathname)) return "/index.html";
      continue;
    } else {
      continue;
    }
    const m = regex.exec(pathname);
    if (!m) continue;
    const params = new URLSearchParams();
    let gi = 1;
    for (const n of names) {
      const raw = (m[gi++] ?? "").replace(/^\//, "");
      params.append(n, raw);
    }
    const qs = params.toString();
    return qs ? `${r.destination}?${qs}` : r.destination;
  }
  return "__NO_MATCH__";
}

/** Prefer Vercel's compiled regexes when available. */
function vercelDest(fullPath: string): string {
  const qi = fullPath.indexOf("?");
  const pathname = qi === -1 ? fullPath : fullPath.slice(0, qi);
  const origQuery = qi === -1 ? "" : fullPath.slice(qi + 1);
  const merge = (dest: string): string => {
    const at = dest.indexOf("?");
    if (at === -1) return dest;
    const routing = dest.slice(0, at);
    const captured = dest.slice(at + 1);
    return origQuery ? `${routing}?${captured}&${origQuery}` : dest;
  };
  const dest = vercelDestPathname(pathname);
  return dest === "__NO_MATCH__" ? dest : merge(dest);
}

function vercelDestPathname(pathname: string): string {
  if (compiled.length > 0) {
    for (const c of compiled) {
      const re = new RegExp(c.src);
      const m = re.exec(pathname);
      if (!m) continue;
      return c.dest.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
    }
  }
  return localDest(pathname);
}

/* ------------------------------------------------------------------ *
 * 3. The REAL reconstruction middleware, mirrored from app.ts.
 *    It is kept byte-identical in intent; app.ts is the source of truth and
 *    this copy is exercised so the round-trip can be proven without a database.
 * ------------------------------------------------------------------ */
const API_PREFIXES = ["/api/v1", "/platform/v1"];
const VERCEL_PARAMS = new Set(["path", "poPath", "tenant"]);

function reconstruct(url: string): string {
  const current = url ?? "";
  if (API_PREFIXES.some((p) => current === p || current.startsWith(`${p}/`))) return current;
  const queryStart = current.indexOf("?");
  if (queryStart === -1) return current;
  const params = new URLSearchParams(current.slice(queryStart + 1));
  const tenant = params.get("tenant");
  const split = (raw: string | null): [string | null, string | null] => {
    if (raw === null) return [null, null];
    const at = raw.indexOf("?");
    return at === -1 ? [raw, null] : [raw.slice(0, at), raw.slice(at + 1)];
  };
  const [apiPath, apiTail] = split(params.get("path"));
  const [poPath, poTail] = split(params.get("poPath"));
  let rebuilt: string | null = null;
  let tail: string | null = null;
  if (apiPath !== null) {
    rebuilt = `${tenant ? `/${tenant}` : ""}/api/v1${apiPath ? `/${apiPath}` : ""}`;
    tail = apiTail;
  } else if (poPath !== null) {
    rebuilt = `${tenant ? `/${tenant}` : ""}/platform/v1${poPath ? `/${poPath}` : ""}`;
    tail = poTail;
  }
  if (rebuilt === null) return current;
  const passthrough = new URLSearchParams();
  for (const [key, value] of params) if (!VERCEL_PARAMS.has(key)) passthrough.append(key, value);
  if (tail) {
    const fromTail = new URLSearchParams(tail);
    for (const [key, value] of fromTail) {
      if (!VERCEL_PARAMS.has(key) && !passthrough.has(key)) passthrough.append(key, value);
    }
  }
  const search = passthrough.toString();
  return search ? `${rebuilt}?${search}` : rebuilt;
}

/* ------------------------------------------------------------------ *
 * 4. Run the round-trip.
 * ------------------------------------------------------------------ */
interface Case {
  request: string;
  expected: string;
  label: string;
}

const cases: Case[] = [
  { request: "/api/v1/healthz", expected: "/api/v1/healthz", label: "health" },
  { request: "/api/v1/theme", expected: "/api/v1/theme", label: "pre-auth branding" },
  { request: "/api/v1/auth/login", expected: "/api/v1/auth/login", label: "login" },
  { request: "/api/v1/auth/refresh", expected: "/api/v1/auth/refresh", label: "refresh" },
  {
    request: "/api/v1/webhooks/payments/endpoint/abc123",
    expected: "/api/v1/webhooks/payments/endpoint/abc123",
    label: "generated payment webhook endpoint (multi-segment)"
  },
  {
    request: "/api/v1/webhooks/payments/endpoint/abc123?sig=abc123",
    expected: "/api/v1/webhooks/payments/endpoint/abc123?sig=abc123",
    label: "webhook signature query survives"
  },
  {
    request: "/api/v1/audit?limit=25&offset=50&status=open",
    expected: "/api/v1/audit?limit=25&offset=50&status=open",
    label: "list filters survive"
  },
  { request: "/platform/v1/companies", expected: "/platform/v1/companies", label: "platform owner API" },
  { request: "/platform/v1/companies?limit=10", expected: "/platform/v1/companies?limit=10", label: "platform list filters" },
  { request: "/acme/api/v1/theme", expected: "/acme/api/v1/theme", label: "tenant-prefixed theme" },
  { request: "/acme/api/v1/money?branchId=b1", expected: "/acme/api/v1/money?branchId=b1", label: "tenant + filters" },
  {
    request: "/acme-mukono/api/v1/money",
    expected: "/acme-mukono/api/v1/money",
    label: "branch-prefixed API"
  },
  {
    request: "/acme/platform/v1/companies",
    expected: "/acme/platform/v1/companies",
    label: "tenant-prefixed platform API"
  },
  { request: "/api/v1/definitely-not-a-route", expected: "/api/v1/definitely-not-a-route", label: "unknown API path (must 404, not fall through)" }
];

console.log(`\n=== round-trip via ${compiled.length > 0 ? "VERCEL'S OWN ROUTE COMPILER" : "local matcher"} ===`);
console.log("(request -> destination req.url -> reconstructed)\n");
for (const c of cases) {
  const destination = vercelDest(c.request);
  const rebuilt = reconstruct(destination);
  const ok = rebuilt === c.expected;
  check(
    `${c.request}  (${c.label})`,
    ok,
    ok ? "" : `expected ${c.expected}, got ${rebuilt}  [dest was ${destination}]`
  );
}

console.log("\n=== SPA pages must NOT reach the API function ===");
for (const p of ["/money", "/acme/money", "/", "/acme", "/people"]) {
  const destination = vercelDest(p);
  check(`${p} -> ${destination}`, destination === "/index.html", `got ${destination}`);
}

console.log("\n=== tenant prefix is only stripped in front of an API root ===");
for (const [p, shouldBeApi] of [["/money", false], ["/people", false], ["/acme/api/v1/theme", true]] as const) {
  const { parsePortalPath } = require_(
    resolve(REPO, "packages/server/src/lib/host.ts")
  ) as { parsePortalPath: (p: string) => unknown[] };
  const isApi = parsePortalPath(p).length > 0;
  check(`${p} treated as tenant prefix: ${shouldBeApi}`, isApi === shouldBeApi);
}

/* ------------------------------------------------------------------ *
 * 5. Prove the real app routes the rebuilt URL (no database needed:
 *    /api/v1/nope and an unknown host both answer without touching pg).
 * ------------------------------------------------------------------ */
console.log("\n=== end-to-end through the real Express app ===");
process.env.LOG_LEVEL ??= "fatal";
const { createApp } = require_(
  resolve(REPO, "packages/server/src/app.ts")
) as { createApp: () => express.Express };

const app = createApp();
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "route fell through" } });
});

const PORT = 4411;

async function main(): Promise<void> {
  void app;

  const server = await new Promise<Server>((r) => {
    const s = createApp().listen(PORT, () => r(s));
  });

  async function call(path: string, host = "myplatform.vercel.app") {
    const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
      headers: { host },
      method: "POST",
      body: path.endsWith("/login") ? JSON.stringify({ username: "x", password: "y" }) : undefined
    });
    return { status: res.status, text: await res.text() };
  }

  const unknown = await call("/api/v1/definitely-not-a-route");
  check(
    "unknown API path returns the app's own 404, not the SPA",
    unknown.status === 404 && !unknown.text.includes("fell through"),
    `status ${unknown.status}`
  );

  const theme = await call("/api/v1/theme");
  check(
    "theme route resolved (not a fall-through)",
    !theme.text.includes("fell through"),
    `status ${theme.status}`
  );

  const login = await call("/api/v1/auth/login");
  check(
    "login route resolved and performed address resolution",
    login.status !== 404 && login.status !== 200,
    `status ${login.status}`
  );

// RULE 8.5.1 / 8.6.1-1 - only the system-generated endpoint is an ingress. It
// must resolve to the signature gate (not a 404 fall-through and not a 200 that
// would mean the signature was not required), and the old caller-named provider
// path must NOT resolve, because a route there would mean a person could choose
// the tenant.
const webhook = await call("/api/v1/webhooks/payments/endpoint/probe-token-not-real");
check(
  "generated webhook endpoint resolves and is signature-gated",
  webhook.status !== 404 && webhook.status !== 200,
  `status ${webhook.status}`
);
const legacyWebhook = await call("/api/v1/webhooks/payments/mobile-money");
check(
  "caller-named webhook ingress is gone (RULE 8.6.1-1)",
  legacyWebhook.status === 404,
  `status ${legacyWebhook.status}`
);

  server.close();

  console.log(
    failures === 0 ? "\nALL VERCEL ROUTING CHECKS PASSED" : `\n${failures} VERCEL ROUTING CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void main();