# NEXORA — IMPLEMENTATION ROADMAP

Source of truth: the four specification documents in `docs/specs/` (SRS v2.1 Part 1, SRS v2.1 Part 2,
Role Specifications A–Z Complete, Platform Owner Portal Spec). Nothing in this roadmap overrides them.

---

## 1. Architecture

- **Single codebase, multi-tenant SaaS** (Part 1 §4): one deployment serves unlimited companies; every
  tenant-scoped row carries an indexed `company_id`; branch-scoped rows additionally carry `branch_id`.
  Two-layer scoping (`company_id` then `branch_id`) is the backbone.
- **Two distinct frontend surfaces** (Part 1 §4; Platform Owner Spec preamble):
  - `packages/web` — company portals (Head Office + all branch portals + all 32 role workspaces +
    Customer Portal), themed per company via theme variables.
  - `packages/platform-web` — the Platform Owner Portal, a separate application surface with Nexora's
    own default identity. It shares **no** branding/navigation/dashboard components with company portals
    and never receives company theme tokens.
- **Backend**: Node.js + TypeScript + Express REST API under `/api/v1` (company side) and
  `/platform/v1` (Platform Owner side), mounted as separate route trees from one process.
- **Database**: PostgreSQL 16 with Row-Level Security policies keyed to session variables
  (`app.company_id`, `app.branch_id`) set per transaction — the spec's "row-level security or an
  equivalent enforced query middleware" (Part 1 §4); we implement both RLS *and* a scoped repository layer.
- **Subdomain routing** (Part 1 §9): `{company-slug}.nexora.app` = Head Office portal;
  `{company-slug}-{branch-slug}.nexora.app` = branch portal. Local development uses `*.localhost`
  equivalents resolved by host-header middleware (`Host: abcfinance-abj.localhost`). Routing/permission
  resolution always uses immutable IDs behind the slug, never the slug itself.
- **Cashless payments** (Part 1 §21): provider adapters → signed webhook receiver → step-wise retryable
  pipeline → allocation engine → ledger/accounting/receipt/notification/audit/dashboard. No manual
  payment entry exists anywhere by design.
- **Real-time performance**: the Performance Calculation Engine is the single calculator (Part 1 §25-B);
  dashboards consume its output; figures refresh when pipeline step 13 completes.

## 2. Project Structure

```
nexora/
├── docs/
│   ├── ROADMAP.md / CHECKLIST.md          this plan + verification checklist
│   └── specs/                             the four authoritative specification documents
├── scripts/                               start/stop local PostgreSQL helpers
└── packages/
    ├── shared/        domain constants: 32-role catalogue, scope types, permission verbs,
    │                  status enums, API envelope types, permission-merge utilities
    ├── server/        Express API
    │   └── src/
    │       ├── config/         zod-validated environment
    │       ├── lib/            logger (pino), errors, async request context
    │       ├── middleware/     request context, auth, permissions, error handler
    │       ├── db/             pg pool, RLS tenant-session helper, migrations, seeds
    │       ├── modules/
    │       │   ├── platform/   Platform Owner Portal API (separate surface)
    │       │   ├── auth/ companies/ branches/ workers/ roles/
    │       │   ├── customers/ groups/ loans/ virtual-accounts/
    │       │   ├── payments/   webhooks, pipeline jobs, allocation engine
    │       │   ├── ledger/ accounting/ reconciliation/
    │       │   ├── performance/ reports/ notifications/ audit/
    │       │   └── support/    tickets, findings, compliance/risk cases
    │       └── routes/
    ├── web/           company portals SPA (React + Vite + TS + Tailwind + Poppins)
    │   └── src/       role workspaces live under src/workspaces/<role-key>/ — one component tree each
    └── platform-web/  Platform Owner Portal SPA (own dark-navy/royal-blue Nexora theme)
```

## 3. Database / Domain Model (Stage 1)

Key tables (all money-moving data FK-reachable from the audit chain, Part 2 §60-6):

