# Nexora Vision Audit — Stage 13

**Authority:** `Cornelius Nexora Finance SAAS Software — Final Vision v3.9 FINAL
CLEAN AUTHORITY — AI and Multi-Company Concurrency Update` (Version 3.9, the
single current build authority). The previous `vision-v39.txt` transcription is
superseded by that document and is no longer a source of requirements.

**Scope:** `packages/server` (Stages 0–12 and Stage 13), the cross-package
contract in `packages/shared`, and the type health of `packages/web` and
`packages/platform-web`. The front end is Stage 15 and is not built; the Vision
does not judge screens the build order places after it (RULE 16.0.1,
RULE 16.0.2).

Every finding is written as RULE 16.2.2 requires: rule reference, what was
found, what should have been found, the fix, and the re-test result. A finding
is closed only by a passing re-test.

## Proof inventory

| Proof | File | Result |
| --- | --- | --- |
| Stage 2 credential law | `tests/stage2-auth.test.ts` | pass |
| Stage 1 data-layer isolation | `tests/rls-isolation.test.ts` | 6/6 |
| Platform Owner layer | `tests/stage3-platform.test.ts` | pass |
| Theme and colour law | `tests/stage4-theme.test.ts`, `tests/stage10-theme-law.test.ts` | pass |
| Workers and role engine | `tests/stage6-workers.test.ts` | pass |
| Branch Workplace | `tests/stage5-branches.test.ts`, `tests/stage6-branch-scope.test.ts` | pass |
| Customers, groups, loans | `tests/stage7-customers.test.ts`, `tests/stage7-groups.test.ts`, `tests/stage7-loans.test.ts` | pass |
| Accounting and statements | `tests/stage7-accounting.test.ts`, `tests/stage8-statements.test.ts` | pass |
| Provider registry, webhooks, VA | `tests/stage8-va-lifecycle.test.ts`, `tests/stage8-reconciliation.test.ts` | pass |
| Payment pipeline and allocation | `tests/stage8-allocation.test.ts`, `tests/stage7-payments.test.ts` | pass |
| Customer portal | `tests/stage8-customer-portal.test.ts` | pass |
| Performance, reports, notifications, audit | `tests/stage8-performance.test.ts`, `tests/stage8-reports.test.ts`, `tests/stage8-notifications.test.ts`, `tests/stage8-audit.test.ts` | pass |
| Gates, EOD, portfolio, loan documents | `tests/stage8-gates.test.ts`, `tests/stage8-eod.test.ts`, `tests/stage8-portfolio.test.ts`, `tests/stage8-loan-docs.test.ts` | pass |
| Part 22 end-to-end acceptance | `tests/stage11-final-acceptance.test.ts` | 6/6 |
| Pass 4 isolation attack | `tests/stage13-isolation-attack.test.ts` | 4/4 |
| Pass 5 permission sweep | `tests/stage12-role-matrix.test.ts` | 1/1 |
| Pass 6 story sweep | `tests/stage13-stories.test.ts` | 4/4 |
| Pass 2 prohibition sweep (32 prohibitions) | `tests/stage13-prohibition-sweep.test.ts` | 18/18 |
| Broad rule regression | `tests/stage9-fixes-runtime.test.ts` | pass |
| **RULE 21 OpenCode integration** | `tests/company-ai-opencode.test.ts` | 19/19 |
| **RULE 3.8 multi-company concurrency** | `tests/multi-company-concurrency.test.ts` | 4/4 |
| Model and health | `tests/model.test.ts`, `tests/health.test.ts` | pass |

**Full suite:** 37/37 files, 295/295 tests, sequential, against the real
database. **Typechecks:** server, web, platform-web, shared all clean.
**Fresh install:** all 81 migrations apply to an empty database.

## The six passes

**Pass 1 — rule compliance.** Part 0 to Part 22 walked against the
implementation. Rules 3.6.4–3.6.7, 3.8.1–3.8.8, 21.1.6–21.1.15, 21.2.1–21.2.10
and 21.3.1–21.3.5 are new in this Version of the Vision and are the substance of
the findings below.

**Pass 2 — prohibition sweep.** All 32 prohibitions proved absent twice where
possible: by searching the code for the forbidden shape, and by attempting it
against the running product. This pass produced four findings, all closed.

**Pass 3 — flow walkthroughs.** Every flow in RULE 16.2.1 pass 3 runs end to
end across the suite: create company as owner, fresh-MD ritual, GM/HR creation,
branch creation, provider configured with a wrong endpoint then a working one,
branch workers, customer registration, application with live face capture,
approval, disbursement, virtual account, customer portal login, payment,
allocation.

