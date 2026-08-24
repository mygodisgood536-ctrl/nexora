# NEXORA — SOFTWARE REQUIREMENTS SPECIFICATION v2.1
## Part 1 of 2 — Vision, Multi-Tenant Architecture, Branch & Staff Model, Role Engine, Cashless Payment System, Loan Workflow, Performance Visibility Layer

**Prepared for:** Adedeji Victor, Founder, Nexora
**Purpose of this revision (v2.0 → v2.1):** This is a targeted revision pass over SRS v2.0, not a rewrite. v2.0 was already an implementation-grade specification for direct use by Cline (VS Code). v2.1 makes ten further corrections/additions identified after a clarification review of v2.0, listed in full in the v2.1 Change Log (Part 2, Section 62-A). Nothing from v2.0 is discarded unless explicitly marked **[v2.1 CHANGE REQUIRED]**.

**Tagging convention used throughout this document:**
- **[EXISTING — PRESERVE]** — an established requirement, carried forward and stated here in full, sometimes reworded for clarity with meaning unchanged.
- **[EXPANDED]** — an established requirement, now stated here with added implementation detail.
- **[CHANGE REQUIRED]** — supersedes an earlier stated version of this requirement (introduced in v2.0); the superseded wording is quoted so nothing is silently lost.
- **[NEW REQUIREMENT]** — introduced in v2.0.
- **[v2.1 NEW REQUIREMENT]** — added in this revision.
- **[v2.1 CHANGE REQUIRED]** — conflicts with v2.0 and overrides it. The v2.0 wording is quoted so nothing is silently lost.
- **[v2.1 EXPANDED]** — existed in v2.0 at a high level; this revision adds the detail v2.0 lacked.
- **[v2.1 PRESERVED — NO CHANGE]** — explicitly reviewed against the new requirements and confirmed to need no change; called out where a reader might otherwise expect one.

Part 2 (separate file) contains Sections 26–65: the remaining systems sections, the Company/Branch/Worker Performance Visibility Layer detail, and the full requirement change log. **A third document, `Nexora_Role_Specifications_AZ_Complete.md`, is now the single source of truth for every built-in role's dashboard, permissions, and workflow** — it supersedes the "16 full-spec + 16 lightweight variant" structure that Part 2 Section 20 used to use, per v2.1 Change #7 (Part 2, Section 62-A). **[v2.1 NEW] A fourth document, `Nexora_Platform_Owner_Portal_Spec.md`, is the single source of truth for the Platform Owner's own portal** — login, dashboard, company management, platform health, settings, and permissions/restrictions — fully separate from and never inheriting from any company portal.

---

## 1. NEXORA VISION [EXPANDED]

**[EXISTING — PRESERVE]** Nexora is a premium, cloud-based, multi-tenant SaaS Financial Management Platform purpose-built for microfinance institutions, loan companies, cooperative societies, and credit organizations. One codebase, unlimited independent companies, each experiencing Nexora as if it were built only for them.

**[EXPANDED]** Nexora is, at its foundation, a digitized ledger — replacing paper books with automated calculations (Part 2, Section 37: Digital Collection Ledger). This revision widens that vision: **Nexora is a full microfinance operating system.** It does not just record what happened to a loan; it runs the organization that manages the loan — its head office, its branches, its staff hierarchy, its money movement, and its accountability trail. The digitized-ledger function (Part 2, Section 37) is one module inside this larger operating system, not the whole of it.

## 2. PRODUCT GOALS [EXPANDED]

1. **[EXISTING]** Eliminate paper ledgers and manual arithmetic for loan/collection operations.
2. **[EXISTING]** Give every company its own fully isolated, fully branded workspace on shared infrastructure.
3. **[NEW]** Give every company complete operational visibility from Head Office down to a single customer's last payment, with no blind spots.
4. **[NEW]** Remove cash entirely from the repayment/collection process — every naira that moves is bank-verified, not human-reported.
5. **[NEW]** Let a company model its actual staff hierarchy — not a fixed three-role hierarchy — using a real role library, multiple simultaneous role assignments, and time-bound acting roles.
6. **[EXISTING]** Let branches scale from one to hundreds without architectural change.

## 3. CORE PRINCIPLES [NEW REQUIREMENT]

These three sentences govern every design decision in this document and should be treated by Cline as non-negotiable acceptance criteria for every feature touching money or user action:

> **If money moves, Nexora must know — automatically, not because someone typed it in.**
> **If an important action happens, Nexora must know who performed it, from where, and when.**
> **If something does not match — a payment, a balance, a webhook, a ledger total — Nexora must expose the discrepancy rather than silently resolve or hide it.**

These principles are why cash is removed (Section 9), why every state change carries an audit entry (Section 23 / Part 2 Section 44), and why reconciliation exceptions are a first-class object in the data model, not an afterthought (Part 2 Section 39).

---

## 4. MULTI-TENANT ARCHITECTURE [EXISTING — PRESERVE, STRENGTHENED]

**[EXISTING — PRESERVE]** Nexora is built once. The Platform Owner creates unlimited companies without code changes. Each company automatically receives the full module set: Dashboard, Customers, Loans, Savings, Accounting, Reports, Notifications, Audit Logs, Settings, User Management, Branch Management, Group Management.

**[EXPANDED — data isolation mechanics]** Data isolation is a governing principle ("ABC Finance must never see XYZ Finance"), and this revision specifies the mechanism that enforces it:

- Every tenant-scoped table carries a mandatory, indexed `company_id`. There is no table containing customer, loan, staff, payment, branch, or audit data that lacks this column.
- Every query executed on behalf of an authenticated user is auto-scoped to that user's `company_id` at the data-access layer (not only in application logic) — e.g. via row-level security or an equivalent enforced query middleware, so a bug in one screen's code cannot leak cross-tenant data.
- The Platform Owner's own tooling connects through a **separate, explicitly-audited support-access path** (see Part 2, Section 50), never through the normal company data layer.
- **[v2.1 NEW REQUIREMENT]** The Platform Owner's own portal — login, dashboard, company management, platform health, settings, and every other Platform Owner screen — is now fully specified, end to end, in a fourth companion document: **`Nexora_Platform_Owner_Portal_Spec.md`**. It is a distinct application surface from every company portal (no shared branding, navigation, or dashboard components), and it never grants the Platform Owner default visibility into a company's customer, loan, payment, savings, or accounting data — that boundary, and the separately-authorized Support Access mechanism that is the only way past it, is specified in full in that document's Section 40.
- Every branch-scoped table additionally carries `branch_id`, enforced the same way, so a Branch Manager's queries cannot silently return another branch's rows even within the same company.

This two-layer scoping (`company_id` then `branch_id`) is the backbone that Sections 7–10 (branches and branch URLs) and Section 15 (role/permission engine) build on.

## 5. COMPANY STRUCTURE [EXPANDED]

```
Nexora Platform
└── Company (tenant)
    ├── Head Office               (the company's top-level operating unit — not a branch)
    ├── Branch 1 … Branch N       (unlimited, see Section 7)
    ├── Staff (users with one or more role assignments — see Section 15)
    ├── Customers (each belongs to exactly one branch)
    ├── Groups (belong to a branch)
    ├── Loans, Savings, Payments, Ledger, Accounting
    └── Audit Log (company-wide, branch-filterable)
```