| Area | Tables |
|---|---|
| Platform | `platform_owners`, `global_settings`, `role_catalogue_entries`, `custom_role_templates` |
| Tenants | `companies` (code prefix unique platform-wide, slug, status), `themes` (per-company CSS tokens), `company_role_settings` (enable/disable) |
| Structure | `branches` (unique `(company_id, code)`; code `{PREFIX}-{SEQ}` never reused, immutable), head office is implicit per company (no branch row — Part 1 §5–6) |
| People | `users` (staff; DOB day+month only, no year column — Part 1 §12), `customers` (one branch each), `groups`, `group_members` |
| RBAC | `roles` (32 built-in seeded per company + custom), `permissions`, `role_permissions`, `role_assignments` (scope type, scope ids, permanent/temporary + start/end, reason, assigned_by) |
| Loans | `loan_products`, `approval_chains`, `approval_chain_steps`, `loan_applications`, `loan_documents`, `credit_assessments`, `loans`, `repayment_schedule_rows` (ledger expected side) |
| Payments | `virtual_accounts` (issued at onboarding; statuses Active/Pending/Replaced/Closed), `payments` (immutable; provider txn ref idempotency key), `payment_allocations`, `payment_reversals` (linked, never edit), `webhook_events`, `webhook_exceptions`, `pipeline_jobs` (per-step status), `reconciliation_items` |
| Savings | `savings_accounts`, `savings_transactions` |
| Accounting | `gl_accounts`, `journal_entries`, `journal_lines`, `receipts` |
| Ops/support | `notifications`, `audit_logs` (full field set incl. role-used, before/after, reason, device/IP), `platform_audit_logs`, `findings`, `compliance_cases`, `risk_cases`, `tickets`, `activity_notes`, `support_access_sessions` |

Constraints: financial records append-only (reversals, never edits); schedule generated in full at
disbursement; VA exists before first payment can ever land; disbursement blocked while VA pending.

## 4. Authentication / Authorization Architecture

- Password-only for company-side users and customers — no OTP/SMS/email verification/2FA (Part 1 §13).
  The Platform Owner account alone mandates a second factor (Platform Owner Spec §1).
- bcrypt password hashing; temporary passwords single-use with configurable expiry (default 72h),
  displayed once to the creating admin only; forced password change on first login.
- JWT access tokens (short-lived) + rotating refresh tokens delivered as httpOnly cookies scoped to the
  portal surface; login resolves `company_id` (+ optional `branch_id`) from the subdomain *before*
  credential checking (Part 1 §13); user never picks company/branch/role.
- Principal = active role assignments merged by **union** of permission sets over covering scopes
  (Part 1 §16); restrictions are per-role and never downgrade another assignment's grant.
- Post-login role-context switcher when multiple roles are active at the current context (never a
  login-time question).
- Temporary assignments auto-activate/deactivate at start/end-of-day boundaries in company timezone;
  deactivation fires audit + notifications (Part 1 §17).
- No signup/self-registration/self-password-reset endpoints exist at all (Part 1 §11).

## 5. Tenant-Isolation Strategy

1. Every tenant table: `company_id uuid NOT NULL` indexed; branch tables add `branch_id`.
2. Postgres RLS: `USING (company_id = current_setting('app.company_id')::uuid)` (+ branch analog);
   the app sets both via `SET LOCAL` inside every transaction through `withTenant()`.
3. Repository base refuses to execute without an established tenant session (fail-closed).
4. Authorization middleware resolves scope per request from the principal's role assignments.
5. Integration tests prove cross-company and cross-branch reads/writes fail for out-of-scope principals.
6. Platform Owner tooling connects only via its own audited path; Support Access is separate,
   time-bound, reason-captured, doubly audited (Platform Owner Spec §40).

## 6. API Architecture

- `/api/v1/*` company operations; `/platform/v1/*` owner operations; `/webhooks/:provider/*`
  signature-verified receiver endpoints (unauthenticated but HMAC-checked).
- zod schema validation on body/query/params; uniform error envelope
  `{ error: { code, message, details?, requestId } }`; pino logging with redaction; `x-request-id` on
  every response; cursor pagination + filter conventions; CSV export endpoints for reports.
- Permission middleware: `requirePermission(verb, resource)` evaluated server-side against merged
  principal permissions — frontend hiding is never the enforcement point.

## 7. Frontend Architecture

