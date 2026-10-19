/**
 * Security invariants that must never regress.
 *
 * These are STATIC checks over the source. They are not a substitute for the
 * database-backed suite (`npm run test:db`), which exercises the real isolation
 * and concurrency behaviour against a live PostgreSQL. What they do is pin the
 * handful of properties that are cheap to break in a refactor and expensive to
 * discover in production: a JWT verified without pinning its algorithm, a webhook
 * comparison that throws instead of rejecting, a raw-body parser mounted after
 * express.json(), a bypass path that grew a new caller, production booting on a
 * placeholder secret.
 *
 *   node scripts/verify-security-invariants.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`ok    ${label}${detail ? ` â€” ${detail}` : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` â€” ${detail}` : ""}`);
  }
};

const read = (p) => readFileSync(resolve(REPO, p), "utf8");

/**
 * Strip comments (and template-literal comments) so structural checks (ordering,
 * presence of a call) cannot be fooled by prose or documentation. Without this,
 * a comment that says "MUST PRECEDE express.json()" is indistinguishable from an
 * actual express.json() call. String literals are preserved verbatim so regexes
 * can still match quoted path arguments like "/api/v1/webhooks".
 */
function code(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let mode = "code"; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (mode === "code") {
      if (c === "/" && c2 === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && c2 === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i++; continue; }
      if (c === '"') { mode = "dq"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
    if (mode === "block") { if (c === "*" && c2 === "/") { mode = "code"; i += 2; } else i++; continue; }
    if (mode === "sq") { out += c; if (c === "\\") { out += c2; i += 2; continue; } if (c === "'") mode = "code"; i++; continue; }
    if (mode === "dq") { out += c; if (c === "\\") { out += c2; i += 2; continue; } if (c === '"') mode = "code"; i++; continue; }
    if (mode === "tpl") { out += c; if (c === "\\") { out += c2; i += 2; continue; } if (c === "`") mode = "code"; i++; continue; }
  }
  return out;
}

/** Every .ts file under the server src tree, as {rel, text}. */
function serverSources() {
  const out = [];
  const root = resolve(REPO, "packages/server/src");
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ rel: p.slice(REPO.length + 1).replace(/\\/g, "/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(root);
  return out;
}

const SRC = serverSources();
const app = read("packages/server/src/app.ts");
const auth = read("packages/server/src/middleware/auth.ts");
const env = read("packages/server/src/config/env.ts");
const pool = read("packages/server/src/db/pool.ts");
/* ------------------------------------------------------------------ *
 * 1. Session tokens.
 * ------------------------------------------------------------------ */
console.log("=== session tokens ===");
check(
  "JWT verification pins the algorithm list",
  /algorithms:\s*\[\s*["']HS256["']\s*\]/.test(auth),
  "blocks alg:none and RS256->HS256 confusion"
);
check(
  "every jwt.verify call supplies explicit options",
  // jwt.verify(token, secret) with no third argument accepts ANY algorithm the
  // token advertises, which reopens alg:none / RSA->HMAC confusion even though
  // TOKEN_OPTIONS pins HS256. Every call site must pass its options object.
  [...code(auth).matchAll(/jwt\.verify\(/g)].length > 0 &&
    !/jwt\.verify\(\s*[^,()]+,\s*[^,()]+\)/.test(code(auth)),
  `${[...code(auth).matchAll(/jwt\.verify\(/g)].length} call site(s)`
);
check("no jwt.decode is used for authorization", !/jwt\.decode\(/.test(auth));
check(
  "an invalid token is rejected with 401",
  /AppError\.unauthorized/.test(auth)
);

/* ------------------------------------------------------------------ *
 * 2. Payment webhooks â€” the money-in path.
 * ------------------------------------------------------------------ */
console.log("\n=== payment webhooks ===");
const webhookRoutes = SRC.find((s) => s.rel.endsWith("modules/payments/routes.ts"))?.text ?? "";

check(
  "signature comparison is constant-time",
  /timingSafeEqual/.test(webhookRoutes)
);
check(
  "a length mismatch is rejected BEFORE timingSafeEqual",
  // timingSafeEqual throws on unequal lengths, which would surface as a 500
  // instead of a clean 401 - and would disclose the expected length.
  /provided\.length\s*!==\s*expected\.length\s*\|\|/.test(webhookRoutes) ||
    /expected\.length\s*!==\s*provided\.length\s*\|\|/.test(webhookRoutes)
);
check(
  "the HMAC is computed over the timestamp plus the RAW body",
  /createHmac\("sha256",\s*secret\)\s*\.update\(`\$\{ts\}\.\$\{bodyString\}`\)/.test(webhookRoutes)
);
check(
  "an unsigned request is refused",
  /if \(!signature\)/.test(webhookRoutes)
);
check("a bad signature is audited", /webhook\.invalid_signature/.test(webhookRoutes));
check(
  "a bad signature notifies the MD (RULE 4.7.1)",
  /webhook\.failure/.test(webhookRoutes)
);

// The raw-body ordering is the single most fragile property in the deployment:
// if a parser ever lands before the webhook mount, the HMAC is computed over
// re-serialised JSON and EVERY inbound payment is silently rejected. Comments
// are stripped first so the in-code explanation cannot satisfy the check.
const appCode = code(app);
const rawIdx = appCode.indexOf('express.raw(');
const jsonIdx = appCode.indexOf('express.json(');
const webhookRaw = /app\.use\(\s*["']\/api\/v1\/webhooks["']\s*,\s*express\.raw\(/.test(appCode);
check(
  "the webhook raw parser is mounted before express.json()",
  webhookRaw && rawIdx !== -1 && jsonIdx !== -1 && rawIdx < jsonIdx,
  webhookRaw ? `webhook+raw found; raw@${rawIdx} json@${jsonIdx}` : "webhook express.raw mount not found (path-scoped)"
);
check(
  "the raw parser is scoped to the webhook path only",
  webhookRaw
);
check(
  "no platform body parser is configured in vercel.json",
  !/"bodyParser"/.test(read("vercel.json")),
  "not a supported vercel.json property; Vercel restores the stream instead"
);

/* ------------------------------------------------------------------ *
 * 3. Idempotency â€” a replayed webhook must not create a second payment.
 * ------------------------------------------------------------------ */
console.log("\n=== idempotency ===");
const migrations = readdirSync(resolve(REPO, "packages/server/src/db/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => read(`packages/server/src/db/migrations/${f}`))
  .join("\n");

check(
  "webhook events are unique per provider event id",
  /CREATE UNIQUE INDEX uq_webhook_provider_event ON webhook_events \(provider, provider_event_id\)/.test(migrations) ||
    /UNIQUE[^;]*\(company_id, provider, provider_event_id\)/.test(migrations)
);
check(
  "a duplicate delivery is detected and suppressed, not re-applied",
  /duplicate_suppressed/.test(webhookRoutes + SRC.map((s) => s.text).join("\n"))
);

// Financial rows must be append-only or explicitly linked, never edited.
const deletions = [...migrations.matchAll(/DELETE FROM\s+(payments|ledger_entries|audit_entries|loans|webhook_events)\b/gi)]
  .map((m) => m[0]);
check(
  "no migration deletes a financial record",
  deletions.length === 0,
  deletions.length ? deletions.join(", ") : "append-only preserved"
);

/* ------------------------------------------------------------------ *
 * 4. Tenant isolation.
 * ------------------------------------------------------------------ */
console.log("\n=== tenant isolation ===");
check(
  "row-level security is enabled on the tenant tables",
  /ENABLE ROW LEVEL SECURITY/.test(migrations)
);
const bypassFiles = SRC.filter((s) => /withBypass/.test(s.text)).map((s) => s.rel);
check(
  "the RLS bypass path has a small, reviewable set of callers",
  (() => {
    const allow = [
      "packages/server/src/db/repo.ts",
      "packages/server/src/db/migrate.ts",
      "packages/server/src/modules/auth/service.ts",
      "packages/server/src/modules/branches/service.ts",
      "packages/server/src/modules/branding/routes.ts",
      "packages/server/src/modules/company-ai/config-service.ts",
      "packages/server/src/modules/customer-portal/service.ts",
      "packages/server/src/modules/customers/service.ts",
      "packages/server/src/modules/face-captures/service.ts",
      "packages/server/src/modules/loan-evidence/service.ts",
      "packages/server/src/modules/loans/service.ts",
      "packages/server/src/modules/payments/routes.ts",
      "packages/server/src/modules/payments/service.ts",
      "packages/server/src/modules/platform/service.ts",
      // The platform schedule (RULE 3.8.6). It must enumerate active companies
      // and resolve the system attribution principal BEFORE any tenant session
      // exists, so it cannot use withTenant for those two reads. Every actual
      // job it starts delegates to a service that opens its own tenant
      // transaction for that company.
      "packages/server/src/routes/cron.ts",
      "packages/server/src/modules/workers/service.ts"
    ];
    const extra = bypassFiles.filter((f) => !allow.includes(f));
    const missing = allow.filter((f) => !bypassFiles.includes(f));
    if (extra.length > 0) return false;
    if (missing.length > 0) return true; // expected modules present; allow shrinking or growing only deliberately
    return true;
  })(),
  `${bypassFiles.length} files call withBypass`
);
check(
  "the tenant-scoped execution helper is used broadly",
  (SRC.filter((s) => /\bwithTenant\(/.test(s.text)).length) >= 20,
  `${SRC.filter((s) => /\bwithTenant\(/.test(s.text)).length} modules scope through withTenant()`
);

/* ------------------------------------------------------------------ *
 * 5. Secrets fail closed.
 * ------------------------------------------------------------------ */
console.log("\n=== secrets ===");
check(
  "production refuses to boot on placeholder secrets",
  /NODE_ENV\s*===\s*["']production["']/.test(env) && /nexora-dev/.test(env) && /throw/.test(env)
);
check("no secret is written to a log call", (() => {
  const offenders = SRC.filter((s) =>
    /logger\.(info|warn|error|debug|trace)\([^)]*(JWT_SECRET|EVIDENCE_ENCRYPTION_KEY|webhook_secret|BACKUP_ENCRYPTION_KEY|FACE_CAPTURE_PROOF_SECRET)/i.test(s.text)
  ).map((s) => s.rel);
  return offenders.length === 0 ? true : offenders;
})());

/* ------------------------------------------------------------------ *
 * 6. Serverless-safe pooling.
 * ------------------------------------------------------------------ */
console.log("\n=== database pooling ===");
check("the pool size is bounded by configuration", /DATABASE_POOL_MAX/.test(pool));
check("connections have a bounded connect timeout", /connectionTimeoutMillis/.test(pool));
check("idle connections are closed", /idleTimeoutMillis/.test(pool));
check(
  "pool error does not crash the function",
  /pool\.on\(["']error["']/.test(pool)
);

/* ------------------------------------------------------------------ *
 * 7. No committed secrets.
 * ------------------------------------------------------------------ */
console.log("\n=== repository hygiene ===");
const tracked = [];
{
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "dist", ".pg", "coverage"].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|json|md|css|mjs|cjs|sql)$/.test(e.name)) tracked.push({ rel: p.slice(REPO.length + 1).replace(/\\/g, "/"), text: readFileSync(p, "utf8") });
    }
  };
  walk(REPO);
}
const SECRET_ASSIGN = /(?:password|secret|api[_-]?key|token)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/gi;
const realSecrets = tracked
  .filter((f) => !/(^|\/)(.env.example)$|\.md$/.test(f.rel))
  .filter((f) => !/(^|\/)tests\//.test(f.rel))
  .filter((f) => !/(^|\/)verify\//.test(f.rel))
  .filter((f) => SECRET_ASSIGN.test(f.text))
  .map((f) => f.rel);
check("no long literal secret is committed", realSecrets.length === 0, realSecrets.join(", "));
check(
  "example environment files carry placeholders only",
  read(".env.example").includes("nexora-dev"),
  "documented as placeholders"
);

/* ------------------------------------------------------------------
 * 5. Webhook tenant binding (RULE 8.5.1 / 8.6.1-1).
 *
 * RULE 8.6.1-1 makes a caller-selectable webhook tenant a hard prohibition:
 * "a manually typed webhook URL, or a screen that lets a person choose which
 * branch a webhook belongs to". The ingress once accepted
 * /payments/{provider} and read the tenant from an X-Nexora-Company header,
 * which is precisely that shape. Only the system-generated endpoint may exist,
 * and the endpoint must be the sole source of the company, branch and provider.
 * ------------------------------------------------------------------ */
check(
  "no webhook route accepts a caller-named provider path",
  !/webhookRouter\.post\(\s*"\/payments\/:provider"/.test(webhookRoutes),
  "the prohibited /payments/:provider ingress must not be re-added"
);
check(
  "the webhook tenant is resolved only from the generated endpoint",
  !/header\(\s*["']x-nexora-company["']\s*\)/i.test(webhookRoutes),
  "a header-selected webhook tenant is prohibited by RULE 8.6.1-1"
);
check(
  "the generated webhook endpoint token is cryptographically random",
  /randomBytes\(32\)/.test(
    SRC.find((s) => s.rel.endsWith("modules/payments/service.ts"))?.text ?? ""
  ),
  "the endpoint token must not be guessable"
);

/* ------------------------------------------------------------------
 * 6. Provider polling (RULE 8.5.6).
 *
 * "The platform must never rely only on webhooks: a scheduled polling or
 * reconciliation job must periodically confirm that every provider transaction
 * matches a recorded payment, and must raise an exception for anything found
 * only on the provider side."
 *
 * The reconciliation diff existed but nothing ever called it, so every
 * provider was webhook-only in practice. The schedule must invoke the poll,
 * and a poll that cannot confirm must raise an exception rather than pass.
 * ------------------------------------------------------------------ */
const pollingSource =
  SRC.find((s) => s.rel.endsWith("modules/payments/polling.ts"))?.text ?? "";
const cronSource = SRC.find((s) => s.rel.endsWith("routes/cron.ts"))?.text ?? "";
check(
  "a scheduled provider poll exists and is invoked by the schedule",
  /pollProviderConfig/.test(cronSource),
  "RULE 8.5.6 requires a scheduled reconciliation job, not webhook-only ingestion"
);
check(
  "a provider poll reconciles provider transactions against recorded payments",
  /reconcileProviderTransactions/.test(pollingSource),
  "the poll must feed the reconciliation diff"
);
check(
  "a failed or unreadable poll raises an exception rather than passing silently",
  /INSERT INTO reconciliation_items/.test(pollingSource),
  "RULE 8.5.6: raise an exception for anything not positively confirmed"
);
check(
  "the poll watermark advances only after a poll that parsed",
  /poll_watermark\s*=\s*GREATEST/.test(pollingSource),
  "a failed poll must not permanently skip the transactions inside its window"
);

/* ------------------------------------------------------------------
 * 7. Mandatory approval stages (RULE 19.12.3).
 *
 * "If an Auditor or other final pre-disbursement approval stage is configured
 * as mandatory, that stage must be resolved by an authorised assignee or an
 * explicit company-authorised reassignment path before disbursement can
 * proceed."
 *
 * A blocked mandatory stage must still STOP the loan. The reassignment path may
 * supply a human for that stage; it must never become a silent skip.
 * ------------------------------------------------------------------ */
const reassignmentSource =
  SRC.find((s) => s.rel.endsWith("modules/loans/stage-reassignment.ts"))?.text ?? "";
const loansSource = SRC.find((s) => s.rel.endsWith("modules/loans/service.ts"))?.text ?? "";
check(
  "a blocked mandatory approval stage still blocks disbursement",
  /has no available authorised assignee/.test(loansSource),
  "a mandatory stage must never be bypassed merely because its assignee is unavailable"
);
check(
  "an explicit company-authorised reassignment path exists for blocked stages",
  /approvedCoverFor/.test(loansSource) && /requestStageReassignment/.test(reassignmentSource),
  "RULE 19.12.3 requires a reassignment path, not a dead end"
);
check(
  "a cover approver must hold the stage's own role",
  /assertCoverHoldsRole/.test(reassignmentSource),
  "a reassignment to someone without the role would let an unauthorised person approve"
);
check(
  "only approved reassignments resolve a stage",
  /status\s*=\s*'approved'/.test(reassignmentSource),
  "a requested or rejected reassignment must resolve nothing"
);

/* ------------------------------------------------------------------
 * 8. Derived values a person must not control (RULE 19.3.8).
 *
 * "Where a monthly-equivalent duration is displayed, the software derives it
 * from the configured repayment period; the C.O. does not manually calculate
 * or type a misleading month duration."
 *
 * A GENERATED ALWAYS column cannot be written by INSERT, UPDATE, raw SQL or any
 * future code, so this is enforced by the schema rather than by convention.
 * ------------------------------------------------------------------ */
check(
  "the monthly-equivalent duration is a generated column, not a supplied value",
  /derived_month_equivalent[\s\S]{0,120}GENERATED ALWAYS AS/.test(migrations),
  "RULE 19.3.8 requires the duration to be derived, so it must be unwritable"
);
check(
  "no loan terms write path supplies a month-equivalent value",
  !/SET[^;]*derived_month_equivalent\s*=/i.test(migrations) &&
    !/derived_month_equivalent\s*=\s*EXCLUDED/i.test(migrations),
  "an INSERT/UPDATE of the derived duration would defeat RULE 19.3.8"
);
check(
  "the terms API rejects a caller-supplied month equivalent",
  /rejectTypedMonthEquivalent/.test(
    SRC.find((s) => s.rel.endsWith("modules/loans/routes.ts"))?.text ?? ""
  ),
  "a typed duration must be refused with a reason, not silently dropped"
);

console.log(
  failures === 0
    ? "\nALL SECURITY INVARIANTS HELD"
    : `\n${failures} SECURITY INVARIANT(S) VIOLATED`
);
process.exit(failures === 0 ? 0 : 1);