**Pass 4 — isolation attack.** Authenticated as company A, every attempt on
company B's real identifiers fails: workers, branches, customers, loans,
payments, providers, webhooks, files, reports, audit, plus cross-branch access,
spoofed tenant headers and no-session fail-closed behaviour.

**Pass 5 — permission sweep.** Single-role sessions for C.O., B.M., Finance, HR,
Auditor and MD assert the exact surface each may reach. 95 standard staff routes
carry an explicit permission; the only unauthenticated write is the signed
provider webhook ingress.

**Pass 6 — story sweep.** The owner's own words about the platform, onboarding
package, support access and Head Office ownership are re-read and answered,
including a structural proof that no "Head Office portal" exists anywhere.

**RULE 16.2.3A — the two new laws, explicitly verified.** The Vision requires
the audit to prove Part 3.8 and Part 21 across eight named properties. Each has a
live test:

| Required property | Proof |
| --- | --- |
| company-scoped configuration | `company-ai-opencode` "21.1.10/21.3.3", "3.6.4/3.6.6/3.6.7" |
| real provider/model discovery | "21.1.7/21.1.8", "21.2.2", "21.2.4", "21.2.10" |
| real verification | "21.1.9/21.1.12/21.1.13", "21.1.12 a configuration OpenCode cannot run" |
| real execution | "21.1.12/21.1.14", "21.2.8/21.3.1" |
| concurrent company operations | `multi-company-concurrency` "3.8.1/3.8.3", "21.3.3/21.3.4" |
| virtual-account concurrency | "3.8.7/3.8.8" |
| failure isolation | "3.8.4" |
| cross-company isolation | "21.1.10/21.3.3", "21.3.1", `stage13-isolation-attack` |

## Findings and closures

### F-01 — A second collection-rate calculation existed outside the performance engine

- **Rule:** RULE 11.2.1, RULE 11.1.2, RULE 11.2.2.
- **Found:** `src/modules/collection-watch/service.ts` selected workers below
  target with its own SQL (`SUM(actual) * 100 / SUM(expected)` in a `HAVING`
  clause) and recomputed the percentage in JavaScript for the alert detail, so
  the alert could disagree with the performance screen.
- **Should have been:** the alert's rate is the engine's rate, on the engine's
  basis, for the same scope.
- **Fix:** the watch selects only *candidates*, then calls
  `calculatePerformanceSet` per worker with the company's grace days and the
  same period basis the rest of the product uses. Threshold and alert detail
  both use the engine's `collectionRate`, and "no collections due" raises
  nothing.
- **Re-test:** `stage13-prohibition-sweep.test.ts` P27 asserts no module outside
  the engine derives a rate. Full suite pass.

### F-02 — DELETE was granted on financial, evidence and identity tables

- **Rule:** Part 15 prohibition 10, RULE 20.3.1, RULE 19.14.
- **Found:** the application role held `DELETE` on 13 tables including
  `loan_applications`, `branch_payment_accounts`, `loan_documents`, `customers`,
  `users` and `reconciliation_items`. No route used them, but a table grant is a
  delete control.
- **Should have been:** no destructive delete of any financial, evidence or
  identity record; every lifecycle change is a status, a reversal or a new
  linked record.
- **Fix:** `0080_prohibition_sweep_findings.sql` revokes `DELETE` from `nexora`
  on all of them.
- **Re-test:** P10 queries `information_schema.role_table_grants` and expects no
  financial DELETE grant; pass. `rls-isolation.test.ts` accepts either refusal
  and proves the row survives; 6/6.

### F-03 — The provider-change authority was unreachable for the roles the Vision names, and reachable for roles it forbids

- **Rule:** RULE 8.4.1, RULE 8.4.2, RULE 8.4.5, prohibition 20, RULE 12.2,
  RULE 12.3, RULE 12.7, RULE 12.8, RULE 12.23.
- **Found:** the payment service already enforced the right role list, but the
  route in front of it required the coarse `configure` verb, which the bundles
  grant to Head Office Administrator and IT/System Administrator and not to
  Deputy MD, GM or the GM family. The named roles were stopped at the door while
  the two roles the Vision forbids passed the route gate.
- **Fix:** verb `configure_providers` (MD, Deputy MD, GM, Assistant GM,
  Operations Manager, Finance Manager) required by the provider create route,
  with the connection test accepting it or the technical `configure` that IT's
  credential flow is allowed.
