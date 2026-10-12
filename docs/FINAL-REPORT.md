# Cornelius Nexora Finance — Final Report

**Date:** 2026-10-09
**Authority:** `Cornelius Nexora Finance SAAS Software — Final Vision v3.9 FINAL CLEAN AUTHORITY — AI and Multi-Company Concurrency Update — FINAL RECHECKED.docx`
**Extraction proof:** re-extracted from the `.docx` and compared byte-for-byte against `docs/verification/VISION-v3.9-AUTHORITY.txt` — **identical, 242,749 characters** (`_reextract_vision.ps1`).

**Production readiness is NOT claimed.** See §9.

---

## 1. What I did this session

| Deliverable | Where |
|---|---|
| Design instructions document (Part 17, all 15 sections, 29 roles written out individually) | `docs/Cornelius Nexora Finance design instructions.md` (63 KB) |
| Vision Audit findings register (RULE 16.2.2 format) | `docs/verification/VISION-AUDIT-FINDINGS.md` |
| External dependency register | `docs/EXTERNAL-DEPENDENCIES.md` |
| PostgreSQL cloud integration plan | `docs/POSTGRESQL-CLOUD-INTEGRATION.md` |
| OpenCode AI cloud integration plan | `docs/OPENCODE-AI-CLOUD-INTEGRATION.md` |
| Re-runnable audit harness | `scripts/extract-rules.mjs`, `audit-sweep.mjs`, `audit-routes.mjs`, `audit-dead-controls.mjs`, `dump-descriptors.mjs`, `check-role-coverage.mjs`, `gen-role-sections.mjs`, `build-design-doc.mjs` |

**Ordering note.** You asked for the design document first and the audit second. Vision RULE 16.0.1 and 17.2.1 prohibit exactly that
("No UI design deliverable… may be produced before Stage 13 has passed"). Since you said the Vision is the authority, I ran the
audit **first** and wrote the document from audited, working behaviour. Flagging it so the deviation from your ordering is
explicit rather than silent.

---

## 2. Completed, with evidence

### 2.1 Vision Audit structure (RULE 16.2.1)
- **411 RULEs** extracted mechanically across Parts 0, 2–14, 16, 17, 19–21 (`docs/verification/vision-rules.json`).
- **All 32 prohibitions** of Part 15 swept by keyword then triaged by hand.
- Six passes attempted. Three are structurally complete; three are execution-blocked (§7).

### 2.2 Prohibition sweep — 30 of 32 proven absent from product code

Every keyword hit was read individually. The important ones:

| Prohibition | Proof |
|---|---|
| 9 — no edit control over money | `GRANT UPDATE (status) ON payments` **only** — money columns are not writable by the app role. The two `UPDATE payments` statements set only the webhook traceability link inside the pipeline. |
| 10 — no delete over a financial record | `REVOKE DELETE` on payments, loans, virtual accounts, schedule rows; `REVOKE UPDATE/DELETE` on journal lines, receipts, allocations, reversals, audit logs. All `DELETE FROM …` hits are test teardown. |
| 13 — no upload/gallery path | **Zero** `type="file"`, `accept="image"` or multipart paths anywhere in the repo. |
| 16 — Branch Workplace cannot be entered by a branch worker | `branchActor()` requires `?branch=<uuid>` and a whitelisted Head Office role; branch-world roles are deliberately excluded. |
| 25 — cross-company visibility | Structurally enforced: 33 tables with `FORCE ROW LEVEL SECURITY`, 42 policies, tenant policy with both `USING` and `WITH CHECK`, a `RESTRICTIVE` branch-scope policy, `set_config('app.company_id')` per transaction. |
| 30 — no fake data or dead controls | 0 dead navigation targets; no `faker`/`lorem`/`mock` in any live view. |
| 29 — no role page mismatch | 38/38 role descriptors present; every nav target resolves to a real route. |

Caveats: #22 was **violated and is now fixed** (§4, F-06). #7 was **partially violated for the owner and is now fixed** (F-01).

### 2.3 Design instructions (Part 17)
All 15 mandatory sections present and mechanically checked. Written for a designer who has never seen the backend. Covers the
splash/loading sequence, the four boot outcomes, the credential ritual stepper, the shell, the role dashboard, every screen, all
19 flows, the colour token table **with per-colour worked examples**, all eight screen states, density, interaction, responsive,
accessibility, the component inventory, copy rules, prohibitions, stated defaults where the Vision was open, and a design
acceptance checklist.

