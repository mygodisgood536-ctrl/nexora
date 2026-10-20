# Phase 4 — Vision Audit Report (RULE 16.2 / Stage 13)

**Status: complete on the code side.** This is the deliverable required by
RULE 16.2.4 ("The audit report is itself a deliverable"). It records the
complete top-to-bottom reread of `docs/verification/VISION-v3.9-AUTHORITY.txt`
(3027 lines, Parts 0–22) against the built system, and the correction cycle.

**Method.** Six passes per RULE 16.2.1:
1. Rule compliance — walk Parts 0–22; mark each rule implemented / partial / missing.
2. Prohibition sweep — walk the 32 prohibitions of Part 15; prove each absent.
3. Flow walkthroughs — end-to-end on a clean environment. **BLOCKED** (no Neon credentials; no live environment).
4. Isolation attack — cross-tenant reads/writes by guessed id. **BLOCKED** (no Neon).
5. Permission sweep — every role sees exactly what Part 12 says. **BLOCKED** (no Neon).
6. Story sweep — re-read owner's vision words. **DONE** (this document).

---

## Pass 1 — Rule compliance (implemented / partial / missing)

Rules verified correctly implemented by direct code inspection:

| Rule | Subject | Status | Evidence |
| --- | --- | --- | --- |
| 1.6 | Company independence law | Implemented | company_id/branch_id RLS at data layer; migration integrity gate |
| 2.4.1 | Credential-to-portal resolution (no role picking) | Implemented | login handler resolves scope from URL + credentials |
| 4.2 | MD credential ritual (blocking, ordered) | Implemented | session gate returns "credential ritual incomplete" |
| 5.1 | Username = full name | Implemented | username derived from captured name |
| 5.2 | Initial password = @FirstName | Implemented | same code path generates and verifies |
| 5.2.3 | Initial credential one-time, dies on change | Implemented | credential consumed, revoked on change |
| 5.2.3.5 / 14.4.1 | Session idle timeout; credential expiry window | Implemented | migration 0096 + live-session guard; 480 min / 168 h defaults |
| 5.4 | Credential lifecycle states | Implemented | LOGIN_BLOCKED_STATES; audit on every transition |
| 5.6 | No manual money; reversal-only corrections | Implemented | no edit controls; correction_requests / loan_adjustments append-only |
| 5.7 | Worker creation flow & ID format | Implemented | `{BRANCH_CODE}-{ROLE_CODE}-{SEQ}` / `{COMPANY_PREFIX}-HO-{ROLE_CODE}-{SEQ}` |
| 5.8 | Freeze / hold / transfer portfolio | Implemented | workers service; audit-logged |
| 7.4 | Branch code `{PREFIX}-{SEQ}` padded to 3 digits | Implemented | branches service |
| 7.7 | Provider add/edit/remove roles; MD authorisation | Implemented | PROVIDER_CHANGE_ROLES; approveProviderConfig |
| 8.5.1 | Webhook endpoint generated, never typed | Implemented | mintWebhookEndpointOnClient; endpoint path |
| 8.5.3 | Webhook idempotency by provider txn ref | Implemented | payment pipeline |
| 8.5.4 | Raw webhook stored before processing | Implemented | raw body capture mounted before express.json() |
| 8.5.6 | Scheduled provider polling + reconciliation | Implemented | polling.ts; cron route; RULE 8.5.6 invariants |
| 8.6.1-1 | No manually typed webhook / branch-choosing ingress | Implemented | legacy `/payments/:provider` route removed; invariant |
| 8.6.1-2 | Explicit shared-account recording | Implemented | migration 0102 `is_shared_account`; invariant |
| 8.6.1-3 | Provider form derives from registry | Implemented | requirement_set + provider_settings; invariant |
| 8.6.1-4 | Activation requires connection test | Implemented | testProviderConnection real fetch |
| 10.6.3 | Write-off / restructuring create new records | Implemented | migration 0097; loan_adjustments append-only |
| 14.4.1 | Sessions expire after configured idle timeout | Implemented | migration 0096; live-session guard revokes + audit-logs |
| 19.3.8 | Monthly-equivalent duration derived, never typed | Implemented | migration 0100 GENERATED ALWAYS column; API rejects typed value |
| 19.4.1 | Customer income fields required | Implemented | loans service |
| 19.7 / 19.8 | Evidence capture order enforced | Implemented | loan-evidence service |
| 19.12.3 | Mandatory stage never bypassed; reassignment path | Implemented | resolveAvailableStage consults approvedCoverFor; invariant |

**Partially implemented / deferred:**

| Rule | Subject | Status | Blocker |
| --- | --- | --- | --- |
| 5.2.3.5 / 19.7 | Passive print-and-screen liveness | Partial | Server rejects single-frame/replay; genuine passive detection needs an external provider (owner decision C1) |
| 19.7 | Frontend multi-frame + proof contract | Open | Backend requires ≥2 frames + proof endpoints; capture client not yet updated (C2 — deferred to UI phases) |
| 21 | OpenCode AI provider integration | Deferred | Explicitly deferred by user instruction; not installed locally |

