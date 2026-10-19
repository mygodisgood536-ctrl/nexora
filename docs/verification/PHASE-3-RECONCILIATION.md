# Phase 3 — Backend & Data Reconciliation Record

**Status: active.** This file is the durable record of the Phase 2 evidence sweep and
the ordered Phase 3 backlog. It exists because a backlog that lives only in a
conversation is not a checklist.

**Authority.** Every row below cites a rule from
`docs/verification/VISION-v3.9-AUTHORITY.txt` (Parts 0–22, 3027 lines, read
end-to-end during Phase 1). No item here is inferred from prior reports; each was
confirmed against the Vision text and the running code.

**Verification gate.** `npm run verify` must exit 0 at every commit. It runs
typecheck, lint, 21 offline tests, both builds, design-system checks, security
invariants, Vercel config/routing, and serverless-route checks.

---

## Legend

| Status | Meaning |
| --- | --- |
| **FIXED** | Implemented, verified, committed and pushed |
| **PARTIAL** | Core exists; a specific named gap remains |
| **OPEN** | Not yet implemented |
| **BLOCKED** | Cannot be completed without external authorization or credentials |

---

## A. Shipping defects found by direct inspection

These were found by reading the code against the Vision, not by trusting any
existing report. Each is a case where the product could be built and would still
violate a stated rule.

| # | Rule | Defect | Status | Commit |
| --- | --- | --- | --- | --- |
| A1 | 10.4.3 / 19.13.1 | Disbursement was not restricted to the configured final authority, so any approver could disburse | FIXED | `4960c9b` |
| A2 | 19.5.1 / 19.7 | Live evidence integrity check was inverted, and guarantor ID could be attached to the customer | FIXED | `4960c9b` |
| A3 | 5.6.3 | Provider rejection/deactivation and provider edit did not exist; a provider change had no lifecycle | FIXED | `e685383` |
| A4 | 8.5.1 / 8.6.1-1 | Webhook ingress let a caller select the tenant via `X-Nexora-Company` | FIXED | `8d5ce6a` |
| A5 | 8.5.1 | `approveProviderConfig` minted the webhook endpoint on a second connection while holding the row lock — a guaranteed hang | FIXED | `8d5ce6a` |
| A6 | 8.5.6 | Reconciliation existed but nothing called it; every provider was webhook-only | FIXED | `8be498e` |
| A7 | 19.12.3 | A mandatory stage with no assignee dead-ended with no reassignment path | FIXED | `9a39e32` |
| A8 | 14.4.1 | `session_timeout_minutes` existed since migration 0037 and was read by nothing | FIXED | `28fff18` |
| A9 | 19.4.1 | Income fields were required of the guarantor only, so a customer loan could be submitted with no income | FIXED | `28fff18` |
| A10 | 19.7.1 / 19.8.1 | Live-capture order (customer ID → guarantor ID → customer house → guarantor house → business) was entirely unenforced | FIXED | `28fff18` |
| A11 | 10.6.3 | Write-off and restructuring did not exist at all; `loans.status` permitted only active/overdue/completed | FIXED | `b2cb28e` |
| A12 | 19.3.8 | No month-equivalent duration existed anywhere; any screen showing one would have had someone type it | FIXED | `f6d5f88` |
| A13 | 3.8.6 | End-of-day, escalation, collection watch and assignment expiry ran only when a person manually POSTed them | FIXED | `b40c0e3` |
| A14 | 14.3.1 | Automated work had no attributable actor | FIXED | `c441dbe`, `b40c0e3` |

---

## B. Correctness of already-shipped behaviour

| # | Rule | Item | Status | Commit |
| --- | --- | --- | --- | --- |
| B1 | 14.3.1 | Audit role and branch attribution recorded | FIXED | `c9a1f09` |
| B2 | 14.3.1 | Platform session / support-IP audit metadata | FIXED | `c9a1f09` |
| B3 | 14.3.1 | Draft discard archived append-only rather than deleted | FIXED | `c9a1f09` |
| B4 | 20.3 | Customer Portal credential lifecycle and ritual | FIXED | `4960c9b` |
| B5 | 8.5.1 | Generated per-configuration webhook endpoints with cross-branch rejection | FIXED | `f21f7ff` |
| B6 | 8.6.1 | Complete payment exception taxonomy | FIXED | `f21f7ff` |
| B7 | 19.6 | Real loan draft state with an explicit submission gate and ordered stage completion | FIXED | `bb8a5e3` |
| B8 | 19.12.1 | Unassigned branch-URL rejection; authority bundles corrected | FIXED | `c45f446` |
| B9 | 8.3.2 | Configurable overdue ladder, timezone and policy values | FIXED | `c45f446` |
| B10 | 5.2.3.5 | Server-authoritative image and frame capture checks; reachable proof minting | FIXED | `1b2fc0f` |

---

## C. Open work