### 2.4 Role/route coverage
- **38/38 roles** have a workspace descriptor (29 live + 9 templates). Zero gaps (`scripts/check-role-coverage.mjs`).
- **0 dead navigation links**; every route except the catch-all is reachable (`scripts/audit-routes.mjs`).
- Every `navigate()` target in every page resolves to a real route.

---

## 3. Partially completed, and why

| Area | State | Limitation |
|---|---|---|
| Role workspaces | Complete structurally | Rendered against a live API only when a session and database exist; not exercised at runtime |
| Performance/reports | Engine complete, UI complete | Figures never executed; correctness is by construction and code review |
| End of day | Endpoint + UI complete | The **scheduler** that should invoke it daily is not deployed (see §6) |
| Face capture | Capture flow and proof signing built | The **liveness vendor** call is missing; prohibition 13 forbids faking it |
| Scheduled reports | Generation + CSV export work | No schedule store, no delivery worker, no email service |
| Provider connection test | Now presents the credential | Needs a real merchant credential to prove the failure path |

---

## 4. Vision Audit findings and fixes

Full register: `docs/verification/VISION-AUDIT-FINDINGS.md`.

### Critical — security defects found and fixed

**F-01 — Platform Owner had no authenticator at all.** Vision: *"the owner is not exempt from security"*, *"mandatory
authenticator challenge"*, prohibition 7. In code, `poLogin` demanded a second factor only `if (totp_secret_encrypted)`, and no
product code ever wrote that column — only test seeds did. An unenrolled owner signed in with a password alone, permanently,
while the login UI claimed "password and authenticator code".
**Fix:** migration `0084`; `poBeginAuthenticatorSetup` / `poVerifyAuthenticator` / `poAuthenticatorStatus`; `poLogin` now
**refuses** (`AUTHENTICATOR_ENROLMENT_REQUIRED`) and audits the refusal; three new routes; a one-time-seed enrolment screen in
the platform console.

**F-02 — authenticator seeds were not encrypted at rest.** RULE 14.5.1 says *"authenticator seeds are encrypted at rest"*.
`totp_secret_encrypted` held `base64(secret)`; `unwrapSecret` was literally `Buffer.from(b64).toString("utf8")`. A database dump
exposed every worker's, the MD's and the owner's second factor.
**Fix:** `lib/secret-vault.ts` — AES-256-GCM, per-account scrypt-derived key, `v1.<iv>.<ct>.<tag>` envelope, tamper-detecting,
and `isLegacySecret` so pre-encryption rows **fail closed** (force re-enrolment) rather than being trusted.

**F-06 — provider credentials and webhook secrets were plaintext.** Prohibition 22 + RULE 14.5.1.
`payment_provider_configs.api_key` and `webhook_signing_secrets.secret` held clear text, so any database read disclosed every
company's live provider credentials and webhook signing secrets.
**Fix:** generalised the existing AI vault to a purpose-bound one (`company-ai-secret` / `payment-provider` / `webhook-secret`)
with company-bound AAD; both columns now hold ciphertext; migration `0085` adds `api_key_fingerprint` so a screen can show
*which* key is configured without decrypting; read surfaces return a fingerprint, never a value.

### High
**F-07 — the connection test could not detect a wrong key.** It issued a bare `GET` and accepted any 2xx. Acceptance test 11
requires a wrong key to fail. **Fix:** the test now decrypts the key via a single-purpose `loadProviderApiKey` and presents it as
`authorization: Bearer` + `x-api-key`.

### Medium
**F-03 — the traceability chain had a backend and no UI.** RULE 10.9.1. **Fix:** `TracePage` (`/trace`) with a walk from any of
10 node types, a query-string anchor, node/edge tables, re-anchoring, and explicit display of what the chain could not reach;
deep-linked from audit rows carrying a payment id.

**F-04 — no Sessions surface.** Part 12 §12.31. **Fix:** `recovery/sessions.ts` reading the existing `refresh_tokens`, company-scoped,
selecting **no `token_hash`**, computing liveness against credential status; gated to IT / Head Office Administrator.

