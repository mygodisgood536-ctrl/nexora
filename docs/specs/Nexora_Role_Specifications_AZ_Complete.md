# NEXORA — ROLE SPECIFICATION LIBRARY (COMPLETE A–Z, ALL 32 BUILT-IN ROLES)
## Companion document to SRS v2.1 (Part 1: Architecture, Part 2: Systems & Requirement Log)

**Status:** This document is the single source of truth for every built-in role's dashboard, permissions, and workflow, per SRS v2.1 Change #7 (Part 2, Section 62-A). It supersedes SRS v2.0 Part 2 Section 20 (which gave full A–P treatment to 16 roles and a permission-delta table to the other 16). **Every one of the 32 built-in roles below receives its own complete, independent specification.** No role's entry defers to, inherits from, or should be inferred from another role's entry — where two roles are intentionally similar, this is stated explicitly inside both entries, and both are still written out in full.

Cline must treat this document as implementation-ready: if a dashboard, permission, workflow, or piece of UI behavior for a built-in role is not described here, that is a gap to raise, not a gap to invent.

---

## HOW TO READ EACH ROLE ENTRY

Every role follows the same 26-field template (A–Z), followed by a compact **Access Matrix** table. This is deliberate: the fields are identical across roles so two roles can be compared line-for-line, but the *content* of each field is written independently per role.

| Field | Covers |
|---|---|
| **A. Role Purpose** | Why this role exists; what business problem it owns |
| **B. Scope** | Company-wide / Head Office / multi-branch / single branch / assigned customers-groups-loans (SRS v2.1 Part 1 §18) |
| **C. Dashboard** | The overall shape/framing of the role's home screen |
| **D. KPI Cards** | The specific summary metrics shown at the top of the dashboard |
| **E. Charts** | Visualizations beyond KPI cards |
| **F. Performance Information** | Exactly which company/branch/worker performance data this role sees, per SRS v2.1 Part 1 §25-C — "none" is a valid, explicitly stated answer for roles with no operational-performance scope |
| **G. Navigation / Sidebar** | Top-level nav items |
| **H. Pages** | Every distinct page/screen this role can reach |
| **I. Tables** | Data tables this role's pages contain, with column sets where they differ from a page already described |
| **J. Filters** | Filter controls available on this role's tables/pages |
| **K. Search** | What this role can search, and what scope limits apply |
| **L. Actions** | Every action button/capability, explicitly verbed (create/edit/approve/reject/assign/export/reverse/suspend/etc.) |
| **M. Permissions** | The permission bundle this role holds by default |
| **N. Restrictions** | What this role explicitly cannot do or see — stated affirmatively, not left implicit |
| **O. Notifications** | What triggers a notification to this role |
| **P. Reports** | Reports this role can generate/export |
| **Q. Drill-down** | The exact drill-down chain available to this role, scope-limited |
| **R. Audit Visibility** | What portion of the audit trail (SRS v2.1 Part 1 §25) this role can see |
| **S. Mobile Behavior** | What changes/condenses on a phone screen |
| **T. Tablet Behavior** | What changes/condenses on a tablet |
| **U. Desktop Behavior** | The full, uncondensed experience |
| **V. Role-Specific Workflows** | End-to-end flows unique to this role |
| **W. Interaction with Other Roles** | Where this role's work hands off to/from other roles |
| **X. Customer Visibility** | Which customers, and how much of each customer's record, this role can see |
| **Y. Loan Visibility** | Which loans, and how much loan detail, this role can see |
| **Z. Payment/Transaction Visibility** | Which payments/transactions this role can see, and at what granularity |

**Access Matrix** — a compact yes/no/scope summary of: Can See, Can Create, Can Edit, Can Approve, Can Reject, Can Assign, Can Export, Can Reverse, Can Manage, Cannot Access, Branches Accessible, Workers Accessible, Customers Accessible, Loans Accessible, Financial Info Accessible.

All 32 roles share Nexora's one design system and one Performance Engine (SRS v2.1 Part 1 §25-B) — nothing below re-derives a calculation or reinvents a visual language; what differs is information architecture and permission scope only.

---

# CATEGORY: EXECUTIVE

## ROLE 1 — MD (MANAGING DIRECTOR)

**A. Role Purpose:** Ultimate executive owner of company performance and strategy. Final authority on high-value approvals, company policy, and company-wide settings. The MD is accountable for the business as a whole, not for any single operational queue.

**B. Scope:** Company-wide, unrestricted — every branch, every customer, every worker, every financial record in the tenant.

**C. Dashboard:** Executive overview. Leads with portfolio health, growth trend, and risk exposure rather than an operational task list. The Head Office Central Command Dashboard (SRS v2.1 Part 2 §21) is the MD's landing screen; the MD's own additional sections (policy, settings, final approvals) sit alongside it in navigation.

**D. KPI Cards:** Total Loan Portfolio, Outstanding Portfolio, Portfolio at Risk (PAR 30/60/90), Total Savings, Today's Collections vs. Expected, Active Customers, Active Loans, Branch Count, Net Income (MTD).

**E. Charts:** Portfolio growth trend (12-month), Collection rate trend, PAR trend by branch, Branch performance leaderboard (bar), Loan disbursement volume trend.

**F. Performance Information:** Full access to every element of the Performance Visibility Layer (Part 1 §25-C) — Company Performance panel, full Branch Performance table (all branches, Company Total row), full Worker Performance table (every worker, every branch), and the dedicated Collection Officer Performance view. The MD's dashboard additionally contains an explicit **Workforce Performance** section (not only a report/drill-down) comparing Branch Managers, Collection Officers, Loan Officers, Credit Officers, and other measurable-performance workers against each other, filterable by Date, Branch, Role, Worker, and Performance Status.

**G. Navigation/Sidebar:** Central Command Dashboard, Branches, Portfolio, Workforce Performance, Approvals, Staff & Roles, Custom Roles, Reports, Audit Trail, Notifications, Settings.