- React 18 + Vite + TypeScript + Tailwind v4; Poppins bundled via @fontsource (works offline).
- Theming strictly via CSS custom properties from the company theme record (Part 1 §26): zero hex
  values in components; Nexora defaults are the token fallbacks. Verified by rendering two differently
  branded tenants with identical component trees.
- One workspace directory + dashboard component tree per built-in role (`src/workspaces/md/`,
  `src/workspaces/collection-officer/`, …) — no cross-role conditional reuse (Part 2 §60-9).
- Shared primitives (KpiCard, DataTable, FilterBar, Drawer, ConfirmDialog…) implement the spec's global
  loading/error/empty/success/confirmation conventions once; role screens compose them.
- Route guards derive from effective permissions; responsive behavior per role specs S/T/U fields
  (desktop/tablet/mobile breakpoints).

## 8. Payment Architecture

- `PaymentProvider` adapter interface: `issueVirtualAccount`, `verifyTransaction`,
  `listTransactions(from,to)` (reconciliation diff), webhook signature validation.
- Built-in **SandboxProvider** (clearly labeled test harness) implements the same contract so the full
  pipeline is exercised end-to-end in dev/test; production providers plug in per-company credentials.
- Pipeline steps are individually retryable jobs with per-step status (`pipeline_jobs`); idempotency by
  provider txn reference; value date = provider timestamp (delayed-webhook safe); duplicates acked and
  suppressed-with-audit; unknown VAs → Unmatched; allocation failure → Unallocated (funds recorded);
  mid-failure → Incomplete Processing; reversals create linked reversal entries and re-audit balances.
- Scheduled reconciliation job diffs provider transaction lists against recorded payments (Part 1 §21).
- The product contains no manual repayment-entry route/service/UI for any role — enforced by absence
  and covered by a structural test asserting no such endpoint exists.

## 9. Staged Implementation Plan

| Stage | Content | Gate |
|---|---|---|
| 0 | Foundation: monorepo, env, logging, validation, errors, auth middleware skeleton, tenant context, DB connection, health probes, both frontends boot | verified ✔ |
| 1 | Full database/domain model + migrations + indexes + constraints + audit chain FKs | model tests green |
| 2 | Auth, sessions, passwords, permission merge engine, scope resolution, RLS isolation tests | isolation suite green |
| 3 | Platform Owner Portal A→Z (40 sections of its spec) | acceptance walkthrough |
| 4 | Company creation wizard + branding/theme variables end-to-end | two-brand render proof |
| 5 | Branch system: creation, deterministic codes, portal URLs, drill-down workspace | race-condition tests |
| 6 | Workers/users lifecycle + role architecture UI/APIs + custom roles + enable/disable | worker flow E2E |
| 7 | Core engines: Performance Calculation Engine, payment pipeline + exceptions, allocation engine, Digital Collection Ledger, accounting posting, reconciliation module, notifications, audit trail, report/export infra, customer/group/loan/savings/VA domains | engine unit+integration suites green |
| 8–39 | Roles 1–32 implemented ONE BY ONE in Role Library order, each A→Z then tested/verified/regressed before the next | per-role gate below |
| 40 | Customer Portal (read-mostly, pay-by-transfer view) | customer flow E2E |
| 41 | Final verification pass vs all four documents + acceptance criteria | CHECKLIST complete |

Per-role gate (applies to every role in stages 8–39): implement A–Z → test dashboard/nav/pages/tables/
filters/search/actions/permissions/scope/restrictions/notifications/reports/drill-down/audit visibility/
transaction visibility/performance visibility → desktop/tablet/mobile checks → regression suite stays
green → mark verified in CHECKLIST.md → next role.

## 10. Testing Strategy

- **Unit (vitest)**: permission merge, branch code generation (incl. collision/no-reuse), allocation
  engine cases (exact/partial/over/multi-cycle/multi-loan), performance vocabulary calculations and
  reconciliation totals, temp-assignment activation/expiry logic.
- **Integration (supertest + real Postgres)**: RLS isolation (cross-company/cross-branch denial),
  approval-chain transitions + authorization at each stage, webhook pipeline including every exception
  row of Part 1 §21's table, reconciliation diff, accounting traceability chain.
- **E2E (Playwright)**: per-role scripted flows verifying that role's A–Z matrix and responsive
  layouts; grows into a regression pack that must stay green after every subsequent change.
