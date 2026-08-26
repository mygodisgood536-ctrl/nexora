# NEXORA — MASTER IMPLEMENTATION CHECKLIST

Updated as stages/roles complete. A checkbox moves only after its gate passes.

## Stages

- [x] Stage 0 — Project foundation (structure, env, logging, validation, errors, auth skeleton, tenant context, DB connection, health, both frontends boot)
- [x] Stage 1 — Database & domain model
- [x] Stage 2 — Multi-tenancy, authentication, security (isolation verified)
- [x] Stage 3 — Platform Owner Portal complete A→Z
- [x] Stage 4 — Company creation & branding/theme variables
- [x] Stage 5 — Branch system (codes, URLs, drill-down)
- [ ] Stage 6 — Staff/users & role architecture (multiple roles, temporary roles, custom roles)
- [ ] Stage 7 — Core engines (Performance Engine, payment pipeline + exceptions, allocation, ledger, accounting, reconciliation, notifications, audit, reports infra)
- [ ] Stage 40 — Customer Portal
- [ ] Stage 41 — Final verification vs all four specs

### Stage 1 progress

A migration counts as done only when applied to BOTH databases and its quality gate passes.

- [x] Migration runner (`db/migrate.ts`, transactional, `_migrations` ledger) — pre-existing
- [x] 0001_platform — pre-existing
- [x] 0002_tenants — pre-existing
- [x] 0003_branches — pre-existing
- [x] 0004_rbac — pre-existing
- [x] 0005_customers (customers / groups / group_members + shared domain enums)
- [x] 0006_lending (loan_products, approval chains/steps, applications, documents, credit assessments, loans, repayment_schedule_rows)
- [x] 0007_payments (virtual_accounts, payments, allocations, reversals, webhook_exceptions, pipeline_jobs, savings)
- [x] 0008_finance (gl_accounts, journal entries/lines, receipts, reconciliation_items, immutability)
- [x] 0009_comms_audit (notifications, full-field audit_logs)
- [x] 0010_rls (FORCE RLS, tenant+branch policies, grants, security-definer VA resolver)
- [x] Stage 1 model/security/isolation tests green (20/20: model 8, isolation 6, auth 4, health 2)

### Stage 2 progress

Gate: auth + sessions + passwords + permission merge + scope resolution +
isolation behavior, all tested.

- [x] Migration 0011_auth_access (companies/refresh_tokens bypass-aware
      policies; role-engine join-table grants)
- [x] Permission merge engine in shared (union over active assignments,
      temporary windows, scope coverage, no-downgrade rule) — unit-tested
- [x] Login resolving company (+branch) from portal host BEFORE credentials;
      uniform credential errors; suspended/terminated rejection
- [x] bcrypt credentials; expired temporary-password distinct error code
- [x] Forced first-login change (mcp claim) gating full-session routes;
      change-password clears flag, rotates all refresh tokens
- [x] JWT access tokens (HS256, 15m) + rotating httpOnly refresh cookies
      (7d, sha256-at-rest); replay of rotated tokens rejected; logout revokes
- [x] /auth/me re-resolves the live principal (assignment changes apply
      without re-login)
- [x] Fail-closed withTenant repo base; audited withBypass path
- [x] Isolation verified by the Stage 1 RLS suite (cross-company/cross-branch)

### Stage 3 progress

Gate: PO auth (password + mandatory TOTP + lockout), company lifecycle
(create/scaffold/status machine), settings, announcements, time-bound support
access with aggregate-only drill-down, platform audit trail, portal UI — all
tested against both databases.

- [x] Migration 0012_platform_auth applied to BOTH databases: refresh_tokens
      nullable `company_id`/`user_id` + `platform_owner_id` + exactly-one-
      principal CHECK; PO grants on all platform tables; bypass-aware policies
      on refresh_tokens/themes/company_settings/company_counters/
      company_enabled_roles/support_access_sessions
- [x] RFC 6238 TOTP verification (`lib/totp.ts`) +
      `bootstrap-platform-owner.mjs` seeding the owner account