**F-08** nav conflation (`/audit` serving two meanings) — split into `/audit` and `/trace`.

### Process
**F-05** design document drafted before the audit passed — ordering corrected (§1).

---

## 5. Missing features and corrective actions

| Missing | Corrective action | Blocked by |
|---|---|---|
| Findings register | **DONE this session** — migration `0086`, service, 4 routes, `FindingsPage`, nav repointed | — |
| Sessions surface | **DONE this session** | — |
| Traceability chain UI | **DONE this session** | — |
| Ticket / query store | New `tickets` table, ownership queue, SLA state, service UI | Design decision only — **not blocked**, simply not yet built |
| Policy checklist store | New policy store + sign-off workflow | Design decision only |
| Report builder | Persisted query model + engine support for composed columns | Design decision only |
| Scheduled report delivery | Schedule store + worker + email service | Design + email service |
| Liveness/KYC vendor call | Vendor adapter against the built capture flow | **External vendor** |
| Daily scheduler | Deploy a cron/worker to invoke end-of day | Deployment |
| Provider/webhook live proofs | Exercise with real merchant credentials | **External provider** |

---

## 6. External dependencies

Full register: `docs/EXTERNAL-DEPENDENCIES.md`.

| # | Dependency | Status | Can stay pending? |
|---|---|---|---|
| 1 | **PostgreSQL** | PENDING (not installed, per your instruction) | **No** — blocks 298 tests and every flow/isolation proof |
| 2 | **OpenCode AI CLI** | PENDING (not installed) | **No** — blocks all of Part 21 |
| 3 | Payment provider (Monnify / OPay / PalmPay / generic) | PENDING | **No** — payments only exist via webhook |
| 4 | Transactional email | OPTIONAL for pilot | Yes (in-app notifications cover a pilot) |
| 5 | SMS | OPTIONAL | Yes |
| 6 | Object storage (evidence/faces) | Works on a mounted volume | Yes, with a volume |
| 7 | KYC / liveness vendor | PENDING | **No** — prohibition 13 forbids faking it |
| 8 | Scheduler / job runner | PENDING | Partly — manual end-of-day exists |
| 9 | Backup destination | PENDING for production | Yes for development |
| 10 | TLS / domain / DNS | PENDING | **No** before any real URL is issued |
| 11 | Observability | OPTIONAL | Yes (pino already ships) |

---

## 7. Test results — including what could not run

### Passed
| Check | Result |
|---|---|
| `npm run typecheck` (all 5 workspaces) | **green** |
| `npx eslint` (server, web, platform-web, ui, shared) | **green**, 0 errors |
| `npm run build --workspace=packages/web` | **green** (14.96 s) |
| `npm run build --workspace=packages/platform-web` | **green** (8.17 s) |
| Dev smoke: web `:5173` | HTML 200; all page modules transform 200; no transform errors |
| Dev smoke: platform `:5174` | HTML 200; LoginPage + api transform 200; no errors |
| Route/nav audit | 0 dead targets |
| Role coverage audit | 38/38 roles |
| Dead-control scan | 0 genuine dead controls (4 flagged, all manually confirmed as handlers on the following line) |

### Did NOT run — and why
| Suite | Count | Reason |
|---|---|---|
| Server test suite | **38 files / 298 tests** | Every file opens the DB pool at import; all fail `ECONNREFUSED 127.0.0.1:5432`. PostgreSQL is pending by your instruction. |
| Flow walkthroughs (RULE 16.2.1 pass 3) | 17 flows | Need a database and, for money-in, a live provider |
| Isolation attacks (pass 4) | 4 suites | Need a database. **Subject verified statically instead** — see below |
| Permission sweep (pass 5) | runtime | Needs a database; structural checks pass |
| AI provider discovery/verify/execute (RULE 16.2.3A) | — | OpenCode CLI not installed |
| Live face capture / liveness | — | No vendor |
| Provider webhooks end-to-end | — | No merchant credentials |

**These are reported as not run. None is described as passing.**