**[NEW REQUIREMENT]** Head Office is a first-class structural entity, not "branch zero." It has no branch code, no branch URL, and does not appear in branch lists or branch performance tables — it is the vantage point from which the whole company, including every branch, is viewed and administered.

## 6. HEAD OFFICE STRUCTURE [NEW REQUIREMENT]

Head Office is where executive, finance, HR, audit, and credit-committee roles live (the full catalogue is in Section 19 / Part 2 Section 20). It is reached at the company's primary portal URL (Section 8). From Head Office, authorized roles drill down into any branch without leaving the portal (Section 10). Head Office itself has no "branch performance row" of its own; instead, the Head Office dashboard aggregates all branches (Part 2, Section 21).

## 7. BRANCH STRUCTURE [CHANGE REQUIRED — limit removed, fields corrected]

**[EXISTING — PRESERVE]** A company may create unlimited branches; this revision makes explicit that there is no soft cap either (no UI pagination assumption that breaks past a small number, no design that only looks good with 3–5 branches). A company may operate 5, 50, or 500 branches with identical UX.

**[CHANGE REQUIRED]** Branch fields were previously specified as: *"Branch Name, Branch Code, Address, Phone Number, Email, Branch Manager, Collection Officers, Groups."* Two of these are corrected by the new requirements below: **Branch Code is system-generated, never entered** (Section 8), and **Phone Number and Email are optional, never mandatory** (Section 9). "Branch Manager" as a fixed field is also superseded — a branch is staffed via role assignment (Section 15), so it can have zero, one, or more people holding the Branch Manager role at a given time (e.g. during a handover).

Each branch record contains:

| Field | Source | Required |
|---|---|---|
| Branch ID (internal UUID/PK) | system-generated | always |
| Branch Code (human-facing) | system-generated (Section 8) | always |
| Branch Name | entered | yes |
| Branch Address | entered | yes |
| Phone Number | entered | **no** |
| Email | entered | **no** |
| Status (Active / Suspended / Closed) | system, editable by authorized role | always |
| Branch Portal URL | system-generated (Section 10) | always |
| Date Created / Created By | system | always |
| Workers (via role assignment) | derived | — |
| Customers, Groups, Loans, Collections | derived | — |

## 8. BRANCH CODE GENERATION [NEW REQUIREMENT]

The user never types a branch code. On submission of the branch-creation form, Nexora generates one deterministically:

**Format:** `{COMPANY_PREFIX}-{BRANCH_SEQ}` — e.g. company "ABC Finance" (company code `ABC`, assigned once at company creation — `Nexora_Platform_Owner_Portal_Spec.md`, Section 9, Create Company Wizard) creates its 4th branch → `ABC-004`.

Rules:
- **Company prefix** is fixed at company creation (3–6 uppercase letters, derived from company name, deduplicated platform-wide by the Platform Owner tooling — this is the company-code mechanism established at company creation, `Nexora_Platform_Owner_Portal_Spec.md` Section 9).
- **Branch sequence number** is a per-company, monotonically increasing integer, zero-padded to 3 digits, assigned atomically (e.g. via a database sequence or a `SELECT … FOR UPDATE` counter row per company) so two simultaneous branch creations can never collide.
- The sequence **never reuses a number**, even if a branch is later closed — closed branches keep their code permanently (auditability: old reports referencing `ABC-004` must always resolve to the same branch).
- The code is **immutable**: renaming the branch never changes the code.
- The code is used as the internal reference in reports, staff IDs (Section 12), URLs (Section 10), and audit logs — anywhere a human-readable, permanent branch identifier is needed.
- Uniqueness is enforced by a database unique constraint on `(company_id, branch_code)`, not just application logic.

## 9. BRANCH PORTAL URL [NEW REQUIREMENT]

**[NEW REQUIREMENT]** Every branch receives its own authenticated entry point, generated automatically at creation — not a separate tenant, but a scoped subdomain into the same company tenant.

**Format:** `{company-slug}-{branch-slug}.nexora.app`

Example, matching the requirement's own illustration:
- Head Office (company portal): `abcfinance.nexora.app`
- Abuja branch: `abcfinance-abj.nexora.app`
- Lagos branch: `abcfinance-lag.nexora.app`

Generation rule:
- `company-slug` is fixed at company creation (already part of the company portal URL mechanism, Section 10).
- `branch-slug` is derived from the branch name at creation time: lowercase, non-alphanumeric characters stripped, truncated to a short recognizable token (e.g. first 3–4 consonant-led letters of the city/branch name), and **deduplicated within the company** by appending a numeral if a collision occurs (`abj`, then `abj2` if a second Abuja-named branch is created). The branch-slug is cosmetic only — routing and permission resolution never depend on it; they depend on the immutable `branch_id` behind it (see below), so renaming a branch does not have to break its old URL if the company prefers continuity, though regenerating the slug on rename is a configurable company setting.
- The subdomain resolves, at the infrastructure layer, to the same application deployment as the company's main portal — it carries a `branch_id` binding, not a separate build or database.

**Behavior at that URL (Section 10):**
- Login screens at a branch URL authenticate against the same company user table, but any session created there is **branch-scoped by construction**: the login handler resolves `company_id` and `branch_id` from the subdomain before checking credentials, and rejects/redirects a user whose role assignments include no grant at that branch (unless they *also* hold a Head-Office-scope role — see Section 15).
- Once authenticated, Nexora already knows Company, Branch, User, Role(s), and Permissions from the URL + session — the user is taken straight to their role's dashboard. They are never asked to select a branch or select a role.

## 10. HEAD OFFICE BRANCH DRILL-DOWN [NEW REQUIREMENT]

Head Office users never need the branch URL. From the Head Office portal (`abcfinance.nexora.app`), any role with company-wide or multi-branch scope (Section 15) can navigate:

```
Head Office Dashboard → Branches → Abuja Branch → Open Branch
```

"Open Branch" loads a **branch workspace view** rendered inside the Head Office session — same login, same tab, no logout/login cycle. Internally this is implemented as the identical branch-scoped views a Branch Manager would see at the branch URL, rendered under the Head Office user's own session with their own (typically read/oversight-heavy) permission set applied, plus a persistent "Viewing: Abuja Branch — Return to Head Office" context bar. Drill-down continues into individual Collection Officers, customers, loans, and payments, respecting the viewer's own permission scope at every level (an HR Manager drilling into a branch sees staff records; they do not thereby gain visibility into that branch's loan ledger unless HR's permission set separately grants it).

## 11. NO PUBLIC STAFF SIGN-UP [EXISTING — PRESERVE, STRENGTHENED]

**[EXISTING — PRESERVE]** Branch Managers, Collection Officers, and other staff do not self-register — accounts are created by authorized personnel and credentials are issued to them (this principle already governs company-level accounts, Section 11; this revision extends the same non-self-service philosophy explicitly to all staff).

**[NEW REQUIREMENT — made explicit]** There is no "Sign Up," "Create Account," or "Choose your branch" screen anywhere in the staff-facing product. The only entry points are: (a) the login screen at the company or branch URL, and (b) the internal Create Worker flow, usable only by an authorized, authenticated staff member (Section 12).

## 12. WORKER CREATION [NEW REQUIREMENT]