- **Re-test:** P20/P21 — a C.O. is refused, a Finance change is saved inactive
  and unapproved, appears in the MD's queue, and only the MD's own approval
  activates it; pass.

### F-04 — The company's generated URL was returned but never stored

- **Rule:** RULE 3.4.1.
- **Found:** `createCompany` returned `company_url` and left
  `companies.portal_url` NULL.
- **Fix:** written in the provisioning transaction; `0080` backfills any
  existing company.
- **Re-test:** P1 asserts the stored URL, that exactly one portal exists, and
  that no Head Office portal, route, table or column exists; pass.

### F-05 — The MD's credential issuance and support sessions were invisible in the company's own audit trail

- **Rule:** RULE 5.10.2, RULE 3.4.1, RULE 3.6.3, prohibition 31.
- **Found:** the issuance of the MD's initial credential, and every support
  session open/close/summary, was recorded in the platform audit only.
- **Fix:** `auditCompanyTrail` writes to the company trail after the platform
  transaction commits, so no orphan audit row survives a rollback.
- **Re-test:** `stage13-stories.test.ts` asserts both trails; 4/4.

### F-06 — The company AI was a deterministic query engine, not the OpenCode execution layer the Vision requires

- **Rule:** RULE 21.1.6, RULE 21.1.7, RULE 21.1.8, RULE 21.1.15, RULE 21.2.8.
- **Found:** the company AI answered from three hard-coded intents and returned
  pre-computed JSON. There was no OpenCode integration, no provider or model
  discovery, and no provider/model selection anywhere in the product. The
  AI MODEL interface the Vision specifies had nothing to connect to.
- **Should have been:** OpenCode as the real provider/model integration and
  execution layer; the live provider and model catalogue read from it; a real
  execution using the exact provider/model the company selected.
- **Fix:** `src/lib/opencode.ts` is the single integration boundary. It resolves
  the real executable, lists providers and models from the live catalogue,
  exposes the genuinely free models as OpenCode currently reports them, performs
  real verification and real execution, and reports real failures with no
  substitution. `config-service.ts` adds the company-scoped configuration
  lifecycle, and `runCompanyAi` executes with the caller's own persisted
  configuration inside that company's tenant context.
- **Re-test:** 19/19 in `company-ai-opencode.test.ts`, including a real execution
  whose answer contains the value the test asked for, and a test that asserts
  RULE 21.2.1's exact labels and explanatory text are served from the backend so
  a screen cannot rename or reword them while the two lists stay live; pass.

### F-07 — OpenCode could not actually be executed from the server process