- [x] PO login on `/platform/v1`: password step (uniform 401s) → TOTP step
      (`TOTP_REQUIRED`); configurable lockout threshold read from
      global_settings security_policy with self-reset after the window;
      dedicated PO JWT (`typ:"po"`) + rotating httpOnly refresh cookie scoped
      to `/platform/v1`; logout revocation
- [x] Company creation wizard backend: letters-only code prefix (route schema
      + DB CHECK), platform-wide dedup → 409 on collision, slug derivation,
      scaffolding seeds (theme defaults, counters, enabled roles), audited
      `companies.created` with company linkage
- [x] Status transition machine: invalid transition → 409, suspend without
      reason → 422; every change audited with previous/new values
- [x] Global settings get/edit with before/after audit entries
- [x] Announcements create/list
- [x] Support access sessions: reason + TTL, open/close lifecycle; aggregate
      drill-down summary fails closed (403) without an open session id
- [x] `/platform/v1/audit` feed (actor/action/company/before/after/reason)
- [x] Portal UI (`packages/platform-web`): adaptive TOTP login, companies view
      with create form + status actions, settings, announcements, support
      drill-down, audit views; router mounted in `app.ts`
- [x] Tests: stage3 suite 6/6 (TOTP+lockout, prefix dedup+scaffolding, audited
      status walk, settings audit, drill-down gating, unauthenticated 401
      sweep) — **39/39 total green** (34 server + 5 shared)

### Stage 4 progress

Gate: wizard completion with live branding preview, theme tokens end-to-end
via --nx-* CSS variables only (zero hard-coded hex), enabled-role catalogue,
validation, isolation by host, two-brand render proof.

- [x] shared/theme.ts: THEME_VAR_MAP (themes columns → --nx-* vars),
      #RRGGBB grammar, themeRowToCssVars w/ font-fallback stack and
      skip-null fallback semantics; unit-tested in shared package
- [x] Wizard step 1–2–4 complete (PO Spec §9): Profile → Branding (color
      pickers + hex inputs, logo/login-background URLs, font family, Reset
      to Nexora defaults, LIVE preview rendering login+dashboard miniatures
      through the same custom-property mechanism) → Review & Confirm
      (read-only summary, explicit confirmation checkbox gating Create);
      enabled-role selection included at creation
- [x] Branding persisted per company: PUT /platform/v1/companies/:id/theme
      validates tokens (strict schema; service-side re-checks), writes
      themes row, audits `themes.updated` with before/after values
- [x] Enabled roles config: GET/PUT /companies/:id/enabled-roles; replace-all
      transaction; keys validated against the 32 built-ins; ≥1 enforced;
      disabling never touches existing assignments (Part 2 §48); audited
      `enabled_roles_changed`
- [x] createCompany accepts branding + enabledRoleKeys applied in the same
      provisioning txn as scaffolding seeds
- [x] Public pre-auth GET /api/v1/theme resolves the portal host via the
      slug grammar and returns that company's CSS-var token map — login
      screens render tenant identity; unknown host fails closed 404
- [x] web main.tsx applies the resolved tokens to document root BEFORE first
      paint (1.5s bounded); stylesheet Nexora defaults remain the fallback
- [x] Platform portal UI: per-company Branding panel (edit tokens, enabled
      roles, reset, live preview)
- [x] Structural guard test: no hex literals in packages/web/src components
- [x] Two-brand render proof at the API layer: alpha vs beta hosts receive
      different token maps from the same endpoint/tree
- [x] Deferred (documented): wizard seed-HOA-admin account creation lands in
      the workers-lifecycle stage where full users A–Z exists
- [x] Tests: stage4 suite 5/5 + shared theme 5/5 — **49/49 total green**
      (server 39 + shared 10)

### Stage 5 progress

Gate: race-proof deterministic branch codes, per-company slugs + portal URLs,
lifecycle state machine, tenant isolation, Platform-Owner structural-only
drill-down — all tested.

- [x] Migration 0013_branch_rls_bypass applied to BOTH databases: branches
      policy mirrors the companies pattern (audited bypass flag OR own-company
      match) so the PO drill-down reads through the bypass path instead of the
      plain tenant policy failing closed to zero rows