**Flow:**
```
Authorized Staff (role has "Create Worker" permission, scoped to a branch or company-wide)
→ Head Office Dashboard (or Branch Dashboard) → Branches → [Branch] → Staff → Create Worker
```

**Form fields:**
1. Worker role(s) — selected from the company's enabled role catalogue (Section 19); at least one role, more than one permitted (Section 15).
2. First name, Middle name (optional), Last name
3. Phone number
4. Passport photograph (upload)
5. Date of birth — **Day + Month only, no year field exists in the schema** (privacy requirement below)
6. Assigned branch (pre-filled if created from within a branch context; selectable if created from Head Office)

**[NEW REQUIREMENT — privacy]** The date-of-birth field is stored and displayed as day+month only (e.g. "14 March"). There is no year-of-birth column on the staff/worker table at all — not merely a hidden one — so it cannot be exported, reported, or reintroduced accidentally by a later feature.

**On "Create Worker," Nexora automatically generates:**
- **Worker ID / staff code:** `{BRANCH_CODE}-{ROLE_PREFIX}-{SEQ}` (e.g. `ABJ-CO-014` for the 14th Collection Officer historically assigned at branch ABJ — role prefix reflects the role held at creation and does not change if the person's role changes later; the Worker ID is a permanent identifier, not a live description of current duties).
- **Username:** derived from name + a disambiguating suffix if needed (e.g. `mary.abuja01`), never the person's private phone number or email, so it can be safely shown on-screen.
- **Temporary password:** a random, high-entropy string, one-time-use, displayed **once**, only to the creating staff member, in a "copy and hand to the worker" panel — never emailed or texted automatically, consistent with Nexora's no-OTP/no-forced-verification-channel philosophy (Section 11), since branch workers frequently lack a reliable personal email on file.

**First-login behavior [EXPANDED, mirrors the company-level first-login flow of Section 11]:** worker logs in at their branch URL with username + temp password → forced password change → temp password invalidated immediately → dashboard loads.

**Lifecycle actions**, all permission-gated and all audit-logged (Section 23):
- **Password reset:** only an authorized role (e.g. Branch Manager for their branch's staff, HR/Head Office Administrator company-wide) can trigger a new temporary password for a worker — workers cannot self-service a forgotten password, mirroring the principle that only an administrator issues resets, extended down to worker level.
- **Suspension:** login blocked, role assignments preserved (unpaused on reactivation) — used for short-term issues (investigation pending, leave without a formal role change).
- **Termination:** login blocked permanently, all active role assignments end-dated, worker record retained (never hard-deleted) for audit/history continuity — past loans, collections, and audit entries they touched must remain attributable.
- **Activation:** reverses suspension.
- **Credential security:** temporary passwords are single-use and expire if unused after a configurable window (default 72 hours); all credential-issuance events are audit-logged with who issued them, to whom, and when — never what the password was.

## 13. AUTHENTICATION [EXISTING — PRESERVE, EXTENDED]

**[EXISTING — PRESERVE]** No OTP, no SMS verification, no email verification, no two-factor authentication as the default login method, for any user type. Password + recovery-key model only.

**[EXPANDED]** Applied to branch context: authentication at a branch URL resolves `company_id` + `branch_id` from the subdomain, then checks username/password against that company's user table with a branch-scope check (Section 9). A user is never asked to pick a company, branch, or role during login — Nexora derives all of that from (URL + credentials), then routes to the correct dashboard for their role(s) (Section 15's permission-merge logic decides which dashboard when a user holds multiple roles active at that branch).

**[EXISTING — PRESERVE]** Only the Head Office Administrator (or another role explicitly granted the permission) can issue a worker a new temporary password; workers cannot self-reset.

## 14. USER LIFECYCLE [NEW REQUIREMENT — consolidates staff + company lifecycle states]

`Invited (credentials generated, first login pending) → Active → Suspended → Reactivated → Terminated.` Every transition is audit-logged with actor, timestamp, and reason (Section 23). Terminated users are never deleted — their historical actions (loans they processed, payments they verified, approvals they gave) must remain intact and attributable in every report and audit trail forever.

---

## 15. ROLE ARCHITECTURE — User + Role + Scope + Permission [CHANGE REQUIRED]

**[CHANGE REQUIRED]** Permissions were previously modeled as fixed per role name ("Head Office → full access," "Branch Manager → branch access," "Collection Officer → assigned-customer access") with one implicit role per user. This is replaced by a four-part model:

```
User  →  one or more Role Assignments, each with:
              Role            (from the built-in catalogue or a Custom Role, Section 19 / Part 2 §48)
              Scope           (Company-wide | Head Office | specific Branch(es) | assigned Customers/Groups/Loans)
              Permission Set  (the concrete actions that role grants, at that scope)
              Assignment Type (Permanent | Temporary, Section 17)
```

A **Role** is a named bundle of default permissions (Part 2, Section 20 defines the default bundle for every built-in role). A **Scope** answers "over what data does this grant apply." A **Permission Set** is the actual list of allowed actions (view/create/edit/approve/reject/suspend/assign/disburse/export/delete/reverse — the verbs used throughout Part 2's role specs). Scope and permission set both default from the Role but are independently adjustable per assignment, so two Branch Managers in the same company can, if the company chooses, have slightly different grants without needing two different "roles" to exist.

**Why this matters (traceable to requirements):** it is what makes multiple simultaneous roles (Section 16), temporary acting roles (Section 17), per-branch drill-down permission checks (Section 10), and custom roles (Part 2 §48) all work through one consistent engine instead of four separate hacks.

### 16. MULTIPLE ROLES PER USER [CHANGE REQUIRED]

**[CHANGE REQUIRED]** The one-role-per-user assumption is replaced. A user now has an array of Role Assignments, e.g.:

```
Mary
 ├── Collection Officer  — Scope: Abuja Branch — Permanent
 └── Branch Manager      — Scope: Abuja Branch — Temporary (Section 17)

John
 ├── GM                  — Scope: Company-wide — Permanent
 └── HR Manager          — Scope: Company-wide — Permanent
```

**Permission merge rule:** effective permissions at any given screen/action = the **union** of every currently-active role assignment whose scope covers the data in question. There is no "highest role wins" logic and no silent downgrade — if any active assignment grants an action at the relevant scope, the user has it. Restrictions (Part 2, Section 20's "Restrictions" field per role) apply per-role; a restriction on one role assignment does not block an action separately granted by another active assignment held by the same person.

**Dashboard selection when a user holds multiple roles:** the user lands on a **role switcher**-aware home — if exactly one role is active at the current context (company portal vs. this specific branch URL), that role's dashboard loads directly; if more than one role is active at that context, a lightweight role-context switcher is shown (not a login-time question — a post-login, in-app toggle, e.g. "Viewing as: Collection Officer ▾") so Mary can move between her Collection Officer workspace and her (temporary) Branch Manager workspace without logging out. This is distinct from the branch-selection prohibition in Section 9 — the branch is fixed by the URL; only the *role lens* on that branch is switchable.

### 17. TEMPORARY / ACTING ROLES [NEW REQUIREMENT]

Full workflow, using the requirement's own example:

```
Assign Additional Role
  User: Mary
  Existing Role(s): Collection Officer (unaffected, remains active)
  Additional Role: Branch Manager
  Scope: Abuja Branch
  Assignment Type: Temporary
  Start Date: [date]
  End Date: [date]
  Reason: [free text, required for audit]
  Assigned By: [captured automatically]
```

- On **Start Date**, the additional role assignment activates automatically (no manual "turn on" step needed) and immediately participates in the permission-merge rule above.
- On **End Date**, it deactivates automatically at end-of-day in the company's configured timezone — no cron-dependent human step required, though the deactivation event itself fires an audit log entry and a notification to the user and to whoever assigned it.
- Mary's Collection Officer assignment is never touched by this process — it is a fully independent Role Assignment record.
- **Extension / early termination:** an authorized role can extend the End Date or end the assignment early; both are separately audit-logged actions, distinct from the original assignment and its natural expiry.

**Supported assignment actions, all captured as Role Assignment records (create/modify/end), all audit-logged with before/after state:**
- **Promotion** — new Permanent role assignment added (old role may be ended or kept, per what actually happened at the company).
- **Demotion** — a role assignment is end-dated; a different (or no) new one may be added.
- **Temporary assignment** — as above.
- **Permanent assignment** — same structure, no End Date.
- **Replacement** — one user's role assignment at a scope is end-dated while another user's assignment at the same scope begins; both are separate audit entries, linked by a shared "replacement" reference so the transition is traceable as one event.
- **Transfer between branches** — the existing branch-scoped assignment is end-dated and a new one created at the destination branch; the Worker ID (Section 12) does not change, preserving historical continuity.
- **Suspension / termination / role removal** — as defined in Section 14, applied at the role-assignment level (a user can be suspended from one role while remaining active in another, if that reflects reality — e.g. under investigation for a Branch Manager duty but still trusted to perform Collection Officer duties elsewhere).

## 18. SCOPE TYPES [NEW REQUIREMENT — referenced throughout Section 15–17 and Part 2]

| Scope type | Meaning | Typical roles |
|---|---|---|
| Company-wide | Every branch, every customer, every record in the tenant | MD, GM, Deputy MD, Internal Auditor, Compliance Officer, HR Manager |
| Head Office | Head Office data/functions only, not automatically all branches unless also granted | Head Office Administrator, Finance/Accounting roles (unless extended) |
| Multi-branch (named set) | An explicitly assigned list of branches | Area Manager over 4 named branches |
| Single branch | One branch, fully | Branch Manager, Collection Officer, branch-based Loan Officer |
| Assigned customers/groups/loans | A filtered subset within a branch, e.g. only the groups a specific Collection Officer collects from | Collection Officer, Field/Account Officer |

## 19. ROLE CATALOGUE — BUILT-IN vs. CUSTOM [NEW REQUIREMENT]

Every role the requirement listed was evaluated against one test: **does a microfinance institution need this as a distinct, independently-assignable set of permissions and a distinct dashboard, or is it a minor variant better served by a Custom Role (Part 2, Section 48) built from a nearby built-in role?** Roles below marked "Built-in — full spec" receive complete A–P treatment in Part 2, Section 20. Roles marked "Built-in — lightweight" get a defined permission bundle and scope but reuse a close sibling's dashboard shape with adjusted data (documented in Part 2 as a variant, to avoid 40 near-duplicate dashboard descriptions that don't earn their own design). Roles marked "Custom Role template" are not created as platform defaults but are pre-filled starting points a company can clone when building a Custom Role, because they are common but not universal across microfinance business models.

| # | Role | Category | Decision |
|---|---|---|---|
| 1 | MD | Executive | Built-in — full spec |
| 2 | Deputy MD | Executive | Built-in — lightweight (MD variant, narrower default approval authority) |
| 3 | GM | Executive | Built-in — full spec |
| 4 | Assistant GM | Executive | Built-in — lightweight (GM variant) |
| 5 | Head Office Administrator | Executive | Built-in — full spec |
| 6 | Operations Manager | Executive | Built-in — full spec |
| 7 | Assistant Operations Manager | Executive | Built-in — lightweight (Ops Manager variant) |
| 8 | Finance Manager | Finance | Built-in — full spec |
| 9 | Accountant | Finance | Built-in — full spec |
| 10 | Assistant Accountant | Finance | Built-in — lightweight (Accountant variant, no posting/approval rights) |
| 11 | Cash/Bank Reconciliation Officer | Finance | Built-in — lightweight (scoped to Part 2 §39 reconciliation module only) |
| 12 | Finance Officer | Finance | Custom Role template (overlaps Accountant/Finance Manager; institutions define the split differently) |
| 13 | HR Manager | HR/Admin | Built-in — full spec |
| 14 | HR Officer | HR/Admin | Built-in — lightweight (HR Manager variant, no termination rights) |
| 15 | HR Assistant | HR/Admin | Custom Role template |
| 16 | Administrative Officer | HR/Admin | Custom Role template |
| 17 | Internal Auditor | Audit/Compliance | Built-in — full spec |
| 18 | Audit Officer | Audit/Compliance | Built-in — lightweight (Internal Auditor variant, narrower scope) |
| 19 | Compliance Officer | Audit/Compliance | Built-in — full spec |
| 20 | Risk Officer | Audit/Compliance | Built-in — lightweight (Compliance Officer variant, portfolio-risk focus) |
| 21 | Credit Manager | Credit/Loans | Built-in — full spec |
| 22 | Credit Officer | Credit/Loans | Built-in — lightweight (Credit Manager variant, no final approval) |
| 23 | Loan Officer | Credit/Loans | Built-in — full spec |
| 24 | Loan Processing Officer | Credit/Loans | Custom Role template (documentation-only subset of Loan Officer) |
| 25 | Credit Analyst | Credit/Loans | Custom Role template |
| 26 | Account Officer | Customer/Accounts | Built-in — lightweight (Loan Officer variant, relationship focus) |
| 27 | Assistant Account Officer | Customer/Accounts | Custom Role template |
| 28 | Field Account Officer | Customer/Accounts | Built-in — lightweight (Collection Officer variant, savings/account focus) |
| 29 | Customer Service Officer | Customer/Accounts | Built-in — full spec |
| 30 | Customer Service Manager | Customer/Accounts | Built-in — lightweight (CSO variant, supervisory) |
| 31 | Area Manager | Operations/Field | Built-in — full spec |
| 32 | Branch Manager | Operations/Field | Built-in — full spec |
| 33 | Deputy/Assistant Branch Manager | Operations/Field | Built-in — lightweight (Branch Manager variant) |
| 34 | Collection Officer | Operations/Field | Built-in — full spec |
| 35 | Senior Collection Officer | Operations/Field | Built-in — lightweight (CO variant, mentoring/escalation permissions) |
| 36 | Field Officer | Operations/Field | Custom Role template (overlaps CO; some companies distinguish, most don't) |
| 37 | Operations Officer | Operations/Field | Custom Role template |
| 38 | Recovery Officer | Other | Built-in — lightweight (CO variant, overdue/legacy-debt focus, elevated escalation permissions) |
| 39 | Portfolio Manager | Other | Custom Role template |
| 40 | Treasury Officer | Other | Custom Role template |
| 41 | MIS/Reporting Officer | Other | Built-in — lightweight (read-only, cross-branch reporting scope) |
| 42 | IT/System Administrator | Other | Built-in — full spec |
| 43 | Data/Reporting Analyst | Other | Custom Role template |

This yields **32 built-in roles** (the 16 originally marked "full spec" plus the 16 originally marked "lightweight variant" — see the **[v2.1 CHANGE REQUIRED]** note below) and **11 Custom Role templates** the company can clone. Every institution can still create any additional role from scratch via Custom Roles (Part 2, Section 48) — this catalogue is the default library, not a ceiling.

**[v2.1 PRESERVED — NO CHANGE]** This 43-role catalogue and its built-in-vs-custom classification (the table above) is unchanged by v2.1. No role is added, removed, or reclassified between built-in and custom. What changes is only how thoroughly each *built-in* role is specified — see below.

**[v2.1 CHANGE REQUIRED]** v2.0 classified 16 of the 32 built-in roles as "lightweight variants" and documented them only as a permission/scope delta against a full-spec sibling (v2.0 Part 2, Section 20.17), explicitly to "avoid 16 near-duplicate A–P write-ups." This shortcut is withdrawn. **Every one of the 32 built-in roles now receives its own complete, independent specification** — Cline must not infer, derive, or inherit any lightweight role's dashboard, pages, or workflow from a sibling role. Where two roles are intentionally similar (e.g. Branch Manager and Deputy/Assistant Branch Manager), their specifications explicitly state what differs, while each still receives the full treatment below in its own right.

---

## 20. COMPLETE ROLE-BY-ROLE SPECIFICATION — see `Nexora_Role_Specifications_AZ_Complete.md`

**[v2.1 CHANGE REQUIRED]** v2.0's Part 2, Section 20 delivered full A–P specification for 16 roles and a permission-bundle-only delta for the other 16. Per the change above, this is superseded: the companion document `Nexora_Role_Specifications_AZ_Complete.md` now delivers a complete, independent **A–Z specification** for all 32 built-in roles — Role Purpose, Scope, Dashboard, KPI Cards, Charts, Performance Information (Section 25-C), Navigation, Pages, Tables, Filters, Search, Actions, Permissions, Restrictions, Notifications, Reports, Drill-down, Audit Visibility, Mobile/Tablet/Desktop behavior, Role-Specific Workflows, Interaction with Other Roles, Customer Visibility, Loan Visibility, and Payment/Transaction Visibility, plus an explicit access matrix (can see / create / edit / approve / reject / assign / export / reverse / manage / cannot access, and exactly which branches, workers, customers, loans, and financial information the role can reach) for every role. Part 2 Section 20 of this SRS is retained only as a short index pointing to that document, so the requirement history stays traceable.

---

## 21. NO CASH PAYMENTS — CASHLESS PAYMENT ARCHITECTURE [EXPANDED — Nexora was already cashless in design; this makes it an explicit, enforced constraint]

**[EXISTING — PRESERVE]** Nexora has never specified a cash-collection feature: repayment happens by transfer into a Virtual Account, and no Collection Officer should manually record electronic payments. This revision does not remove an existing feature; it **closes a previously open gap**: nothing previously explicitly forbade a future "record cash payment" screen from being added, and no edge-case handling (duplicates, failed/delayed webhooks, unknown virtual account, reversals) was specified. Both gaps are closed here.

**[NEW REQUIREMENT — explicit prohibition]** The product **must not** contain, at any point in its lifetime: a "Record Cash Payment" action, a "Cash Collected" field on any Collection Officer screen, or any manual repayment-entry form of any kind, for any role. The only way a repayment or savings deposit is recorded is the automated webhook pipeline below. This is a permanent architectural constraint, not a default that a company setting can turn off — cashlessness is enforced by *what the application does not build*, not by a toggle that could be switched.

**Full pipeline (expands the prior 12-step webhook list into a resilient, exception-aware pipeline):**

```
Customer → transfers to their Dedicated Virtual Account (Section 22)
        → Bank / Payment Provider
        → Webhook received by Nexora
        → [1] Signature verification
        → [2] Idempotency check (dedupe by provider transaction reference)
        → [3] Transaction genuineness confirmed with provider (where the provider supports a verify-callback, Nexora confirms rather than trusting the webhook body alone)
        → [4] Resolve Virtual Account → Customer
        → [5] Resolve Customer's active Loan(s) (Section 23 handles multiple-loan customers)
        → [6] Payment Allocation Engine (Part 2, Section 35 — loan vs. savings split)
        → [7] Loan Repayment recorded + Savings recorded
        → [8] Digital Collection Ledger updated
        → [9] Accounting entries posted
        → [10] Receipt generated
        → [11] Notifications sent (customer + assigned Collection Officer + Branch Manager)
        → [12] Audit log entry recorded
        → [13] Dashboards updated (real-time, not batch)
```

**Exception handling — each is a defined, first-class system state, not an unhandled edge case:**

| Exception | Handling |
|---|---|
| **Duplicate webhook** | Provider transaction reference is the idempotency key; a second webhook for the same reference is acknowledged (200 OK to the provider, so it stops retrying) but produces no second ledger entry — logged as a "duplicate suppressed" audit event. |
| **Duplicate transaction from provider (genuinely two transfers)** | Processed as two separate payments — allocation engine applies twice, sequentially. |
| **Failed webhook delivery** | Nexora does not rely on delivery alone: a scheduled reconciliation job periodically pulls the provider's transaction list per virtual account and diffs it against Nexora's recorded payments — this periodic synchronization is a concrete, scheduled job, not an aspiration. |
| **Delayed webhook** | Processed normally on arrival; the payment's *value date* is the provider's transaction timestamp, not Nexora's receipt timestamp, so late-arriving payments still land in the correct day's ledger. |
| **Invalid/malformed webhook** | Rejected at signature/schema validation, logged to a Webhook Exceptions queue (visible to Finance Manager / IT Administrator, Part 2 §20), never silently dropped. |
| **Payment received but allocation failed** (e.g. loan already closed, ambiguous multi-loan case not resolvable automatically) | Funds are still recorded as **received into the customer's account** (money is never "lost" from the system's perspective) but flagged as an **Unallocated Payment Exception**, routed to Branch Manager/Finance for manual allocation review — this manual step allocates an already-verified payment; it never substitutes for the verification step itself, preserving the no-manual-repayment-entry rule. |
| **Unknown virtual account** (reference doesn't match any customer) | Held as an **Unmatched Payment**, visible to Finance/Head Office, with the provider's raw account/reference details, for investigation — never silently discarded. |
| **Reversed transaction** (chargeback/reversal from provider) | Creates a linked **reversal entry** against the original payment (never edits/deletes the original), reverses the same repayment/savings split that was originally applied, and re-audits the loan/savings balances — full before/after trail preserved per Section 23. |
| **Partially processed transaction** (pipeline failure mid-way, e.g. after ledger update but before accounting post) | Each pipeline step is a discrete, individually-retryable job in a queue with per-step status tracking; a stuck payment is visible in an **Incomplete Processing** queue rather than silently appearing "done" in one system and "missing" in another. |
| **Provider downtime** | Nexora queues confirmed-but-unprocessed webhooks and continues the reconciliation-diff job once the provider recovers; no payment confirmed by the provider is ever lost due to Nexora-side downtime. |
| **Reconciliation exceptions generally** | Surfaced in a dedicated Reconciliation module (Part 2, Section 39) as a persistent, resolvable-item list — not a report that is generated and forgotten. |

## 22. DEDICATED VIRTUAL ACCOUNTS [v2.1 CHANGE REQUIRED — generation moved to customer onboarding]

**[EXISTING — PRESERVE]** Nexora requests one permanent Virtual Account per customer from the company's configured payment provider (each company configures its own payment provider integration in company settings — API credentials, webhook endpoint, and account-issuance settings), storing Bank Name, Account Name, Account Number, Provider, Reference Number, Date Created.

**[v2.1 CHANGE REQUIRED]** v2.0 of this document stated: *"After loan approval, Nexora requests one permanent Virtual Account per customer... the account is generated once, on a customer's first loan approval, and is permanent."* This tied account existence to a customer having received at least one loan. The v2.1 clarification is explicit: **every registered customer must have a permanent dedicated Virtual Account, independent of whether they have ever applied for or been approved for a loan.** The v2.0 behavior (generate on first loan approval) is superseded by the rule below; a company that never disburses a loan to a customer must still be able to receive a savings-only deposit into that customer's account from day one.

**Ownership model — unchanged and reaffirmed:**

```
One Customer
  → One Permanent Virtual Account
    → Many Loans
      → Many Payments
```

The Virtual Account belongs to the **customer**, never to an individual loan. A customer never receives a different Virtual Account because they take out another loan.

**[v2.1 NEW REQUIREMENT — generation timing]**

- **When generated:** as part of the **customer onboarding flow**, immediately after the customer record is successfully created (Customer Registration, Part 2 Section 27) and the company's payment-provider configuration is available. Generation does **not** wait for a loan application, loan approval, or disbursement of any kind.
- **Hard requirement:** the account must exist **before the customer's first payment of any kind** — whether that payment is a loan repayment, a savings deposit, or any other credit to the customer's account. Nexora must never be in a state where a customer can attempt to pay but has nowhere to pay into.
- **If provider generation fails at onboarding:** the customer record is still created (customer onboarding is not blocked by a payment-provider outage), but the customer is placed in a **"Virtual Account Pending"** status, visible to Branch Manager/Finance, with automatic retry; a loan cannot be **disbursed** to a customer still in this status (this specific block is carried forward from v2.0's original "cannot disburse without an account" rule — only the trigger point moved from loan-approval-time to onboarding-time).
- **Who generates it:** the company's configured payment provider, via API call from Nexora at customer-creation time.
- **Linkage:** the Virtual Account record stores `customer_id`, and through the customer record inherits `company_id` and `branch_id` — it is never generated or stored independent of its owning customer and tenant.

**Virtual Account record fields:**

| Field | Notes |
|---|---|
| Company ID | inherited from customer |
| Branch ID | inherited from customer |
| Customer ID | owning customer — permanent link |
| Provider | the payment provider that issued the account |
| Bank Name | provider-supplied |
| Account Name | provider-supplied |
| Account Number | provider-supplied |
| Provider Reference | provider's own reference for the account |
| Creation Date | server timestamp at generation |
| Status | Active / Pending / Replaced / Closed |

**Provider-forced replacement:** if the payment provider requires the account to be replaced (e.g. a provider-side migration), Nexora preserves the full history of the old account (never deletes it — Status becomes `Replaced`) and links the new account to the **same** customer. The customer-facing identity (which account to pay into) is always "whichever account is currently Active for this customer" — historical accounts remain visible in the audit trail but are not shown as the current payment destination.

**Identifying the customer/loan from a payment:** the Virtual Account → Customer link is the identification step (payment pipeline step 4, Section 21); if the customer holds multiple active loans, Loan identification uses the company's configured allocation-priority rule (Part 2, Section 35 — e.g. oldest-loan-first, or a manually-tagged "priority loan"). The Virtual Account itself carries no loan-specific data at all — it is not a loan-level account, and the allocation engine (not the account) decides which loan(s) a payment serves.

**Multiple active loans:** the Payment Allocation Engine applies the repayment/savings split across the priority-ordered loan(s) until the payment is exhausted (mirrors the multi-cycle allocation example of Section 24, extended to multi-loan rather than only multi-cycle).

**Receipts, ledger, accounting, dashboards:** update exactly per the pipeline in Section 21, steps 8–13.

---

## 23. LOAN WORKFLOW [CHANGE REQUIRED — configurable approval chain; v2.1 lifecycle diagram corrected]

**[v2.1 CHANGE REQUIRED]** v2.0 stated the core lifecycle as: *"Customer Registration → Loan Application → Document Collection → Review → Credit Assessment → Approval → Virtual Account → Disbursement → Active Loan → Repayments → Overdue → Completed."* Because Section 22 now generates the Virtual Account at **onboarding**, not at loan approval, "Virtual Account" is removed from this sequence as a loan-stage step — it already exists by the time any loan reaches this workflow. The corrected lifecycle is:

`Customer Registration (Virtual Account generated here — Section 22) → Loan Application → Document Collection → Review → Credit Assessment → Approval → Disbursement (blocked only if the customer's Virtual Account is still "Pending" — Section 22) → Active Loan → Repayments → Overdue → Completed.`

**[CHANGE REQUIRED]** The rule previously stated plainly: *"Only Head Office can disburse loans."* This is now **configurable per company**, because the same requirement set explicitly calls for company-specific approval chains (Company A: Collection Officer → Branch Manager → GM → Disbursement; Company B: Loan Officer → Credit Officer → Credit Manager → MD → Disbursement). The original rule becomes the **default** approval-chain template (a company that changes nothing behaves exactly as originally specified — Head Office disburses), but companies can define their own ordered chain of roles.

**Configurable Approval Workflow model:**
- A company defines one or more **Approval Chain templates**, each an ordered list of Roles (not individuals) that a loan application must pass through, e.g. `[Collection Officer (submit), Branch Manager (review), GM (approve), Disbursement]`.
- A loan product (Part 2, Section 29–30) is associated with an Approval Chain template, so different loan products can use different chains (e.g. small loans use a short chain; large loans route through Credit Committee-style roles).
- At each stage, the loan carries a status matching that stage (`Submitted`, `Under Branch Review`, `Under Credit Review`, `Approved`, `Disbursed`, etc.) and only a user holding the role assigned to the *current* stage — at the correct scope (their branch, or company-wide) — can move it to the next stage. A user with the right role but wrong scope (e.g. a Branch Manager of a different branch) cannot act on it.
- Every stage transition is captured for Section 23-style audit (actor, role used, previous status, new status, timestamp, optional reason — required for rejections).
- Rejection at any stage returns the loan to a defined prior status (configurable per chain — either back to the applicant or back one stage) rather than a dead end.

## 24. PAYMENT ALLOCATION [EXISTING — PRESERVE, ENGINE FORMALIZED]

**[EXISTING — PRESERVE]** Given a daily expected repayment + savings figure, a payment is allocated automatically:

- Exact expected amount → full repayment + full savings, as configured.
- Less than expected → applied to repayment first, savings absorbs the shortfall (down to zero).
- More than expected → excess goes to savings, or — if it exceeds a full cycle — rolls forward to the next cycle's repayment, per company-configured allocation rules (illustrated by the ₦16,000/₦24,000 multi-cycle example: a ₦24,000 payment against a ₦16,000 daily expected figure leaves ₦8,000 excess, which is routed to savings unless it completes a full repayment cycle, in which case it rolls forward to reduce the next cycle's expected repayment).

**[EXPANDED]** This is formalized as a configurable **Allocation Engine** per company/loan product, because different institutions prioritize differently (some prioritize savings before excess principal, some allow customers to over-pay principal directly). The engine's inputs are: expected repayment, expected savings, amount received, current loan balance, current cycle, and the company's configured priority order; its output is a structured allocation record (this loan's repayment amount, this loan's savings amount, any rollover) that step 6 of the payment pipeline (Section 21) writes to the ledger.

---

## 25. AUDIT AND TRANSPARENCY [EXISTING — PRESERVE, FIELD SET COMPLETED]

**[EXISTING — PRESERVE]** Nexora has an audit log module. This revision completes the field set every audit entry must carry, per the new requirement:

| Field | Notes |
|---|---|
| User | who performed the action |
| Role used | which active role assignment was in effect (relevant when a user holds multiple roles — Section 16) |
| Company | tenant scope |
| Branch | branch scope, where applicable |
| Date & Time | server timestamp, not client-supplied |
| Action | what happened (create/approve/disburse/reverse/suspend/etc.) |
| Previous value | pre-change state, for edits |
| New value | post-change state |
| Reason | required for sensitive actions (rejections, reversals, suspensions, terminations) |
| Transaction reference | linking a financial action back to its source payment/webhook where applicable |
| Device/IP | captured where available |

**Full traceability chain (matches the requirement's own diagram):** `Payment → Webhook → Transaction → Customer → Loan → Allocation → Ledger → Accounting → Branch → Collection Officer → Audit Log.` Every link in this chain is a foreign-key relationship in the data model, not a report-time join guess — an auditor can click from any node to any adjacent node (Part 2, Section 20 specifies exactly which roles can see which parts of this chain).

---

## 25-A. STANDARD PERFORMANCE VOCABULARY [v2.1 NEW REQUIREMENT]

**[v2.1 NEW REQUIREMENT]** Terms like Expected, Actual, Outstanding, and Overdue were previously used throughout this specification without a single controlling definition. v2.1 makes this an explicit, binding vocabulary. **Every dashboard, report, and API response in Nexora must use these exact definitions — no dashboard, role, or module may define its own variant calculation.**

| Term | Definition |
|---|---|
| **Expected** | The amount scheduled/due for the selected date or period, per the customer's repayment schedule (and, for savings, the scheduled savings contribution). |
| **Actual** | The verified electronic amount successfully received and allocated/recognized for that date or period — sourced exclusively from the payment pipeline (Section 21); never a manually entered figure. |
| **Outstanding** | `Expected − Actual`, for the portion that remains unpaid as of "now," within the current, not-yet-overdue period. |
| **Overdue / Default** | The amount that remains unpaid **after** the configured due-date and overdue rules are triggered (i.e., Outstanding that has crossed the company's configured grace/overdue threshold). |
| **Collection Rate** | `Actual ÷ Expected × 100`, subject to the company's configured handling for zero-Expected periods (e.g. a branch with no collections due today does not show a misleading 0% or divide-by-zero — it is displayed as "No Collections Due" or equivalent, per company configuration). |
| **Expected Savings / Actual Savings** | The savings-side equivalents of Expected/Actual, calculated identically but against the savings component of each customer's schedule. |
| **Savings Variance** | `Actual Savings − Expected Savings` (may be positive, where a customer overpaid into savings per the allocation engine's rules, Section 24). |
| **Customers Expected** | Count of customers with a scheduled repayment and/or savings contribution due for the selected date/period. |
| **Customers Paid** | Count of customers, from the Customers Expected set, whose Actual for that date/period fully or partially matches their schedule per the company's "counts as paid" configuration (fully-paid-only vs. partial-counts, company-configurable). |
| **Customers Missed** | `Customers Expected − Customers Paid` for that date/period. |

These definitions apply identically whether the figure is being computed for a single Collection Officer, a branch, an area, or the whole company (Section 25-B) — the words never mean something different depending on which dashboard is showing them.

## 25-B. PERFORMANCE CALCULATION HIERARCHY [v2.1 NEW REQUIREMENT]

**[v2.1 NEW REQUIREMENT]** Nexora calculates performance hierarchically from the same underlying verified financial records (the payment pipeline, Section 21) — never independently per dashboard.

```
Customer
  → Group
    → Collection Officer
      → Branch
        → Area (where Area Manager scope applies)
          → Company
```

At **every** level of this hierarchy, Nexora calculates the same field set, using the same definitions from Section 25-A:

- Expected, Actual, Outstanding, Overdue/Default, Collection %
- Expected Savings, Actual Savings, Savings Variance
- Customers Expected, Customers Paid, Customers Missed

**Reconciliation rule (mandatory, enforced at the data layer, not just by convention):**

- `Branch Total = SUM(its permitted underlying customer/loan records)`
- `Company Total = SUM(all permitted branches)`
- `Collection Officer Total = SUM(their assigned customer/group records)`
- `Area Total (where applicable) = SUM(its assigned branches)`

All totals at every level must reconcile to the level below. **No dashboard, report, or API endpoint may compute a performance figure independently of the shared Performance Calculation Service described below** — every screen in Sections 20 (Part 2) and the Role Specification Library consumes this same service's output; none re-derives its own numbers from raw tables.

**Real-time requirement:** performance figures recalculate the moment a verified electronic payment clears the pipeline (Section 21, step 13) — not on a batch/nightly schedule. A payment received at 2:14pm is reflected in every authorized dashboard (Collection Officer's own figures, their branch's figures, and the company total) by the time step 13 completes, not the next day.

**Manual entry is structurally impossible:** because every figure in this hierarchy derives from the payment pipeline (Section 21) and the repayment schedule (the Digital Collection Ledger logic, Part 2 Section 37), and because no manual repayment-entry screen exists anywhere in the product (Section 21's permanent constraint), performance figures can never depend on, or be distorted by, a manually typed collection number, at any level of this hierarchy.

## 25-C. COMPANY, BRANCH AND WORKER PERFORMANCE VISIBILITY LAYER [v2.1 NEW REQUIREMENT — shared system capability]

**[v2.1 NEW REQUIREMENT]** This is the most significant addition in the v2.1 revision. v2.0 treated company/branch performance visibility as something that happened to live on the MD and GM dashboards, and treated the Collection Officer leaderboard as a GM-specific feature. That is now corrected: **performance visibility is a shared system capability, built once as a reusable engine, and granted to whichever roles have the scope and permission for it** — it does not belong exclusively to MD, GM, or Branch Manager, and it is not reimplemented per role.

**The same underlying Performance Engine (Section 25-B) is reused by every role granted performance permission**, including but not limited to MD, GM, HR Manager, Internal Auditor, Area Manager, Branch Manager, Operations Manager, Compliance Officer, and any Custom Role granted the permission. **The difference between roles is SCOPE and PERMISSION, not separate calculation systems** — there is exactly one performance calculation engine in Nexora.

**Scope resolution (reuses the Scope Types of Section 18):**

| Scope held | What the user sees |
|---|---|
| Company-wide | Company totals, and every branch's row in the branch comparison table, and worker performance company-wide |
| Multi-branch (named set) | Totals aggregated across only their assigned branches, and only those branches' rows/workers |
| Single branch | That branch's totals, and only that branch's workers |
| Assigned customers/groups | Only their own personal performance figures, computed from only their assigned customers/groups |

**Permission is separate from scope:** holding a performance-visibility permission never grants any modification right. **Performance visibility is always read-only** — it exposes what the Performance Engine (Section 25-B) computes; it never exposes an edit, override, or manual-entry control of any kind. This holds even for roles (like MD) that separately hold unrelated edit/approval permissions elsewhere in the system — the performance screens themselves carry no write actions.

**A. Company Performance (shown to any role whose scope covers company-wide or the relevant multi-branch/branch subset):**

- Today's Total Expected Collection
- Today's Total Actual Collection
- Today's Collection Rate
- Today's Total Outstanding Collection
- Today's Total Overdue/Default Amount
- Today's Expected Savings
- Today's Actual Savings
- Active Customers
- Active Loans
- Total Branches (or, for a scoped role, total branches within their scope)
- Branches Meeting Target
- Branches Below Target
- Total Expected Collection across all permitted branches
- Total Actual Collection across all permitted branches
- Total Outstanding across all permitted branches
- Total Overdue/Default across all permitted branches

**B. Branch Performance Table** — every authorized company-wide or multi-branch performance dashboard provides a branch comparison table with, at minimum, one row per permitted branch:

| Column |
|---|
| Branch |
| Branch Code |
| Today's Expected Collection |
| Today's Actual Collection |
| Collection % |
| Outstanding |
| Overdue/Default Amount |
| Expected Savings |
| Actual Savings |
| Active Customers |
| Active Loans |
| Number of Customers Expected Today |
| Customers Paid Today |
| Customers Missed Today |
| Number of Collection Officers |
| Branch Target Status |

The table always includes a **Company Total row** (or, for a multi-branch-scoped role, a **Scope Total row**) aggregating every row shown to that user, per the reconciliation rule in Section 25-B.

**Table drill-down (identical mechanism company-wide, scoped per viewer):**

```
Branch → Branch Manager → Collection Officers → Customers → Groups → Loans
       → Repayment Schedules → Payments → Transactions → Audit Trail
```

This reuses the exact Head Office drill-down mechanic already specified in Section 10 — no second drill-down implementation exists.

**C. Worker Performance** — any role with the appropriate scope and permission can view a worker performance table:

| Column |
|---|
| Worker Name |
| Worker ID |
| Role |
| Branch |
| Assigned Customers |
| Assigned Groups |
| Expected Collection |
| Actual Collection |
| Collection % |
| Outstanding |
| Overdue/Default Amount |
| Customers Expected |
| Customers Paid |
| Customers Missed |
| Savings Expected |
| Savings Actual |
| Active Loans |
| Overdue Customers |

**Collection Officer Performance** is additionally exposed as its own dedicated, purpose-built view (not merely a filtered row of the general worker table) wherever a role's scope includes Collection Officers, because Collection Officers are the highest-volume worker type this table is used for.

**Scope enforcement for worker visibility (mirrors Section 18):**

- A **company-wide** user sees workers across every permitted branch.
- A **multi-branch** user sees only workers in their assigned branches.
- A **branch-scoped** user (e.g. Branch Manager) sees only that branch's workers.
- A **Collection Officer** (or any customer/group-scoped worker) sees only **their own** performance — never another Collection Officer's, another branch's, or company-wide figures — unless a separate, additional active role assignment (Section 16) independently grants that broader scope.

**D. Cross-cutting rules that apply to every role granted this capability, without exception:**

1. Performance figures are calculated automatically from Nexora's verified financial data (Section 21/25-B) and must never depend on manually entered collection figures.
2. Performance data updates in real time when a verified electronic payment is processed (Section 25-B).
3. The same underlying Performance Engine is reused across every role granted the permission — MD, GM, HR, Internal Auditor, Area Manager, Branch Manager, Operations Manager, Compliance Officer, and any other role or Custom Role granted it.
4. Performance visibility never grants permission to modify financial records, approve, reverse, allocate, or otherwise act on the underlying data — it is strictly read-only, everywhere, for every role.
5. Which specific roles are granted this capability, and exactly which of the sections above (Company / Branch Table / Worker Performance) each one sees, is defined per-role in `Nexora_Role_Specifications_AZ_Complete.md`, field **F — Performance Information**, for every built-in role. HR Manager and Internal Auditor — previously the two roles most conspicuously missing this — are specified there with the following minimum guarantees:
   - **HR Manager** (company-wide HR scope): company collection performance, branch collection performance (expected vs. actual, outstanding, overdue/default, collection rate), Collection Officer performance, worker performance by branch, and staff deployment/coverage by branch — organized as a distinct **"Organization Performance"** workspace, separate from HR's existing **"People & Workforce"** workspace (Part 2, Section 20.7 as expanded in the Role Specification Library), so HR's existing people-management functions are unchanged and undiminished. HR gains no edit rights over loans, payments, or accounting from this visibility.
   - **Internal Auditor** (company-wide, read-only by design, Part 2 Section 20.8): company expected/actual/collection-rate/outstanding/overdue, expected/actual savings, branch performance comparison, Collection Officer and worker performance, customers expected vs. paid vs. missed, and the ability to identify branches with abnormal performance or workers/Collection Officers with unusual performance patterns — with drill-down extending the auditor's existing chain (Section 25) one level further: `Company → Branch → Worker → Collection Officer → Customer → Loan → Payment → Transaction → Ledger → Accounting → Audit Log`. This remains, like every other Internal Auditor capability, strictly read-only.

## 26. COMPANY BRANDING [EXPANDED — Nexora's color system generalized per tenant]

**[EXISTING — PRESERVE]** Nexora's own default visual identity is: bright royal blue / white / deep navy primary palette, Poppins typography, rounded cards, soft shadows. This remains Nexora's own fallback brand and the Platform Owner's portal theme.

**[NEW REQUIREMENT]** Per-company branding is configured during the company creation wizard (`Nexora_Platform_Owner_Portal_Spec.md`, Section 9: Create Company Wizard, and Section 10: Company Branding Preview), before the company becomes active:

- Company name, Logo, Primary color, Secondary color, Accent color, optional login background image, other brand tokens.
- A **live preview** of the company's own portal (login screen + a sample dashboard) renders during the wizard, using the entered values, before the Platform Owner finalizes creation.
- **Implementation requirement for Cline:** the entire frontend must consume color and brand values as **theme variables** (CSS custom properties / a theming context), never hard-coded hex values in components. Each company's `company_id` resolves to a stored theme record at session start; the same component tree renders with different visual identity per tenant without any per-company code branching. Nexora's own default palette (above) becomes the literal default values a new company's theme is pre-filled with, and the fallback used anywhere a company has not overridden a token.

---

*(End of Part 1 (v2.1). Part 2 continues with: Sections 26–61 — Customer Portal, Digital Collection Ledger detail, Reconciliation, Reports, Notifications, Custom Roles workflow, Security & Data Isolation implementation detail, Database/API/Frontend architecture notes for Cline, complete end-to-end user flows, and the full Changed / Added / Preserved requirement log. The companion document `Nexora_Role_Specifications_AZ_Complete.md` contains the full A–Z specification for every one of the 32 built-in roles and is the authoritative source for all dashboard, permission, and workflow detail per role — Part 2 Section 20 is now a short index into that document rather than the specification itself.)*