- **Structural guards**: lint/test assertions that no manual payment-entry endpoint/component exists;
  that every tenant table carries `company_id`; that components contain no hard-coded brand colors.

## 11. Role-by-Role Implementation Sequence (exact Role Library order)

| # | Role | Category |
|---|---|---|
| 1 | MD | Executive |
| 2 | Deputy MD | Executive |
| 3 | GM | Executive |
| 4 | Assistant GM | Executive |
| 5 | Head Office Administrator | Executive |
| 6 | Operations Manager | Executive |
| 7 | Assistant Operations Manager | Executive |
| 8 | Finance Manager | Finance |
| 9 | Accountant | Finance |
| 10 | Assistant Accountant | Finance |
| 11 | Cash/Bank Reconciliation Officer | Finance |
| 12 | HR Manager | HR/Admin |
| 13 | HR Officer | HR/Admin |
| 14 | Internal Auditor | Audit/Compliance |
| 15 | Audit Officer | Audit/Compliance |
| 16 | Compliance Officer | Audit/Compliance |
| 17 | Risk Officer | Audit/Compliance |
| 18 | Credit Manager | Credit/Loans |
| 19 | Credit Officer | Credit/Loans |
| 20 | Loan Officer | Credit/Loans |
| 21 | Account Officer | Customer/Accounts |
| 22 | Field Account Officer | Customer/Accounts |
| 23 | Customer Service Officer | Customer/Accounts |
| 24 | Customer Service Manager | Customer/Accounts |
| 25 | Area Manager | Operations/Field |
| 26 | Branch Manager | Operations/Field |
| 27 | Deputy/Assistant Branch Manager | Operations/Field |
| 28 | Collection Officer | Operations/Field |
| 29 | Senior Collection Officer | Operations/Field |
| 30 | Recovery Officer | Other |
| 31 | MIS/Reporting Officer | Other |
| 32 | IT/System Administrator | Other |

The 11 Custom Role templates (Finance Officer, HR Assistant, Administrative Officer, Loan Processing
Officer, Credit Analyst, Assistant Account Officer, Field Officer, Operations Officer, Portfolio
Manager, Treasury Officer, Data/Reporting Analyst) ship as cloneable templates per the preserved
catalogue decision — not as pre-built dashboards.

---

## 12. Implementation Log

Chronological record of verified milestones. A milestone is logged only after its quality gate
(typecheck + lint + tests + database verification against both `nexora_dev` and `nexora_test`)
passes and the work is committed.