**H. Pages:** Central Command Dashboard (§21); Branch list with performance table and drill-down; branch detail workspace; loan portfolio explorer; Workforce Performance explorer; Approval queue (final-stage items only, per the company's configured approval chain, Part 1 §23); Staff directory & role assignments; Custom Roles builder; Company settings/branding (Part 1 §26); full Report library; full Audit Trail explorer.

**I. Tables:** Branch Performance table (Part 1 §25-C(B) column set, with Company Total row); Worker Performance table (Part 1 §25-C(C) column set), filterable to any role/branch; Approval queue table (Applicant, Product, Amount, Current Stage, Days at Stage, Requesting Branch); Staff directory table (Worker ID, Name, Role(s), Branch, Status, Assignment Type).

**J. Filters:** Branch, Region/Area, Date range, Role, Worker, Performance status (meeting/below target), Approval-chain stage, Loan product.

**K. Search:** Any customer, loan, branch, staff member, or transaction reference, company-wide, unrestricted.

**L. Actions:** Approve/reject applications at the final approval-chain stage (mandatory reason on rejection); assign or end any role assignment company-wide, including temporary/acting roles; create/suspend/close branches; enable/disable built-in roles for the company; build/edit Custom Roles; edit company branding/settings; export any report.

**M. Permissions:** view (unrestricted), approve (final stage), reject (final stage), assign (any role, any scope), suspend/terminate (any worker), create/suspend/close (branches), export (all reports), configure (branding, settings, role catalogue).

**N. Restrictions:** No manual repayment/cash entry exists for anyone, including the MD (Part 1 §21 — a permanent constraint, not a role-specific one); cannot edit a posted, already-audited transaction in place — only a reversal is possible, never an edit (Part 1 §21 exceptions table); performance visibility grants no separate write permission over financial records (Part 1 §25-C(D)(4)).

**O. Notifications:** Large-value loan approvals pending at final stage, PAR threshold breaches, branch performance anomalies, unresolved reconciliation exceptions above a configurable value, role-assignment changes at executive level.

**P. Reports:** All company reports — portfolio, branch comparison, worker/staff performance, financial statements (Cash Book/Cash Flow/P&L/Balance Sheet), audit summaries.

**Q. Drill-down:** `Company → Branch → Branch Manager → Collection Officers → Customers → Groups → Loans → Repayment Schedules → Payments → Transactions → Audit Trail` (full chain, Part 1 §10/§25/§25-C).

**R. Audit Visibility:** Full — every audit entry, every branch, every role, company-wide.

**S. Mobile Behavior:** Condensed to KPI cards, the Approval queue, and Notifications — deep portfolio/workforce analysis is treated as a desktop task and is view-summary-only on mobile.

**T. Tablet Behavior:** Branch and Worker Performance tables become card lists; Approval queue and Portfolio explorer remain fully usable.

**U. Desktop Behavior:** Full Central Command Dashboard, full Workforce Performance explorer, full Custom Roles builder and Settings/Branding — these three are desktop-primary due to their forms/table density.

**V. Role-Specific Workflows:** (1) Final-stage loan approval — review application + all prior-stage notes → approve/reject with reason → system moves loan to Disbursed or configured rejection state. (2) Company-wide role assignment — select worker → select role → select scope → select Permanent/Temporary → (if Temporary) set start/end date and reason → save (Part 1 §16–17). (3) Branding wizard — edit brand tokens → live preview renders → finalize (Part 1 §26).

**W. Interaction with Other Roles:** Receives escalations and final-stage approvals from GM/Credit Manager; assigns/ends role assignments for every other role in the company, including GM and Head Office Administrator; Head Office Administrator executes MD-approved company configuration changes day-to-day.

**X. Customer Visibility:** Every customer, full profile, company-wide.

**Y. Loan Visibility:** Every loan, full detail, company-wide, at every stage.

**Z. Payment/Transaction Visibility:** Every payment and transaction, full detail, company-wide, including reversed/unallocated/unmatched exception records.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything, company-wide |
| Can Create | Branches, role assignments, Custom Roles |
| Can Edit | Company settings/branding, loan products, approval chains |
| Can Approve | Final-chain-stage loan applications, role assignments |
| Can Reject | Final-chain-stage loan applications (reason required) |
| Can Assign | Any role, any scope, any assignment type |
| Can Export | All reports, company-wide |
| Can Reverse | No direct financial reversal action (that is Finance Manager's function); MD can direct/authorize one, execution stays with Finance |
| Can Manage | Branches, staff, roles, company settings/branding |
| Cannot Access | A manual payment-entry function (does not exist for anyone) |
| Branches Accessible | All |
| Workers Accessible | All |
| Customers Accessible | All |
| Loans Accessible | All |
| Financial Info Accessible | All (read); posting/adjustment execution remains Finance Manager's/Accountant's action |

---

## ROLE 2 — DEPUTY MD

**A. Role Purpose:** Deputizes for the MD — carries the same strategic/executive oversight so company leadership continuity does not depend on one person, without independently holding the MD's final say on company-defining settings.

**B. Scope:** Company-wide, identical to MD's scope.

**C. Dashboard:** Same Central Command Dashboard and executive framing as MD's — this is intentionally the same tool, not a lesser one, because the Deputy MD must be able to step into the MD's shoes without a different mental model.

**D. KPI Cards:** Identical to MD's: Total Loan Portfolio, Outstanding Portfolio, PAR 30/60/90, Total Savings, Today's Collections vs. Expected, Active Customers, Active Loans, Branch Count, Net Income (MTD).

**E. Charts:** Identical to MD's: Portfolio growth trend, Collection rate trend, PAR trend by branch, Branch performance leaderboard, Disbursement volume trend.

**F. Performance Information:** Identical full access to Company Performance, Branch Performance table, Worker Performance table, and Workforce Performance explorer as MD (Part 1 §25-C) — performance visibility is never the axis on which this role is narrowed.

**G. Navigation/Sidebar:** Same as MD's, minus the Custom Roles builder unless separately granted.

**H. Pages:** Same page set as MD, with the Company Settings/Branding page shown in **view-only** mode unless separately granted edit rights.

**I. Tables:** Identical Branch Performance and Worker Performance tables to MD's.

**J. Filters:** Identical to MD's.

**K. Search:** Company-wide, unrestricted — identical to MD.

**L. Actions:** Approve/reject at the final approval-chain stage exactly as MD can; assign/end role assignments company-wide; create/suspend branches. **Difference from MD:** cannot finalize a change to company settings/branding or the role/Custom-Role catalogue on their own authority — these require MD sign-off, though any single one of these actions can be explicitly delegated to the Deputy MD per instance.

**M. Permissions:** Same verb set as MD (view, approve, reject, assign, suspend/terminate, create/suspend branches, export) except configure (branding/settings/role-catalogue), which is delegated per-instance rather than held by default.

**N. Restrictions:** No default final say on company settings, branding, or the Custom Role catalogue (delegable per instance, each delegation audit-logged); same universal no-manual-payment restriction as every role.

**O. Notifications:** Identical trigger set to MD's — large-value approvals pending, PAR breaches, branch anomalies, unresolved reconciliation exceptions, executive role-assignment changes.

**P. Reports:** Identical report library access to MD's.

**Q. Drill-down:** Identical full chain to MD's.

**R. Audit Visibility:** Full, company-wide — identical to MD.

**S. Mobile Behavior:** Identical condensed view to MD's (KPI cards + Approval queue + Notifications).

**T. Tablet Behavior:** Identical to MD's.

**U. Desktop Behavior:** Identical to MD's, with the Settings/Branding page rendering read-only unless a delegation is currently active.

**V. Role-Specific Workflows:** Same final-approval and role-assignment workflows as MD. **Delegation workflow (unique to this role):** MD grants a specific settings/branding/Custom-Role action to the Deputy MD for a defined instance → Deputy MD executes it → action is audit-logged against both the Deputy MD (actor) and MD (delegating authority).

**W. Interaction with Other Roles:** Functions as MD's stand-in toward GM, Head Office Administrator, and every other role; escalates any settings/branding/role-catalogue decision back to MD absent an active delegation.

**X. Customer Visibility:** Identical to MD's — every customer, company-wide.

**Y. Loan Visibility:** Identical to MD's — every loan, company-wide.

**Z. Payment/Transaction Visibility:** Identical to MD's — every payment/transaction, company-wide.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything, company-wide (identical to MD) |
| Can Create | Branches, role assignments |
| Can Edit | Loan products, approval chains; company settings/branding only when delegated |
| Can Approve | Final-chain-stage loan applications, role assignments |
| Can Reject | Final-chain-stage loan applications (reason required) |
| Can Assign | Any role, any scope, any assignment type |
| Can Export | All reports, company-wide |
| Can Reverse | No direct financial reversal action (Finance Manager's function) |
| Can Manage | Branches, staff, roles; company settings/branding only when delegated |
| Cannot Access | Manual payment entry (does not exist); company settings/branding/Custom-Role catalogue final say without an active MD delegation |
| Branches Accessible | All |
| Workers Accessible | All |
| Customers Accessible | All |
| Loans Accessible | All |
| Financial Info Accessible | All (read); posting/adjustment execution remains Finance Manager's/Accountant's action |

---

## ROLE 3 — GM (GENERAL MANAGER)

**A. Role Purpose:** Runs day-to-day company operations. Typically the mid-chain or final approver in the company's configured loan workflow (Part 1 §23) and the operational escalation point above Branch Managers/Area Managers.

**B. Scope:** Company-wide.

**C. Dashboard:** Operational command center — closer to the Head Office Central Command Dashboard concept (Part 2 §21) than MD's strategic view. The Branch Performance table is the centerpiece of this role's daily screen.

**D. KPI Cards:** Today's Expected vs. Actual Collection (company-wide), Collection Rate, Overdue Amount, Loan Applications Pending Approval, Active Branches, Staff Headcount, Today's Disbursements.

**E. Charts:** Branch performance comparison (Branch / Expected / Collected / Collection % / Outstanding / Overdue / Active Customers / Active Loans), Collection Officer leaderboard, Applications-in-pipeline funnel by stage.

**F. Performance Information:** Full Company Performance panel, full Branch Performance table (all branches, Company Total row), and a complete **Worker Performance** section covering every measurable worker type — Collection Officers, Branch Managers, Loan Officers, Credit Officers, and other operational staff — not only the Collection Officer leaderboard. GM can drill `Worker → Branch → Assigned Customers/Applications → Loans → Payments/Transactions → Audit Trail` and sees company totals and branch comparisons without opening each branch individually.

**G. Navigation/Sidebar:** Central Command Dashboard, Branches, Worker Performance, Approvals, Staff, Loan Applications, Reports, Audit Trail, Notifications.

**H. Pages:** Central Command Dashboard/Branch performance table with click-through to branch workspace (Part 1 §10); Worker Performance explorer (all worker types, company-wide); Approval queue at GM's configured chain stage; Staff role-assignment management; Loan-product/approval-chain configuration; Reports.

**I. Tables:** Branch Performance table (identical column set to Part 1 §25-C(B)); Worker Performance table across all worker types (Part 1 §25-C(C)); Collection Officer leaderboard (a Collection-Officer-filtered view of the same Worker Performance table, not a separately maintained dataset); Approval queue table.

**J. Filters:** Branch, Role, Worker, Date range, Performance status, Approval-chain stage.

**K. Search:** Company-wide — branches, staff, customers, loans.

**L. Actions:** Approve/reject loans at the GM's configured chain stage; create workers/branches if the company's permission configuration grants it (Part 1 §7 is explicitly configurable, not fixed to one role); assign temporary/acting roles; suspend staff.

**M. Permissions:** view (company-wide), approve/reject (GM's chain stage), assign (temporary/acting roles), suspend (staff), create (workers/branches, if configured), export (branch/worker/collection reports).

**N. Restrictions:** Cannot alter company branding/theme (MD/Head Office Administrator territory) unless separately granted; same universal no-manual-payment restriction; performance visibility grants no edit/reversal right over any financial record.

**O. Notifications:** Approval queue items, overdue-threshold breaches, branch anomalies, staff role-assignment expirations.

**P. Reports:** Branch performance, worker/Collection Officer performance, staff performance, loan pipeline reports.

**Q. Drill-down:** `Company → Branch → Branch Manager → Collection Officers → Customers → Groups → Loans → Payments → Transactions → Audit Trail` (identical full chain to MD's).

**R. Audit Visibility:** Full, company-wide.

**S. Mobile Behavior:** KPI cards + Approval queue + Notifications.

**T. Tablet Behavior:** Branch table and Worker Performance table become card lists; fully usable.

**U. Desktop Behavior:** Full Branch Performance table, full Worker Performance explorer with filters, full Approval queue.

**V. Role-Specific Workflows:** (1) Branch-table drill-down — click a branch row → branch workspace loads in-session (Part 1 §10) → continue into Collection Officers/Customers/Loans. (2) Worker Performance comparison — filter by Role → compare all Collection Officers, or all Branch Managers, across the company side by side. (3) Chain-stage approval — review application at GM's stage → approve/reject with reason → moves to next configured stage.

**W. Interaction with Other Roles:** Receives applications from Credit Manager/Branch Manager at GM's chain stage; escalates final-say items to MD; directs Operations Manager on process exceptions; oversees Area Managers' regional performance.

**X. Customer Visibility:** Every customer, company-wide, full profile.

**Y. Loan Visibility:** Every loan, company-wide, at every stage.

**Z. Payment/Transaction Visibility:** Every payment/transaction, company-wide.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything operational, company-wide |
| Can Create | Workers, branches (if company permission config grants it) |
| Can Edit | Loan products, approval chains |
| Can Approve | Loans at GM's configured chain stage |
| Can Reject | Loans at GM's configured chain stage (reason required) |
| Can Assign | Temporary/acting role assignments |
| Can Export | Branch, worker, collection, pipeline reports |
| Can Reverse | No direct financial reversal action |
| Can Manage | Staff role assignments, branch oversight |
| Cannot Access | Company branding/theme (unless granted); manual payment entry (does not exist) |
| Branches Accessible | All |
| Workers Accessible | All |
| Customers Accessible | All |
| Loans Accessible | All |
| Financial Info Accessible | Collection/portfolio figures full; deep accounting/ledger detail read-only unless separately granted |

---

## ROLE 4 — ASSISTANT GM

**A. Role Purpose:** Supports the GM across the same operational command function, providing coverage and delegated execution so GM-level operational oversight does not bottleneck on one person.

**B. Scope:** Company-wide by default, or a multi-branch subset if the company scopes it that way.

**C. Dashboard:** Same operational command-center framing as GM's — Branch Performance table as centerpiece.

**D. KPI Cards:** Identical to GM's: Today's Expected vs. Actual Collection, Collection Rate, Overdue Amount, Applications Pending Approval, Active Branches, Staff Headcount, Today's Disbursements.

**E. Charts:** Identical to GM's: Branch performance comparison, Collection Officer leaderboard, Applications funnel.

**F. Performance Information:** Identical Company Performance panel and Branch Performance table access to GM's, and the same full Worker Performance section across all worker types, scoped to whatever branch subset the Assistant GM is assigned (company-wide by default).

**G. Navigation/Sidebar:** Identical to GM's.

**H. Pages:** Identical page set to GM's.

**I. Tables:** Identical Branch Performance and Worker Performance tables to GM's.

**J. Filters:** Identical to GM's.

**K. Search:** Company-wide (or scoped multi-branch subset, per assignment).

**L. Actions:** Approve/reject loans at GM's configured chain stage if the chain includes this role; assign temporary/acting roles. **Difference from GM:** no branch-creation or staff-termination rights by default (both are available to GM directly).

**M. Permissions:** view, approve/reject (chain stage, if included), assign (temporary/acting roles), export (branch/worker reports). No create-branch or terminate-worker permission by default.

**N. Restrictions:** No branch-creation or staff-termination rights unless separately granted; cannot alter company branding/theme; same universal no-manual-payment restriction.

**O. Notifications:** Identical trigger set to GM's.

**P. Reports:** Identical report access to GM's.

**Q. Drill-down:** Identical full chain to GM's, scope-limited if assigned a branch subset.

**R. Audit Visibility:** Same scope as the role's data access — company-wide or scoped multi-branch.

**S. Mobile Behavior:** Identical condensed view to GM's.

**T. Tablet Behavior:** Identical to GM's.

**U. Desktop Behavior:** Identical to GM's.

**V. Role-Specific Workflows:** Same branch-drill-down and Worker Performance comparison workflows as GM. Branch-creation and worker-termination requests are routed to GM for execution rather than performed directly.

**W. Interaction with Other Roles:** Deputizes for GM on approvals and oversight; routes branch-creation/termination decisions to GM; coordinates with Area Managers/Branch Managers on GM's behalf.

**X. Customer Visibility:** Every customer within scope, full profile.

**Y. Loan Visibility:** Every loan within scope, full detail.

**Z. Payment/Transaction Visibility:** Every payment/transaction within scope.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything operational within scope |
| Can Create | Nothing by default (no branch/worker creation) |
| Can Edit | Loan products/approval chains, if granted |
| Can Approve | Loans at GM's chain stage, if the chain includes this role |
| Can Reject | Same as above (reason required) |
| Can Assign | Temporary/acting role assignments |
| Can Export | Branch, worker, collection reports |
| Can Reverse | No direct financial reversal action |
| Can Manage | Staff coverage/oversight, not termination |
| Cannot Access | Branch creation, staff termination, company branding (all unless separately granted) |
| Branches Accessible | All, or assigned multi-branch subset |
| Workers Accessible | Matching branch scope |
| Customers Accessible | Matching branch scope |
| Loans Accessible | Matching branch scope |
| Financial Info Accessible | Collection/portfolio figures within scope |

---

## ROLE 5 — HEAD OFFICE ADMINISTRATOR

**A. Role Purpose:** Administers the Head Office portal, staff records, and company configuration on the MD/GM's behalf — the operational "keeper" of company setup (branches, workers, roles, branding), distinct from portfolio-performance ownership.

**B. Scope:** Head Office scope by default (Part 1 §18), extendable to company-wide by explicit grant.

**C. Dashboard:** Administrative control panel — staff, branches, and settings status, not portfolio metrics.

**D. KPI Cards:** Total Staff, Pending Worker Approvals/Credential Issues, Active Branches, Open Role Assignments Expiring This Week, Unresolved Support/Password-Reset Requests.

**E. Charts:** Staff headcount by branch (bar), Role distribution (pie), Recent worker-creation activity timeline.

**F. Performance Information:** None by default — this role's dashboard is deliberately administrative, not performance-focused. If the company separately grants a performance-visibility permission (uncommon for this role), it would follow the standard scope rules of Part 1 §25-C, but no collection or PAR metric appears here by default.

**G. Navigation/Sidebar:** Dashboard, Branches, Staff (create/manage workers), Roles & Permissions, Custom Roles, Company Settings, Branding, Audit Trail.

**H. Pages:** Branch list & branch creation form (Part 1 §7–8); Create Worker flow (Part 1 §12); Role assignment management (Part 1 §16–17); Custom Role builder (Part 2 §48); Company branding wizard (Part 1 §26); password-reset/credential-issuance panel.

**I. Tables:** Staff directory (Worker ID, Name, Role(s), Branch, Status, Assignment Type, Credential Status); Branch list (Branch Code, Name, Status, Portal URL, Staff Count); Role assignment history table.

**J. Filters:** Branch, Role, Assignment Type (Permanent/Temporary), Status (Active/Suspended/Terminated), credential status.

**K. Search:** Staff, branches, role assignments.

**L. Actions:** Create branches (if the company grants this role the permission — Part 1 §7 is explicitly configurable); create/suspend/terminate workers; issue temporary passwords; assign/end role assignments; build custom roles; edit company settings/branding.

**M. Permissions:** create (branches if configured, workers), suspend/terminate (workers), issue (credentials), assign/end (role assignments), configure (Custom Roles, branding, company settings).

**N. Restrictions:** Cannot approve loans or touch financial ledgers unless separately granted; cannot view customer financial detail beyond what's needed for staff-to-customer assignment identification.

**O. Notifications:** New worker credential-issuance confirmations, role assignments expiring soon, branch creation confirmations.

**P. Reports:** Staff roster reports, role-assignment audit reports, branch-list reports.

**Q. Drill-down:** `Branch → Staff list → individual worker's role-assignment history`.

**R. Audit Visibility:** Full visibility into staff/role/branch-administration audit entries; financial-transaction audit entries only if separately granted.

**S. Mobile Behavior:** Limited to credential-issuance and approval-of-pending-items.

**T. Tablet Behavior:** Fully usable — forms and directory tables render cleanly.

**U. Desktop Behavior:** Full experience — this is a forms-heavy role and desktop is the primary target.

**V. Role-Specific Workflows:** (1) Create Worker — role(s), name, phone, photo, DOB (day+month only, Part 1 §12), branch → system generates Worker ID/username/temp password → one-time credential panel shown to the creating admin. (2) Branding wizard — enter brand tokens → live preview → finalize (Part 1 §26). (3) Temporary role assignment — assign additional role with start/end date and reason (Part 1 §17).

**W. Interaction with Other Roles:** Executes MD/GM-approved configuration changes; hands newly created workers to their assigned Branch Manager/HR Manager for day-to-day supervision; coordinates with HR Manager on worker lifecycle where both roles are enabled (either can be granted worker creation, per company preference).

**X. Customer Visibility:** None by default — this role is people/config-focused, not customer-facing, unless separately granted.

**Y. Loan Visibility:** None by default.

**Z. Payment/Transaction Visibility:** None by default.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Staff, branches, roles, company settings |
| Can Create | Branches (if configured), workers, Custom Roles |
| Can Edit | Company settings, branding, role assignments |
| Can Approve | Not applicable (no loan-approval role) |
| Can Reject | Not applicable |
| Can Assign | Role assignments, including temporary/acting |
| Can Export | Staff, branch, role-assignment reports |
| Can Reverse | Nothing financial (no financial access by default) |
| Can Manage | Workers (create/suspend/terminate), branches, Custom Roles, branding |
| Cannot Access | Loan approval, financial ledgers, customer financial detail (unless separately granted) |
| Branches Accessible | Head Office by default; company-wide if granted |
| Workers Accessible | All (this is the role's core function) |
| Customers Accessible | None by default |
| Loans Accessible | None by default |
| Financial Info Accessible | None by default |

---

## ROLE 6 — OPERATIONS MANAGER

**A. Role Purpose:** Owns operational consistency across branches — process adherence, staffing coverage, and day-to-day exceptions that are not strictly financial approvals.

**B. Scope:** Company-wide (or multi-branch, if the company scopes it that way).

**C. Dashboard:** Operations health board — coverage and exceptions, not portfolio value.

**D. KPI Cards:** Branches Meeting Daily Collection Target, Staff Attendance/Coverage Gaps (via role-assignment records), Open Missed-Payment Cases, Open Unallocated-Payment Exceptions (Part 1 §21), Loan Applications Stuck > X Days at a Stage.

**E. Charts:** Branch operational-health heatmap, Applications-by-stage funnel, Exceptions-over-time trend.

**F. Performance Information:** Company Performance panel and Branch Performance table (Part 1 §25-C), viewed through an operations-health lens (target-met/below-target status is the organizing dimension rather than raw collection value); Worker Performance table filtered to staffing-coverage and exception-generating workers.

**G. Navigation/Sidebar:** Dashboard, Branches, Operations Exceptions, Staff Coverage, Worker Performance, Reports, Notifications.

**H. Pages:** Exceptions queue (unallocated payments, unmatched payments, stuck applications — pulled directly from Part 1 §21's exception tables); branch operational detail; staff coverage/role-assignment calendar; Worker Performance explorer (operations lens).

**I. Tables:** Exceptions table (Type, Branch, Amount, Age, Status); Branch operational-health table (Branch, Target Status, Open Exceptions, Coverage Gaps); Worker Performance table (Part 1 §25-C(C)).

**J. Filters:** Branch, Exception type, Age (days open), Role, Coverage status.

**K. Search:** Branches, applications, exception records.

**L. Actions:** Reassign stuck applications between staff/branches; escalate exceptions; request role-assignment changes (subject to permission).

**M. Permissions:** view (operational data company-wide), reassign (applications/staff coverage), escalate (exceptions), request (role-assignment changes).

**N. Restrictions:** Typically no final loan-approval authority (process-focused, not credit-decision-focused) unless the company's chain includes this role explicitly; performance visibility is read-only.

**O. Notifications:** New exceptions, applications aging past SLA, coverage gaps.

**P. Reports:** Operational exception reports, SLA/turnaround-time reports.

**Q. Drill-down:** `Exception → source transaction/application → branch → responsible staff`.

**R. Audit Visibility:** Operational actions across the company; financial-posting audit entries visible read-only.

**S. Mobile Behavior:** Exception counts and a quick-triage list.

**T. Tablet Behavior:** Fully usable — exceptions queue and coverage calendar both render as tablet-friendly lists.

**U. Desktop Behavior:** Full heatmap, funnel, and exceptions queue with filtering.

**V. Role-Specific Workflows:** (1) Exception triage — open exceptions queue → filter by type/age → reassign or escalate. (2) Coverage-gap resolution — identify branch with a staffing gap → recommend/request a temporary role assignment to cover it (Part 1 §17).

**W. Interaction with Other Roles:** Escalates unresolved exceptions to Finance Manager (financial resolution) or GM (staffing/process escalation); coordinates with Branch Managers on stuck applications; receives operational-health input from Area Managers.

**X. Customer Visibility:** Limited to what's needed to triage an exception (customer identity, affected loan/payment reference) — not full customer profile browsing.

**Y. Loan Visibility:** Limited to applications stuck in the pipeline and their stage history — not full portfolio browsing.

**Z. Payment/Transaction Visibility:** Exception-flagged payments/transactions (unallocated, unmatched, incomplete) — full detail on those; routine successful payments are visible only in aggregate (Branch Performance table), not individually.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Operational exceptions, branch health, worker performance |
| Can Create | Reassignment requests |
| Can Edit | Nothing financial directly |
| Can Approve | Only if the company's approval chain names this role explicitly |
| Can Reject | Same condition as above |
| Can Assign | Requests role-assignment changes (execution may require another role's sign-off) |
| Can Export | Operational/SLA reports |
| Can Reverse | Nothing (Finance Manager's function) |
| Can Manage | Exception triage, staff coverage coordination |
| Cannot Access | Final loan approval (unless chain-configured); accounting postings |
| Branches Accessible | All, or assigned multi-branch subset |
| Workers Accessible | All, or assigned multi-branch subset |
| Customers Accessible | Only via an open exception |
| Loans Accessible | Only applications stuck/flagged in the pipeline |
| Financial Info Accessible | Exception-flagged transactions only; aggregate branch figures |

---

## ROLE 7 — ASSISTANT OPERATIONS MANAGER

**A. Role Purpose:** Supports the Operations Manager's process-adherence and exceptions function, providing triage coverage without independent authority to close matters at executive level.

**B. Scope:** Company-wide by default, or a multi-branch subset.

**C. Dashboard:** Identical operations health-board framing to Operations Manager's.

**D. KPI Cards:** Identical to Operations Manager's: Branches Meeting Target, Coverage Gaps, Open Missed-Payment Cases, Open Unallocated-Payment Exceptions, Applications Stuck > X Days.

**E. Charts:** Identical to Operations Manager's.

**F. Performance Information:** Identical Company Performance and Branch Performance table access to Operations Manager's, scoped to whatever branch subset the Assistant is assigned.

**G. Navigation/Sidebar:** Identical to Operations Manager's.

**H. Pages:** Identical page set to Operations Manager's.

**I. Tables:** Identical exceptions and branch operational-health tables to Operations Manager's.

**J. Filters:** Identical to Operations Manager's.

**K. Search:** Same as Operations Manager's, scoped to assignment.

**L. Actions:** Triage exceptions (view, categorize, add notes); recommend reassignment. **Difference from Operations Manager:** cannot close/escalate a case to executive level — triage and recommendation only; final escalation is the Operations Manager's action.

**M. Permissions:** view (operational data within scope), triage (exceptions), recommend (reassignment). No escalate-to-executive permission by default.

**N. Restrictions:** Cannot close or escalate a case to executive level; cannot reassign staff without Operations Manager sign-off; same universal no-manual-payment restriction.

**O. Notifications:** New exceptions requiring triage, SLA-aging alerts.

**P. Reports:** Same operational/SLA reports as Operations Manager, view/export.

**Q. Drill-down:** Identical chain to Operations Manager's, scope-limited.

**R. Audit Visibility:** Own triage actions, plus read visibility into the same operational audit entries as Operations Manager, within scope.

**S. Mobile Behavior:** Identical condensed exception-triage list to Operations Manager's.

**T. Tablet Behavior:** Identical to Operations Manager's.

**U. Desktop Behavior:** Identical to Operations Manager's, minus the escalate-to-executive action.

**V. Role-Specific Workflows:** Exception intake and triage → recommendation drafted → routed to Operations Manager for final escalation/closure decision.

**W. Interaction with Other Roles:** Feeds triaged exceptions to Operations Manager; coordinates with Branch Managers on day-to-day coverage questions.

**X. Customer Visibility:** Same limited exception-context visibility as Operations Manager's.

**Y. Loan Visibility:** Same limited stuck-application visibility as Operations Manager's.

**Z. Payment/Transaction Visibility:** Same exception-flagged-only visibility as Operations Manager's.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Operational exceptions, branch health (within scope) |
| Can Create | Triage notes, reassignment recommendations |
| Can Edit | Nothing financial |
| Can Approve | Nothing at executive level |
| Can Reject | Nothing at executive level |
| Can Assign | Nothing directly — recommends only |
| Can Export | Operational/SLA reports |
| Can Reverse | Nothing |
| Can Manage | Exception triage only |
| Cannot Access | Executive-level case closure/escalation, staff reassignment execution |
| Branches Accessible | All, or assigned multi-branch subset |
| Workers Accessible | All, or assigned multi-branch subset |
| Customers Accessible | Only via an open exception |
| Loans Accessible | Only applications stuck/flagged in the pipeline |
| Financial Info Accessible | Exception-flagged transactions only |

---

# CATEGORY: FINANCE

## ROLE 8 — FINANCE MANAGER

**A. Role Purpose:** Owns the company's financial integrity — accounting accuracy, reconciliation, financial reporting, and payment-provider configuration.

**B. Scope:** Company-wide financial data (all branches' ledgers/accounting); typically not staff/role administration.

**C. Dashboard:** Financial control center.

**D. KPI Cards:** Cash Position (bank-verified, Part 1 §21 — no manual cash figure exists), Total Receivables, Today's Reconciliation Status, Open Reconciliation Exceptions, Unallocated/Unmatched Payments Outstanding, Net Income (MTD/YTD).

**E. Charts:** Cash flow trend, Income vs. expense trend, Reconciliation exception aging.

**F. Performance Information:** Full Company Performance panel and full Branch Performance table (Part 1 §25-C), viewed through a financial-integrity lens (Outstanding/Overdue figures feed directly into receivables and provisioning); Worker Performance table available read-only where it explains a branch's collection variance.

**G. Navigation/Sidebar:** Dashboard, Accounting, Reconciliation, Reports, Payment Provider Settings, Audit Trail.

**H. Pages:** Chart of accounts; journal/ledger views; Reconciliation module (Unallocated, Unmatched, Reversed, Incomplete Processing exception tables, Part 1 §21); Financial statement generation (P&L, Balance Sheet, Cash Flow); Payment provider configuration.

**I. Tables:** Reconciliation exceptions table (Type, Reference, Amount, Age, Status); General ledger table; Financial statement line-item tables.

**J. Filters:** Date range, Branch, Account, Exception type, Age.

**K. Search:** Transactions, accounts, exceptions, by reference/date/branch.

**L. Actions:** Resolve/allocate exception payments; post/adjust accounting entries with mandatory reason capture; configure payment provider; export financial statements.

**M. Permissions:** view (financial data company-wide), resolve/allocate (exceptions), post/adjust (accounting entries, reason required), configure (payment provider), export (financial reports).

**N. Restrictions:** Cannot create/edit a repayment record directly outside the automated pipeline — resolving an "Unallocated Payment Exception" allocates an already-verified payment; it never creates a new one from nothing. No staff/role administration by default.

**O. Notifications:** New reconciliation exceptions, provider webhook failures/downtime alerts, month-end close reminders.

**P. Reports:** Full accounting/financial report suite, reconciliation reports.

**Q. Drill-down:** `Financial statement line → underlying ledger entries → source transaction → audit log`.

**R. Audit Visibility:** Full financial audit trail, company-wide.

**S. Mobile Behavior:** Exception alerts and approvals only.

**T. Tablet Behavior:** Reconciliation module and statements are usable for review; heavy posting work remains desktop-oriented.

**U. Desktop Behavior:** Full spreadsheet-like ledger/journal views, full reconciliation module.

**V. Role-Specific Workflows:** (1) Exception resolution — open an Unallocated Payment Exception → identify the correct loan/customer → allocate the already-verified payment → audit entry recorded. (2) Month-end close — generate P&L/Balance Sheet/Cash Flow → review reconciliation status → close period.

**W. Interaction with Other Roles:** Receives exceptions flagged by IT/System Administrator (technical health) and Operations Manager (process-level); Accountant executes day-to-day postings under Finance Manager's chart of accounts and policy; Internal Auditor reviews Finance Manager's resolutions independently.

**X. Customer Visibility:** Customer identity as needed to resolve a payment exception — not general customer-profile browsing.

**Y. Loan Visibility:** Loan balances/status as needed for allocation and receivables reporting — full financial detail, not application-workflow detail.

**Z. Payment/Transaction Visibility:** Full — every payment/transaction, company-wide, including all exception states.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | All financial data, company-wide |
| Can Create | Journal entries (non-payment), provider configuration |
| Can Edit | Chart of accounts, accounting entries (reason required) |
| Can Approve | Exception resolutions/allocations |
| Can Reject | N/A (no loan-approval role) |
| Can Assign | Nothing role-related |
| Can Export | All financial statements/reports |
| Can Reverse | Reversal entries against payments (linked, never edits original) |
| Can Manage | Reconciliation module, payment provider settings |
| Cannot Access | Staff/role administration, branding, customer-service ticketing |
| Branches Accessible | All (financial data) |
| Workers Accessible | Read-only, where relevant to a branch's financial variance |
| Customers Accessible | As needed for exception resolution |
| Loans Accessible | Full financial detail, company-wide |
| Financial Info Accessible | Full — this is the role's core scope |

---

## ROLE 9 — ACCOUNTANT

**A. Role Purpose:** Day-to-day bookkeeping — posting, categorizing, and maintaining the books that the automated payment pipeline (Part 1 §21) feeds.

**B. Scope:** Company-wide (or Head Office-scoped, per company) financial records; no staff/role administration.

**C. Dashboard:** Bookkeeping workspace.

**D. KPI Cards:** Today's Postings, Pending Categorization Items, Bank Book Balance vs. System Balance, Open Journal Entries.

**E. Charts:** Daily posting volume, Category breakdown of expenses/income.

**F. Performance Information:** None by default — this role's function is bookkeeping accuracy, not portfolio/collection performance. Read-only access to aggregate branch financial totals where needed to reconcile the books, not the full Performance Visibility Layer.

**G. Navigation/Sidebar:** Dashboard, Ledger, Journal Entries, Cash Book, Reports.

**H. Pages:** General ledger; journal entry form (non-payment accounting entries — payroll, expenses; never customer repayments, which remain pipeline-only); Cash Book; Bank Book.

**I. Tables:** Journal entries table (Date, Account, Debit, Credit, Reference, Status); Cash Book/Bank Book tables.

**J. Filters:** Date, Account, Category, Status (posted/pending).

**K. Search:** Ledger entries by date/account/reference.

**L. Actions:** Create/edit non-payment journal entries; categorize transactions; export ledger extracts.

**M. Permissions:** create/edit (non-payment journal entries), categorize (transactions), export (ledger extracts).

**N. Restrictions:** No access to role/staff administration, branding, or provider configuration; cannot post entries against the automated repayment pipeline's transactions except via the Finance Manager-gated exception-resolution path.

**O. Notifications:** New items needing categorization, ledger discrepancies flagged by the reconciliation job.

**P. Reports:** Ledger extracts, cash book/bank book reports.

**Q. Drill-down:** `Ledger entry → source document/transaction`.

**R. Audit Visibility:** Own postings and their history; broader financial audit trail read-only.

**S. Mobile Behavior:** View-only.

**T. Tablet Behavior:** Usable for review of ledger/journal entries.

**U. Desktop Behavior:** Full posting/categorization workspace — this is the primary target device.

**V. Role-Specific Workflows:** Daily posting — receive non-payment transaction (e.g. rent, payroll) → categorize → post to ledger → reflected in Cash Book/Bank Book.

**W. Interaction with Other Roles:** Executes day-to-day postings under Finance Manager's chart of accounts and policy; escalates any discrepancy touching customer repayments to Finance Manager (Accountant cannot resolve those directly).

**X. Customer Visibility:** None beyond a transaction reference where needed for bookkeeping — no customer-profile access.

**Y. Loan Visibility:** None beyond ledger-level balances needed for bookkeeping.

**Z. Payment/Transaction Visibility:** Read-only view of pipeline-posted transactions as they appear in the ledger; cannot create or edit them.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Ledger, journal entries, cash/bank book |
| Can Create | Non-payment journal entries |
| Can Edit | Own non-payment journal entries (before posting/lock) |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Ledger extracts, cash/bank book reports |
| Can Reverse | Nothing (Finance Manager's function) |
| Can Manage | Categorization of transactions |
| Cannot Access | Role/staff administration, branding, provider configuration, repayment-pipeline postings |
| Branches Accessible | Company-wide or Head-Office-scoped ledger, per company config |
| Workers Accessible | None |
| Customers Accessible | None beyond a transaction reference |
| Loans Accessible | Ledger-level balances only |
| Financial Info Accessible | Non-payment ledger/journal entries; pipeline entries read-only |

---

## ROLE 10 — ASSISTANT ACCOUNTANT

**A. Role Purpose:** Supports the Accountant with data entry and draft postings, under a dual-control model where the Accountant approves before anything is finalized.

**B. Scope:** Same as Accountant's — company-wide or Head Office-scoped financial records.

**C. Dashboard:** Identical bookkeeping-workspace framing to Accountant's.

**D. KPI Cards:** Identical to Accountant's: Today's Postings, Pending Categorization Items, Bank Book Balance vs. System Balance, Open Journal Entries — with an added "My Drafts Awaiting Approval" card.

**E. Charts:** Identical to Accountant's.

**F. Performance Information:** None by default, identical to Accountant's.

**G. Navigation/Sidebar:** Identical to Accountant's.

**H. Pages:** Identical page set to Accountant's; the journal entry form saves to a **draft** state rather than posting directly.

**I. Tables:** Identical to Accountant's, plus a "My Drafts" table (Date, Account, Amount, Status: Draft/Approved/Rejected).

**J. Filters:** Identical to Accountant's, plus Draft Status.

**K. Search:** Same as Accountant's.

**L. Actions:** Create/edit non-payment journal entries as **drafts**; categorize transactions; export ledger extracts. **Difference from Accountant:** no journal-entry **posting** rights — every entry requires Accountant approval before it becomes a posted, ledger-affecting entry.

**M. Permissions:** create/edit (draft journal entries), categorize (transactions), export (ledger extracts). No post permission.

**N. Restrictions:** Cannot post any journal entry directly; cannot access role/staff administration, branding, or provider configuration; cannot touch pipeline-posted transactions.

**O. Notifications:** Draft approved/rejected by Accountant, items needing categorization.

**P. Reports:** Same ledger extracts as Accountant, view/export.

**Q. Drill-down:** `Draft entry → source document → Accountant approval status`.

**R. Audit Visibility:** Own draft/edit history; broader ledger read-only.

**S. Mobile Behavior:** View-only.

**T. Tablet Behavior:** Usable for review and draft entry.

**U. Desktop Behavior:** Full draft-entry workspace.

**V. Role-Specific Workflows:** Draft a non-payment journal entry → submit → Accountant reviews and posts or rejects with reason → Assistant Accountant notified either way.

**W. Interaction with Other Roles:** Every draft routes to the Accountant for posting; escalates repayment-related discrepancies to Finance Manager via the Accountant.

**X. Customer Visibility:** None, identical to Accountant's.

**Y. Loan Visibility:** None beyond ledger-level balances, identical to Accountant's.

**Z. Payment/Transaction Visibility:** Read-only, identical to Accountant's.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Ledger, journal entries, cash/bank book, own drafts |
| Can Create | Draft non-payment journal entries |
| Can Edit | Own drafts (before Accountant approval) |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Ledger extracts |
| Can Reverse | Nothing |
| Can Manage | Draft categorization |
| Cannot Access | Journal-entry posting, role/staff administration, provider configuration |
| Branches Accessible | Same as Accountant's |
| Workers Accessible | None |
| Customers Accessible | None |
| Loans Accessible | None beyond ledger-level balances |
| Financial Info Accessible | Draft, unposted entries only; posted ledger read-only |

---

## ROLE 11 — CASH/BANK RECONCILIATION OFFICER

**A. Role Purpose:** Owns day-to-day resolution of the Reconciliation module's exception queues (Unallocated Payments, Unmatched Payments, Reversed Transactions, Incomplete Processing) — a narrower, execution-focused slice of Finance Manager's broader financial-integrity role.

**B. Scope:** Company-wide, but scoped strictly to the Reconciliation module (Part 1 §21 exception tables) — no chart-of-accounts, statement-generation, or provider-configuration access.

**C. Dashboard:** Reconciliation queue workspace.

**D. KPI Cards:** Open Unallocated Payments, Open Unmatched Payments, Reversed Transactions (MTD), Incomplete Processing Items, Average Resolution Time.

**E. Charts:** Exception volume trend by type, Resolution-time trend.

**F. Performance Information:** None — this role's KPIs are exception-resolution metrics, not collection/portfolio performance.

**G. Navigation/Sidebar:** Dashboard, Reconciliation Queue, Reports.

**H. Pages:** Unallocated Payments queue; Unmatched Payments queue; Reversed Transactions log; Incomplete Processing queue.

**I. Tables:** One table per exception type (Reference, Amount, Date Received, Age, Status, Assigned To).

**J. Filters:** Exception type, Age, Branch, Status.

**K. Search:** Transactions/exceptions by reference, date, or branch.

**L. Actions:** Resolve/allocate an Unallocated Payment Exception to the correct customer/loan; investigate and match an Unmatched Payment; review a Reversed Transaction's linked entries; flag an Incomplete Processing item for technical follow-up.

**M. Permissions:** resolve/allocate (reconciliation exceptions only). No permission to post accounting entries or configure the payment provider.

**N. Restrictions:** Cannot post accounting entries or configure provider settings — resolves reconciliation exceptions only; no staff/role administration; no loan approval.

**O. Notifications:** New exceptions of any type, exceptions aging past SLA.

**P. Reports:** Reconciliation exception reports, resolution-time reports.

**Q. Drill-down:** `Exception → source payment/webhook → customer → loan (if allocated)`.

**R. Audit Visibility:** Own resolution actions; broader reconciliation-module audit trail read-only.

**S. Mobile Behavior:** Exception alerts and quick lookups.

**T. Tablet Behavior:** Fully usable — the queues are list-based by nature.

**U. Desktop Behavior:** Full queue management across all four exception types simultaneously.

**V. Role-Specific Workflows:** Exception intake → identify likely customer/loan (for Unallocated) or likely transaction (for Unmatched) → resolve/allocate → audit entry recorded → queue count decrements.

**W. Interaction with Other Roles:** Escalates anything requiring an accounting-policy judgment call to Finance Manager; escalates technically-failed webhooks to IT/System Administrator; Internal Auditor reviews resolutions independently.

**X. Customer Visibility:** Customer identity as needed to resolve an allocation — not general profile browsing.

**Y. Loan Visibility:** Loan identity/balance as needed to resolve an allocation.

**Z. Payment/Transaction Visibility:** Full detail on exception-flagged payments/transactions only; routine successful payments are not part of this role's queue.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | The four reconciliation exception queues, company-wide |
| Can Create | Resolution/allocation records |
| Can Edit | Nothing outside the reconciliation module |
| Can Approve | Exception resolutions |
| Can Reject | N/A |
| Can Assign | Nothing role-related |
| Can Export | Reconciliation/resolution-time reports |
| Can Reverse | Nothing directly (views Reversed Transactions, does not initiate reversal) |
| Can Manage | Reconciliation queues only |
| Cannot Access | Chart of accounts, statement generation, provider configuration, staff/role administration |
| Branches Accessible | All (reconciliation scope only) |
| Workers Accessible | None |
| Customers Accessible | As needed for exception resolution |
| Loans Accessible | As needed for exception resolution |
| Financial Info Accessible | Exception-queue transactions only |

---

# CATEGORY: HR/ADMIN

## ROLE 12 — HR MANAGER

**A. Role Purpose:** Owns the staff lifecycle — hiring (worker creation), role assignment oversight, discipline/termination, HR record-keeping. As of SRS v2.1, also owns visibility into how the organization is performing at the branch/worker level, so people decisions can be made with performance context.

**B. Scope:** Company-wide staff data; company-wide read access to the Performance Visibility Layer (Part 1 §25-C); no edit access to financial/loan data.

**C. Dashboard:** **Two distinct workspaces**, per SRS v2.1 Change #2 (Part 2, Section 62-A): **(1) People & Workforce** — the existing HR-focused dashboard, unchanged; **(2) Organization Performance** — new, read-only.

**D. KPI Cards — People & Workforce (unchanged):** Total Headcount, New Hires (MTD), Pending Terminations/Suspensions, Role Assignments Expiring This Week, Branches Understaffed (vs. a configured minimum).
**KPI Cards — Organization Performance (new):** Company Collection Rate (today), Branches Below Target, Collection Officers with High Missed-Payment Rates, Branches with Staffing/Performance Problems.

**E. Charts — People & Workforce:** Headcount by branch/role, Hiring trend, Role-assignment-type breakdown (Permanent vs. Temporary).
**Charts — Organization Performance:** Branch collection-rate comparison, Collection Officer missed-payment-rate distribution.

**F. Performance Information [v2.1 NEW for this role]:** Full read-only access to: Company collection performance; Branch collection performance (expected vs. actual, outstanding, overdue/default, collection rate); Collection Officer performance; Worker performance by branch; Staff deployment/coverage by branch. This is company-wide HR scope, reusing the exact Performance Engine of Part 1 §25-B/C — HR does not get a separate calculation, only a read-only lens onto the same numbers everyone else sees. HR uses this to understand which branches are performing well or underperforming, which workers are performing well, which Collection Officers have high missed-payment rates, and which branches have staffing/performance problems.

**G. Navigation/Sidebar:** Dashboard (People & Workforce), Organization Performance, Staff Directory, Create Worker, Role Assignments, Reports, Audit Trail.

**H. Pages:** Full staff directory (all branches); Create Worker flow (Part 1 §12); individual staff profile (role history, assignment history, status); Role assignment management including temporary/acting assignments (Part 1 §17); suspension/termination actions; **Organization Performance workspace** — Company Performance panel, Branch Performance table, Worker Performance table, Collection Officer Performance view (all Part 1 §25-C, read-only).

**I. Tables:** Staff directory table; Role-assignment history table; Branch Performance table (Part 1 §25-C(B) column set, read-only); Worker Performance table (Part 1 §25-C(C) column set, read-only).

**J. Filters:** Branch, Role, Assignment Type, Status (staff side); Branch, Date range, Performance status (performance side).

**K. Search:** Staff by name, branch, role, Worker ID.

**L. Actions:** Create/suspend/terminate workers; assign/end/extend role assignments including temporary ones; issue temporary passwords; export staff reports. **On the Organization Performance side: view and export only** — no create/edit/approve action exists there.

**M. Permissions:** create/suspend/terminate (workers), assign/end (role assignments), issue (credentials), export (staff reports), **view-only** (all Organization Performance data).

**N. Restrictions:** No access to customer/loan/payment data beyond what the Performance Visibility Layer exposes in aggregate; **HR does not gain permission to edit loans, payments, accounting, or other financial records merely because performance data is now visible — performance information is strictly read-only for this role, as for every role**; no accounting access; branding/company-settings only if separately granted.

**O. Notifications:** New worker credential confirmations, role assignments expiring, termination/suspension confirmations, branch performance anomalies (new, tied to Organization Performance).

**P. Reports:** Staff roster, role-assignment history, headcount-by-branch reports, and (new) branch/Collection-Officer performance summary reports.

**Q. Drill-down:** People side — `Branch → staff list → individual profile → role-assignment history → related audit entries`. Performance side — `Branch → Branch Manager → Collection Officers → Customers → Groups → Loans → Repayment Schedules → Payments → Transactions → Audit Trail`, identical mechanism to every other Performance Visibility Layer consumer (Part 1 §25-C), always read-only for HR.

**R. Audit Visibility:** Full staff/role-administration audit trail; performance-related audit entries visible where they explain a staffing action; no financial-posting audit entries.

**S. Mobile Behavior:** Approvals/notifications and quick staff lookup; Organization Performance condenses to KPI cards only.

**T. Tablet Behavior:** Fully usable — both workspaces render as tablet-friendly forms/tables.

**U. Desktop Behavior:** Full staff directory and full Organization Performance workspace side by side in navigation.

**V. Role-Specific Workflows:** (1) Create Worker (Part 1 §12). (2) Temporary role assignment (Part 1 §17). (3) **New — performance-informed staffing review:** open Organization Performance → identify an underperforming branch or a Collection Officer with a high missed-payment rate → cross-reference against Staff Directory/coverage data → initiate a staffing action (reassignment request, disciplinary case, coverage fix) through the People & Workforce workspace. The performance data informs the decision; the actual staffing action is executed through HR's existing, unchanged tools.

**W. Interaction with Other Roles:** Coordinates with Head Office Administrator on worker creation where both roles are enabled; escalates performance-driven staffing concerns to Branch Manager/GM; never resolves a financial exception itself (that stays with Finance Manager/Reconciliation Officer) even when HR is the one who first notices a pattern via Organization Performance.

**X. Customer Visibility:** None directly — customer-level detail is not exposed on the Organization Performance workspace, only aggregated branch/worker figures.

**Y. Loan Visibility:** None directly — only aggregated branch/worker collection figures, no individual loan browsing.

**Z. Payment/Transaction Visibility:** None directly — only aggregated Expected/Actual/Outstanding/Overdue figures at branch and worker level; no individual payment/transaction records.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Staff records company-wide; branch/worker performance company-wide (read-only) |
| Can Create | Workers, role assignments |
| Can Edit | Staff records, role assignments |
| Can Approve | Nothing financial or loan-related |
| Can Reject | Nothing financial or loan-related |
| Can Assign | Role assignments, including temporary/acting |
| Can Export | Staff reports, performance summary reports |
| Can Reverse | Nothing |
| Can Manage | Worker lifecycle (create/suspend/terminate), credentials |
| Cannot Access | Loan editing, payment/accounting editing, individual customer/loan/payment records |
| Branches Accessible | All (staff data and performance data) |
| Workers Accessible | All |
| Customers Accessible | None (aggregate only) |
| Loans Accessible | None (aggregate only) |
| Financial Info Accessible | Aggregate branch/worker performance figures only, read-only |

---

## ROLE 13 — HR OFFICER

**A. Role Purpose:** Executes day-to-day HR administration under HR Manager's policy — worker creation, credential issuance, and routine record-keeping — without termination authority.

**B. Scope:** Company-wide or branch-scoped, per company configuration; same Organization Performance read access as HR Manager, scoped identically.

**C. Dashboard:** Identical two-workspace framing to HR Manager's (People & Workforce; Organization Performance).

**D. KPI Cards:** Identical to HR Manager's on both workspaces.

**E. Charts:** Identical to HR Manager's on both workspaces.

**F. Performance Information:** Identical read-only access to Company/Branch/Worker/Collection-Officer performance as HR Manager (Part 1 §25-C), scoped identically (company-wide or branch, per configuration).

**G. Navigation/Sidebar:** Identical to HR Manager's.

**H. Pages:** Identical page set to HR Manager's.

**I. Tables:** Identical to HR Manager's.

**J. Filters:** Identical to HR Manager's.

**K. Search:** Same as HR Manager's, scoped per configuration.

**L. Actions:** Create/suspend workers; assign/end role assignments; issue temporary passwords; export staff reports. **Difference from HR Manager:** no termination rights — terminations escalate to HR Manager for final action.

**M. Permissions:** create/suspend (workers), assign/end (role assignments), issue (credentials), export (staff reports), view-only (Organization Performance). No terminate permission.

**N. Restrictions:** No termination rights (suspend/create only); same read-only-performance restriction as HR Manager — no edit access to loans, payments, or accounting.

**O. Notifications:** Identical to HR Manager's, minus termination-specific confirmations (those go to HR Manager).

**P. Reports:** Identical to HR Manager's.

**Q. Drill-down:** Identical to HR Manager's, scoped per configuration.

**R. Audit Visibility:** Own actions plus the same staff/role-administration audit trail as HR Manager, scoped per configuration.

**S. Mobile Behavior:** Identical to HR Manager's.

**T. Tablet Behavior:** Identical to HR Manager's.

**U. Desktop Behavior:** Identical to HR Manager's, minus the terminate action.

**V. Role-Specific Workflows:** Same Create Worker and temporary-assignment workflows as HR Manager; a termination case is drafted here and routed to HR Manager for final execution.

**W. Interaction with Other Roles:** Reports to/escalates terminations to HR Manager; otherwise identical interaction pattern to HR Manager's.

**X. Customer Visibility:** None, identical to HR Manager's.

**Y. Loan Visibility:** None, identical to HR Manager's.

**Z. Payment/Transaction Visibility:** None, identical to HR Manager's.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Staff records; branch/worker performance (read-only), scoped per configuration |
| Can Create | Workers, role assignments |
| Can Edit | Staff records (non-termination) |
| Can Approve | Nothing financial or loan-related |
| Can Reject | Nothing financial or loan-related |
| Can Assign | Role assignments, including temporary/acting |
| Can Export | Staff reports, performance summary reports |
| Can Reverse | Nothing |
| Can Manage | Worker creation/suspension, credentials |
| Cannot Access | Worker termination (escalates to HR Manager), loan/payment/accounting editing |
| Branches Accessible | Company-wide or branch-scoped, per configuration |
| Workers Accessible | Same scope as branches |
| Customers Accessible | None |
| Loans Accessible | None |
| Financial Info Accessible | Aggregate performance figures only, read-only |

---

# CATEGORY: AUDIT/COMPLIANCE

## ROLE 14 — INTERNAL AUDITOR

**A. Role Purpose:** Independent verification that recorded activity matches actual activity; traces the full money-movement chain (Part 1 §25) for irregularities. As of SRS v2.1, also compares operational performance against the underlying financial/audit trail.

**B. Scope:** Company-wide, read-only across virtually everything, by design — an auditor who can also edit records is not independent. Now explicitly includes company-wide read access to the Performance Visibility Layer (Part 1 §25-C).

**C. Dashboard:** Trace/verification workspace, now including an **Operational Performance** panel alongside the existing audit-trail focus.

**D. KPI Cards:** Open Audit Findings, Reconciliation Exceptions Unresolved > 7 Days, Reversed Transactions (MTD), Role Assignments Changed (MTD), High-Value Approvals (MTD), **and (new)** Branches with Abnormal Performance, Workers/Collection Officers with Unusual Performance Patterns.

**E. Charts:** Exception trend by branch, Reversal frequency trend, Findings-by-severity breakdown, **and (new)** Branch performance-vs-audit-trail comparison chart.

**F. Performance Information [v2.1 NEW for this role]:** Full read-only visibility into: Company expected collection, Company actual collection, Company collection rate, Company outstanding collection, Company overdue/default amount, Expected savings, Actual savings, Branch performance comparison, Collection Officer performance, Worker performance, Customers expected vs. customers paid, Customers missed, Branches with abnormal performance, and Workers/Collection Officers with unusual performance patterns. **All of this is strictly read-only** — identical in kind to every other capability this role holds; performance visibility grants no edit, approve, reverse, or allocate right.

**G. Navigation/Sidebar:** Dashboard, Audit Trail (full), Findings, Operational Performance, Reconciliation (read-only), Reports.

**H. Pages:** Full audit trail explorer (filterable by user/branch/action/date/reference); Findings log; read-only reconciliation exception view; read-only ledger/accounting view; **Operational Performance workspace** — Company Performance panel, Branch Performance table, Worker/Collection Officer Performance tables (all read-only, Part 1 §25-C).

**I. Tables:** Audit trail table (User, Role Used, Company, Branch, Date/Time, Action, Previous/New Value, Reason, Transaction Reference, Device/IP); Findings table (Severity, Description, Linked Entries, Status); Branch Performance table (read-only); Worker Performance table (read-only).

**J. Filters:** User, Branch, Action, Date range, Reference, Severity, Performance status.

**K. Search:** Any user, branch, customer, loan, transaction, reference — company-wide.

**L. Actions:** Record a Finding (with severity, description, linked audit entries); mark a Finding resolved once evidence is provided; export audit extracts. **No create/edit/approve/delete rights on any operational record, and no edit/allocate right over any performance or financial figure** — recording a Finding is the only write action this role has anywhere in Nexora.

**M. Permissions:** view (unrestricted, read-only), record/resolve (Findings only), export (audit/findings/performance extracts).

**N. Restrictions:** Cannot approve loans, post accounting entries, create/suspend staff, or resolve payment exceptions (view-and-flag only, by design); cannot act on any performance figure it observes — abnormal branch or worker performance is flagged as a Finding and routed for someone else (Operations Manager, Finance Manager, HR Manager, GM) to act on.

**O. Notifications:** New reversed transactions, exceptions unresolved past SLA, high-value approvals, role-assignment changes at executive scope, **and (new)** branch performance anomalies, unusual worker/Collection Officer performance patterns.

**P. Reports:** Full audit trail exports, findings reports, reversal/exception summary reports, **and (new)** performance-vs-audit-trail comparison reports.

**Q. Drill-down [v2.1 EXPANDED]:** `Company → Branch → Worker → Collection Officer → Customer → Loan → Payment → Transaction → Ledger → Accounting → Audit Log`, in either direction — extending the v2.0 chain one hop further (Company and Worker were implicit; both are now explicit entry points) so the auditor can start from a performance anomaly and trace down to the specific ledger/audit entries that explain it, or start from an audit entry and trace up to see its effect on branch/worker performance.

**R. Audit Visibility:** Complete — this is the role's entire function.

**S. Mobile Behavior:** Findings/alerts only.

**T. Tablet Behavior:** Usable for review of audit trail and performance panels.

**U. Desktop Behavior:** Full trace workspace — deep trace work is desktop-primary.

**V. Role-Specific Workflows:** (1) Record a Finding — observe an anomaly (via audit trail or the new Operational Performance panel) → link supporting audit entries/performance data → set severity → record → routed to the accountable role. (2) **New — performance-vs-record comparison:** open Operational Performance → identify a branch/worker whose reported performance looks inconsistent with its audit trail (e.g. high Collection % but frequent reversed transactions) → drill down the extended chain → record a Finding if warranted.

**W. Interaction with Other Roles:** Findings are routed to the accountable role (Finance Manager for financial exceptions, HR Manager/Branch Manager for staffing/performance concerns, Operations Manager for process issues); reviews Finance Manager's and Cash/Bank Reconciliation Officer's exception resolutions independently; never resolves anything itself.

**X. Customer Visibility:** Full read-only, company-wide — needed to trace any audit chain to its end.

**Y. Loan Visibility:** Full read-only, company-wide, at every stage.

**Z. Payment/Transaction Visibility:** Full read-only, company-wide, including all exception states.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything, company-wide, read-only |
| Can Create | Findings only |
| Can Edit | Findings (own) only |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Audit, findings, and performance extracts |
| Can Reverse | Nothing |
| Can Manage | Findings log only |
| Cannot Access | Any create/edit/approve/reverse/allocate action on operational, financial, or performance data |
| Branches Accessible | All (read-only) |
| Workers Accessible | All (read-only) |
| Customers Accessible | All (read-only) |
| Loans Accessible | All (read-only) |
| Financial Info Accessible | All (read-only) |

---

## ROLE 15 — AUDIT OFFICER

**A. Role Purpose:** Executes Internal Auditor's read-only-plus-Findings function at a narrower, branch-assigned scope — the field-level counterpart to Internal Auditor's company-wide role.

**B. Scope:** Assigned branch(es) rather than company-wide.

**C. Dashboard:** Identical trace/verification and Operational Performance framing to Internal Auditor's, scoped to assigned branches.

**D. KPI Cards:** Identical to Internal Auditor's, computed only across assigned branches.

**E. Charts:** Identical to Internal Auditor's, scoped to assigned branches.

**F. Performance Information:** Identical read-only Performance Visibility Layer access to Internal Auditor's (Company/Branch/Worker/Collection Officer performance, customers expected/paid/missed, abnormal-performance flags), scoped to assigned branch(es) only rather than company-wide.

**G. Navigation/Sidebar:** Identical to Internal Auditor's.

**H. Pages:** Identical page set to Internal Auditor's, scoped to assigned branches.

**I. Tables:** Identical to Internal Auditor's, filtered to assigned branches.

**J. Filters:** Identical to Internal Auditor's, with Branch pre-filtered to assignment.

**K. Search:** Any user, customer, loan, transaction, reference — within assigned branch(es) only.

**L. Actions:** Record/resolve Findings, identical model to Internal Auditor's, scoped to assigned branches. Same universal no-write-elsewhere restriction.

**M. Permissions:** view (read-only, assigned branches), record/resolve (Findings, assigned branches), export (assigned-branch extracts).

**N. Restrictions:** Cannot see or act on branches outside assignment; same read-only-everywhere-else restriction as Internal Auditor.

**O. Notifications:** Same trigger set as Internal Auditor's, limited to assigned branches.

**P. Reports:** Same report types as Internal Auditor's, scoped to assigned branches.

**Q. Drill-down:** Identical extended chain to Internal Auditor's, scope-limited to assigned branches.

**R. Audit Visibility:** Complete for assigned branches only.

**S. Mobile Behavior:** Identical to Internal Auditor's.

**T. Tablet Behavior:** Identical to Internal Auditor's.

**U. Desktop Behavior:** Identical to Internal Auditor's, scope-limited.

**V. Role-Specific Workflows:** Identical Finding-recording and performance-vs-record comparison workflows to Internal Auditor's, scoped to assigned branches.

**W. Interaction with Other Roles:** Escalates cross-branch or systemic findings to Internal Auditor; otherwise identical routing pattern to Internal Auditor's, within assigned branches.

**X. Customer Visibility:** Full read-only, assigned branches only.

**Y. Loan Visibility:** Full read-only, assigned branches only.

**Z. Payment/Transaction Visibility:** Full read-only, assigned branches only.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything within assigned branch(es), read-only |
| Can Create | Findings only |
| Can Edit | Findings (own) only |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Audit/performance extracts, assigned branches |
| Can Reverse | Nothing |
| Can Manage | Findings log (assigned branches) |
| Cannot Access | Branches outside assignment; any write action beyond Findings |
| Branches Accessible | Assigned branch(es) only |
| Workers Accessible | Assigned branch(es) only |
| Customers Accessible | Assigned branch(es) only |
| Loans Accessible | Assigned branch(es) only |
| Financial Info Accessible | Assigned branch(es) only, read-only |

---

## ROLE 16 — COMPLIANCE OFFICER

**A. Role Purpose:** Ensures the company's operations follow regulatory and internal policy requirements (KYC completeness, loan-product policy adherence, data-handling rules) — forward-looking/preventive, distinct from Internal Auditor's backward-looking/verifying transaction-tracing focus.

**B. Scope:** Company-wide, read access to customer/loan/staff records; write access limited to compliance flags and case records.

**C. Dashboard:** Compliance workspace.

**D. KPI Cards:** Customers with Incomplete KYC, Loans Disbursed Without Full Documentation (should be zero — a control indicator), Open Compliance Cases, Policy Exceptions (MTD).

**E. Charts:** KYC completeness by branch, Compliance case volume trend.

**F. Performance Information:** No dedicated Performance Visibility Layer access by default — Compliance Officer's KPIs are policy-adherence indicators, not collection performance. Read-only access to branch KYC-completeness figures only, which are a compliance metric, not part of the Part 1 §25-C performance set.

**G. Navigation/Sidebar:** Dashboard, KYC/Documentation, Compliance Cases, Policy Configuration (view), Reports.

**H. Pages:** Customer KYC-completeness list; Compliance case log; Policy reference pages (loan-product rules, documentation requirements).

**I. Tables:** KYC completeness table (Customer, Branch, Missing Items, Status); Compliance case table (Case ID, Subject, Severity, Status, Opened Date).

**J. Filters:** Branch, KYC status, Case severity, Case status.

**K. Search:** Customers, loans, staff by compliance-case status.

**L. Actions:** Open/close compliance cases; flag a customer/loan record for review (visible to Branch Manager/Credit Manager; does not itself block the loan unless the company's approval chain includes a compliance stage, Part 1 §23); export compliance reports.

**M. Permissions:** open/close (compliance cases), flag (customer/loan records), export (compliance reports).

**N. Restrictions:** No loan approval, disbursement, or financial-posting rights; cannot edit customer/loan data directly, only annotate/flag it.

**O. Notifications:** New incomplete-KYC customers, loans nearing disbursement without complete documentation, new compliance cases assigned.

**P. Reports:** KYC completeness reports, compliance case reports.

**Q. Drill-down:** `Case → customer/loan record → related documents → branch`.

**R. Audit Visibility:** Compliance-related audit entries company-wide; broader financial audit read-only.

**S. Mobile Behavior:** Case alerts.

**T. Tablet Behavior:** Fully usable for case review.

**U. Desktop Behavior:** Full KYC list and case log with filtering.

**V. Role-Specific Workflows:** Open a compliance case against a customer/loan/staff record → describe and set severity → flag becomes visible to the accountable role → close once resolved.

**W. Interaction with Other Roles:** Flags surface to Branch Manager/Credit Manager; escalates systemic policy issues to GM/MD; distinct from, and does not duplicate, Internal Auditor's transaction-tracing function.

**X. Customer Visibility:** Read access to customer records company-wide, focused on KYC/documentation completeness fields.

**Y. Loan Visibility:** Read access to loan documentation-completeness status company-wide; not full financial detail.

**Z. Payment/Transaction Visibility:** None — payment/transaction detail is outside this role's function.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Customer/loan KYC and documentation status, company-wide |
| Can Create | Compliance cases |
| Can Edit | Compliance case records (not the underlying customer/loan record) |
| Can Approve | Nothing (a compliance flag informs, does not itself gate, unless chain-configured) |
| Can Reject | Nothing |
| Can Assign | Nothing role-related |
| Can Export | KYC/compliance reports |
| Can Reverse | Nothing |
| Can Manage | Compliance case log |
| Cannot Access | Loan approval/disbursement, financial postings, direct customer/loan data editing |
| Branches Accessible | All (KYC/compliance scope) |
| Workers Accessible | None directly (only via a staff-related compliance case) |
| Customers Accessible | All, KYC/documentation fields |
| Loans Accessible | All, documentation-completeness status only |
| Financial Info Accessible | None |

---

## ROLE 17 — RISK OFFICER

**A. Role Purpose:** Company-wide portfolio-risk monitoring — concentration risk, PAR trend, and risk-policy adherence — the risk-focused counterpart to Compliance Officer's KYC/documentation focus.

**B. Scope:** Company-wide, portfolio-risk focus.

**C. Dashboard:** Identical compliance-workspace framing to Compliance Officer's, with the emphasis shifted to PAR/concentration risk over KYC completeness.

**D. KPI Cards:** Portfolio at Risk (PAR 30/60/90), Concentration Risk (top-N customer/branch exposure), Open Risk Cases, Policy Exceptions (MTD).

**E. Charts:** PAR trend by branch, Concentration-risk breakdown, Risk case volume trend.

**F. Performance Information:** Read-only access to Branch Performance table figures that feed risk indicators (Outstanding, Overdue/Default, Collection Rate) — a risk lens on the same Part 1 §25-C data Compliance Officer and other roles see, not a separate calculation.

**G. Navigation/Sidebar:** Dashboard, Risk Cases, Portfolio Risk, Policy Configuration (view), Reports.

**H. Pages:** Portfolio risk explorer (PAR by branch/product); Risk case log; Policy reference pages.

**I. Tables:** Risk case table (identical shape to Compliance Officer's case-flagging model); Branch risk table (Branch, PAR 30/60/90, Overdue Amount, Concentration Exposure).

**J. Filters:** Branch, Risk severity, PAR bucket, Case status.

**K. Search:** Customers, loans, branches by risk-case status or PAR bucket.

**L. Actions:** Open/close risk cases; flag a customer/loan/branch for risk review; export risk reports — same case-flagging permission model as Compliance Officer.

**M. Permissions:** open/close (risk cases), flag (customer/loan/branch records), export (risk reports).

**N. Restrictions:** No loan approval, disbursement, or financial-posting rights; cannot edit customer/loan data directly, only annotate/flag it — identical restriction pattern to Compliance Officer.

**O. Notifications:** PAR threshold breaches, new risk cases assigned, concentration-risk threshold breaches.

**P. Reports:** Portfolio risk reports, concentration-risk reports.

**Q. Drill-down:** `Risk case → customer/loan record → branch → PAR contribution`.

**R. Audit Visibility:** Risk-related audit entries company-wide; broader financial audit read-only.

**S. Mobile Behavior:** Risk-alert notifications only.

**T. Tablet Behavior:** Fully usable for case review.

**U. Desktop Behavior:** Full portfolio risk explorer with filtering.

**V. Role-Specific Workflows:** Identical case-opening/closing workflow to Compliance Officer's, applied to risk rather than KYC subject matter.

**W. Interaction with Other Roles:** Flags surface to Credit Manager/GM; distinct from Compliance Officer (policy/KYC) and Internal Auditor (transaction tracing) — three independent, non-overlapping oversight lenses.

**X. Customer Visibility:** Read access to customer records company-wide, focused on risk-relevant fields (exposure, repayment history pattern).

**Y. Loan Visibility:** Read access to loan risk classification (PAR bucket) company-wide.

**Z. Payment/Transaction Visibility:** Aggregate Outstanding/Overdue figures only; not individual transaction detail.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Portfolio risk data, company-wide |
| Can Create | Risk cases |
| Can Edit | Risk case records (not underlying customer/loan record) |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing role-related |
| Can Export | Risk/PAR reports |
| Can Reverse | Nothing |
| Can Manage | Risk case log |
| Cannot Access | Loan approval/disbursement, financial postings, direct customer/loan data editing |
| Branches Accessible | All (risk scope) |
| Workers Accessible | None directly |
| Customers Accessible | All, risk-relevant fields |
| Loans Accessible | All, PAR/risk classification |
| Financial Info Accessible | Aggregate Outstanding/Overdue figures only |

---

# CATEGORY: CREDIT/LOANS

## ROLE 18 — CREDIT MANAGER

**A. Role Purpose:** Owns credit-risk decisions — final or near-final loan approval authority within the company's configured approval chain (Part 1 §23), and portfolio risk oversight from a credit-decision (not compliance or audit) perspective.

**B. Scope:** Company-wide loan/credit data.

**C. Dashboard:** Credit-risk workspace.

**D. KPI Cards:** Applications Pending My Approval, Portfolio at Risk (PAR 30/60/90), Approval Turnaround Time (avg), Approved-vs-Rejected Ratio (MTD), Loans Disbursed (MTD).

**E. Charts:** PAR trend, Applications funnel by stage, Approval-rate-by-branch comparison.

**F. Performance Information:** Read-only access to Branch Performance table figures relevant to credit decisions (PAR, Overdue/Default, Collection Rate by branch) — used to inform approval-chain and loan-product policy, not a general-purpose performance dashboard.

**G. Navigation/Sidebar:** Dashboard, Approval Queue, Loan Products, Credit Policy, Portfolio, Reports.

**H. Pages:** Approval queue (items at Credit Manager's chain stage); individual application review page (documents, credit assessment, applicant history); loan product configuration; portfolio risk explorer.

**I. Tables:** Approval queue table (Applicant, Product, Amount, Branch, Days at Stage); Portfolio risk table (Branch/Product, PAR 30/60/90).

**J. Filters:** Branch, Product, Status, Date range.

**K. Search:** Applications, customers, loans, by status/branch/product.

**L. Actions:** Approve/reject applications at their chain stage (mandatory reason for rejection); configure loan products and approval chains; escalate an application to the next stage manually if policy allows.

**M. Permissions:** approve/reject (Credit Manager's chain stage), configure (loan products, approval chains), escalate (applications).

**N. Restrictions:** Cannot disburse directly unless the chain assigns that final step to this role; cannot alter a customer's virtual account or payment records.

**O. Notifications:** New applications reaching their stage, PAR threshold breaches, applications aging past SLA.

**P. Reports:** Credit/portfolio risk reports, approval turnaround reports.

**Q. Drill-down:** `Application → applicant profile → branch → assigned Collection/Loan Officer`.

**R. Audit Visibility:** Credit-decision audit entries company-wide (approvals, rejections, escalations); broader audit trail read-only.

**S. Mobile Behavior:** Approval queue and PAR alerts.

**T. Tablet Behavior:** Fully usable for application review.

**U. Desktop Behavior:** Full document-heavy application review workspace.

**V. Role-Specific Workflows:** Review application at Credit Manager's chain stage (documents, credit assessment, applicant history) → approve/reject with reason, or escalate manually if policy allows → loan moves to next configured stage.

**W. Interaction with Other Roles:** Receives applications from Loan Officer/Credit Officer at Credit Manager's stage; forwards to GM/MD for final-stage approval if the chain requires it; Credit Officer reviews and recommends but cannot hold the final stage this role can.

**X. Customer Visibility:** Full applicant profile as needed for credit assessment, company-wide.

**Y. Loan Visibility:** Full, company-wide, at every stage of the credit workflow.

**Z. Payment/Transaction Visibility:** None directly — payment/transaction detail belongs to Finance/Reconciliation roles; Credit Manager sees portfolio-level Outstanding/Overdue aggregates only.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Applications, credit/portfolio data, company-wide |
| Can Create | Loan products, approval chains |
| Can Edit | Loan product configuration |
| Can Approve | Applications at Credit Manager's chain stage |
| Can Reject | Applications at Credit Manager's chain stage (reason required) |
| Can Assign | Nothing role-related |
| Can Export | Credit/portfolio risk reports |
| Can Reverse | Nothing |
| Can Manage | Approval queue, loan product/chain configuration |
| Cannot Access | Virtual account/payment record editing; disbursement (unless chain-assigned) |
| Branches Accessible | All (credit/loan scope) |
| Workers Accessible | Read visibility into Loan/Credit Officers as needed for application routing |
| Customers Accessible | All, applicant/credit-assessment detail |
| Loans Accessible | All, company-wide |
| Financial Info Accessible | Portfolio-level aggregates (PAR, Outstanding, Overdue) only |

---

## ROLE 19 — CREDIT OFFICER

**A. Role Purpose:** Reviews and recommends on loan applications within the credit-assessment stage of the approval chain — the review-and-recommend counterpart to Credit Manager's decision authority.

**B. Scope:** Assigned branch(es) or application set.

**C. Dashboard:** Identical credit-risk workspace framing to Credit Manager's, scoped to assigned applications.

**D. KPI Cards:** Applications Pending My Review, Approval Turnaround Time (avg, own), Recommended-vs-Overturned Ratio (MTD), PAR (assigned branch(es)).

**E. Charts:** Applications funnel by stage (own assigned set), Recommendation-outcome trend.

**F. Performance Information:** Read-only Branch Performance figures for assigned branch(es) only — same informational purpose as Credit Manager's, narrower scope.

**G. Navigation/Sidebar:** Dashboard, Review Queue, Loan Products (view), Reports.

**H. Pages:** Review queue (applications at Credit Officer's stage, assigned branch(es)); individual application review page (documents, credit assessment, applicant history).

**I. Tables:** Review queue table, identical column set to Credit Manager's Approval queue, filtered to assignment.

**J. Filters:** Branch (within assignment), Product, Status, Date range.

**K. Search:** Applications, customers, loans — within assigned branch(es)/application set only.

**L. Actions:** Review applications and record a recommendation (approve-recommend / reject-recommend, with supporting notes); escalate to Credit Manager's queue. **Difference from Credit Manager:** reviews and recommends only — cannot hold the *final* approval-chain stage.

**M. Permissions:** review (assigned applications), recommend (approve/reject recommendation), escalate (to Credit Manager).

**N. Restrictions:** Cannot make a binding approval/rejection decision — every recommendation is subject to Credit Manager's (or the chain's next-stage role's) actual decision; cannot disburse; cannot alter virtual account/payment records.

**O. Notifications:** New applications reaching review, applications aging past SLA (own assigned set).

**P. Reports:** Personal review/recommendation report, submission history.

**Q. Drill-down:** `Application → applicant profile → branch → assigned Collection/Loan Officer`, scope-limited.

**R. Audit Visibility:** Own review/recommendation actions; broader credit-decision audit trail read-only within assignment.

**S. Mobile Behavior:** Review queue and SLA alerts.

**T. Tablet Behavior:** Fully usable for document-based review.

**U. Desktop Behavior:** Full application review workspace, scope-limited.

**V. Role-Specific Workflows:** Review application (documents, credit assessment, applicant history) → record recommendation with notes → forward to Credit Manager's queue.

**W. Interaction with Other Roles:** Receives applications from Loan Officer; forwards recommendations to Credit Manager; recommendations can be accepted or overturned by Credit Manager without further Credit Officer action required.

**X. Customer Visibility:** Applicant profile as needed for review, within assigned branch(es)/application set.

**Y. Loan Visibility:** Within assigned branch(es)/application set, at the review stage.

**Z. Payment/Transaction Visibility:** None.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Applications within assignment |
| Can Create | Recommendation records |
| Can Edit | Own recommendation notes (before forwarding) |
| Can Approve | Nothing binding (recommendation only) |
| Can Reject | Nothing binding (recommendation only) |
| Can Assign | Nothing |
| Can Export | Personal review/recommendation reports |
| Can Reverse | Nothing |
| Can Manage | Own review queue |
| Cannot Access | Final approval-chain stage, disbursement, virtual account/payment editing |
| Branches Accessible | Assigned branch(es)/application set only |
| Workers Accessible | None |
| Customers Accessible | Assigned applicant set only |
| Loans Accessible | Assigned application set only |
| Financial Info Accessible | None |

---

## ROLE 20 — LOAN OFFICER

**A. Role Purpose:** Originates loan applications in the field or branch — intake, document collection, and initial submission — the origination counterpart to Credit roles' decision function.

**B. Scope:** Assigned branch, or assigned customer/application set.

**C. Dashboard:** Origination/pipeline workspace — own submitted applications and their stage progress.

**D. KPI Cards:** My Applications Submitted (MTD), Applications Pending Document Collection, Applications Approved (MTD), Applications Rejected (MTD).

**E. Charts:** Personal submission volume trend, Applications-by-stage funnel (own pipeline).

**F. Performance Information:** None — Loan Officer's KPIs are origination-volume and pipeline-status indicators, not part of the collection-focused Performance Visibility Layer.

**G. Navigation/Sidebar:** Dashboard, My Applications, Customers, Document Collection, Reports, Search.

**H. Pages:** New application intake form; document checklist per application; personal pipeline view (applications by stage); applicant profile (own assigned customers).

**I. Tables:** Personal applications table (Applicant, Product, Amount, Stage, Days at Stage, Documents Complete Y/N).

**J. Filters:** Stage, Product, Document-completeness status.

**K. Search:** Own applications and assigned customers.

**L. Actions:** Create a new loan application; upload/collect required documents; submit an application into the approval chain; initiate a new loan application on behalf of an assigned customer.

**M. Permissions:** create (applications), upload (documents), submit (to approval chain).

**N. Restrictions:** No approval authority at any stage; cannot disburse; cannot alter payment/virtual account records; no manual repayment-entry function.

**O. Notifications:** Document checklist incomplete reminders, application status changes (approved/rejected/returned).

**P. Reports:** Personal pipeline report, submission history.

**Q. Drill-down:** `Application → applicant profile → document checklist`.

**R. Audit Visibility:** Own actions only.

**S. Mobile Behavior:** Field-friendly — full document capture and application intake designed for phone use.

**T. Tablet Behavior:** Full parity with mobile, larger document-review surface.

**U. Desktop Behavior:** Full parity for office-based processing.

**V. Role-Specific Workflows:** Intake — capture applicant details and product → collect required documents → submit for review → track through Credit Officer/Credit Manager stages via personal pipeline view.

**W. Interaction with Other Roles:** Submits to Credit Officer/Credit Manager for review and decision; coordinates with Branch Manager on branch-level application volume; no overlap with Credit roles' approval authority — Loan Officer originates, Credit roles decide.

**X. Customer Visibility:** Own assigned/originated customers only.

**Y. Loan Visibility:** Own originated applications only, through to decision.

**Z. Payment/Transaction Visibility:** None.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own applications and assigned customers |
| Can Create | Loan applications |
| Can Edit | Own applications (before submission/lock) |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Personal pipeline/submission reports |
| Can Reverse | Nothing |
| Can Manage | Document collection for own applications |
| Cannot Access | Approval authority at any stage, disbursement, payment/virtual account records |
| Branches Accessible | Assigned branch only |
| Workers Accessible | None |
| Customers Accessible | Own assigned/originated customers only |
| Loans Accessible | Own originated applications only |
| Financial Info Accessible | None |

---

# CATEGORY: CUSTOMER/ACCOUNTS

## ROLE 21 — ACCOUNT OFFICER

**A. Role Purpose:** Manages an assigned customer relationship set with a relationship-management framing — an origination-and-servicing role adjacent to Loan Officer, with added cross-sell/relationship notes.

**B. Scope:** Assigned branch, relationship-managed customer set.

**C. Dashboard:** Relationship/pipeline workspace — similar shape to Loan Officer's, with a relationship-notes panel added.

**D. KPI Cards:** My Applications Submitted (MTD), Applications Pending Document Collection, Active Relationships (assigned customers), Cross-Sell Opportunities Flagged.

**E. Charts:** Personal submission volume trend, Applications-by-stage funnel (own pipeline).

**F. Performance Information:** None — identical to Loan Officer, this role's KPIs are relationship/origination indicators, not collection performance.

**G. Navigation/Sidebar:** Dashboard, My Customers, My Applications, Document Collection, Reports, Search.

**H. Pages:** New application intake form; document checklist per application; personal pipeline view; customer relationship profile (application/loan history plus relationship notes).

**I. Tables:** Personal applications table, identical shape to Loan Officer's; Relationship notes table (Customer, Note, Date, Flagged Opportunity Y/N).

**J. Filters:** Stage, Product, Document-completeness status.

**K. Search:** Own assigned customers and applications.

**L. Actions:** Create a new loan application; upload/collect required documents; submit an application into the approval chain; add relationship/cross-sell notes to a customer profile.

**M. Permissions:** create (applications), upload (documents), submit (to approval chain), annotate (relationship notes).

**N. Restrictions:** No approval authority at any stage; cannot disburse; cannot alter payment/virtual account records; no manual repayment-entry function — identical restriction set to Loan Officer.

**O. Notifications:** Document checklist incomplete reminders, application status changes.

**P. Reports:** Personal pipeline report, relationship-notes summary.

**Q. Drill-down:** `Application → applicant profile → document checklist → relationship notes`.

**R. Audit Visibility:** Own actions only.

**S. Mobile Behavior:** Field-friendly, identical to Loan Officer's.

**T. Tablet Behavior:** Identical to Loan Officer's.

**U. Desktop Behavior:** Identical to Loan Officer's, plus the relationship-notes panel.

**V. Role-Specific Workflows:** Identical intake/document-collection/submission flow to Loan Officer's, with an added relationship-note capture step at any customer touchpoint.

**W. Interaction with Other Roles:** Same submission relationship to Credit Officer/Credit Manager as Loan Officer's; relationship notes are visible to Branch Manager/Customer Service Officer for continuity of customer context.

**X. Customer Visibility:** Own assigned/relationship-managed customers only.

**Y. Loan Visibility:** Own originated applications only, through to decision.

**Z. Payment/Transaction Visibility:** None.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own applications, assigned customers, relationship notes |
| Can Create | Loan applications, relationship notes |
| Can Edit | Own applications (before submission/lock), own notes |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Personal pipeline/relationship reports |
| Can Reverse | Nothing |
| Can Manage | Document collection, relationship notes for own customers |
| Cannot Access | Approval authority at any stage, disbursement, payment/virtual account records |
| Branches Accessible | Assigned branch only |
| Workers Accessible | None |
| Customers Accessible | Own assigned/relationship-managed customers only |
| Loans Accessible | Own originated applications only |
| Financial Info Accessible | None |

---

## ROLE 22 — FIELD ACCOUNT OFFICER

**A. Role Purpose:** Field-facing role managing an assigned set of savings-focused customers/groups — the savings/account counterpart to Collection Officer's loan-collection focus.

**B. Scope:** Assigned customers/groups within one branch, savings-product focus.

**C. Dashboard:** Operational and simple, mobile-first, identical framing to Collection Officer's, with savings targets as the organizing metric instead of loan-collection targets.

**D. KPI Cards — "Today" section:** Expected Savings Contribution, Actual Savings Collected, Outstanding Savings, Customers Contributed, Customers Missed, Active Savings Accounts (all figures sourced from verified electronic transactions only, Part 1 §21).

**E. Charts:** Minimal by design — today-vs-target progress bar and a 7-day personal savings-collection trend.

**F. Performance Information:** Own personal savings-performance figures only (Expected/Actual/Outstanding for savings, Customers Contributed/Missed) — the savings-focused equivalent of a Collection Officer's own performance view (Part 1 §25-C), scoped identically (no visibility into other workers, branches, or company-wide figures unless a separate active role assignment grants it).

**G. Navigation/Sidebar:** My Customers, My Groups, Savings Schedule, Digital Collection Ledger, Notifications, Search.

**H. Pages:** Customer Profiles (own assigned customers only); Virtual Accounts (view only, Part 1 §22); Savings Schedule (own assigned customers/groups); Contribution History; Digital Collection Ledger (read).

**I. Tables:** My Customers table (Customer Name, Group, Virtual Account status, Expected Contribution, Last Contribution Date, Status); Contribution History table (Date, Customer, Amount, Virtual Account reference, Pipeline status).

**J. Filters:** Group, Contribution status (paid/missed/upcoming), Date range — all scoped to own assigned customers/groups only.

**K. Search:** Own assigned customers/groups only.

**L. Actions:** View customer/group profiles and virtual account details (to share with customers so they can pay); mark a customer as visited/followed-up (an activity note, never a payment record); view savings schedules and digital ledger. **There is no “Record Payment,” “Collect Cash,” or manual contribution-entry action anywhere in this role's UI — explicitly absent by design, not merely unused**, identical to Collection Officer's constraint.

**M. Permissions:** view (own assigned customers/groups, own performance), create (activity/visit notes), export (personal savings-performance report).

**N. Restrictions:** Cannot edit savings balances, cannot edit loan balances, cannot delete financial records, cannot approve loans; no manual contribution-entry action exists for this role.

**O. Notifications:** Customer savings contribution received (real-time, from the pipeline), customer missed expected contribution, group contribution-day reminders.

**P. Reports:** Personal savings-collection performance report, missed-contribution list.

**Q. Drill-down:** `Customer → their savings account(s) → contribution history (read) → digital ledger entries`.

**R. Audit Visibility:** Own actions only (profile views logged minimally; activity notes logged fully).

**S. Mobile Behavior:** Mobile-first — every action works one-handed on a small screen, identical priority to Collection Officer's.

**T. Tablet Behavior:** Convenience view, not the primary target — identical pattern to Collection Officer's.

**U. Desktop Behavior:** Fully usable but not the primary target device — same field-first design intent as Collection Officer's.

**V. Role-Specific Workflows:** Field visit → view customer's virtual account details to share for a transfer → mark visited/followed-up → return later to confirm contribution via the pipeline-fed dashboard (never entered manually).

**W. Interaction with Other Roles:** Reports into Branch Manager exactly as a Collection Officer does; savings-side counterpart that can coexist with a Collection Officer covering the same customer's loan side.

**X. Customer Visibility:** Own assigned customers/groups only.

**Y. Loan Visibility:** None directly — this role's focus is savings; any loan a shared customer holds is visible only to whichever role (e.g. a Collection Officer) is assigned to that side.

**Z. Payment/Transaction Visibility:** Own assigned customers' savings contributions only, read-only.


**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own assigned customers/groups, own savings performance |
| Can Create | Activity/visit notes |
| Can Edit | Nothing financial |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Personal savings-performance report |
| Can Reverse | Nothing |
| Can Manage | Visit/follow-up notes for own customers |
| Cannot Access | Any manual payment/contribution-entry function (does not exist); other officers'/branches'/company performance |
| Branches Accessible | Own assigned branch only |
| Workers Accessible | None |
| Customers Accessible | Own assigned customers/groups only |
| Loans Accessible | None |
| Financial Info Accessible | Own assigned customers' savings figures only |

---

## ROLE 23 — CUSTOMER SERVICE OFFICER

**A. Role Purpose:** Front-line customer support — inquiries, profile updates, issue resolution, non-financial account servicing.

**B. Scope:** Assigned branch (or company-wide for a Head Office-based CSO).

**C. Dashboard:** Support workspace.

**D. KPI Cards:** Open Tickets/Inquiries, Tickets Resolved Today, Average Resolution Time, Customers Awaiting Callback.

**E. Charts:** Ticket volume trend, Resolution-time trend.

**F. Performance Information:** None — this role's KPIs are ticket/service indicators, not collection performance.

**G. Navigation/Sidebar:** Dashboard, Customers, Inquiries/Tickets, Notifications, Search.

**H. Pages:** Customer lookup/profile (contact + loan/savings summary, read-mostly); inquiry log and case notes; profile-update request form (routed to an authorized role for actual data changes where policy requires dual control).

**I. Tables:** Ticket table (Customer, Subject, Status, Assigned Date, Resolution Date).

**J. Filters:** Status, Date range, Branch (if company-wide scope).

**K. Search:** Customers by name/phone/account/branch.

**L. Actions:** Log and resolve inquiries; update non-sensitive customer contact details directly (phone, address); request sensitive changes (e.g. linked virtual account details) for authorized approval rather than editing directly.

**M. Permissions:** log/resolve (inquiries), edit (non-sensitive contact details), request (sensitive-change approval).

**N. Restrictions:** No loan approval, no payment/ledger edit rights, no role administration; **no manual repayment/cash-entry function.**

**O. Notifications:** New inquiry assigned, escalated tickets, customer-initiated requests.

**P. Reports:** Ticket volume and resolution reports.

**Q. Drill-down:** `Customer → loan/savings summary (read) → payment history (read)`.

**R. Audit Visibility:** Own actions (profile edits, ticket resolutions) only.

**S. Mobile Behavior:** Mobile-friendly for quick lookups.

**T. Tablet Behavior:** Fully usable.

**U. Desktop Behavior:** Preferred for case-note-heavy work.

**V. Role-Specific Workflows:** Receive inquiry → log ticket → resolve directly (non-sensitive) or route a sensitive-change request to the authorized role → close ticket.

**W. Interaction with Other Roles:** Routes sensitive changes to Branch Manager/Head Office Administrator; escalates to Customer Service Manager if unresolved past SLA.

**X. Customer Visibility:** Contact details plus a read-mostly loan/savings summary, within scope (branch or company-wide per assignment).

**Y. Loan Visibility:** Summary-level (balance, status) only — not full application/credit-assessment detail.

**Z. Payment/Transaction Visibility:** Read-only payment history, summary level, within scope.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Customer contact/loan/savings summary, within scope |
| Can Create | Tickets, non-sensitive-change edits, sensitive-change requests |
| Can Edit | Non-sensitive customer contact details directly |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Ticket/resolution reports |
| Can Reverse | Nothing |
| Can Manage | Own ticket queue |
| Cannot Access | Loan approval, payment/ledger editing, role administration, sensitive-field direct editing |
| Branches Accessible | Assigned branch, or company-wide if Head Office-based |
| Workers Accessible | None |
| Customers Accessible | Within scope, contact + summary detail |
| Loans Accessible | Summary level only, within scope |
| Financial Info Accessible | Read-only payment history, summary level |

---

## ROLE 24 — CUSTOMER SERVICE MANAGER

**A. Role Purpose:** Supervises Customer Service Officers — ticket escalation, workload distribution, and service-quality review — the supervisory counterpart to CSO's front-line function.

**B. Scope:** Branch or company-wide, per assignment.

**C. Dashboard:** Identical support-workspace framing to CSO's, with a team-oversight panel added.

**D. KPI Cards:** Identical to CSO's (Open Tickets, Tickets Resolved Today, Average Resolution Time, Customers Awaiting Callback), plus Team Resolution Rate and Escalated Tickets Open.

**E. Charts:** Identical to CSO's, plus a CSO-performance comparison chart (ticket volume/resolution time per officer).

**F. Performance Information:** None from the collection-focused Performance Visibility Layer — this role's "performance" view is service-quality (ticket resolution), not the Part 1 §25-C engine; a CSO-performance-review table is a service-metrics table, not a Worker Performance table under §25-C.

**G. Navigation/Sidebar:** Identical to CSO's, plus Team Overview.

**H. Pages:** Identical page set to CSO's, plus a Team Overview page (ticket load and resolution rate per CSO).

**I. Tables:** Identical ticket table to CSO's, plus a Team Overview table (CSO, Open Tickets, Resolved Today, Avg Resolution Time).

**J. Filters:** Identical to CSO's, plus CSO/agent filter.

**K. Search:** Same as CSO's, plus ability to search across the team's tickets.

**L. Actions:** All CSO actions, plus reassign a ticket between CSOs and conduct a CSO performance review. **Difference from CSO:** adds ticket-reassignment and CSO-performance-review permissions.

**M. Permissions:** All CSO permissions, plus reassign (tickets), review (CSO service performance).

**N. Restrictions:** Same restriction set as CSO's — no loan approval, no payment/ledger edit rights, no role administration, no manual repayment/cash-entry function.

**O. Notifications:** All CSO notification triggers, plus tickets escalated by a CSO, team SLA breaches.

**P. Reports:** Ticket volume and resolution reports (own + team), CSO performance-review reports.

**Q. Drill-down:** `Team → individual CSO → their tickets → customer → loan/savings summary (read)`.

**R. Audit Visibility:** Own actions plus visibility into the team's ticket-resolution audit entries.

**S. Mobile Behavior:** Mobile-friendly for quick lookups and escalation triage.

**T. Tablet Behavior:** Fully usable.

**U. Desktop Behavior:** Preferred for team-oversight and case-note-heavy work.

**V. Role-Specific Workflows:** Monitor Team Overview → identify an overloaded/underperforming CSO → reassign tickets or flag for review → conduct periodic CSO performance review.

**W. Interaction with Other Roles:** Receives escalations from CSOs; routes sensitive-change requests onward exactly as a CSO would; reports team service-quality trends to Branch Manager/Operations Manager.

**X. Customer Visibility:** Identical to CSO's, across the whole team's assigned customers.

**Y. Loan Visibility:** Identical to CSO's — summary level.

**Z. Payment/Transaction Visibility:** Identical to CSO's — read-only, summary level.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Team ticket load, customer contact/loan/savings summary, within scope |
| Can Create | Tickets, non-sensitive-change edits, sensitive-change requests, CSO reviews |
| Can Edit | Non-sensitive customer contact details, ticket assignments |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Tickets between CSOs |
| Can Export | Ticket/resolution/CSO-performance reports |
| Can Reverse | Nothing |
| Can Manage | Team ticket queue, CSO performance reviews |
| Cannot Access | Loan approval, payment/ledger editing, role administration, sensitive-field direct editing |
| Branches Accessible | Branch or company-wide, per assignment |
| Workers Accessible | CSOs within scope |
| Customers Accessible | Within scope, contact + summary detail |
| Loans Accessible | Summary level only, within scope |
| Financial Info Accessible | Read-only payment history, summary level |

---

# CATEGORY: OPERATIONS/FIELD

## ROLE 25 — AREA MANAGER

**A. Role Purpose:** Oversees a defined set of branches (a region/area) between Branch Manager and GM level — performance accountability across multiple, but not all, branches.

**B. Scope:** Multi-branch (an explicitly assigned named set, Part 1 §18).

**C. Dashboard:** Regional performance board — the Head Office branch-performance table (Part 1 §10/§18/§25-C), filtered to the Area Manager's assigned branches only. Same tool GM uses, same shape, hard-scoped.

**D. KPI Cards:** Area Expected vs. Actual Collection, Area Collection Rate, Area Overdue Amount, Branches Meeting Target (of assigned set), Active Customers/Loans (area total).

**E. Charts:** Branch comparison within the area, Area collection-rate trend.

**F. Performance Information:** Full Company-equivalent Performance panel, scoped to the assigned area (Company Performance fields computed as Area totals per Part 1 §25-B's reconciliation rule); full Branch Performance table for assigned branches only, with an Area Total row; full Worker Performance table for workers in assigned branches only, including a dedicated Collection Officer Performance view.

**G. Navigation/Sidebar:** Dashboard, My Branches, Worker Performance, Staff, Reports, Notifications.

**H. Pages:** Area branch-performance table with drill-down (Part 1 §10, scoped to assigned branches); individual branch workspace; Worker Performance explorer (area-scoped); staff overview across the area.

**I. Tables:** Branch Performance table (Part 1 §25-C(B) column set, Area Total row, assigned branches only); Worker Performance table (Part 1 §25-C(C), assigned branches only).

**J. Filters:** Branch (within area), Role, Worker, Date range, Performance status.

**K. Search:** Customers, loans, staff — restricted to assigned branches.

**L. Actions:** Review/escalate branch performance issues; participate in the approval chain if the company includes Area Manager as a stage; recommend (or, if granted, directly assign) temporary role coverage across their branches (e.g. moving a Collection Officer between two of their branches during a staffing gap).

**M. Permissions:** view (area-scoped performance/staff/customer/loan data), approve/reject (if chain includes this role), recommend/assign (temporary coverage within area).

**N. Restrictions:** Cannot see or act on branches outside their assigned set; cannot alter company-wide settings/branding; performance visibility grants no edit right over any financial record.

**O. Notifications:** Branch performance anomalies within their area, applications aging at their stage.

**P. Reports:** Area performance report, branch comparison within area.

**Q. Drill-down:** `Area → Branch → Branch Manager → Collection Officers → Customers → Loans → Payments` (full chain, scope-limited to assigned branches).

**R. Audit Visibility:** Audit entries for their assigned branches only.

**S. Mobile Behavior:** Field-oriented — condensed area KPI cards and branch list.

**T. Tablet Behavior:** Tablet-first — designed for branch visits; area branch table renders as a card list.

**U. Desktop Behavior:** Full desktop for reporting and area-wide Worker Performance comparison.

**V. Role-Specific Workflows:** (1) Area branch-table drill-down — identical mechanism to Part 1 §10, scope-limited. (2) Temporary coverage — identify a staffing gap in one assigned branch → recommend/assign a worker transfer from another assigned branch (Part 1 §17).

**W. Interaction with Other Roles:** Reports area performance to GM; oversees Branch Managers within the area; escalates cross-area or company-wide issues to GM/Operations Manager.

**X. Customer Visibility:** Every customer within assigned branches, full profile.

**Y. Loan Visibility:** Every loan within assigned branches, at every stage.

**Z. Payment/Transaction Visibility:** Every payment/transaction within assigned branches.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything within assigned branches (area) |
| Can Create | Temporary coverage assignments (if granted) |
| Can Edit | Nothing company-wide |
| Can Approve | Loans, only if the chain includes this role, area-scoped |
| Can Reject | Same as above (reason required) |
| Can Assign | Temporary role coverage within area (if granted) |
| Can Export | Area performance/branch comparison reports |
| Can Reverse | Nothing |
| Can Manage | Area branch oversight, staff coverage within area |
| Cannot Access | Branches outside assigned set; company-wide settings/branding |
| Branches Accessible | Assigned area (named set) only |
| Workers Accessible | Assigned area only |
| Customers Accessible | Assigned area only |
| Loans Accessible | Assigned area only |
| Financial Info Accessible | Assigned area only |

---

## ROLE 26 — BRANCH MANAGER

**A. Role Purpose:** Runs one branch's daily operations end-to-end — staff, customers, collections, and loan applications originating there.

**B. Scope:** One assigned branch, fully (unless they also hold another role granting wider access, Part 1 §16).

**C. Dashboard:** Branch operations command center.

**D. KPI Cards:** Today's Expected Collection, Today's Actual Collection, Collection Rate, Today's Savings, Outstanding Collection, Overdue Amount, Active Customers, Active Loans.

**E. Charts:** Collection performance trend (branch), Collection Officer performance comparison (bar), Customer/group repayment-status breakdown.

**F. Performance Information:** Full Branch Performance detail for their own branch (Part 1 §25-C(B), single-branch scope — the branch's own row, not a comparison table across branches) and full Worker Performance for their own branch's workers, including the dedicated Collection Officer Performance view. No visibility into other branches' performance unless a separate active role assignment grants it.

**G. Sections (preserved exactly):** Collection Performance; Collection Officer Performance; Customers Who Missed Today; Overdue Customers; Loan Applications; Branch Groups; Recent Payments; Alerts.

**H. Sidebar/Pages (preserved exactly):** Dashboard, Customers, Groups, Loans, Collections, Savings, Staff, Reports, Notifications, Settings (branch-scoped only).

**I. Tables:** Branch Collection Officer performance table (Part 1 §25-C(C) column set, own branch only); Customers Missed Today table; Overdue Customers table; Loan Applications table; Branch Groups table; Recent Payments table.

**J. Filters:** Collection Officer, Date range, Status (missed/overdue), Loan product.

**K. Search:** Customers, groups, loans, staff — within their branch only.

**L. Actions:** Review/act on loan applications at the Branch Manager's chain stage (Part 1 §23); create workers for their branch if permitted (Part 1 §12); reassign customers/groups between Collection Officers within the branch; view/resolve missed-payment and overdue cases; export branch reports.

**M. Permissions:** approve/reject (Branch Manager's chain stage), create (workers, if permitted), reassign (customers/groups within branch), export (branch reports).

**N. Restrictions:** Cannot see other branches' data unless separately granted; **no manual repayment/cash-entry function**; cannot alter company-wide settings, branding, or role catalogue.

**O. Notifications:** Missed payments today, overdue accounts crossing a threshold, new loan applications, staff role-assignment changes at their branch, reconciliation exceptions involving their branch's customers.

**P. Reports:** Branch performance report, Collection Officer performance report, overdue/missed-payment report, branch group report.

**Q. Drill-down:** `Branch → Collection Officer → Customer → Loan → Payment → Transaction` (Part 1 §25 chain, scope-limited to the branch).

**R. Audit Visibility:** All audit entries for their branch.

**S. Mobile Behavior:** Alerts and quick lookups.

**T. Tablet Behavior:** Practical daily-use device — branch-floor use, dashboard sections render fully.

**U. Desktop Behavior:** Full reporting workspace.

**V. Role-Specific Workflows:** (1) Chain-stage approval — review application at Branch Manager's stage → approve/reject with reason. (2) Missed-payment resolution — open Customers Who Missed Today → review Collection Officer's activity notes → follow up or reassign. (3) Worker creation for the branch (Part 1 §12, if permitted).

**W. Interaction with Other Roles:** Receives applications from Loan Officer for review; escalates to Area Manager/GM per approval chain; supervises Collection Officers and Senior Collection Officers directly; coordinates with HR Manager/Head Office Administrator on worker creation.

**X. Customer Visibility:** Every customer in their branch, full profile.

**Y. Loan Visibility:** Every loan in their branch, at every stage.

**Z. Payment/Transaction Visibility:** Every payment/transaction in their branch.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything within their branch |
| Can Create | Workers (if permitted) |
| Can Edit | Customer/group-to-officer assignments within branch |
| Can Approve | Loans at Branch Manager's chain stage |
| Can Reject | Same as above (reason required) |
| Can Assign | Customers/groups between Collection Officers within branch |
| Can Export | Branch performance/CO performance/overdue reports |
| Can Reverse | Nothing (Finance Manager's function) |
| Can Manage | Branch staff, customers, groups, loan applications at their stage |
| Cannot Access | Other branches' data (unless granted); company-wide settings/branding/role catalogue |
| Branches Accessible | Own assigned branch only |
| Workers Accessible | Own branch only |
| Customers Accessible | Own branch only |
| Loans Accessible | Own branch only |
| Financial Info Accessible | Own branch only |

---

## ROLE 27 — DEPUTY/ASSISTANT BRANCH MANAGER

**A. Role Purpose:** Supports the Branch Manager across the same branch-operations function, providing coverage and delegated execution within one branch.

**B. Scope:** Same branch as the Branch Manager they support.

**C. Dashboard:** Identical branch operations command-center framing to Branch Manager's.

**D. KPI Cards:** Identical to Branch Manager's: Today's Expected/Actual Collection, Collection Rate, Today's Savings, Outstanding, Overdue, Active Customers, Active Loans.

**E. Charts:** Identical to Branch Manager's.

**F. Performance Information:** Identical Branch Performance and Worker Performance access to Branch Manager's, same single-branch scope.

**G. Navigation/Sidebar:** Identical to Branch Manager's — Dashboard, Customers, Groups, Loans, Collections, Savings, Staff, Reports, Notifications, Settings (branch-scoped only).

**H. Pages:** Identical to Branch Manager's — Collection Performance, Collection Officer Performance, Customers Who Missed Today, Overdue Customers, Loan Applications, Branch Groups, Recent Payments, Alerts.

**I. Tables:** Identical to Branch Manager's — Branch Collection Officer performance table (Part 1 §25-C(C) column set, own branch only), Customers Missed Today table, Overdue Customers table, Loan Applications table, Branch Groups table, Recent Payments table.

**J. Filters:** Identical to Branch Manager's — Collection Officer, Date range, Status (missed/overdue), Loan product.

**K. Search:** Customers, groups, loans, staff — within their branch only, identical to Branch Manager's.

**L. Actions:** Review/act on loan applications at the Branch Manager's chain stage if delegated; reassign customers/groups between Collection Officers; view/resolve missed-payment and overdue cases; export branch reports. **Difference from Branch Manager:** cannot create/terminate workers or edit branch settings without Branch Manager co-approval.

**M. Permissions:** Same verb set as Branch Manager's for day-to-day operations (approve/reject at chain stage if delegated, reassign, export); create-worker/terminate-worker/edit-branch-settings require Branch Manager co-approval.

**N. Restrictions:** Cannot create/terminate workers or edit branch settings without Branch Manager co-approval; same universal no-manual-payment restriction; cannot see other branches' data.

**O. Notifications:** Identical trigger set to Branch Manager's.

**P. Reports:** Identical report access to Branch Manager's.

**Q. Drill-down:** Identical chain to Branch Manager's.

**R. Audit Visibility:** Same as Branch Manager's — all audit entries for the branch.

**S. Mobile Behavior:** Identical to Branch Manager's.

**T. Tablet Behavior:** Identical to Branch Manager's.

**U. Desktop Behavior:** Identical to Branch Manager's, minus unilateral worker-creation/termination/settings-edit actions.

**V. Role-Specific Workflows:** Same missed-payment-resolution and chain-stage-approval workflows as Branch Manager's, when delegated; worker-creation/termination and branch-settings changes are drafted here and require Branch Manager co-approval before taking effect.

**W. Interaction with Other Roles:** Deputizes for Branch Manager toward Collection Officers, Loan Officer, and Area Manager; routes worker-lifecycle and settings decisions through Branch Manager.

**X. Customer Visibility:** Every customer in the branch, full profile — identical to Branch Manager's.

**Y. Loan Visibility:** Every loan in the branch, at every stage — identical to Branch Manager's.

**Z. Payment/Transaction Visibility:** Every payment/transaction in the branch — identical to Branch Manager's.


**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Everything within the branch (identical to Branch Manager) |
| Can Create | Nothing unilaterally (worker creation requires co-approval) |
| Can Edit | Customer/group-to-officer assignments within branch |
| Can Approve | Loans at Branch Manager's chain stage, if delegated |
| Can Reject | Same as above (reason required) |
| Can Assign | Customers/groups between Collection Officers within branch |
| Can Export | Branch performance/CO performance/overdue reports |
| Can Reverse | Nothing |
| Can Manage | Day-to-day branch operations, not worker lifecycle/settings unilaterally |
| Cannot Access | Worker creation/termination, branch-settings edits (without Branch Manager co-approval); other branches' data |
| Branches Accessible | Same branch as their Branch Manager |
| Workers Accessible | Own branch only |
| Customers Accessible | Own branch only |
| Loans Accessible | Own branch only |
| Financial Info Accessible | Own branch only |

---

## ROLE 28 — COLLECTION OFFICER

**A. Role Purpose:** Field-facing role managing an assigned set of customers/groups — the human relationship layer over an entirely electronic, cashless collection process.

**B. Scope:** Assigned customers/groups within one branch.

**C. Dashboard:** Operational and simple, mobile-first.

**D. KPI Cards — "Today" section:** Expected Collection, Actual Collection, Outstanding, Customers Paid, Customers Missed, Savings Collected (all figures sourced from verified electronic payments only, Part 1 §21).

**E. Charts:** Minimal by design — a simple today-vs-target progress bar and a 7-day personal collection trend; this role prioritizes task lists over analytics.

**F. Performance Information:** Own personal performance figures only — Today's Expected Collection, Today's Actual Collection, Outstanding, Collection %, Customers Expected, Customers Paid, Customers Missed, Overdue Customers, Expected Savings, Actual Savings, Active Loans, Overdue Amount (Part 1 §25-C). A Collection Officer **must not see another Collection Officer's performance, another branch's performance, or company-wide performance unless another active role assignment grants that scope.**

**G. Navigation/Sidebar:** My Customers, My Groups, Repayment Schedule, Digital Collection Ledger, Notifications, Search.

**H. Pages:** Customer Profiles (own assigned customers only); Virtual Accounts (view only, Part 1 §22); Repayment Schedule; Payment History; Digital Collection Ledger (read); new loan application form (on behalf of an assigned customer, if permitted).

**I. Tables:** My Customers table (Customer Name, Group, Virtual Account status, Expected Collection, Last Payment Date, Status); Payment History table (Date, Customer, Amount, Virtual Account reference, Pipeline status).

**J. Filters:** Group, Payment status (paid/missed/upcoming), Date range — all scoped to own assigned customers/groups only.

**K. Search:** Own assigned customers/groups only.

**L. Actions:** View customer/group profiles and virtual account details (to share with customers so they can pay); mark a customer as visited/followed-up (an activity note, never a payment record); initiate a new loan application on behalf of an assigned customer if permitted; view repayment schedules and digital ledger. **There is no "Record Payment," "Collect Cash," or manual repayment-entry action anywhere in this role's UI — explicitly absent by design, not merely unused.**

**M. Permissions:** view (own assigned customers/groups, own performance), create (activity/visit notes, loan applications on behalf of assigned customers if permitted), export (personal collection performance report).

**N. Restrictions:** Cannot edit repayments, cannot edit savings balances, cannot edit loan balances, cannot delete financial records, cannot approve loans; **no financial payment entry is created manually by the Collection Officer.**

**O. Notifications:** Customer payment received (real-time, from the pipeline), customer missed expected payment, group repayment-day reminders.

**P. Reports:** Personal collection performance report, missed-payment list.

**Q. Drill-down:** `Customer → their loan(s) → payment history (read) → digital ledger entries`.

**R. Audit Visibility:** Own actions only (profile views logged minimally; activity notes logged fully).

**S. Mobile Behavior:** Mobile-first — this is the role most likely to be used standing in front of a customer on a phone; every action works one-handed on a small screen.

**T. Tablet Behavior:** Convenience view, not the primary target.

**U. Desktop Behavior:** Fully usable but not the primary target device for this role.

**V. Role-Specific Workflows:** Field visit → view customer's virtual account details to share for a transfer → mark visited/followed-up → payment (if made) appears automatically via the pipeline, never entered by the officer.

**W. Interaction with Other Roles:** Reports into Branch Manager; escalates overdue/legacy-debt cases to Recovery Officer where that role exists; a Senior Collection Officer at the same branch may hold light mentoring/escalation permission over this role's cases.

**X. Customer Visibility:** Own assigned customers/groups only.

**Y. Loan Visibility:** Own assigned customers' loans only.

**Z. Payment/Transaction Visibility:** Own assigned customers' payments only, read-only — and, notably, this role is the only one in the specification where the absence of a manual "record what happened with money" action is itself the single most important restriction in the entire system (Part 1 §21): every figure this role sees for its own book arrives exclusively via the payment pipeline.


**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own assigned customers/groups, own personal performance |
| Can Create | Activity/visit notes, loan applications on behalf of assigned customers (if permitted) |
| Can Edit | Nothing financial |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Personal collection performance report |
| Can Reverse | Nothing |
| Can Manage | Visit/follow-up notes for own customers |
| Cannot Access | Any manual payment-entry function (does not exist); other officers'/branches'/company performance unless separately granted |
| Branches Accessible | Own assigned branch only |
| Workers Accessible | None |
| Customers Accessible | Own assigned customers/groups only |
| Loans Accessible | Own assigned customers' loans only |
| Financial Info Accessible | Own assigned customers' payments/collection figures only |

---

## ROLE 29 — SENIOR COLLECTION OFFICER

**A. Role Purpose:** Executes the same field-collection function as Collection Officer, with added light oversight of junior Collection Officers at the same branch — mentoring and escalation, not supervisory authority equivalent to Branch Manager's.

**B. Scope:** Same as Collection Officer's (assigned customers/groups within one branch), plus limited oversight visibility into junior Collection Officers' cases at the branch.

**C. Dashboard:** Identical operational, mobile-first framing to Collection Officer's, with an added "Team" panel showing junior officers' overdue-case counts.

**D. KPI Cards:** Identical to Collection Officer's Today section, plus Team Overdue Cases Open.

**E. Charts:** Identical to Collection Officer's — today-vs-target progress bar and personal 7-day trend.

**F. Performance Information:** Own personal performance figures identical to Collection Officer's, plus limited read visibility into junior Collection Officers' overdue-case counts at the same branch (not their full personal performance figures, which remain scoped to each individual officer per Part 1 §25-C, unless a separate role assignment grants broader access).

**G. Navigation/Sidebar:** Identical to Collection Officer's, plus a Team Overdue Cases page.

**H. Pages:** Identical to Collection Officer's (Customer Profiles, Virtual Accounts view-only, Repayment Schedule, Payment History, Digital Collection Ledger), plus a Team Overdue Cases page listing junior Collection Officers' aging cases at the branch.

**I. Tables:** Identical My Customers and Payment History tables to Collection Officer's, plus a Team Overdue Cases table (Junior Officer, Customer, Loan Reference, Days Overdue, Last Contact).

**J. Filters:** Identical to Collection Officer's (Group, Payment status, Date range), plus Junior Officer and Days-Overdue-bucket filters on the Team Overdue Cases page.

**K. Search:** Own assigned customers/groups, plus read access to junior officers' overdue-case list at the branch.

**L. Actions:** All Collection Officer actions, plus "escalate a peer's overdue case" and a light mentoring/reassignment-suggestion action. **There is still no "Record Payment" or manual repayment-entry action anywhere in this role's UI.**

**M. Permissions:** All Collection Officer permissions, plus view (junior officers' overdue-case counts and case list at the branch) and create (escalation/reassignment suggestions).

**N. Restrictions:** Identical restriction set to Collection Officer's — cannot edit repayments/savings/loan balances, cannot delete financial records, cannot approve loans, no manual payment entry; cannot see junior officers' full personal performance figures, only their overdue-case counts.

**O. Notifications:** Identical to Collection Officer's, plus junior-officer overdue-case escalations.

**P. Reports:** Personal collection performance report, missed-payment list, plus a team overdue-case summary.

**Q. Drill-down:** Identical to Collection Officer's for own customers (`Customer → loan(s) → payment history → digital ledger`); `Junior Officer's overdue case → customer → loan` for the oversight function.

**R. Audit Visibility:** Own actions, plus escalation actions taken on a peer's case.

**S. Mobile Behavior:** Identical mobile-first design to Collection Officer's.

**T. Tablet Behavior:** Identical to Collection Officer's.

**U. Desktop Behavior:** Identical to Collection Officer's; the Team Overdue Cases table is easier to review on tablet/desktop than on a phone, but remains usable on mobile.

**V. Role-Specific Workflows:** Identical field-visit workflow to Collection Officer's for own customers; additionally, review a junior officer's overdue case → suggest a reassignment or escalate to Branch Manager.

**W. Interaction with Other Roles:** Reports into Branch Manager, same as Collection Officer; mentors/escalates on behalf of junior Collection Officers at the same branch, without holding Branch Manager's reassignment authority.

**X. Customer Visibility:** Own assigned customers/groups, plus read visibility into junior officers' overdue customer cases only.

**Y. Loan Visibility:** Own assigned customers' loans, plus overdue-case loan references for junior officers.

**Z. Payment/Transaction Visibility:** Own assigned customers' payments only, read-only — identical to Collection Officer's; no broader payment visibility from the oversight function.


**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own assigned customers/groups, own performance, junior officers' overdue-case counts |
| Can Create | Activity/visit notes, escalation/reassignment suggestions |
| Can Edit | Nothing financial |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing directly — suggests reassignment only |
| Can Export | Personal collection performance report, team overdue summary |
| Can Reverse | Nothing |
| Can Manage | Visit/follow-up notes for own customers; escalation of junior officers' overdue cases |
| Cannot Access | Any manual payment-entry function (does not exist); junior officers' full personal performance figures; reassignment execution (Branch Manager's action) |
| Branches Accessible | Own assigned branch only |
| Workers Accessible | Junior Collection Officers at the same branch, overdue-case visibility only |
| Customers Accessible | Own assigned customers/groups, plus junior officers' overdue cases |
| Loans Accessible | Own assigned customers' loans, plus junior officers' overdue-case loans |
| Financial Info Accessible | Own assigned customers' payments/collection figures only |

---

# CATEGORY: OTHER

## ROLE 30 — RECOVERY OFFICER

**A. Role Purpose:** Field-collection function reframed around aged-debt recovery — manages an assigned overdue/legacy-debt customer set, cross-branch if needed, with elevated escalation permissions relative to a standard Collection Officer.

**B. Scope:** Assigned overdue/legacy-debt customer set, which may span multiple branches (unlike a standard Collection Officer's single-branch scope).

**C. Dashboard:** Operational and mobile-first, identical baseline to Collection Officer's, reframed around aged-debt recovery KPIs (Days Past Due buckets) instead of a daily collection target.

**D. KPI Cards — "Today" section:** Total Overdue Amount Assigned, Days-Past-Due Buckets (30/60/90/120+), Amount Recovered (MTD), Cases Assigned, Cases Resolved (MTD).

**E. Charts:** Days-Past-Due bucket distribution, Recovery trend (MTD).

**F. Performance Information:** Own personal recovery-performance figures only — Amount Recovered, Cases Resolved, DPD-bucket distribution of the assigned book (a recovery-focused reframing of the Collection Officer Performance fields in Part 1 §25-C, same "own figures only" scope rule: no visibility into another Recovery/Collection Officer's book, another branch's performance, or company-wide figures unless a separate active role assignment grants it).

**G. Navigation/Sidebar:** My Overdue Cases, Digital Collection Ledger, Notifications, Search.

**H. Pages:** Customer Profiles (own assigned overdue/legacy-debt cases only); Virtual Accounts (view only, Part 1 §22); Payment History; Digital Collection Ledger (read); Case Escalation form.

**I. Tables:** My Overdue Cases table (Customer, Branch, Loan Reference, Days Past Due, DPD Bucket, Amount Overdue, Last Contact, Status); Payment History table (Date, Customer, Amount, Virtual Account reference, Pipeline status).

**J. Filters:** Branch (cases may span branches), DPD bucket (30/60/90/120+), Case status (visited/promised-to-pay/unreachable/escalated).

**K. Search:** Own assigned overdue/legacy-debt cases only, which may span branches.

**L. Actions:** View customer/loan profiles and virtual account details; mark a case as visited/followed-up/promised-to-pay (an activity note, never a payment record); escalate a case (e.g. for legal/write-off review) per company policy. **There is no "Record Payment," "Collect Cash," or manual repayment-entry action anywhere in this role's UI — identical constraint to Collection Officer's.**

**M. Permissions:** view (own assigned overdue/legacy-debt cases, own recovery performance), create (activity/visit notes, escalation requests), export (personal recovery performance report).

**N. Restrictions:** Cannot edit repayments, savings, or loan balances; cannot delete financial records; cannot approve loans; cannot make write-off/legal decisions (escalates only); no manual payment entry — identical restriction set to Collection Officer's.

**O. Notifications:** Customer payment received on an assigned case (real-time, from the pipeline), case aging into the next DPD bucket, escalation outcome.

**P. Reports:** Personal recovery performance report, DPD-bucket aging report.

**Q. Drill-down:** `Case → customer → loan → payment history (read) → digital ledger entries`.

**R. Audit Visibility:** Own actions only.

**S. Mobile Behavior:** Mobile-first, identical priority to Collection Officer's.

**T. Tablet Behavior:** Convenience view, not the primary target.

**U. Desktop Behavior:** Fully usable but not the primary target device for this role.

**V. Role-Specific Workflows:** Review assigned overdue case → contact customer → log activity note (visited/promised-to-pay/unreachable) → escalate per policy if unresolved past a threshold.

**W. Interaction with Other Roles:** Receives escalated overdue cases from Branch Manager/Collection Officer; escalates further to Credit Manager/GM for write-off or legal-review decisions, which remain outside this role's authority.

**X. Customer Visibility:** Own assigned overdue/legacy-debt customer set only, which may span branches.

**Y. Loan Visibility:** Own assigned cases' loans only.

**Z. Payment/Transaction Visibility:** Own assigned cases' payments only, read-only.


**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Own assigned overdue/legacy-debt cases, own recovery performance |
| Can Create | Activity/visit notes, escalation requests |
| Can Edit | Nothing financial |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Personal recovery performance report |
| Can Reverse | Nothing |
| Can Manage | Activity notes and escalations for own assigned cases |
| Cannot Access | Any manual payment-entry function (does not exist); write-off/legal decisions (escalates only); other officers'/branches'/company performance |
| Branches Accessible | Only branches with an assigned case (may be multiple) |
| Workers Accessible | None |
| Customers Accessible | Own assigned overdue/legacy-debt cases only |
| Loans Accessible | Own assigned cases' loans only |
| Financial Info Accessible | Own assigned cases' payments/recovery figures only |

---

## ROLE 31 — MIS/REPORTING OFFICER

**A. Role Purpose:** Company-wide, read-only reporting and export function — pure Management Information Systems (MIS) role, distinct from Internal Auditor's Findings-recording capability.

**B. Scope:** Company-wide, reporting only.

**C. Dashboard:** Reporting workspace — a library and builder view rather than an operational task list.

**D. KPI Cards:** Reports Generated (MTD), Scheduled Reports Active, Report Export Volume, Data Freshness Indicator (time since last pipeline sync).

**E. Charts:** Report-usage trend, Export-volume-by-report-type breakdown.

**F. Performance Information [read-only reporting pattern]:** Full read-only access to the Company Performance panel, full Branch Performance table (all branches, Company Total row), and full Worker/Collection Officer Performance tables (Part 1 §25-C) — identical scope to Internal Auditor's performance access, but **without Internal Auditor's Findings-recording capability**. This role is pure reporting/export: it surfaces the same numbers, it does not investigate or flag them as a formal function.

**G. Navigation/Sidebar:** Dashboard, Report Library, Report Builder, Scheduled Reports, Audit Trail (read-only), Notifications.

**H. Pages:** Report library (every report type in the system); Report builder (select fields/filters/date range → generate); Scheduled Reports management (recurring exports); read-only Company/Branch/Worker Performance views.

**I. Tables:** Branch Performance table (read-only); Worker Performance table (read-only); Report catalogue table (Report Name, Type, Last Generated, Schedule).

**J. Filters:** Branch, Date range, Role, Report type.

**K. Search:** Reports by name/type; underlying data by branch/date/role, company-wide, read-only.

**L. Actions:** Generate/export any report; configure a scheduled/recurring report export. **No create/edit/approve/reject/assign/reverse action anywhere in this role's UI — pure read-only, export-only.**

**M. Permissions:** view (all reportable data, company-wide, read-only), generate/export (any report), schedule (recurring exports).

**N. Restrictions:** No Findings-recording capability (that remains Internal Auditor's own function); no create/edit/approve/reject/assign/reverse rights on any record, financial or otherwise.

**O. Notifications:** Scheduled report ready, data-freshness/pipeline-sync alerts.

**P. Reports:** Every report type in the system — this role's entire function.

**Q. Drill-down:** `Company → Branch → Worker → Collection Officer → Customer → Loan → Payment` (read-only, mirroring the Performance Visibility Layer's drill-down, Part 1 §25-C), for report-building purposes only — no audit-log/ledger/accounting hop, since that trace-to-source function belongs to Internal Auditor.

**R. Audit Visibility:** Read-only access to report-relevant audit metadata (who generated what report, when); no broader audit-trail investigative function.

**S. Mobile Behavior:** View scheduled-report status and KPI cards only.

**T. Tablet Behavior:** Usable for report review, less so for report-building (desktop-preferred for the builder's filter-heavy UI).

**U. Desktop Behavior:** Full report builder and library — this is a desktop-primary role.

**V. Role-Specific Workflows:** Report builder — select report type → select fields/filters/date range/branch → generate → export or schedule as recurring.

**W. Interaction with Other Roles:** Produces the reports that MD, GM, HR Manager, Internal Auditor, and others consume; does not itself investigate, flag, or act on anomalies — that is left to the role that receives the report.

**X. Customer Visibility:** Read-only, company-wide, at whatever level of aggregation the report requests (individual customer rows are visible in an export, but this role has no customer-profile browsing UI outside the reporting context).

**Y. Loan Visibility:** Read-only, company-wide, at report-appropriate granularity.

**Z. Payment/Transaction Visibility:** Read-only, company-wide, at report-appropriate granularity.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | All reportable data, company-wide, read-only |
| Can Create | Report definitions, scheduled exports |
| Can Edit | Own report definitions/schedules |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | Any report, company-wide |
| Can Reverse | Nothing |
| Can Manage | Report library, scheduled exports |
| Cannot Access | Findings-recording; any create/edit/approve/reject/assign/reverse action on operational or financial data |
| Branches Accessible | All (read-only, reporting) |
| Workers Accessible | All (read-only, reporting) |
| Customers Accessible | All (read-only, reporting) |
| Loans Accessible | All (read-only, reporting) |
| Financial Info Accessible | All (read-only, reporting) |

---

## ROLE 32 — IT/SYSTEM ADMINISTRATOR

**A. Role Purpose:** Technical administration of the company's Nexora tenant — integrations, technical settings, and technical user-support escalation, distinct from HR's people-lifecycle administration.

**B. Scope:** Company-wide, technical/configuration surface only — not customer financial data by default.

**C. Dashboard:** Technical/system health workspace.

**D. KPI Cards:** Webhook Delivery Success Rate (24h), Failed/Delayed Webhooks Open, Reconciliation Job Last Run Status, API/Provider Connection Status, Active Sessions.

**E. Charts:** Webhook success-rate trend, Exception-queue-size trend (Part 1 §21's exception tables, technical-health lens rather than Finance's resolution lens).

**F. Performance Information:** None from the Performance Visibility Layer — this role's health indicators are pipeline/technical metrics, not collection/portfolio performance. Read visibility into the same exception queues Finance Manager and Cash/Bank Reconciliation Officer see, but framed as "is the pipeline healthy" rather than "should this payment be allocated."

**G. Navigation/Sidebar:** Dashboard, Payment Provider Settings, Integrations, Webhook Exceptions, System Logs, Audit Trail (technical actions).

**H. Pages:** Payment provider configuration; webhook exception queue (view/technical-retry, not financial resolution — that remains Finance Manager's action); integration/API key management; technical audit log.

**I. Tables:** Webhook exception table (Reference, Type, Status, Retry Count, Last Attempt); System log table (Event, Timestamp, Severity).

**J. Filters:** Exception type, Status, Date range, Severity.

**K. Search:** Technical logs, webhook events, integration records.

**L. Actions:** Configure/rotate provider API credentials; manually trigger a reconciliation-diff job run; retry a technically-failed webhook job; view (not resolve) financial exceptions.

**M. Permissions:** configure (provider credentials, integrations), trigger (reconciliation-diff job), retry (technically-failed webhooks), view (financial exceptions, read-only).

**N. Restrictions:** No access to customer financial detail, loan approval, or accounting entries; cannot resolve an Unallocated/Unmatched Payment Exception (Finance Manager's/Cash-Reconciliation Officer's action) — can only ensure the pipeline itself is healthy.

**O. Notifications:** Provider downtime, webhook failure-rate threshold breaches, failed reconciliation job runs.

**P. Reports:** System/technical health reports, webhook processing reports.

**Q. Drill-down:** `Webhook exception → raw payload/technical detail → linked transaction (read-only)`.

**R. Audit Visibility:** Technical/configuration audit entries company-wide; financial audit entries read-only where relevant to pipeline health.

**S. Mobile Behavior:** Critical alerts only.

**T. Tablet Behavior:** Usable for log/exception review.

**U. Desktop Behavior:** Desktop-first — technical/log-heavy work.

**V. Role-Specific Workflows:** Webhook failure detected → open Webhook Exceptions queue → inspect raw payload → retry the technical job, or flag for Finance Manager if the issue is allocation-logic rather than delivery-failure.

**W. Interaction with Other Roles:** Keeps the payment pipeline *running*; Finance Manager resolves what the pipeline *surfaces* — a deliberate separation of duties, neither can fully do the other's job.

**X. Customer Visibility:** None by default — only a customer reference visible inside a technical webhook payload, not a profile view.

**Y. Loan Visibility:** None by default.

**Z. Payment/Transaction Visibility:** Read-only, technical/pipeline-health context only (payload, delivery status, retry history) — not financial resolution detail.

**Access Matrix:**

| Field | Value |
|---|---|
| Can See | Technical/system health data, company-wide |
| Can Create | Nothing operational |
| Can Edit | Provider/integration configuration |
| Can Approve | Nothing |
| Can Reject | Nothing |
| Can Assign | Nothing |
| Can Export | System/technical health reports |
| Can Reverse | Nothing |
| Can Manage | Provider credentials, integrations, technical retries |
| Cannot Access | Loan approval, accounting entries, financial exception resolution, customer financial detail |
| Branches Accessible | None directly (technical scope is company-wide, not branch-scoped) |
| Workers Accessible | None |
| Customers Accessible | None beyond a technical reference in a payload |
| Loans Accessible | None |
| Financial Info Accessible | Read-only, technical/pipeline-health context only |

---

# END OF ROLE SPECIFICATION LIBRARY

All 32 built-in roles (per SRS v2.1 Part 1 §19–20, Part 2 §20) are specified above, independently, in full — no role's entry inherits from or defers to another. The 11 Custom Role templates (Part 1 §19) remain company-cloneable starting points per the preserved catalogue decision (SRS v2.1 Part 2, Section 62-A, Change #9) and are not given mandatory full specifications here.

**Traceability check for Cline:** every role entry above states, explicitly, what the role can see/create/edit/approve/reject/assign/export/reverse/manage, what it cannot access, and exactly which branches/workers/customers/loans/financial information it can reach — per the implementation requirement that no built-in role be left dependent on inferred behavior. Where a role's specification says "identical to [Role X]'s," that sentence itself is the explicit statement of sameness — it is not an instruction to consult Role X's component tree instead of building this role's own; per SRS v2.1 Part 2 §60, item 9, each role is still its own independent component tree even where its permissions match a sibling's exactly.
