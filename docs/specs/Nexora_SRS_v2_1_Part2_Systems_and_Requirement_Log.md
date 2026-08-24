# NEXORA — SOFTWARE REQUIREMENTS SPECIFICATION v2.1
## Part 2 of 2 — Remaining Systems, Performance Visibility Index, Requirement Log

Continues directly from Part 1 (v2.1). Tagging convention (EXISTING / EXPANDED / CHANGE REQUIRED / NEW, plus the v2.1-prefixed variants defined in Part 1's header) is unchanged.

**[v2.1 CHANGE REQUIRED]** v2.0 of this document contained the full role-by-role specification directly in this file (Section 20, below), using an A–P template for 16 "full-spec" roles and a permission-delta-only table for 16 "lightweight variant" roles. Per Part 1's Section 19/20 change, that structure is withdrawn: **every one of the 32 built-in roles now receives its own complete, independent A–Z specification**, and that specification now lives in a dedicated companion document, `Nexora_Role_Specifications_AZ_Complete.md`, so it can be maintained, reviewed, and extended without inflating this systems document. Nothing from v2.0's role write-ups was discarded — every full-spec role's content was carried into the new document and expanded; every lightweight-variant role's content was expanded from a permission delta into the same full treatment. Section 20 below is now a short index.

All 32 built-in roles share Nexora's base design system (Part 1 §26 branding: bright royal blue / white / deep navy primary palette, Poppins typography, rounded cards, soft shadows) — what differs between roles is **information architecture**, not visual style.

---

## SECTION 20 — ROLE SPECIFICATION INDEX [v2.1 CHANGE REQUIRED — full specifications relocated]

The complete A–Z specification for every built-in role — Role Purpose, Scope, Dashboard, KPI Cards, Charts, **Performance Information** (Part 1 §25-C), Navigation, Pages, Tables, Filters, Search, Actions, Permissions, Restrictions, Notifications, Reports, Drill-down, Audit Visibility, Mobile/Tablet/Desktop behavior, Role-Specific Workflows, Interaction with Other Roles, Customer Visibility, Loan Visibility, Payment/Transaction Visibility, and an explicit access matrix — is in `Nexora_Role_Specifications_AZ_Complete.md`. That document is organized by the same category grouping used in Part 1 §19's catalogue table:

| Category | Roles (all 32 now individually specified) |
|---|---|
| Executive | MD, Deputy MD, GM, Assistant GM, Head Office Administrator, Operations Manager, Assistant Operations Manager |
| Finance | Finance Manager, Accountant, Assistant Accountant, Cash/Bank Reconciliation Officer |
| HR/Admin | HR Manager, HR Officer |
| Audit/Compliance | Internal Auditor, Audit Officer, Compliance Officer, Risk Officer |
| Credit/Loans | Credit Manager, Credit Officer, Loan Officer |
| Customer/Accounts | Account Officer, Field Account Officer, Customer Service Officer, Customer Service Manager |
| Operations/Field | Area Manager, Branch Manager, Deputy/Assistant Branch Manager, Collection Officer, Senior Collection Officer |
| Other | Recovery Officer, MIS/Reporting Officer, IT/System Administrator |

The 11 Custom Role templates (Part 1 §19) remain templates, per the preserved catalogue decision (Section 62-A, Change #9) — they are not given mandatory full specifications, since a company clones and adjusts them rather than receiving them pre-built.

**Historical roles retired from this section (content relocated, not deleted):** SECTION 20 previously (v2.0) contained subsections 20.1–20.16 (full-spec roles) and 20.17 (lightweight variants). That content is now Sections A–Z of each role's entry in `Nexora_Role_Specifications_AZ_Complete.md`.

*(Full A–Z specifications for all 32 built-in roles — including every role formerly listed above as a "lightweight variant" — now live in `Nexora_Role_Specifications_AZ_Complete.md`. See Section 20 above for the index. No role content was deleted in this relocation; each entry was expanded, not shortened.)*

---

## SECTION 21. HEAD OFFICE CENTRAL COMMAND DASHBOARD [v2.1 CHANGE REQUIRED — made explicit as a distinct screen]

**[v2.1 CHANGE REQUIRED]** v2.0 described the "central command center" concept only as an emergent pattern — the branch-performance table + drill-down shared by every company-wide role's own dashboard (GM's, Head Office Administrator's, etc.), each filtered by that role's own KPI/permission set, with no single dedicated screen. The v2.1 requirement is explicit: **the company's Head Office portal must have its own Central Command Dashboard** — a specific, named, primary company-level operational overview, not merely an emergent property of other roles' dashboards.

**Nature of this screen:** the Central Command Dashboard is the company's operational overview. It sits alongside, not instead of, each role's own role-specific dashboard sections — a GM still has their Approvals/Staff/Reports navigation (their full spec is in `Nexora_Role_Specifications_AZ_Complete.md`); the Central Command Dashboard is what they (and every other role with sufficient scope) land on as the company-wide overview. **Existing role permissions still determine what the current user can actually see or do on it** — the screen itself is shared infrastructure (reusing the Performance Engine, Part 1 §25-B/C), but its contents are always filtered to the viewer's own scope and permission set, exactly like every other performance surface in this document.

**COMPANY SUMMARY panel:**

- Total Loan Portfolio
- Outstanding Portfolio
- Today's Expected Collection
- Today's Actual Collection
- Today's Collection Rate
- Today's Outstanding Collection
- Today's Overdue/Default Amount
- Today's Expected Savings
- Today's Actual Savings
- Active Customers
- Active Loans
- Branch Count

**BRANCH PERFORMANCE panel:** every company branch in a performance table —

| Branch | Expected Today | Collected Today | Collection % | Outstanding | Overdue/Default | Expected Savings | Actual Savings | Active Customers | Active Loans |
|---|---|---|---|---|---|---|---|---|---|

— with a **Company Total row**, per the reconciliation rule of Part 1 §25-B. This reuses the identical branch-comparison table defined in Part 1 §25-C(B), not a separately built table.

**WORKER PERFORMANCE panel:** a company-level worker performance section showing the workers responsible for collection and other measurable operational activity, reusing the worker performance table of Part 1 §25-C(C).

**BRANCH DRILL-DOWN:** clicking a branch opens the branch workspace **without logout/login**, exactly per the mechanism already specified in Part 1 §10. From there the Head Office user continues: `Branch → Branch Manager → Collection Officers → Customers → Groups → Loans → Payments → Transactions → Audit Trail` — scoped, as always, to what the viewer's own role permits.

**Relationship to individual role dashboards:** the Central Command Dashboard is the company's shared operational overview; individual roles (Part 1 §19/20, full detail in `Nexora_Role_Specifications_AZ_Complete.md`) may have additional role-specific dashboard sections beyond it (e.g. MD's policy/settings surfaces, Finance Manager's reconciliation module). No role's specification should treat the Central Command Dashboard and that role's own dashboard as competing or duplicate concepts — the Central Command Dashboard is the entry point; role-specific sections are reached from its navigation exactly as GM's and Head Office Administrator's specifications already describe.

## SECTION 25. CUSTOMER PORTAL [EXISTING — PRESERVE]
A customer-facing, optional, read-mostly portal, enabled or disabled per company (Section 46–47, Configurable Company Features), showing: loan balance, repayment schedule, savings balance, payment history, receipts, and their Virtual Account details for making transfers (Part 1 §22). No cash-related function exists here either — it is a read/pay-by-transfer surface only.

## SECTION 26–27. CUSTOMER MANAGEMENT / GROUP MANAGEMENT [EXISTING — PRESERVE]
**Customer Registration / Customer Profile:** every customer registers with a full profile — including at minimum their identifying details, contact information, address, and any KYC/identification documents the company requires — captured once at registration and editable afterward by an authorized role. Each customer belongs to exactly one branch (Part 1 §5) and, once registered, immediately receives a permanent Virtual Account (Part 1 §22). A customer's profile, loans, savings, and payment history are always owned by that individual customer record — never by a Group.

**Group Management:** customers are organized into branch-level Groups, created and managed by Collection Officers (or another role with equivalent scope/permission). A Group is a convenience wrapper for field operations — it lets a Collection Officer organize their assigned customers for collection rounds and reporting — but every loan, savings account, and payment remains individually owned by the customer, not the Group; a Group has no financial balance or ledger of its own, and closing or renaming a Group never affects its members' individual records.

## SECTION 28–31. LOAN APPLICATION / CREDIT ASSESSMENT / APPROVAL WORKFLOW / DISBURSEMENT — see Part 1 §23 (Configurable Approval Workflow) for the full lifecycle and disbursement-authority rule.

**Loan Products (referenced by Part 1 §23):** a company defines one or more Loan Products (e.g. name, interest rate/method, cycle length, expected repayment/savings split, minimum/maximum amount), each associated with an Approval Chain template (Part 1 §23). A Loan Application is always submitted against a specific Loan Product, which determines both the loan's terms and which approval chain it must pass through.

**Document Collection, Review, and Credit Assessment stages:** within whatever Approval Chain a company configures (Part 1 §23), the "Document Collection," "Review," and "Credit Assessment" stages are generic workflow stages, not fixed universal checklists — the specific documents required and the specific credit criteria applied are configured per company/loan product, because these vary by institution and jurisdiction. At each of these stages Nexora requires, structurally: the assigned role uploads or confirms the required documents (Document Collection); the assigned role records a pass/fail or approve/escalate decision with an optional note (Review); and the assigned role records a credit decision — approve, reject, or request more information — with a required reason on rejection (Credit Assessment). Each stage transition is captured for audit exactly as Part 1 §23 specifies (actor, role used, previous status, new status, timestamp, reason where required).

## SECTION 32–36. VIRTUAL ACCOUNTS / PAYMENT PROCESSING / WEBHOOKS / ALLOCATION / SAVINGS — fully specified in Part 1, Sections 21–24.

## SECTION 37. DIGITAL COLLECTION LEDGER [EXISTING — PRESERVE]
The Digital Collection Ledger is the chronological, per-customer/per-loan record of every scheduled and received amount, replacing a paper collection book. It is exclusively and automatically fed by the verified payment pipeline (Part 1 §21) — no manual line-entry screen exists anywhere in the product (a permanent constraint, Part 1 §21).

- **Automatic date generation:** at loan disbursement, Nexora generates the full repayment schedule for the loan's cycle length (one row per due date, each carrying the Expected repayment and Expected savings amount for that date, per the loan product's configured split) — the schedule is generated once, in full, at disbursement, not built up incrementally as dates pass.
- **Automatic payment entry:** each ledger row's Actual repayment and Actual savings amounts are written exclusively by the payment pipeline (Part 1 §21, step 6, via the Payment Allocation Engine, Section 24) the moment a verified electronic payment is allocated to that date — never typed in by a Collection Officer or any other role.
- **Ledger totals:** each ledger automatically maintains running totals — cumulative Expected, cumulative Actual, cumulative Outstanding, and cumulative Overdue/Default (using the exact definitions of Part 1 §25-A) — recalculated the moment a new payment is allocated (Part 1 §25-B's real-time requirement).
- **Daily / Weekly / Monthly Performance Summary:** the same Expected/Actual/Outstanding/Overdue/Collection-Rate figures (Part 1 §25-A) are rolled up automatically for any selected day, week, or month, at every level of the Performance Calculation Hierarchy (customer, Collection Officer, branch, company — Part 1 §25-B); no summary is calculated independently of the shared Performance Calculation Service.

## SECTION 38–39. ACCOUNTING / RECONCILIATION [EXPANDED]
**Accounting Module:** Nexora maintains standard financial statements generated automatically from the verified payment pipeline (Part 1 §21) and the ledger (Section 37) — including a General Ledger, Cash Book, and Cash Flow Statement. "Cash Book" and "Cash Flow Statement" are used here purely as standard accounting/reporting terminology — Nexora has no physical-cash-handling feature anywhere (Part 1 §21 is a permanent constraint); these statements report money movement that occurred exclusively via verified electronic transfer.

**[NEW REQUIREMENT]** Reconciliation is elevated to its own persistent module (referenced throughout Part 1 §21): a standing, resolvable list of Unallocated Payments, Unmatched Payments, Reversed Transactions, and Incomplete Processing items, owned operationally by Finance Manager/Cash-Reconciliation Officer (full specification of both roles in `Nexora_Role_Specifications_AZ_Complete.md`), with read visibility for Internal Auditor and IT Administrator.

## SECTION 40–43. REPORTS / BRANCH PERFORMANCE / COLLECTION OFFICER PERFORMANCE / NOTIFICATIONS [EXISTING — PRESERVE]
**Reporting System:** Nexora includes a Reporting System — exportable (CSV at minimum), filterable by date range/branch/role scope, and drawing exclusively from the same verified data used everywhere else in the product (the payment pipeline, Part 1 §21, and the Performance Calculation Service, Part 1 §25-B) — never a manually maintained figure. Branch Performance and Collection Officer Performance reports are specific report types within this system, built on the branch and worker performance tables already specified in Part 1 §25-C.

**Notification Center:** Nexora includes a Notification Center that raises in-app (and, where a role's specification calls for it, email) notifications for events such as: a payment received, a loan application entering or leaving a user's action queue, a reconciliation exception raised (Section 38–39), an approaching or crossed overdue threshold, and a role assignment change affecting the user.

Exactly which reports and notifications each role receives is specified per role in `Nexora_Role_Specifications_AZ_Complete.md` (fields O — Notifications and P — Reports for every role).

## SECTION 44–45. AUDIT LOGS / TRANSPARENCY — fully specified in Part 1 §25.

## SECTION 46–47. COMPANY BRANDING / CONFIGURABLE COMPANY FEATURES — fully specified in Part 1 §26; "configurable company features" additionally covers: which built-in roles are enabled for a given company (Section 48 below), which approval chain each loan product uses (Part 1 §23), and reconciliation thresholds for notification triggers (Finance Manager, `Nexora_Role_Specifications_AZ_Complete.md`).

## SECTION 48. ROLE ENABLE/DISABLE & CUSTOM ROLES [NEW REQUIREMENT]

- **Enable/disable built-in roles:** a company can hide roles from its Create Worker role-picker that don't apply to its structure (e.g. a small cooperative disables MD/Deputy MD/GM and just uses Head Office Administrator) — disabling a role does not delete any existing assignment of it, it only stops new assignments and hides it from pickers.
- **Custom Role creation:** authorized role (Head Office Administrator/MD by default) opens Custom Role builder → names the role → selects a starting template (a built-in role's permission bundle, or one of the 11 templates in Part 1 §19) → adjusts individual permissions (view/create/edit/approve/reject/suspend/assign/disburse/export/delete/reverse, each toggleable) → sets default scope type (Part 1 §18) → saves.
- **Editing:** permission changes to a Custom Role apply immediately to all current holders (their effective permissions recompute on next action, per the merge rule in Part 1 §16) and are audit-logged with before/after permission diffs.
- **Disabling vs. deleting:** disabling stops new assignment; deleting is only permitted if zero active or historical assignments exist (to protect audit-trail integrity — a role that was ever actually held by someone cannot be deleted, only disabled).
- **Assignment/audit:** Custom Roles participate in Section 16–17's multiple-role and temporary-assignment machinery identically to built-in roles — there is no special-cased logic anywhere else in the system for "is this role custom."

## SECTION 50. SECURITY / DATA ISOLATION [EXISTING — PRESERVE, mechanism specified in Part 1 §4]

**[v2.1 NEW — cross-reference]** The Platform Owner's own portal, including the explicitly-authorized, time-bound, fully-audited Support Access mechanism referenced in Part 1 §4, is now fully specified in `Nexora_Platform_Owner_Portal_Spec.md`. That document's Section 40 (Platform Owner Permissions and Restrictions) is the authoritative statement of exactly what the Platform Owner can and cannot see by default, and Section 39 (Company Drill-down Behavior) is the authoritative statement of exactly where that drill-down stops. Nothing in this section is changed by that document; it is the implementation-grade detail this section's mechanism reference pointed to.

## SECTION 60. IMPLEMENTATION REQUIREMENTS FOR CLINE [NEW REQUIREMENT]

1. Build the **Role Assignment table** (Part 1 §15) and its permission-merge resolver *before* building any role-specific dashboard — every dashboard in `Nexora_Role_Specifications_AZ_Complete.md` is a view over this one engine, not 32 separate authorization systems.
2. Build the **payment pipeline and exception tables** (Part 1 §21) before building the Collection Officer or Branch Manager dashboard — those dashboards only display what the pipeline produces; they must never write payment data directly.
3. Do not build a "record payment" component of any kind, anywhere, for any role — this is a permanent constraint, not a first-draft omission to fill in later.
4. Branch code and branch URL generation (Part 1 §8–9) must be implemented as deterministic, race-condition-safe functions before the branch-creation form ships — the form should never expose a "branch code" input field at all.
5. Theme values (Part 1 §26) must be read from a per-company theme record, never hard-coded — verify by confirming two differently-branded companies render the same component tree with different colors with zero component-level code differences.
6. Every table storing money-moving data must be reachable from the audit-trail chain in Part 1 §25 via foreign key, not by report-time string-matching.
7. **[v2.1 NEW]** Build the **Performance Calculation Engine** (Part 1 §25-B/25-C) as one shared service *before* building any performance-displaying screen — the Central Command Dashboard (Section 21), every role's Performance Information (`Nexora_Role_Specifications_AZ_Complete.md`, field F), and the branch/worker performance tables all call this one service; none may compute Expected/Actual/Outstanding/Overdue independently.
8. **[v2.1 NEW]** Generate the customer's Virtual Account at customer-onboarding completion (Part 1 §22), not at loan approval — verify by confirming a customer with zero loans still has an Active Virtual Account and can receive a payment.
9. **[v2.1 NEW]** Implement every one of the 32 built-in roles' full A–Z specification independently — a code review that finds a role's dashboard component conditionally rendering based on "if role is a variant of X, reuse X's component" fails this requirement; each role's dashboard is its own component tree, even where two roles look similar.

## SECTION 62–64. REQUIREMENTS CHANGE LOG (PRE-v2.0 → v2.0)

**Changed:**
- Loan disbursement authority: previously fixed to "Head Office only" → now a configurable approval-chain endpoint (Part 1 §23), defaulting to Head Office-equivalent behavior.
- Branch fields: previously Phone/Email mandatory, Branch Code manually entered → both optional/system-generated respectively (Part 1 §7–8).
- One role per user (previously implicit) → multiple simultaneous role assignments with a scope/permission merge engine (Part 1 §15–17).

**Added (new in v2.0):**
- Branch Portal URL architecture and Head Office drill-down (Part 1 §9–10).
- Complete 43-role catalogue (Part 1 §19).
- Temporary/acting role assignments (Part 1 §17).
- Explicit, permanent no-cash-payment architectural constraint plus full webhook exception handling (Part 1 §21).
- Worker date-of-birth privacy rule — day+month only, no year field (Part 1 §12).
- Per-company theming/branding as enforced theme variables (Part 1 §26).
- Reconciliation as a standing module rather than an implied byproduct of accounting (Section 38–39 above).

**Preserved (unchanged, verified for conflicts — none found):**
- Multi-tenant single-codebase architecture; no-OTP/no-2FA authentication philosophy; Digital Collection Ledger and its automatic calculations (Section 37); Smart Payment Allocation core logic (Part 1 §24); Group Management (Section 26–27); Customer Registration/Profile (Section 26–27); Loan Products/Application/Review structure (Section 28–31); Virtual Account core concept (Part 1 §22); Accounting Module and financial statements (Section 38–39); Reporting System and Notification Center as modules (Section 40–43); AI Assistant (Section 27, Platform Owner Spec).

---

## SECTION 62-A. REQUIREMENTS CHANGE LOG (v2.0 → v2.1) [v2.1 NEW]

This is the log of the ten changes approved in the v2.1 clarification review, cross-referenced to where each is implemented in this two-part document (Part 1 = P1, Part 2 = P2) and in the companion `Nexora_Role_Specifications_AZ_Complete.md` (RSL).

| # | Change | Type | Where implemented |
|---|---|---|---|
| 1 | Company/branch/worker performance visibility becomes a shared system capability, grantable by scope/permission to any authorized role — not exclusive to MD/GM/Branch Manager. | v2.1 NEW REQUIREMENT | P1 §25-A/B/C; RSL field F for every role |
| 2 | HR Manager gains a read-only Organization Performance workspace (company/branch/CO/worker performance) alongside its unchanged People & Workforce workspace. | v2.1 CHANGE REQUIRED | P1 §25-C(D)(5); RSL — HR Manager |
| 3 | Internal Auditor gains read-only operational-performance visibility (company/branch/worker/CO performance, abnormal-performance identification) with an extended drill-down chain. | v2.1 CHANGE REQUIRED | P1 §25-C(D)(5); RSL — Internal Auditor |
| 4 | MD's Workforce Performance becomes an explicit dashboard section (filterable by date/branch/role/worker/status), not only an implicit report/drill-down capability. | v2.1 EXPANDED | RSL — MD |
| 5 | GM's Worker Performance becomes a complete section covering all worker types (not only the Collection Officer leaderboard), with company totals and branch comparison without per-branch drill-in. | v2.1 EXPANDED | RSL — GM |
| 6 | Head Office Central Command Dashboard becomes an explicit, named, primary company-level screen (Company Summary + Branch Performance + Worker Performance + drill-down), distinct from the previous "emergent pattern" description. | v2.1 CHANGE REQUIRED | P2 §21 |
| 7 | Every built-in role (32 total) receives its own complete, independent A–Z specification; "inherits parent role"/"lightweight variant" is withdrawn as a substitute for specification. | v2.1 CHANGE REQUIRED | P1 §19/§20; P2 §20; RSL (all roles) |
| 8 | Customer Virtual Account generation moves from "on first loan approval" to "at customer onboarding" — every registered customer has a permanent Virtual Account whether or not they ever take a loan. | v2.1 CHANGE REQUIRED | P1 §22, §23 (lifecycle diagram corrected) |
| 9 | The 43-role built-in/custom catalogue and its classification decisions are explicitly preserved — no role added, removed, or reclassified. | v2.1 PRESERVED — NO CHANGE | P1 §19 |
| 10 | Expected/Actual/Outstanding/Overdue-Default/Collection Rate and related terms get one binding, company-wide definition; no dashboard may define its own calculation. | v2.1 NEW REQUIREMENT | P1 §25-A |

**Preserved from v2.0 (explicitly reviewed against the v2.1 changes above, no conflicts found):** the Role Architecture / Scope / Permission engine (P1 §15–18); Multiple Roles Per User and Temporary/Acting Roles (P1 §16–17); Branch Code/Portal URL generation (P1 §8–9); Head Office drill-down mechanism (P1 §10, reused unchanged by Section 21's Central Command Dashboard and by every performance table in §25-C); the cashless payment pipeline and its exception handling (P1 §21); the Payment Allocation Engine (P1 §24); the Audit field set and traceability chain (P1 §25, now extended one hop further for performance drill-down only); Company Branding/theming (P1 §26); Role Enable/Disable & Custom Roles workflow (P2 §48).

---

*End of Part 2. This two-part document (v2.1), together with `Nexora_Role_Specifications_AZ_Complete.md` and `Nexora_Platform_Owner_Portal_Spec.md`, constitutes the current single source of truth for building Nexora. No requirement was silently dropped in this revision — every change above is traceable to a specific prior line, quoted and superseded rather than deleted, per this document's own tagging convention.*