- **Rule:** RULE 21.1.8 ("must be properly installed and available to the
  platform's execution architecture").
- **Found:** three genuine execution defects, each found only by attempting a
  real run. (1) `spawn` cannot run the Windows `.cmd`/`.ps1` npm shim without a
  shell, and wrapping a provider execution in a shell is wrong; the executable
  itself is now resolved behind the npm shim. (2) OpenCode reads stdin while it
  works and does not run until stdin reaches EOF, so a spawned child that was
  never told "no further input" hung until it was killed. (3) A 45-second
  catalogue timeout was too short for a cold start of a large executable under
  load, and a single attempt reported a false outage.
- **Fix:** explicit executable resolution with an `OPENCODE_BIN` override,
  immediate stdin EOF, a 120-second catalogue budget with one retry, and a
  180-second execution budget. Genuine availability differences are still
  reported as themselves, never as success.
- **Re-test:** the real-execution test and the seven live models measured
  directly; pass.

### F-08 — A company AI credential was not bound to its company

- **Rule:** RULE 21.1.10, RULE 21.1.11, RULE 21.3.3.
- **Found:** nothing prevented a secret belonging to one company from being used
  for another, and no vault existed for AI credentials.
- **Fix:** `src/lib/ai-secret-vault.ts` encrypts with AES-256-GCM using the
  company id as authenticated additional data, so a ciphertext cannot be
  replayed for another tenant even with full database access. The plaintext is
  handed to exactly one child process under that provider's own key variable name
  and dies with it; no credential is inherited from the server's environment.
- **Re-test:** cross-company decryption is refused, and no secret appears in any
  API response; pass.

### F-09 — An unverified or failed configuration could have taken a company's AI offline

- **Rule:** RULE 21.1.12, RULE 21.1.13, RULE 21.1.14, RULE 21.3.5.
- **Found:** no activation gate existed, because no verification existed.
- **Fix:** a configuration is created unverified; `Done` is refused unless a
  real verification succeeded; the database permits exactly one active
  configuration per company, so two concurrent `Done` actions cannot both
  believe they activated theirs; a failed replacement leaves the previous
  verified configuration active; removal is an audited revoke flow.
- **Re-test:** the lifecycle test proves unverified activation is refused, a
  vanished model is reported as a real failure and never marked verified, and an
  unverified replacement does not displace the active configuration; pass.

### F-10 — The Companies workspace was unpaginated, unsearchable, and exposed a customer count

- **Rule:** RULE 3.6.1, RULE 3.6.2, RULE 3.6.4, RULE 3.6.6.
- **Found:** the list returned every company in a bare array with no search,
  filter, sort or pagination, and included a per-company customer count that the
  owner is not permitted to see. There was no Company Detail workspace, so the
  AI provider/model configuration had nowhere to live.
- **Fix:** the list is now `{ items, total, limit, offset }` with search over
  name/slug/prefix, status filter, whitelisted sort columns, and pagination; the
  customer count is gone, leaving only the structural aggregates RULE 3.6.1
  permits. `GET /platform/v1/companies/:id/detail` returns that company's
  management context — setup progress, staff counts by role category, branches,
  branding, login recency and its own AI configuration — and nothing from
  RULE 3.6.2's forbidden list.
- **Re-test:** "3.6.6" searches, filters, sorts and paginates and proves every
  listed result opens its own exact company; "3.6.4/3.6.6/3.6.7" proves two
  companies hold different AI configurations that never interleave and that the
  detail payload contains no customer, loan, payment or balance data; pass.

### F-11 — Concurrency law: virtual-account creation was not proven across tenants

- **Rule:** RULE 3.8.1, 3.8.2, 3.8.3, 3.8.4, 3.8.5, 3.8.7, 3.8.8.
- **Found:** no test exercised several companies disbursing at once, so nothing
  proved that each resolves its own company, branch, provider and credential.
- **Fix:** `src/lib/tenant-execution.ts` provides a tenant execution context
  whose secret resolver cannot be pointed at another tenant, and a limiter keyed
  per (company, lane) rather than globally, plus `runAcrossTenants` for
  independent concurrent work. The provider virtual-account call resolves the
  branch's configuration and credentials inside the caller's tenant.
- **Re-test:** four companies with four different providers, four different
  credentials and four real HTTP provider endpoints disburse simultaneously;
  each endpoint receives exactly one request carrying its own company, branch,
  account name and a credential that no other company's key can produce; the
  number the provider issued is what is persisted; a failing provider leaves no
  loan, account or portal row and does not affect any other company; two
  simultaneous disbursements of one application produce one loan and one active
  account; every queue and history table carries `company_id`. 4/4 pass.

## Audited, no deviation found

- **RULE 8.1.2, 8.2.1, 8.3.1, 8.2.3** — the provider registry is data, and the
  form follows it. `payment_providers` carries each provider's
  `requirement_set`, `capability_flags`, `connection_descriptor`,
  `webhook_descriptor` and `virtual_account_descriptor`; the requirement sets
  genuinely differ, which P23 proves.
- **RULE 19.1–19.3, 19.15** — group lending: real schedule, real collection,
  real per-member ledger. `stage7-groups.test.ts`, `stage11-final-acceptance`.
- **RULE 19.2** — the active-loan gate and next-cycle numbering.
- **RULE 19.11, 19.12.7, 19.12.8, 19.13.4** — the final package and the
  standalone Return for Information state.
- **RULE 20.5, 20.6** — restore verification and post-recovery reconciliation,
  including evidence hash checks and 20 explicit record types.
- **RULE 21.4.1–21.4.5** — role-aware intelligence, auditor traceability, branch
  workplace exposure and configurable performance-versus-salary monitoring.
- **RULE 4.x, Part 3** — the Platform Owner layer, its company workspaces, the
  atomic create-company wizard, and the absence of any head-office portal.

## Residual items

These are open and are **not** claimed as closed.

1. **RULE 20.4.1–20.4.5 — production backup architecture.** Encrypted
   continuous WAL/PITR, a separate encrypted scheduled full backup, an
   independent evidence/object replication strategy, an isolated protected copy,
   and configurable retention, geographic placement and residency cannot be
   proved from a development database. The code side (RULE 20.5, 20.6) is
   implemented and tested; the infrastructure side needs deployment evidence and
   a recorded restore drill against a real backup.
2. **Part 12 role workspaces and Part 13 colour law** are front-end
   deliverables. By RULE 16.0.1 the front end is built after the design
   instructions document, so their screens, groups and colour tokens are not yet
   built and cannot be audited. The backend contract each of those screens reads
   is implemented and permission-checked.
