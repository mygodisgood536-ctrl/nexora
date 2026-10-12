# Vision Audit — Findings Register (Stage 13)

Authority: `docs/verification/VISION-v3.9-AUTHORITY.txt` — verified byte-identical (242,749 chars) to a
fresh extraction of `Cornelius Nexora Finance SAAS Software — Final Vision v3.9 FINAL CLEAN AUTHORITY — AI
and Multi-Company Concurrency Update — FINAL RECHECKED.docx` (re-extraction script: `_reextract_vision.ps1`).

Method per RULE 16.2.1 (six passes) and RULE 16.2.2 (finding format).
Harness scripts (re-runnable): `scripts/extract-rules.mjs`, `scripts/audit-sweep.mjs`,
`scripts/audit-routes.mjs`, `scripts/audit-dead-controls.mjs`.

**Rule inventory extracted:** 411 RULEs across Parts 0, 2–14, 16, 17, 19–21. Part 12 (roles) and Part 15
(prohibitions) are prose, not RULEs, and are audited separately.

---

## Findings

| # | Rule / Prohibition | Found | Should be | Severity | Fix | Re-test |
|---|---|---|---|---|---|---|
| F-01 | RULE 14.1.1, 14.2.1; Part 3 ("the owner is not exempt from security"); Prohib. 7 | Platform Owner had **no authenticator enrolment path**. `poLogin` demanded a second factor only `if (po.totp_secret_encrypted)`; no product code ever wrote that column, so an unenrolled owner signed in with a password alone, permanently. Login UI simultaneously claimed "password and authenticator code". | Owner holds a mandatory, verified authenticator; no session until enrolment completes. | **Critical** | Migration `0084_platform_owner_authenticator_enrolment.sql`; `poBeginAuthenticatorSetup` / `poVerifyAuthenticator` / `poAuthenticatorStatus`; `poLogin` now **refuses** (`AUTHENTICATOR_ENROLMENT_REQUIRED`, 403) and audits the refusal; routes `/auth/authenticator/{setup,verify,status}`; platform-web enrolment screen with one-time seed display. | typecheck ✅ · lint ✅ · build ✅ (both apps) · behavioural test **BLOCKED** (needs PG, §Blocked) |
| F-02 | **RULE 14.5.1** ("authenticator seeds are encrypted at rest") | Authenticator seeds were stored as `base64(secret)` in a column *named* `totp_secret_encrypted`. Base64 is encoding, not encryption: a DB dump exposed every worker's, the MD's and the owner's second factor. `unwrapSecret` was literally `Buffer.from(b64).toString("utf8")`. | Real authenticated encryption at rest. | **Critical** | New `packages/server/src/lib/secret-vault.ts`: AES-256-GCM, per-account scrypt-derived key from `EVIDENCE_ENCRYPTION_KEY`, `v1.<iv>.<ct>.<tag>` format, tamper-detecting, `isLegacySecret` so pre-encryption rows fail **closed** (force re-enrolment) instead of being trusted. Wired into the worker ritual (`auth/service.ts`) and owner login. | typecheck ✅ · lint ✅ · build ✅ |
| F-03 | RULE 10.9.1 / 6.5.4 | Traceability chain existed in the backend (`GET /traceability/chain`, 10 node types) but had **no UI and no nav link**. Descriptors pointed "Traceability chain" at `/audit`, so the required chain walk was unreachable. | Chain walkable from any node, per role. | High | New `TracePage` (`/trace`): node-type + id walk, anchor from query string, node/edge tables, re-anchor from any node, explicit `missing[]` display. Wired into the router and into `descriptors.ts`; deep-linked from audit rows that carry a payment id. | typecheck ✅ · lint ✅ · nav-target check ✅ (0 dead) · behavioural **BLOCKED** (needs PG) |
| F-04 | Part 12 §12.31 ("Sessions" in the Technical hub) | No sessions surface at all, though `refresh_tokens` already holds created_at/expires_at/revoked_at/ip/user_agent. | Owner of the Technical hub can see who is signed in. | Medium | `recovery/sessions.ts` (company-scoped via `withTenantSession`, **no `token_hash` selected**, live-state computed against credential status) + `GET /recovery/sessions` gated to `it_system_administrator`/`head_office_administrator` + Sessions tab in `TechnicalPage`. | typecheck ✅ · lint ✅ |
| F-05 | Part 17 §17.1.1 / RULE 17.2.1 | Design-instructions draft existed before Stage 13 passed. | Audit passes first. | Process | Ordering corrected: audit executed first; design doc written from audited, working behaviour only. | ✅ |
| F-06 | **RULE 14.5.1**, prohibition 22 | `payment_provider_configs.api_key` and `webhook_signing_secrets.secret` held **plaintext**. A database read disclosed every company's live provider credentials and webhook signing secrets — and an export of that column would have been a prohibited secret disclosure. | Provider credentials and webhook secrets encrypted at rest. | **Critical** | `ai-secret-vault.ts` generalised to a purpose-bound vault (`company-ai-secret` / `payment-provider` / `webhook-secret`) with company-bound AAD; provider keys and signing secrets now written as AES-256-GCM ciphertext; added `api_key_fingerprint` (migration `0085`) so the UI identifies *which* key is set without decrypting; read surface returns a fingerprint, never a value; new `loadProviderApiKey` is the only plaintext path. | typecheck ✅ · lint ✅ |
| F-07 | Prohibition 19 / acceptance test 11 | The connection test issued a bare `GET` to `api_base_url` and treated **any** 2xx as success. It never presented the credential, so a *wrong* key would pass and activate the provider — exactly what test 11 forbids. | A wrong key must fail; activation requires a real successful connection. | **High** | The test now decrypts the key via `loadProviderApiKey` and presents it as `authorization: Bearer` + `x-api-key`; a provider rejecting the credential returns non-2xx, which correctly does **not** pass and does not activate. | typecheck ✅ · lint ✅ · behavioural **BLOCKED** (needs a real provider credential + DB) |
| F-08 | Part 12 §12.1–12.31 (Descriptors §4 of Part 17) | "Traceability chain" nav item pointed at `/audit`, i.e. two different things shared one link. | One page per capability. | Low | Split: `/audit` and `/trace` are now separate routes and separate nav items. | nav audit ✅ 0 dead |