- [x] POST /api/v1/branches — `{PREFIX}-{SEQ}` codes allocated under a
      per-company pg_advisory_xact_lock + atomic company_counters upsert:
      gap-free, distinct, never reused (closed branches included); unique
      per-company slugs (`name`, `name-2`, …); portal URL
      `{company}-{branch}.nexora.app`; creation audited
- [x] POST /api/v1/branches/:id/status — suspend/reactivate/close machine:
      invalid transition 409 before missing-reason 422; close requires a
      reason, is terminal (sets closed_at), codes stay monotonic afterwards;
      every change audited previous/new under SELECT … FOR UPDATE
- [x] GET /api/v1/branches RLS-scoped to the caller's company; cross-company
      writes fail closed
- [x] GET /platform/v1/companies/:id/branches — structural fields ONLY
      (PO Spec §40 aggregate boundary enforced by response shape); 401 unauthed
- [x] Platform portal UI: per-company Branches overview panel (BranchesPanel)
- [x] Tests: stage5 suite 4/4 incl. an 8-way concurrent creation race —
      **53/53 total green** (server 43 + shared 10)

## Roles (implement one-by-one; mark each sub-item when that role's gate passes)

Gate per role: A–Z implemented · permissions · scope · UI · dashboard · responsive (desktop/tablet/mobile) · workflows · audit behavior · performance visibility · regression green.

| # | Role | Implemented | Verified |
|---|---|---|---|
| 1 | MD | ☐ | ☐ |
| 2 | Deputy MD | ☐ | ☐ |
| 3 | GM | ☐ | ☐ |
| 4 | Assistant GM | ☐ | ☐ |
| 5 | Head Office Administrator | ☐ | ☐ |
| 6 | Operations Manager | ☐ | ☐ |
| 7 | Assistant Operations Manager | ☐ | ☐ |
| 8 | Finance Manager | ☐ | ☐ |
| 9 | Accountant | ☐ | ☐ |
| 10 | Assistant Accountant | ☐ | ☐ |
| 11 | Cash/Bank Reconciliation Officer | ☐ | ☐ |
| 12 | HR Manager | ☐ | ☐ |
| 13 | HR Officer | ☐ | ☐ |
| 14 | Internal Auditor | ☐ | ☐ |
| 15 | Audit Officer | ☐ | ☐ |
| 16 | Compliance Officer | ☐ | ☐ |
| 17 | Risk Officer | ☐ | ☐ |
| 18 | Credit Manager | ☐ | ☐ |
| 19 | Credit Officer | ☐ | ☐ |
| 20 | Loan Officer | ☐ | ☐ |
| 21 | Account Officer | ☐ | ☐ |
| 22 | Field Account Officer | ☐ | ☐ |
| 23 | Customer Service Officer | ☐ | ☐ |
| 24 | Customer Service Manager | ☐ | ☐ |
| 25 | Area Manager | ☐ | ☐ |
| 26 | Branch Manager | ☐ | ☐ |
| 27 | Deputy/Assistant Branch Manager | ☐ | ☐ |
| 28 | Collection Officer | ☐ | ☐ |
| 29 | Senior Collection Officer | ☐ | ☐ |
| 30 | Recovery Officer | ☐ | ☐ |
| 31 | MIS/Reporting Officer | ☐ | ☐ |
| 32 | IT/System Administrator | ☐ | ☐ |

## Permanent architectural constraints (checked continuously)

- [ ] No manual repayment/cash-entry function exists anywhere for any role (Part 1 §21)
- [ ] Every tenant table has indexed `company_id`; branch tables also `branch_id` (Part 1 §4)
- [ ] Performance figures come only from the shared Performance Engine (Part 1 §25-B)
- [ ] Theme values read from theme records via CSS variables — zero hard-coded brand colors in components (Part 1 §26)
- [ ] Financial records are append-only; corrections happen via linked reversals (Part 1 §21/§25)
- [ ] Each role is its own component tree — no cross-role conditional reuse (Part 2 §60-9)
- [ ] Virtual accounts generated at customer onboarding, before any first payment (Part 1 §22)