### Isolation: what I could verify without a database
Verified statically, and it is strong: RLS is `ENABLE`+`FORCE`d on 33 tables; the tenant policy carries **both** `USING` and
`WITH CHECK`; branch scoping is a `RESTRICTIVE` policy so it is ANDed with tenancy; `withTenantSession` sets
`app.company_id`/`app.branch_id` per transaction and resets the branch flag on every pooled connection so a restricted session
cannot leak into a wider one; `companies` itself is RLS-protected with an explicit bypass only for the platform path. A query
run on the bare pool sees `NULL` for `app.company_id` and therefore sees **no rows** — fail-closed by construction.

**This is not the same as having passed the isolation attack suite. It has not passed it.**

---

## 8. PostgreSQL and OpenCode plans

- **PostgreSQL:** `docs/POSTGRESQL-CLOUD-INTEGRATION.md` — what exists (85 migrations, RLS design, write-protection grants),
  managed-hosting recommendation, the two-role split (migrator vs. non-owner app role, because RLS is bypassed by the owner),
  every environment variable with the production guards already in `config/env.ts`, the no-local-install deployment sequence, and
  the proof required before "production ready".
- **OpenCode AI:** `docs/OPENCODE-AI-CLOUD-INTEGRATION.md` — the existing boundary (`lib/opencode.ts` is the only module that
  touches OpenCode), binary resolution order, env allow-list and timeouts already implemented, the guarantee that no provider,
  model, availability state or success is ever fabricated, co-location recommendation, the eight Part 21 obligations and what
  blocks each.

**Format change disclosed:** generalising the secret vault changed the key-derivation and AAD strings used for company-AI
secrets. There is no deployed database, so no existing ciphertext exists to invalidate. On any environment that has one,
those keys must be re-entered. Provider credentials likewise cannot be "converted" — a plaintext value was never encrypted —
so on any environment with existing provider rows, credentials must be re-entered through the provider flow. Both are
deliberate fail-closed choices.

---

## 9. Production readiness

**Not claimed.** The Vision's own law (RULE 16.3.1) requires 28 end-to-end acceptance tests to pass on a clean environment, and
RULE 16.2.2 requires a finding to be closed only by a passing re-test. **Zero of those 28 have run**, because they require
PostgreSQL.

What is genuinely true today:
- The backend compiles, lints, and builds clean across all five workspaces.
- 30 of 32 prohibitions are proven absent **in product code**, several of them by database-level guarantees that make them
  structurally impossible rather than merely unimplemented.
- 38/38 roles have workspaces; every navigation target resolves; no dead controls.
- Three critical security defects were found by this audit and fixed.

What is not yet true:
- No test has executed. No flow has been walked. No isolation attack has been attempted.
- Money-in, face capture, and AI have never run against a real service.

---

## 10. Exact actions required from you

1. **Approve a managed PostgreSQL instance** (Neon recommended) — or tell me the host and I'll write the provisioning steps.
   This is the single highest-value unblock: it enables 298 tests, 28 acceptance tests, and every isolation proof.
2. **Decide the AI deployment** — approve installing the OpenCode CLI inside the API container image. Nothing will be installed on your PC without this.
3. **Choose a payment provider** (Monnify / OPay / PalmPay) and supply sandbox credentials, or confirm a provider simulation harness is acceptable for non-production.
4. **Choose a KYC/liveness vendor** for the live face capture the Vision mandates.
5. **Confirm the four "design decision only" gaps** (tickets, policy checklist, report builder, scheduled reports) — build now, or accept as documented scope reductions.
6. **Decide object storage**: mounted volume (zero code change) or S3 (needs an adapter).
7. **Decide outbound email**: in-app only for a pilot, or wire a provider.

Once you approve (1), the sequence I will run is: provision → migrate → verify RLS live → run all 298 tests → run the 28
acceptance flows → run the isolation attacks → re-run this audit → and only then make any readiness claim.

---

## Appendix — audit harness re-run instructions

```powershell
node scripts/extract-rules.mjs        # rebuild the 411-rule inventory from the Vision
node scripts/audit-sweep.mjs          # prohibition keyword sweep + triage data
node scripts/audit-routes.mjs         # route ↔ nav-target coverage
node scripts/audit-dead-controls.mjs  # dead controls + a11y smells
node scripts/check-role-coverage.mjs  # role ↔ workspace coverage
npm run typecheck; npx eslint packages/*/src
npm test --workspace=packages/server  # requires PostgreSQL — currently blocked
```