---

## Prohibition sweep (Pass 2) — 32 prohibitions

Every hit triaged by hand. **30 of 32 proven absent from product code**; 2 carry caveats recorded in the
final report.

| Prohibition | Verdict | Evidence |
|---|---|---|
| 1 Head Office portal | absent | no route/record/label by that name |
| 2 Company without MD Board | absent | atomic provisioning (`createCompanyAndBoard`) |
| 3 Data before ritual | absent | `requireCompleteSession` on 23 routers; ritual state machine enforced |
| 4 Initial password still valid | absent | one-time credential state; consumed on change |
| 5 Credential that cannot log in | absent | generated credentials are the login username/password |
| 6 Username != full name | absent | `credential.ts` builds username = full name, password = `@`+first name |
| 7 Worker exempt from authenticator | **FIXED (was partially true for the owner)** | see F-01 |
| 8 Manual money entry | absent | no endpoint creates a payment; only the webhook pipeline does |
| 9 Edit over money | absent | `GRANT UPDATE (status) ON payments` only — money columns are **not writable** by the app role. The two `UPDATE payments` statements set only the webhook traceability link inside the pipeline. |
| 10 Delete over financial record | absent | `REVOKE DELETE` on payments, loans, VA, schedule rows; all `DELETE FROM …` hits are test teardown |
| 11 Savings-only anything | absent | no savings-officer role, no savings-only path |
| 12 VA at registration | absent | VA created only in the disbursement transaction |
| 13 Upload/gallery photo | absent | **zero** `type="file"` / multipart paths in the repo |
| 14 Disburse without VA + schedule | absent | disbursement is one transaction covering VA, schedule, ledger, portal access |
| 15 Duplicate customer on loan/portal | absent | loans and portal access reference the existing customer |
| 16 Branch Workplace password / branch-worker entry | absent | `branchActor()` requires `?branch=` and a whitelisted Head Office role; branch roles are deliberately excluded |
| 17 Worker sees HO viewed his book | absent | workplace entry is audited silently; no notification to the worker |
| 18 Typed webhook URL | absent | bound automatically from the provider config |
| 19 Provider activated without test | absent | activation gated on a successful connection test |
| 20 Non-MD provider change | absent | `configure` verb + role check |
| 21 Non-MD change without MD authorisation | absent | `md_approved` gate; approvals queue |
| 22 Provider secret on screen | **caveat** | masked in UI; **PLAINTEXT AT REST** — `payment_provider_configs.api_key` not encrypted (see final report; tracked as a finding for the next pass) |
| 23 Fixed provider form | absent | per-provider requirement sets with how-to guidance |
| 24 Hard-coded company colour | absent in product UI | hex only in platform-owner green branding + migration seed defaults; portal uses `--nx-color-accent` |
| 25 Cross-company visibility | structurally enforced | RLS `USING`+`WITH CHECK`+`FORCE` on 33 tables, 42 policies, `app.company_id` set per transaction |
| 26 Platform brand inside a company | absent | companies render their own identity |
| 27 Dashboard off-engine | absent | every figure comes from `calculatePerformanceSet` |
| 28 Role rendered from another's components | absent | 31 role descriptors, own nav per role |
| 29 Role page mismatch | 0 dead nav links (mechanically verified) | `scripts/audit-routes.mjs` |
| 30 Fake data / dead controls | absent | 0 dead nav targets; no fake data in live views; a11y sweep run |
| 31 Owner sees company financials unlogged | absent | support access is a separate, time-bound, audited session |
| 32 Worker record deleted on leaving | absent | only test teardown deletes users; product terminates, never deletes |

## Flow walkthroughs (Pass 3) — **CANNOT RUN**
Requires PostgreSQL. All 38 test files / 298 tests import the DB pool at module load and fail with
`ECONNREFUSED 127.0.0.1:5432`. Per the user's standing instruction, PostgreSQL stays pending; these are
reported as **not run**, never as passing.

## Isolation attack (Pass 4) — **CANNOT RUN EXECUTE; SUBJECT VERIFIED STATICALLY**
Suites `stage13-isolation-attack`, `rls-isolation`, `multi-company-concurrency`, `stage6-branch-scope`
exist but cannot execute. Verified statically instead: 33 tables with `FORCE ROW LEVEL SECURITY`, tenant
policy with both `USING` and `WITH CHECK`, a `RESTRICTIVE` branch-scope policy on the 7 branch-owned
tables, and `set_config('app.company_id')` applied per transaction in `withTenantSession`.

## Permission sweep (Pass 5) — structural checks pass; **runtime enforcement untested**
Route inventory verified against descriptors (0 dead, 0 missing). Permission verbs are enforced by
`requirePermission` middleware at mount time and by RLS beneath it. Runtime denial behaviour is untested
(no DB).

## Story sweep (Pass 6)
The owner's own words were re-read against the built system; results in the final report.

## Blocked (cannot be verified here)
- 298 server tests, flow walkthroughs, isolation attacks — need PostgreSQL.
- OpenCode AI provider discovery/verification/execution — needs the provider runtime.
- Face capture / liveness, virtual-account issuance, provider webhooks — need real provider credentials.