| # | Rule | Item | Status | Notes |
| --- | --- | --- | --- | --- |
| C1 | 5.2.3.5 / 19.7 | Passive print-and-screen liveness detection | PARTIAL | Server rejects single-frame and replayed captures and proves the byte chain. Genuine passive screen/print detection still needs an external provider. Requires an owner decision: paid service vs documented limitation. |
| C2 | 19.7 | Frontend capture clients must adopt the multi-frame + proof contract | OPEN | Backend now requires ≥2 frames plus proof endpoints. The existing capture flow will fail until the client is updated. Deliberately deferred to the UI phases, but the product is **not operational end-to-end** until it is done. |
| C3 | 8.6.1-3 | Provider form field set ignores the chosen provider | OPEN | Needs a per-provider schema registry; the fixed field set still exists. |
| C4 | 8.6.1-2 | Explicit shared merchant account across branches is not yet recorded as a first-class fact | PARTIAL | Endpoint resolution tolerates a null branch, but the deliberate sharing decision is not yet stored and displayed as the Vision describes. |
| C5 | 6.2.1 vs 11/12/18 | `area_manager` appears in Parts 11, 12 and 18 but is absent from the closed Part 6.2.1 catalogue | OPEN | **Genuine Vision self-contradiction.** Must not be silently erased. Needs an explicit owner ruling recorded in the Vision. |
| C6 | 3.8.7 / 3.8.8 | Concurrent multi-company virtual-account creation suite | BLOCKED | Schema and code exist; the acceptance test needs a real Neon database. |
| C7 | — | Full DB-backed suite (298 tests, 28 acceptance flows) | BLOCKED | Requires `DATABASE_URL` for Neon. Not yet executed. |
| C8 | 17 | Backup restore drill | BLOCKED | Restore is implemented; a real restore-from-backup has never been performed. Needs a Neon credential. |
| C9 | — | Vercel deployment of `nexora` and `nexora-platform` | BLOCKED | Vercel MCP returns `404 User not found`. Needs account authorization. |
| C10 | — | Production cron (EOD, escalation, polling) | BLOCKED | Code and config are complete; Vercel has not yet run them. |
| C11 | 21 | OpenCode provider integration | BLOCKED | Deliberately deferred by explicit user instruction. Do not install locally. |

---

## D. Security invariants added during Phase 3

These are permanent regression guards. Each fails `npm run verify` if the
property it protects is ever removed. They exist because several defects in
section A were introduced by code that passed every test at the time.

| Guard | Rule | Added in |
| --- | --- | --- |
| `no webhook route accepts a caller-named provider path` | 8.6.1-1 | `8d5ce6a` |
| `the webhook tenant is resolved only from the generated endpoint` | 8.6.1-1 | `8d5ce6a` |
| `the generated webhook endpoint token is cryptographically random` | 8.5.1 | `8d5ce6a` |
| `a scheduled provider poll exists and is invoked by the schedule` | 8.5.6 | `8be498e` |
| `a provider poll reconciles provider transactions against recorded payments` | 8.5.6 | `8be498e` |
| `a failed or unreadable poll raises an exception rather than passing silently` | 8.5.6 | `8be498e` |
| `the poll watermark advances only after a poll that parsed` | 8.5.6 | `8be498e` |
| `a blocked mandatory approval stage still blocks disbursement` | 19.12.3 | `9a39e32` |
| `an explicit company-authorised reassignment path exists for blocked stages` | 19.12.3 | `9a39e32` |
| `a cover approver must hold the stage's own role` | 19.12.3 | `9a39e32` |
| `only approved reassignments resolve a stage` | 19.12.3 | `9a39e32` |
| `the monthly-equivalent duration is a generated column` | 19.3.8 | `f6d5f88` |
| `no loan terms write path supplies a month-equivalent value` | 19.3.8 | `f6d5f88` |
| `the terms API rejects a caller-supplied month equivalent` | 19.3.8 | `f6d5f88` |

---

## E. Migrations added during Phase 3

| Migration | Purpose |
| --- | --- |
| `0088` | Customer credential lifecycle, disbursement authority, HR authority |
| `0089` | Audit attribution and platform session metadata |
| `0090` | Generated webhook endpoints, primary provider per branch, health counters |
| `0091` | Complete payment exception taxonomy |
| `0092` | Real loan draft state |
| `0093` | Authority bundle correction |
| `0094` | Configurable overdue / timezone / policy values |
| `0095` | Per-company suspended platform schedule principal |
| `0096` | Session idle expiry (`users.last_seen_at`) |
| `0097` | Write-off and restructuring (`loan_adjustments`), loan status widening, partial unique application index |
| `0098` | Provider polling counters, watermark, branch poll health |
| `0099` | Approval stage reassignment |
| `0100` | Generated monthly-equivalent duration |

**None of these have been executed.** They are validated only by reading and by
the static invariants. Running them requires a Neon connection.

---

## F. Exit criteria for Phase 3

Phase 3 is complete when:

1. Every item in section A and B is FIXED and its invariant is in place. ✅
2. Every item in section C that is not BLOCKED is FIXED or explicitly deferred in
   writing with a named owner decision.
3. `npm run verify` exits 0. ✅
4. All migrations have been executed against a real database and the DB-backed
   suite passes. ❌ **blocked on Neon credentials**

Item 4 cannot be satisfied without a database. Phase 3 must not be declared
complete until it runs, because schema-level defects in migrations `0095`–`0100`
are exactly the class of defect that reading cannot catch.