**Genuine Vision contradiction (not silently resolved — owner ruling required):**

| Rule | Subject | Status |
| --- | --- | --- |
| 6.2.1 vs 11/12/18 | `area_manager` appears in Parts 11.3.1, 12.26 and 19.12.2 but is absent from the closed Part 6.2.1 Head Office role catalogue | Open (C5) — must not be silently erased or added |

**Blocked (no Neon credentials / no Vercel access / no live environment):**

| Rule | Subject |
| --- | --- |
| 3.8 / 16.2 Pass 3–6 | Concurrent multi-company scenarios; isolation attack; permission sweep; end-to-end flows |
| 20.5 | Backup restore drill into a controlled recovery environment |
| Part 22 | Final end-to-end acceptance suite on clean environment |

---

## Pass 2 — Prohibition sweep (Part 15, 32 prohibitions)

Each prohibition is proved absent either by code inspection or by a permanent
security/migration invariant that fails the build if regressed:

| # | Prohibition | Status | Enforced by |
| --- | --- | --- | --- |
| 1 | "Head Office portal" route/label | Absent | code inspection; no such route exists |
| 2 | Company without MD Board/credentials | Absent | atomic company provisioning |
| 3 | Reach company data before ritual | Absent | session gate returns "credential ritual incomplete" |
| 4 | Initial password works after change | Absent | credential consumed + revoked on change |
| 5 | Generated credential that doesn't log in | Absent | same code path generates + verifies |
| 6 | Username not full name / wrong password format | Absent | derived from name / @FirstName |
| 7 | Worker exempted from authenticator | Absent | LOGIN_BLOCKED_STATES; no exemptions |
| 8 | Manual payment/collection entry | Absent | no edit controls; reversal-only |
| 9 | Edit control over money | Absent | no mutation of payments/allocations/ledger |
| 10 | Delete control over financial/audit record | Absent | append-only; REVOKE DELETE |
| 11 | Savings-only customer/onboarding/portal/role | Absent | no such flows or roles |
| 12 | VA at customer registration | Absent | VA created only at disbursement |
| 13 | Loan application accepts gallery photo | Absent | live capture only; no file upload |
| 14 | Disbursement without VA + schedule | Absent | atomic disbursement |
| 15 | Duplicate customer record | Absent | single customer record |
| 16 | Branch Workplace requires password / worker enters it | Absent | Head Office session, no password; workers never enter |
| 17 | Worker sees Head Office looked at his book | Absent | inspection is silent; only audit trail records it |
| 18 | Webhook URL typed by person / branch chosen by person | Absent | legacy ingress removed; endpoint-derived tenant |
| 19 | Provider activation without connection test | Absent | testProviderConnection required |
| 20 | Provider change by role outside MD/Deputy MD/GM/Finance | Absent | PROVIDER_CHANGE_ROLES |
| 21 | Non-MD provider change active without MD authorisation | Absent | approveProviderConfig MD gate |
| 22 | Provider secret in log/export/notification/audit value | Absent | encrypted at rest; fingerprint only |
| 23 | Fixed provider form ignoring chosen provider | Absent | requirement_set derived form; invariant |
| 24 | Company colour hard-coded / page background | Absent | design-system tokens; neutral base |
| 25 | Company A data visible inside company B | Absent | RLS; migration integrity; tenant isolation |
| 26 | Platform brand inside company workspace | Absent | platform name only in owner portal |
| 27 | Dashboard independent of performance engine | Absent | single engine; no per-screen calculation |
| 28 | Role rendered from another role's components | Absent | independent role workspaces |
| 29 | Role sees page it doesn't need / lacks required page | Absent | per-role permission model |
| 30 | Fake balances / sample customers / dead controls | Absent | real pipeline data; empty states honest |
| 31 | Platform owner views company data outside support session | Absent | owner cannot read company financial data |
| 32 | Worker record deleted when he leaves | Absent | append-only; freeze/hold/transfer only |

---

## Passes 3–6 (flow walkthroughs, isolation attack, permission sweep, story sweep)

These require a live database (Neon) and a deployed/Vercel-runnable environment, which are not available (credentials withheld, Vercel MCP returns 404). They cannot be executed or passed until external authorization is granted. This is the only remaining blocker to declaring Phase 4 fully complete.

---

## Exit criteria for Phase 4

1. Complete top-to-bottom Vision reread — **DONE** (all 3027 lines read).
2. Correction cycle — every implementable deviation corrected; contradictions surfaced rather than silently resolved — **DONE** (code side).
3. Permanent regression guards for every fixed rule — **DONE** (security + migration invariants).
4. Vision Audit passes in full on a live environment — **BLOCKED** (Neon credentials / Vercel access not available).

Per the FINAL NO-INFERENCE RULE (3023), no business ambiguity was silently guessed; the Area Manager catalogue contradiction and OpenCode integration are surfaced here for owner decision rather than resolved by assumption.