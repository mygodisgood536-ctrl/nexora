/**
 * End-to-end check of the tenant-prefix middleware against a real Express app.
 *
 * Proves that `/acme/api/v1/money` and `/api/v1/money` reach the SAME route with
 * the same handler — i.e. the prefix selects the tenant, never a code path — and
 * that a portal page name is never stripped.
 *
 *   npx tsx scripts/verify-tenant-middleware.ts
 */
import express from "express";
import { tenantPrefix } from "../packages/server/src/middleware/tenant-prefix";
import { parsePortalPath } from "../packages/server/src/lib/host";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

const app = express();
app.use(tenantPrefix);

let seenUrl: string | null = null;
let seenPath: string | null = null;
let seenHost: string | null = null;

app.use((req, res) => {
  seenUrl = req.url;
  seenPath = req.tenantPath ?? null;
  seenHost = req.headers.host ?? null;
  const candidates = parsePortalPath(req.tenantPath);
  res.json({
    url: req.url,
    tenantPath: req.tenantPath,
    candidate: candidates[0] ?? null
  });
});

const PORT = 4399;
const server = app.listen(PORT);

async function call(urlPath: string, host = "nexora.vercel.app") {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { headers: { host } });
  return (await res.json()) as {
    url: string;
    tenantPath: string | null;
    candidate: { companySlug: string; branchSlug: string | null } | null;
  };
}

async function main() {
  console.log("--- the prefix is stripped, the route is identical ---");
  const plain = await call("/api/v1/money?a=1");
  check("plain API url untouched", plain.url, "/api/v1/money?a=1");
  check("plain API carries no tenant", plain.candidate, null);

  const prefixed = await call("/acme/api/v1/money?a=1");
  check("prefixed url reduced to the same route", prefixed.url, "/api/v1/money?a=1");
  check("prefixed url is byte-identical to the plain one", prefixed.url === plain.url, true);
  check("original path preserved", prefixed.tenantPath, "/acme/api/v1/money");
  check("tenant resolved from the prefix", prefixed.candidate, { companySlug: "acme", branchSlug: null });
  check("plain original path preserved", plain.tenantPath, "/api/v1/money");

  console.log("\n--- branch addresses ---");
  const branch = await call("/acme-mukono/api/v1/money");
  check("branch prefix stripped", branch.url, "/api/v1/money");
  check("branch tenant is the most specific split", branch.candidate, { companySlug: "acme-mukono", branchSlug: null });
  check("branch candidates ordered longest-first", parsePortalPath(branch.tenantPath).map((c) => `${c.companySlug}/${c.branchSlug ?? ""}`), [
    "acme-mukono/",
    "acme/mukono"
  ]);

  console.log("\n--- platform routes are never touched ---");
  for (const p of ["/platform/v1/companies", "/acme/platform/v1/companies"]) {
    const r = await call(p);
    check(`${p} reaches its own route`, r.url.startsWith("/platform/v1/"), true);
  }
  const poPrefixed = await call("/platform/v1/companies");
  check("owner console has no tenant", poPrefixed.candidate, null);

  console.log("\n--- a portal page path is NOT stripped ---");
  const page = await call("/money");
  check("page url untouched", page.url, "/money");
  check("page carries no tenant", page.candidate, null);

  const pagePrefixed = await call("/acme/money");
  check("prefixed page url untouched (SPA owns it)", pagePrefixed.url, "/acme/money");

  console.log("\n--- webhook bodies keep their query string ---");
  const hook = await call("/acme/api/v1/webhooks/payments?sig=xyz");
  check("webhook url", hook.url, "/api/v1/webhooks/payments?sig=xyz");
  check("webhook tenant", hook.candidate, { companySlug: "acme", branchSlug: null });

  console.log("\n--- health check ---");
  const health = await call("/api/healthz");
  check("health url untouched", health.url, "/api/healthz");

  server.close();
  console.log(
    failures === 0
      ? "\nALL TENANT MIDDLEWARE CHECKS PASSED"
      : `\n${failures} TENANT MIDDLEWARE CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

void seenUrl;
void seenPath;
void seenHost;

main().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