| Milestone | Contents | Gate | Commit |
|---|---|---|---|
| baseline | Stage 0 foundation + migration runner + 0001_platform / 0002_tenants / 0003_branches / 0004_rbac (pre-existing OpenCode work, committed as-is) | initial commit | `8376b8d` |
| 0005_customers | `customers` (one branch per Part 1 §5; status starts `va_pending` per §22 onboarding rule; KYC documents jsonb + `kyc_complete`; unique `(company_id, customer_code)`), `groups` (branch-level, no financial columns, Part 2 §27), `group_members` (composite PK); indexes + update triggers; `CustomerStatus`/`GroupStatus` added to shared domain enums; lint fix: CLI console statement scoped in migrate.ts | typecheck ✓ lint ✓ tests 6/6 ✓ both DBs verified ✓ | `d254ad4` |
| 0006_lending | `approval_chains` (+configurable on-rejection behavior), `approval_chain_steps` (ordered roles — built-in or custom via `roles.id`), `loan_products` (principal bounds, rate + free-form method, cycle days/count, expected repayment/savings split, required chain link), `loan_applications` (chain snapshot, generic stage statuses + `current_stage_order`, rejection-requires-reason CHECK), `loan_documents` (upload + confirmation), `credit_assessments` (append-only via REVOKE UPDATE/DELETE), `loans` (term snapshots at disbursement, lifecycle active/overdue/completed, DELETE revoked), `repayment_schedule_rows` (expected side generated at disbursement; actuals pipeline-written only; DELETE revoked) | typecheck ✓ lint ✓ tests 6/6 ✓ both DBs verified ✓ | `357caf4` |
| 0007_payments | `virtual_accounts` (§22 fields; UNIQUE(provider,account_number); partial unique one-active-per-customer; replacement keeps history — DELETE revoked), `payments` (immutable financial facts: REVOKE UPDATE + column-grant UPDATE(status) only; idempotency UNIQUE(provider,provider_txn_ref); provider-timestamp value_date per delayed-webhook rule; full pipeline status CHECK), `payment_allocations` (repayment/savings/rollover split, must move money; append-only), `payment_reversals` (UNIQUE original_payment_id — single linked reversal; append-only), `webhook_exceptions` (invalid_signature/malformed/verification_failed queue with resolution trail), `pipeline_jobs` (per-step 1–13 retryable jobs, attempts+last_error), `savings_accounts` (one per customer, balance ≥ 0) + `savings_transactions` (append-only credit/debit ledger with balance_after) | typecheck ✓ lint ✓ tests 6/6 ✓ both DBs verified ✓ | `a0c39ec` |
| 0008_finance | `gl_accounts` (per-company chart, 5 account types, cash flag for Cash Book), `journal_entries` (sources pipeline/reversal/system only; optional payment_id traceability; self-FK reversal_of_entry_id for linked corrections; REVOKE UPDATE+DELETE — posted immutability), `journal_lines` (debit/credit; REVOKE UPDATE+DELETE) with **deferred constraint trigger enforcing debits=credits per entry** (spec §3 discrepancy principle at DB level), `receipts` (one per payment via UNIQUE payment_id; numbered UNIQUE(company_id,receipt_number); append-only), `reconciliation_items` (persistent §39 resolvable list: unallocated/unmatched/reversed/incomplete-processing; open→resolved/dismissed trail) | typecheck ✓ lint ✓ tests 6/6 ✓ both DBs verified ✓ | `4551eaa` |
| 0009_comms_audit | `audit_logs` — complete Part 1 §25 field set: actor user + role-used, company/branch scope, server timestamp, action, entity type/id, previous/new values jsonb, reason for sensitive actions, payment_id FK + provider transaction_ref for financial traceability (§25 chain as foreign keys, not report-time joins), IP/user-agent device capture, request-id correlation; append-only (REVOKE UPDATE/DELETE). `notifications` — Notification Center rows for staff users *and* customer-portal recipients (single-recipient CHECK), kind + payload, channel in_app/email/in_app+email, read tracking | typecheck ✓ lint ✓ tests 6/6 ✓ both DBs verified ✓ | `c0cd087` |
| 0010_rls | FORCE RLS on all 36 tenant tables (+ `companies` with an explicit bypass-flag policy reserved for the pre-auth login path); permissive `rls_tenant` policy on `app.company_id`; **RESTRICTIVE** `rls_branch_scope` layer on the 7 branch-scoped operational tables keyed to `app.branch_restricted`/`app.branch_id`; normalized grants incl. append-only re-revokes and payments' status-only column grant; webhook_events SELECT/INSERT for the receiver; security-definer `resolve_virtual_account(provider, account_number)` so pipeline intake works without a tenant session while staying single-active-VA-correct; `group_members.company_id` added (ROADMAP §5.1 conformance). Isolation proven by tests below | typecheck ✓ lint ✓ tests 20/20 ✓ both DBs verified ✓ | (commit A) |
| stage-1 tests | vitest globalSetup auto-applies migrations to `nexora_test`; deterministic two-company fixture (advisory-lock serialized, self-healing); **model suite**: customer-code uniqueness scope, status CHECKs, payment idempotency + positive-amount, one-active-VA partial index w/ replacement history, rejection-requires-reason, deferred balanced-journal trigger, posted-entry immutability (amount UPDATE denied / status UPDATE allowed / audit DELETE denied); **isolation suite**: fail-closed zero rows without session, company-scoped reads, cross-company write rejection, branch restriction on/off behavior, known-id tamper denial, definer VA resolver without session | tests 20/20 PASS | `3f3a71f` |
| 0011_auth_access | Grants the pre-auth/role-engine read paths RLS cannot cover structurally: `companies` SELECT via its bypass-flag policy (host→tenant resolution before credentials), plus `role_permissions`/`role_assignment_branches` SELECT (join tables whose tenant containment flows through their RLS-scoped parents), and a bypass-aware `refresh_tokens` policy so rotation can identify the cookie's tenant before opening its session | applied dev+test ✓ | (commit A) |
| stage-2 auth foundation | **shared/auth.ts** permission-merge engine: union of active assignments' grants, temporary-window activation (`startsAt≤now≤endsAt`, ended excluded), per-scope coverage incl. multi_branch lists, restrictions never downgrade another grant. **server auth module**: host-candidate login resolving company (+branch) BEFORE credentials (Part 1 §13); bcrypt verify; suspended/terminated rejection; expired-temp-password distinct code; forced-change `mcp` claim gating full-session routes; JWT HS256 access (15m) + rotating httpOnly SameSite refresh cookies (7d, sha256-hashed rows); logout revocation; `/auth/me` re-resolves the live principal from DB so assignment changes apply without re-login; fail-closed `withTenant` repo base + audited `withBypass` path. **tests**: shared merge-engine suite (5) + HTTP lifecycle suite (8): host-before-credentials, uniform credential errors, multi-assignment union, TEMP_PASSWORD_EXPIRED code, mcp gate→change-password→released, rotation w/ replay rejection, logout revocation, live permission change reflection — **33/33 total green** | typecheck ✓ lint ✓ tests 33/33 ✓ | (commit B) |
| 0012_platform_auth | Widens the session model for the platform principal: `refresh_tokens.company_id`/`user_id` become nullable + new `platform_owner_id` with a CHECK enforcing exactly one principal kind; bypass-aware policy so PO refresh rotation resolves its tenant-less cookie; GRANTs for the platform role across all platform tables (`platform_owners`, `global_settings`, `role_catalogue_entries`, `custom_role_templates`, `companies`, `themes`, `company_settings`, `company_counters`, `company_enabled_roles`, announcements, `support_access_sessions`, `platform_audit_logs`) plus bypass-aware policies on the tenant tables PO tooling touches; applied to BOTH databases (ledgered-migration caveat handled via live delta script) | applied dev+test ✓ schema verified both DBs ✓ | (stage-3 commit) |
| stage-3 platform owner portal | **lib/totp.ts** RFC 6238 (30s step, ±1 window); **bootstrap-platform-owner.mjs** seeds `owner@nexora.test` (bcrypt pw + base32 TOTP secret). **platform module**: login — password step w/ uniform 401s, adaptive TOTP step (`TOTP_REQUIRED`), bad-code lockout counter thresholded from `global_settings.security_policy.po_lockout_threshold` with self-reset after the window, suspended-owner rejection; dedicated PO JWT `typ:"po"` (30m) + rotating httpOnly `nxp_refresh` cookie (7d, sha256-at-rest, nullable-principal aware); logout revocation. Company wizard: letters-only prefix (route regex + `companies.code_prefix` CHECK), platform-wide dedup → 409, slug derivation, scaffolding seeds (theme defaults, company_counters, enabled built-in roles), audited `companies.created` linked to the company row. Status machine: invalid transition → 409 before missing-reason → 422; suspend requires reason; every change audited with previous/new values. Global settings get/edit with before/after audit; announcements create/list; time-bound support-access sessions gating an aggregate-only drill-down summary that fails closed 403 without a matching open session; `/platform/v1/audit` feed. **portal UI**: adaptive TOTP login, companies list/create/status actions, settings, announcements, support drill-down, audit views; router mounted at `/platform/v1` in `app.ts`. **tests** (6): TOTP enforcement + lockout self-reset, prefix dedup + scaffolding, self-contained audited status walk, settings audit, drill-down gating, authless 401 sweep — **39/39 total green** at the time (34 server + 5 shared) | typecheck ✓ lint ✓ tests 39/39 ✓ | `6b26bc3` |
| stage-4 branding & theme variables | **shared/theme.ts**: `THEME_VAR_MAP` (themes columns → `--nx-*` custom properties), `#RRGGBB` grammar, `themeRowToCssVars` (font wrapped in the Poppins fallback stack; null/absent tokens skipped so stylesheet Nexora defaults stay in effect). **Platform API**: wizard payload extended with `branding` + `enabledRoleKeys` applied inside the same provisioning txn as scaffolding seeds; `PUT /companies/:id/theme` (strict zod + service-side re-validation, audits `themes.updated` before/after); `GET|PUT /companies/:id/enabled-roles` (replace-all txn, keys validated against the 32 built-ins, ≥1 enforced, disabling never touches existing assignments per Part 2 §48, audited `enabled_roles_changed`). **Company API**: public pre-auth `GET /api/v1/theme` resolves the portal host through the slug grammar and returns that company's CSS-var token map (unknown host → 404). **web bootstrap**: main.tsx applies resolved tokens to the document root before first paint (bounded 1.5s) — login screens render tenant identity with Nexora defaults as fallback. **platform-web UI**: Create Company Wizard steps Profile → Branding (color pickers + hex inputs, logo/login-bg URLs, font family, Reset-to-Nexora-defaults, live preview rendering miniature login+dashboard via the same custom properties, PO Spec §10) → Review & Confirm w/ explicit checkbox gating Create; per-company Branding panel edits tokens/enabled-roles with the same preview. **tests** (5 server + 5 shared): audited token edit incl. invalid-hex and strict-extra-key 422s, enabled-roles round-trip + empty/bogus-key 422s, creation-time branding+roles application, host-based two-brand proof (alpha≠beta tokens, unknown host 404), structural guard asserting zero hex literals under packages/web/src. Seed-HOA-admin wizard step deferred to the workers-lifecycle stage where full users A–Z exists | typecheck ✓ lint ✓ tests 49/49 ✓ | `378ce1f` |

