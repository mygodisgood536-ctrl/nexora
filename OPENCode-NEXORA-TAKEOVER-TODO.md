# OPENCode — NEXORA FINANCE TAKEOVER — MASTER TODO

Authority: `Cornelius Nexora Finance SAAS Software — Final Vision v3.9 FINAL CLEAN AUTHORITY`
Source text: `_probe_out/VISION-v3.9-AUTHORITY.txt` (3027 lines, read in full).

Status legend: `NOT STARTED` / `IN PROGRESS` / `BLOCKED` / `COMPLETE`

This list is the execution contract. It is created ONCE. It is not rewritten or reordered.
Newly discovered Vision requirements are appended to the appropriate existing section.
Only statuses change during execution.

---

## TODO 1 — Vision Authority
Status: COMPLETE

- [x] Read the complete authoritative Vision (Parts 0-22, all 3027 lines).
- [x] Extract requirements: Ten Laws, 5 login worlds, 12 role catalogue + custom roles,
      credential law (Part 5), money non-editing law (Part 5.6), tenancy law (1.6),
      multi-company concurrency (3.8), provider registry (Part 8), customers (Part 9),
      loan lifecycle (Part 10), performance engine (Part 11), role matrix (Part 12),
      theme law (Part 13), security (Part 14), 32 prohibitions (Part 15),
      build order (Part 16), group lending (Part 19), storage/DR (Part 20),
      OpenCode AI law (Part 21), final acceptance (Part 22).
- [x] Note: line 2 of the extracted text is a stray fragment ("RULE 19.6.1 — Savings Achieved
      is an actual outcome only"). Content is consistent with RULE 11.1.1; treated as an
      extraction artifact, not a conflicting rule. Not blocking.
- [x] Re-read Vision at every major stage (mandatory, TODO 13 and 14).

## TODO 2 — Repository and Architecture Baseline
Status: IN PROGRESS

- [x] Repository layout: `packages/server`, `packages/web`, `packages/platform-web`,
      `packages/shared`, `scripts`.
- [x] Server module inventory (28 modules) + 82 SQL migrations + 45 test files.
- [ ] Map: config/env, db pool + repo, tenant execution context, async context.
- [ ] Map: authentication (auth module, tokens, TOTP, session epoch, credential law).
- [ ] Map: authorization (roles, permissions, scopes, role lens, permission bundles).
- [ ] Map: database isolation (RLS migrations 0010/0013/0014/0025/0032/0040/0041/0043).
- [ ] Map: payments pipeline, allocation, ledger, accounting, reconciliation.
- [ ] Map: performance engine and hierarchy.
- [ ] Map: providers/webhooks/virtual accounts.
- [ ] Map: loans/applications/evidence/face capture/approval chain/disbursement.
- [ ] Map: notifications, reports, audit, traceability, backup/DR, recovery.
- [ ] Map: OpenCode integration (`lib/opencode.ts`, `modules/company-ai`).
- [ ] Map: verification harness (`_verify.cmd`, `_harness_*.mjs`, `_job_*.cmd`).
- [ ] Map: frontend surface actually implemented vs Vision Part 12/13.
- [ ] Record what ACTUALLY exists (evidence, not claims).

## TODO 3 — Complete Vision Reconciliation
Status: NOT STARTED

- [ ] Build discrepancy inventory, rule by rule, against the whole Vision.
- [ ] Record per discrepancy: rule ref, actual behaviour, expected behaviour, severity.
- [ ] Do NOT fix during the audit pass. Audit breadth first.

## TODO 4 — Root-Cause Correction
Status: NOT STARTED

- [ ] Fix each confirmed discrepancy at root cause.
- [ ] Add/update automated regression test per fix.
- [ ] Verify each fix; verify all affected requirements sharing the root cause.

## TODO 5 — Verification Infrastructure
Status: NOT STARTED

- [ ] Prove the harness cannot produce false GREEN.
- [ ] Fresh artifacts required; stale artifacts rejected.
- [ ] Missing/invalid artifacts fail; real job execution required.

## TODO 6 — Automated Verification
Status: NOT STARTED

- [ ] Run full suite; resolve genuine failures; never weaken a Vision rule to pass a test.

## TODO 7 — Full Role-Based User Verification
Status: NOT STARTED

- [ ] Platform Owner, MD, Deputy MD, HR (Manager/Officer), Auditor, Audit Officer,
      Finance (Manager/Accountant/Asst/Cash&Bank), GM/Asst GM, Ops Manager/Asst,
      HO Administrator, Compliance, Risk, Credit (Manager/Officer), CSM/CSO,
      MIS, IT, Branch Manager, Deputy Branch Manager, Senior C.O., C.O.,
      Recovery Officer, Customer Portal.

## TODO 8 — Full Business Lifecycle
Status: NOT STARTED

- [ ] Company create/activate/suspend/reactivate; company URL; MD first login ritual.
- [ ] Role creation; branches; branch workers; worker credential lifecycle.
- [ ] Customers; groups (~5 groups x ~5 members); collections; loan applications;
      approvals; disbursement; VA creation; repayments; allocation; schedules;
      webhooks; notifications; reports; auditor visibility; customer portal; AI.

## TODO 9 — Security and Tenant Isolation
Status: NOT STARTED

- [ ] Multi-company + branch isolation proven at backend/DB, not UI only.
- [ ] Role/permission enforcement; RLS; credential, AI, provider, file, notification,
      export, error-message isolation.

## TODO 10 — Financial and Concurrency Verification
Status: NOT STARTED

- [ ] Financial invariants; transactions; idempotency; races; concurrent companies;
      concurrent disbursements/VA creation; provider failure isolation; retries.

## TODO 11 — Complete Discovery Pass
Status: NOT STARTED

- [ ] Use the real application head-to-toe; record ALL issues before repair.

## TODO 12 — Complete Repair Pass
Status: NOT STARTED

- [ ] Root-cause, fix, test, verify each discovered issue.

## TODO 13 — Reuse and Regression Pass
Status: NOT STARTED

- [ ] Re-run the whole application end to end; fix new issues; repeat until clean.

## TODO 14 — Final Vision Audit
Status: NOT STARTED

- [ ] Re-read the entire Vision; compare final implementation; close every finding.
- [ ] Verify all 32 prohibitions of Part 15 are absent by search AND by attempt.

## TODO 15 — Final Acceptance
Status: NOT STARTED

- [ ] Only complete when every TODO 1-14 item is COMPLETE with evidence and the
      Vision fully tallies.