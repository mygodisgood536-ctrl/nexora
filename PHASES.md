# Cornelius Nexora Finance — Verification Phase Plan

**Working rule (agreed with the project owner):**

> Run the software **head to toe first**. Record every issue as it appears.
> Do **not** fix anything while running. Fix only after the full run is finished,
> then re-run to prove the fixes. The project moves **forward only**.

## The loop (per phase)

```
1. PREPARE -> confirm phase entry criteria (build/db/seed ok)
2. RUN     -> drive the real software end-to-end for this phase ONLY
              NO code edits. No "quick patches".
3. LOG     -> write every issue into _probe_out/ISSUE-LOG.md, one by one,
              with id, severity, exact repro, observed vs expected, evidence
4. CLOSE   -> phase report: what passed, what failed, which issue ids raised
5. (later) -> FIX phase batches the logged issues, then RE-RUN to prove green
```

### The one exception
If a **harness/test-script bug** (not a product bug) blocks the run from
continuing, the smallest possible harness-only fix may be made so the run can
proceed — and it MUST still be logged as an issue with the reason recorded.
Product code is never touched during a run phase.

## Issue identity

| Field | Meaning |
|---|---|
| `ISS-nnn` | stable id, never reused, never renumbered |
| `SEV-1 Critical` | money corruption, cross-tenant leak, auth bypass, data loss |
| `SEV-2 High` | documented behaviour wrong, wrong permission, unusable workflow |
| `SEV-3 Medium` | wrong status code, poor error, missing validation, brittle UX |
| `SEV-4 Low` | cosmetic / copy / docs |
| `AREA` | `prod` (real product defect) or `harness` (test tooling defect) |

Severity is set by **product impact**, not by how annoying it was to find.
---

## Current in-flight state (recorded before freezing)

These edits exist but are **NOT yet proven green**. They are the tail of the
previous reactive loop and are carried into Phase 12 as-is.

| Change | File | State |
|---|---|---|
| F-03 gate group membership on `assign` | `modules/groups/routes.ts` | Applied; 403 gone, e2e proof outstanding |
| F-03 grant `assign` to C.O. | `db/migrations/0082_collection_officer_group_management.sql` | **Applied to `nexora_test`**: 82 migrations, 1 bundle row, 7 live C.O. roles hold `assign` |
| Apply migrations before journeys | `_verify.cmd` | Added; `DATABASE_URL` pinned to `nexora_test` |
| Accounting endpoint correction | `verify/journey3.ts` | Verified: ledger 403/200 correct |
| Group member payload | `verify/journey3.ts` | Unverified |
| Run-scoped group names | `verify/journey3.ts` | **Unverified — added, never executed** |

**Known defect not yet fixed:** duplicate group name returns `500 INTERNAL_ERROR`
instead of `409 CONFLICT` (`groups_company_id_branch_id_name_key`). Recorded as
**ISS-001**.

---

## Phase list

### PHASE 0 — Freeze & Baseline *(in progress)*
Capture exact current state so nothing is lost or silently assumed.

### PHASE 1 — Infrastructure & Boot
Install state, typecheck, build, migration count, DB reachable, server boots,
health endpoint, request-id/logging, config loading. Boot failure blocks
everything, so this is first.

### PHASE 2 — Platform Owner Onboarding
Single Platform Owner → create company → receives MD credentials → MD logs in.
Confirm company lifecycle state (this is where F-02 lived) and every
provisioning step the Vision describes.

### PHASE 3 — Role & Permission Matrix
For **every** role: create the worker, confirm credential, real login, record
the exact permission bundle from the database. Build the matrix **from
evidence**, not from code. Produces the reference later phases test against.

### PHASE 4 — Customers, Groups & Collections (C.O. domain)
Core field workflow: register customer, no virtual account at registration
(prohibition 12), create group, add/remove members, group listing, and the C.O.
"his groups" boundary. This is where F-03 lives.

### PHASE 5 — Loans, Approvals & Disbursement
Apply → approval chain → offer → accept → disbursement. State-machine legality
at each hop; no step skippable or repeatable.

### PHASE 6 — Payments, Savings & Accounting Integrity *(highest risk)*
The money path: provider connection, signed webhook, VA creation, payment
intake, C.O. allocation, split into principal/interest/savings, repayment
schedule, journal posting, duplicate-webhook idempotency, failure rollback,
concurrent allocation. Verify **invariants in the database**, not just HTTP
status:
  - money in == principal + interest + savings (exactly, no residue)
  - no payment recorded as both repayment and savings
  - schedule cannot close with outstanding balance
  - journal balances per transaction

### PHASE 7 — HR, Hold/Transfer & Branch Workplace
Worker records, HR placement and hold, transfer between branches with its
consequences, single-branch vs multi-branch scope, Branch Manager visibility.

### PHASE 8 — Customer Portal / Self-service
Live customer login, own loan/schedule/statement, request/respond, and proof a
customer can never see another customer's data.

### PHASE 9 — Cross-company Isolation & Security
Adversarial pass: every entity id from company B probed against company A. Plus
host-header confusion, token reuse across companies, privilege escalation for
every role.

### PHASE 10 — Audit, Reporting & Notifications
Audit trail completeness, report correctness against raw data, notification
delivery and scoping.

### PHASE 11 — AI / OpenCode Integration
Real model catalogue, real execution (not mocked), company AI assistant
scoping, failure handling, and that AI output never drives unauthenticated
financial writes.

### PHASE 12 — Fix Sprint *(single batched pass)*
Work the issue log top-down by severity. One defect, one focused change, one
regression test that fails before and passes after. **No new features here.**

### PHASE 13 — Regression Re-run
Re-run every phase that raised issues, plus the full automated suite. Proves
fixes did not trade one defect for another.

### PHASE 14 — Final Sign-off
Clean typecheck, clean build, full suite green, issue log fully dispositioned
(fixed / accepted-with-reason / not-a-bug), written report.

---

## Status

| Phase | Status | Issues raised |
|---|---|---|
| 0 Freeze & Baseline | **done** | ISS-001 |
| 1 Infrastructure & Boot | **done** | ISS-002 |
| 2 Platform Owner Onboarding | **done (not green)** | ISS-003✔, ISS-004, ISS-005 |
| 3 Role & Permission Matrix | **BLOCKED (ISS-006)** | ISS-006 |
| 4 Customers/Groups/Collections | pending | |
| 5 Loans/Approvals/Disbursement | pending | |
| 6 Payments/Savings/Accounting | pending | |
| 7 HR & Branch Workplace | pending | |
| 8 Customer Portal | pending | |
| 9 Isolation & Security | pending | |
| 10 Audit/Reports/Notifications | pending | |
| 11 AI / OpenCode | pending | |
| 12 Fix Sprint | pending | |
| 13 Regression Re-run | pending | |
| 14 Final Sign-off | pending | |
financial writes.

### PHASE 12 — Fix Sprint *(single batched pass)*
Work the issue log top-down by severity. One defect, one focused change, one
regression test that fails before and passes after. **No new features here.**

### PHASE 13 — Regression Re-run
Re-run every phase that raised issues, plus the full automated suite. Proves
fixes did not trade one defect for another.

### PHASE 14 — Final Sign-off
Clean typecheck, clean build, full suite green, issue log fully dispositioned
(fixed / accepted-with-reason / not-a-bug), written report.