# NEXORA — MASTER IMPLEMENTATION CHECKLIST

Updated as stages/roles complete. A checkbox moves only after its gate passes.

## Stages

- [ ] Stage 0 — Project foundation (structure, env, logging, validation, errors, auth skeleton, tenant context, DB connection, health, both frontends boot)
- [ ] Stage 1 — Database & domain model
- [ ] Stage 2 — Multi-tenancy, authentication, security (isolation verified)
- [ ] Stage 3 — Platform Owner Portal complete A→Z
- [ ] Stage 4 — Company creation & branding/theme variables
- [ ] Stage 5 — Branch system (codes, URLs, drill-down)
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
- [ ] 0008_finance (gl_accounts, journal entries/lines, receipts, reconciliation_items, immutability)
- [ ] 0009_comms_audit (notifications, full-field audit_logs)
- [ ] 0010_rls (FORCE RLS, tenant+branch policies, grants, security-definer VA resolver)
- [ ] Stage 1 model/security/isolation tests green

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