| dev-preview workflow | Embedded VS Code live preview for both frontends with no external browser: strict `host:true` Vite dev configs (web :5173, platform-web :5174), `scripts/dev-all.mjs` orchestrating API + both UIs with tagged logs, and VS Code tasks ("Nexora: Dev All", "Preview: Company Portal", "Preview: Platform Portal") that open the built-in Simple Browser docked as the left editor group; HMR/live-reload preserved end-to-end. Dev tooling only — no product architecture change | typecheck ✓ lint ✓ manual HMR verification ✓ | `f02ed51` |
| stage-5 branch system | **migration 0013_branch_rls_bypass**: branches policy rebuilt on the companies pattern (`app.bypass_rls` OR `app_current_company()`) so the Platform Owner's structural drill-down reads through the audited bypass path instead of failing closed. **branches module** (Part 1 §7–9): `createBranch` allocates `{PREFIX}-{SEQ}` codes via a per-company `pg_advisory_xact_lock` + atomic `company_counters('branch_seq')` upsert — gap-free, distinct, never reused even after close; slugify + per-company uniqueness (`name-2`, `name-3`, …); `portal_url` = `{company}-{branch}.nexora.app`; audited `created` with code/slug/url. Status machine suspend (active→suspended, reason) / reactivate (suspended→active) / close (active|suspended→closed, reason, terminal + `closed_at`): unknown action 400, invalid transition 409 before missing-reason 422, `SELECT … FOR UPDATE` guarded, audited previous/new values. `listBranches` RLS-scoped. **platform routes**: `GET /companies/:id/branches` returns a structural allowlist only {id, code, slug, name, status, portal_url, created_at, closed_at} — §40 aggregate boundary by response shape. **platform-web**: BranchesPanel overview per company. **tests** (4): 8-way concurrent-create race asserting contiguous distinct ALP codes + URL grammar; slug dedup + close terminality + post-close code monotonicity; alpha/beta isolation incl. cross-tenant status denial; PO drill-down shape + unauthed 401. Also: stage4 audit test made idempotent against the persistent dev DB (pins a known previous color before the audited edit). **53/53 total green** (server 43 + shared 10) | typecheck ✓ lint ✓ tests 53/53 ✓ | `9b09e30` |

Virtual Account note (v2.1): the physical `virtual_accounts` table arrives with `0007_payments`
(FK → `customers`, so ordering 0005 < 0007 is correct). The onboarding *behavior* required by
Part 1 §22 — VA issued immediately at customer creation, never gated on loan approval, disbursement
blocked while `va_pending` — is carried by `customers.status` from 0005 onward and will be enforced
by the customers module + RLS resolver function in later milestones.

