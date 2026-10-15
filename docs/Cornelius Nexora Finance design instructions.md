# Cornelius Nexora Finance design instructions

**Status:** complete design brief, written from the audited backend.
**Authority:** `docs/verification/VISION-v3.9-AUTHORITY.txt` — Vision v3.9 FINAL CLEAN AUTHORITY.
**Prepared:** Stage 14 of Part 16 (the design instructions), written only after the Vision Audit (Stage 13).

> **Reconciled with the implemented design.** This brief describes every screen,
> state, role and colour rule, and that substance still holds. The visual
> identity it was written against has since been replaced by the owner's
> reference site (`cornelius-adedeji-victor-website.vercel.app`).
>
> **Read `docs/DESIGN-SYSTEM.md` first** — it is the authority for typography,
> colour values, radii, spacing, depth and motion, and it is enforced in CI by
> `npm run verify:design`. Where this brief and `docs/DESIGN-SYSTEM.md` disagree
> on a visual value, the design system wins.
>
> What changed that affects how you read this brief:
> - The typeface is **Fraunces / Inter / JetBrains Mono**, not Poppins.
> - The accent colour law (RULE 13.1–13.9) is **unchanged** and still binding.
>   Everything below about the company colour still applies exactly.
> - Spacing, radii, shadow strategy and the section rhythm are now the
>   design system's, not the values quoted below.

---

## 0. Who this document is for, and what it assumes

You are designing the front end of **Cornelius Nexora Finance**. You have not seen the backend, the database, or the
vision's rule numbering, and you do not need them. This document is self-contained: it explains the product, then every
screen, every state and every colour rule, and — as much as what.

Two hard rules before you start:

1. **The backend is the truth.** Every screen, field, state, permission and error named here already exists in a working
   backend and has been audited against the vision. If something is not described here, it does not exist and must not be
   drawn. Do not design screens for rules that are not yet real.
2. **This is a financial operating system, not a dashboard product.** Denseness is the point. A Collection Officer
   working a phone in daylight needs forty customers' worth of state visible without scrolling theatre. An empty screen is a
   bug unless the underlying data is genuinely empty, in which case the screen says so plainly.

Names used here (`/money`, `/approvals`, `nx-stat`, role keys such as `collection_officer`) are the names already in the
product. Keep them. They map one-to-one onto real pages.

---

## 1. The product in plain language

**Cornelius Nexora Finance is a multi-tenant microfinance operating system sold as software.** A lender company (the
*tenant*) rents it. Inside one company's workspace, its staff run lending operations end to end: branches, workers,
customers, group lending, loan applications, approval chains, disbursement to virtual accounts, payment collection,
reconciliation, accounting, performance, audit and compliance.

The whole product is built on a small number of non-negotiable beliefs, and your design must express all of them:

- **Money is never typed in by a person.** Payments exist only because a payment provider's webhook said so. There is no
  screen anywhere — for any role — with a "record a payment" form. If you design one, the product is wrong.
- **Nothing financial is ever edited or deleted.** Corrections are new, linked, audited entries. Audit entries are
  append-only for everyone, including the platform owner.
- **A person is identified by their full name.** The username *is* the full name. The first password *is* `@` plus the
  first name. No exceptions, and nothing is emailed to anyone.
- **Nobody sees another company's anything.** Tenancy is enforced in the database, not by the interface. Your design must
  never imply otherwise, and must never offer a company switcher.
- **The company's colour is a highlighter.** It marks what to act on and where you are. It is never a background.

### 1.1 The five login worlds

A person signs in once. Which world they land in is decided by their role assignment, never by a different login screen.
Every company user sees the same login structure, including the MD, the Auditor and the Collection Officer.

| World | Who | Where |
|---|---|---|
| Platform Owner | You, and only you | `nexora.app` (the platform console) |
| Company Head Office | MD, Deputy MD, GM, Assistant GM, Finance, HR, Internal Auditor, MIS, IT, and every other Head Office role | `{company}.nexora.app` |
| Company branch | Branch Manager, Deputy Branch Manager, Collection Officer, Recovery Officer | `{company}-{branch}.nexora.app` |
| Customer | The borrower | The customer portal, at the company's portal URL |
| Webhook ingress | Payment providers (not a person) | `…/webhooks/{provider}` |

**The Head Office and the branch are the same portal at different URLs.** A Head Office role may inspect any branch by
choosing a branch inside the portal (the *Branch Workplace*) — with no second password. A branch worker signing in at the
branch URL reaches only his own branch's records and never sees the Branch Workplace.

### 1.2 The company is the brand owner

Inside a company's workspace, everything is that company's: name, logo, colour, on the login screen, the sidebar, page
headers, exported PDFs, receipts, and the browser tab. The platform's own name appears only in the Platform Owner portal, in
platform audit records, or in an optional "powered by" line the owner can switch on. A company without a logo shows its
name in a styled placeholder — never a broken image.

---

## 2. The cast of users

Every role, what the person does all day, what they must see first, and what they must never see. Section 4 gives each
role its own pages.

### Platform Owner
Creates and brands companies, hands over the MD's first credential, watches platform health, publishes announcements,
manages platform-wide settings, and opens time-bound support access. **Sees first:** companies needing action, platform
health, announcements. **Never sees:** a company's customers, loans, payments or accounting, except inside an explicit,
time-bound, audited support session.

### Managing Director (MD)
Owns the company. Decides everything, authorises provider changes, and authorises at the end of any approval chain.
**Sees first:** portfolio outstanding, collected today, approvals waiting on him, branches live. **Never:** edits money,
enters a payment, bypasses his own credential ritual, or sees another company.

### Deputy MD
The MD's stand-in so leadership never depends on one person. Same board, with Control read-only unless the MD delegates a
specific change (and every delegation is audited against both people).

### General Manager
Runs day-to-day operations and is normally a mid-chain or final approver. Branch Performance, Workers, Approvals, Credit,
Providers (subject to MD authorisation), Reports, Audit. **Cannot** change branding unless granted, or approve his own
provider change.

### Assistant GM
Operational cover for the GM. Views everything the GM views; approves only where the chain includes this role.

### Operations Manager / Assistant Operations Manager
Process, branch operations, service levels, acting on exceptions. The Assistant cannot create branches or change settings.

### Head Office Administrator
Executes configuration day to day: company profile, branding, role enable/disable, branches, workers (view).

### Finance Manager, Accountant, Assistant Accountant, Cash/Bank Reconciliation Officer
The truth of money. Work and close reconciliation exceptions with notes, prepare and route reversal/correction requests,
produce statements and exports, and add or change a branch's provider subject to MD authorisation. **They may never enter
or edit a payment, allocation, balance or ledger figure, and never delete a record.**

### HR Manager / HR Officer
Create workers, hand over credentials, manage temporary and acting roles, freeze, hold, transfer, re-issue credentials, and
maintain passport and profile details. **Never** financial data beyond what a portfolio hold requires.

### Internal Auditor, Audit Officer, Compliance Officer, Risk Officer
Read everything, walk the entire traceability chain from any node, open any Branch Workplace, open any worker's book,
record findings, export. **They never approve, never disburse, never edit.** An auditor who can change the thing they
audit is not an auditor.

### Credit Manager / Credit Officer
Products, approval chains, credit assessment, applications in flight, the disbursement register. The Credit Officer works a
defined queue; the Credit Manager owns assessment standards.

### Customer Service Manager / Customer Service Officer
Look up customers and their real records, raise and resolve service tickets, raise refund/correction requests to Finance,
view branch groups and loans. **Never** approve money.

### Area Manager
Several branches in a defined area: area performance, his branches, worker performance inside the area.

### Branch Manager / Deputy Branch Manager
Run their own branch: groups, customers, loans and applications, collections ledger, awaiting-allocation queue, branch
notifications. **Never** the Branch Workplace (prohibition 16).

### Collection Officer
The field worker. His own customers, his own groups, register a customer, start a loan application, his collections ledger,
the payments awaiting his allocation, record visits, his own performance. **He may never** see another worker's book, the
company's performance as a whole, or any control surface.

### Senior Collection Officer
His own figures plus his juniors' open overdue cases. **Still** no branch-wide and no worker-wide table.

### Recovery Officer
His own overdue cases, the contact log, escalations, his own recovery figures.

### MIS / Reporting Officer
The report library, the performance views, and the audit trail's metadata. Read-only on money.

### IT / System Administrator
Provider health, webhook exceptions, integration settings, system logs, technical audit, sessions. **Never** a company's
financial figures.

### The Customer
Borrows, repays, and sees only their own records. No other customer's data exists on their screen.

---

## 3. The screens

### 3.1 Splash and first load (the company's own branded boot)

Before the app is interactive, show the **company's** logo and name on a neutral surface, a thin accent progress line, and
one short line of truthful status. Then, in order:

1. `GET /theme` resolves the host's branding (pre-auth, so the login screen is already branded).
2. The stored session is checked (`POST /auth/refresh`), so a returning user never sees the login screen again.
3. The session's principal is read (`GET /auth/me`).

Four outcomes, and only these four — never a fifth "error, try again later" screen that hides which one happened:

| Outcome | What the user sees |
|---|---|
| No session | The login screen |
| Session incomplete | The credential ritual (§3.2) |
| Session complete | Their role workspace |
| Cannot reach the server | A neutral, branded, honest message with a **Retry** action |

The boot screen must never show a spinner over an empty frame, and must never claim to be "loading your data" when it is
actually waiting on a token check.

### 3.2 Authentication and the credential ritual

**Login.** One card. Username (their full name), password, and — only after the server says a second factor is needed — an
authenticator code field. Failure messages must never reveal whether an account exists.

**The ritual is four steps, in order, and the user cannot skip ahead:**

1. **Change password.** The server refuses the old password once consumed; the new one may not equal the initial
   credential, the username, or any part of the person's name.
2. **Authenticator setup.** A one-time secret is shown exactly once, with the QR/`otpauth` URI. It is never emailed,
   logged, or retrievable again.
3. **Authenticator verification.** Only a correct live code binds it. Setup alone never counts.
4. **Profile completion.** The fields the company needs.

Design consequences: a **stepper** at the top naming all four steps with the current one active and completed ones ticked;
no future step is clickable; the "skip for now" affordance must not exist. On success the ritual hands back a fresh
session and the user lands in their workspace.

**Platform Owner sign-in is different in one respect only:** the owner is explicitly not exempt from security, so if no
authenticator is enrolled the server refuses the session and the console routes to a one-time enrolment screen (generate
key → verify code → sign in).

### 3.3 The shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [logo] Company Name        [⌘K command palette]        🔔 3   avatar ▾        │  header
├───────────────┬──────────────────────────────────────────────────────────────┤
│ Role workspace│                                                              │
│  ▸ Command    │                    page content                              │  sidebar
│  ▸ Money      │                                                              │  (accordion)
│  ▸ People     │                                                              │
│               │                                                              │
│ Sign out      │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- **Sidebar:** the role's own groups, collapsible accordions, the active group auto-opened on arrival. Each item shows an
  icon and a label. Only the signed-in user's own groups exist — there is no "all roles" menu.
- **Header:** company logo and name, the command palette trigger (`Ctrl/⌘+K`), the notification bell with an unread count,
  and the avatar menu (My profile → change password, role lens, sign out).
- **Role lens:** when a person holds more than one role, the header lets them choose which lens the session uses. It
  changes what they can see, never what exists.
- **Breadcrumbs:** every page above the title, as words that are also links.
- **Command palette:** searches only the pages the signed-in role can already open. It must never list a page that would
  then refuse.

### 3.4 The landing summary (dashboard) of a role

Not a generic dashboard. Each role has its own four-to-eight vital figures, drawn from its own descriptor, then named
groups that open on click. Never show everything at once; never show a chart a role cannot act on. If a figure cannot be
computed for that role, it reads `—`, not `0`.

### 3.5 Screens, one by one

| Screen | Route | What it is for | What is on it | What happens on click |
|---|---|---|---|---|
| Money & ledger | `/money` | Six statements from one journal | Tabs: cash book, trial balance, ledger, cash flow, income statement, financial position; a from/to date range that actually drives the figures | Row opens the ledger account; amounts are never editable |
| Reconciliation | `/reconciliation` | Settlement exceptions | Tabs: matching exceptions, unmatched payments, unallocated payments, corrections; Resolve and Dismiss with a mandatory note | Resolve closes the exception with a note; Dismiss records it as benign |
| End of day | `/eod` | The company-wide settlement step | Last run's figures and the manual run | Run requires a Head Office operating role and a confirmation dialog naming what changes |
| Branch registry | `/branches` | Every branch | Code, name, status, portal URL, counts; create/open/suspend/reactivate/close | Lifecycle actions open a confirm dialog with a reason |
| Branch workplace | `/workplace` | Inspect a branch you supervise | A branch picker, an overview, the branch's workers, and any worker's full book | Choosing a branch is audited; opening a worker's book leaves no trace in that worker's session |
| Workers | `/people` | The worker directory | Search, status filter, pagination; create worker | Row opens the worker; create issues a one-time credential shown once |
| Worker detail | `/people/:id` | One worker | Profile, role assignments, status, reset password, assign role, hold portfolio | Every action is a confirm dialog with a reason |
| Roles & control | `/control` | Company configuration | Roles (enable/disable), permissions per role, loan products, approval chains | Toggling a role writes company configuration; permission edits are explicit saves |
| Customers | `/customers` | The customer register | Search, status filter; register customer | Row opens the customer |
| Customer detail | `/customers/:id` | One customer | Profile, savings and eligibility, portal access, loan history, suspend/reactivate/close | Loan rows open the application |
| Groups | `/groups` | Group lending | Group list; create group | Row opens the group |
| Group detail | `/groups/:id` | One group | Details, ledger, members, add member, close group | Members are customers with a group role |
| Applications & credit | `/credit` | The credit queue | Application list with status filter; new application | Row opens the preview-driven detail |
| Application detail | `/credit/:id` | One application | Customer, group, guarantor, loan cycle, terms, bank details, fees, stages, missing evidence; decide, withdraw, disburse | Decide moves the chain; disburse creates the virtual account, schedule, ledger and portal access atomically |
| Approvals | `/approvals` | Your own inbox only | Loan decisions, correction requests, provider changes; each with its own decision dialog | Approve/reject/request information — all recorded with your name, role and reason |
| Providers | `/providers` | Payment providers | Configured connections and the shipped registry; add, test, approve | A connection stays inactive until a **real** successful test and the MD's authorisation |
| Webhooks & health | `/technical` | Technical surfaces | Webhook exceptions, provider health, integrity checks, sessions | Retrying a webhook re-runs the pipeline idempotently |
| Traceability chain | `/trace` | Walk money end to end | Node-type and id to start from, then every record and every relationship, plus anything the chain could not reach | Walk again from any node |
| Audit trail | `/audit` | What happened, to whom | Filters for action, entity and transaction reference; every entry opens its before/after values | Audit entries are never edited or deleted |
| Field | `/field` | The Collection Officer's book | My book, awaiting allocation, visit log; allocate a verified payment; record a visit | Allocation splits the verified amount into repayment and savings and must balance exactly |
| Recovery | `/recovery` | Overdue cases | My cases, escalations, watch alerts; run the ladder; resolve with a note | Resolving keeps the trail |
| Service | `/service` | Customer queries that touch money | Correction requests and the payment explorer; raise a correction | A correction is a *request*; an authorised approver decides it |
| Reports | `/reports` | The report library | Company, branch and staff tables for a period, with CSV export | Exports are the company's own documents |
| Performance | `/performance` | Period performance | My figures, branches, staff | Same engine as the reports — the numbers must agree |
| Notifications | `/notifications` | Your own inbox | Unread filter, mark read, mark all read | Nothing else, ever — other people's notifications do not exist here |
| Your account | `/profile` | Your session | Identity, roles held, role lens, change password | Password change requires a live authenticator code |
| Capability | `/capability/:key` | Honest gaps | What the workspace expects, whether the platform has it, and where the real surface is | States the truth; never dresses absence as work in progress |

### 3.6 The Platform Owner portal

A separate application, never reachable from a company URL. Companies list, a create-company wizard with a **live branding
preview** (logo, colour and login background update as you type, including a sample dashboard), a one-time credential panel
shown once and never retrievable, activation/suspension/reactivation with mandatory reasons, global settings,
announcements, platform health, platform activity, platform audit, AI configuration, and support access (an explicit
request naming the company and a reason, time-bound and logged). The owner's accent is green; it is never switched to a
company's colour, and a company is never shown green.

---

## 4. Every role, one by one

Thirty-eight workspaces exist: 29 live roles plus 9 custom-role templates. Each is written out separately below, with its landing summary, its navigation groups, the pages inside each group, the actions it offers, the actions it must never offer, and the Branch Workplace rule that applies to it. Naming is taken directly from the built navigation model, so every page listed here exists in the product.

### 4.1 MD Board `md`

**Purpose.** Owns the company; sees everything, decides everything, authorises at the end of any chain.

**Landing summary.** Portfolio outstanding · Collected today · Pending approvals · Branches live

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Command**
  - Command dashboard `/`
  - Performance `/performance`
  - Reports `/reports`
- **Money**
  - Money & ledger `/money`
  - Reconciliation `/reconciliation`
  - End of day `/eod`
- **Branches**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
- **People**
  - Workers `/people`
  - Roles & control `/control`
- **Customers**
  - Customers `/customers`
  - Groups `/groups`
- **Credit**
  - Applications & credit `/credit`
  - Approvals `/approvals`
- **Providers**
  - Payment providers `/providers`
  - Webhooks & health `/technical`
- **Approvals**
  - Approval inbox `/approvals`
- **Audit**
  - Audit trail `/audit`
- **Control**
  - Company control `/control`
  - Findings `/capability/findings`
- **Reports**
  - Report library `/reports`
  - Performance views `/performance`

### 4.2 Deputy MD Board `deputy_md`

**Purpose.** The MD's stand-in; the same board, with Control read-only unless the MD delegates a specific change.

**Landing summary.** Portfolio outstanding · Collected today · Pending approvals · Branches live

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Command**
  - Command dashboard `/`
  - Performance `/performance`
  - Reports `/reports`
- **Money**
  - Money & ledger `/money`
  - Reconciliation `/reconciliation`
- **Branches**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
- **People**
  - Workers `/people`
  - Roles & control (read) `/control`
- **Customers**
  - Customers `/customers`
  - Groups `/groups`
- **Credit**
  - Applications & credit `/credit`
  - Approvals `/approvals`
- **Providers**
  - Payment providers `/providers`
- **Audit**
  - Audit trail `/audit`
- **Reports**
  - Report library `/reports`

### 4.3 Operations hub `gm`

**Purpose.** Runs day-to-day operations; normally a mid-chain or final approver.

**Landing summary.** Branch performance · Pending approvals · Workers active · Collected today

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch performance**
  - Performance views `/performance`
  - Branches `/branches`
  - Branch workplace `/workplace`
- **Workers**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
  - Applications `/credit`
- **Credit**
  - Applications & credit `/credit`
- **Providers**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`
- **Audit**
  - Audit trail `/audit`

### 4.4 Operations hub (Assistant) `assistant_gm`

**Purpose.** Operational coverage for the GM: views everything the GM views, acts only where the chain includes this role.

**Landing summary.** Branch performance · Pending approvals · Workers active · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch performance**
  - Performance views `/performance`
  - Branches `/branches`
  - Branch workplace `/workplace`
- **Workers**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Credit**
  - Applications `/credit`
- **Providers**
  - Payment providers (view) `/providers`
- **Reports**
  - Report library `/reports`
- **Audit**
  - Audit trail `/audit`

### 4.5 Operations hub `operations_manager`

**Purpose.** Process, branch operations and service levels.

**Landing summary.** Branch operations · Process exceptions · Workers in branch scope · Pending approvals

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch operations**
  - Branch registry `/branches`
  - Branch workplace `/workplace`
  - Performance `/performance`
- **Process exceptions**
  - Exceptions queue `/reconciliation`
  - Webhook exceptions `/technical`
- **Workers (branch)**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Report library `/reports`

### 4.6 Operations hub (Assistant) `assistant_operations_manager`

**Purpose.** Operations support: branch inspection and process exception follow-up, minus configuration surfaces.

**Landing summary.** Branch operations · Process exceptions · Workers in branch scope · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Branch operations**
  - Branches (view) `/branches`
  - Branch workplace `/workplace`
  - Performance `/performance`
- **Process exceptions**
  - Exceptions queue `/reconciliation`
- **Workers (branch)**
  - Worker directory `/people`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Report library `/reports`

### 4.7 Administration hub `head_office_administrator`

**Purpose.** Executes the company's configuration day to day: profile, branding, roles, branches.

**Landing summary.** Roles enabled · Branches · Workers · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Company**
  - Company profile & branding `/control`
  - Roles `/control`
- **Branches**
  - Branch registry `/branches`
- **Workers**
  - Workers (view) `/people`
- **Providers (view)**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`

### 4.8 Finance hub `finance_manager`

**Purpose.** The truth of money: reconciliation, exceptions, reversals, settlements, statements.

**Landing summary.** Unallocated payments · Unmatched items · Collected today · Exceptions open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Reconciliation**
  - Settlement matching `/reconciliation`
  - Cash book `/money`
- **Exceptions**
  - Exceptions queue `/reconciliation`
  - Webhook exceptions `/technical`
- **Reversals**
  - Corrections & reversals `/reconciliation`
- **Settlements**
  - Settlement view `/money`
  - Provider status `/providers`
- **Statements**
  - Statements & ledger `/money`
  - Reports `/reports`
- **Provider status**
  - Payment providers `/providers`
- **Reports**
  - Report library `/reports`

### 4.9 Accounting hub `accountant`

**Purpose.** Postings, statements and schedules from the verified data.

**Landing summary.** Trial balance · Cash position · Collected today · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Ledger**
  - General ledger `/money`
  - Trial balance `/money`
- **Schedules**
  - Cash flow & schedules `/money`
- **Statements**
  - Income statement & position `/money`
  - Reports `/reports`
- **Reconciliation (assist)**
  - Reconciliation view `/reconciliation`
- **Reports**
  - Report library `/reports`

### 4.10 Accounting hub (reduced) `assistant_accountant`

**Purpose.** Accounting support: prepare schedules, view the ledger, assist reconciliation.

**Landing summary.** Trial balance · Cash position · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Ledger (view)**
  - General ledger `/money`
- **Schedules**
  - Cash flow & schedules `/money`
- **Statements (assist)**
  - Statements `/money`
- **Reconciliation (assist)**
  - Reconciliation view `/reconciliation`
- **Reports**
  - Report library `/reports`

### 4.11 Reconciliation hub `cash_bank_reconciliation_officer`

**Purpose.** Matches provider settlements to internal records and triages exceptions before Finance sees them.

**Landing summary.** Unmatched settlements · Unallocated · Exceptions open · Collected today

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Settlement matching**
  - Matching queue `/reconciliation`
- **Exceptions**
  - Exceptions queue `/reconciliation`
- **Provider statements**
  - Provider statements `/providers`
  - Cash book `/money`
- **Reports**
  - Reconciliation reports `/reports`

### 4.12 HR hub `hr_manager`

**Purpose.** Owns the workforce: who is here, how they perform, what happens to their seats.

**Landing summary.** Workers · Active today · Role assignments open · Branches

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **People**
  - Worker directory `/people`
  - Create worker `/people`
  - Account controls `/people`
- **Role assignments**
  - Assignments `/people`
  - Role catalogue `/control`
- **Worker performance**
  - Staff performance `/performance`
- **Organisation performance**
  - Company & branch performance `/performance`
  - Reports `/reports`

### 4.13 HR hub (reduced) `hr_officer`

**Purpose.** HR operations under the HR Manager: records, attendance and performance views.

**Landing summary.** Workers · Active today · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **People**
  - Worker directory `/people`
  - Create worker (where granted) `/people`
- **Records**
  - Worker records `/people`
- **Worker performance (view)**
  - Staff performance `/performance`

### 4.14 Audit hub `internal_auditor`

**Purpose.** Independent, unlimited, read-only assurance over everything.

**Landing summary.** Audit events (24h) · Open exceptions · Branches in scope · Findings open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Performance**
  - Company performance `/performance`
  - Branch performance `/reports`
- **Explorers**
  - Customer explorer `/customers`
  - Loan explorer `/credit`
  - Payment explorer `/reconciliation`
- **Exception explorer**
  - Exceptions & reversals `/reconciliation`
  - Webhook exceptions `/technical`
- **Audit trail**
  - Audit trail `/audit`
  - Traceability chain `/trace`
- **Findings**
  - Findings & annotations `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.15 Audit hub (reduced) `audit_officer`

**Purpose.** Audit fieldwork: reads everything, drafts findings for the Internal Auditor.

**Landing summary.** Audit events (24h) · Open exceptions · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Performance**
  - Performance views `/performance`
- **Explorers**
  - Customer explorer `/customers`
  - Loan explorer `/credit`
  - Payment explorer `/reconciliation`
- **Audit trail**
  - Audit trail `/audit`
- **Findings (draft)**
  - Draft findings `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.16 Compliance hub `compliance_officer`

**Purpose.** Regulatory and policy compliance oversight with remediation demands.

**Landing summary.** Findings open · Branches in scope · Audit events (24h) · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Policy**
  - Policy checklist `/capability/policy_checklist`
- **Compliance findings**
  - Findings & remediation `/capability/findings`
- **Branch compliance**
  - Branch compliance view `/branches`
  - Branch performance `/performance`
- **Worker conduct**
  - Worker records `/people`
- **Audit trail (read)**
  - Audit trail `/audit`
- **Reports**
  - Report library `/reports`

### 4.17 Risk hub `risk_officer`

**Purpose.** Portfolio risk and control gaps.

**Landing summary.** Portfolio at risk · Outstanding portfolio · Branches in scope · Findings open

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Portfolio**
  - Portfolio at risk `/reports`
  - Loan explorer `/credit`
- **Concentration**
  - Concentration views `/reports`
  - Branch risk ranking `/branches`
- **Worker risk signals**
  - Worker performance `/performance`
- **Control gaps**
  - Risk findings `/capability/findings`
- **Reports**
  - Report library `/reports`

### 4.18 Credit hub `credit_manager`

**Purpose.** Credit policy, credit decisions and the credit stages of the approval chain.

**Landing summary.** Applications pending · Awaiting my decision · Disbursed this month · Portfolio at risk

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Applications**
  - Application queue `/credit`
  - My approvals `/approvals`
- **Credit assessment**
  - Assessments `/credit`
- **Products and chains**
  - Loan products & chains `/control`
- **Portfolio quality**
  - Portfolio quality `/reports`
- **Disbursement register**
  - Disbursement register `/credit`
- **Reports**
  - Report library `/reports`

### 4.19 Credit hub (reduced) `credit_officer`

**Purpose.** Credit assessment under the Credit Manager: assigned applications and decisions with reasons.

**Landing summary.** Assigned applications · Awaiting my decision · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Assigned applications**
  - My application queue `/credit`
  - My approvals `/approvals`
- **Assessment**
  - Assessment forms `/credit`
- **Customer & loan detail**
  - Customers `/customers`
- **Reports**
  - Reports `/reports`

### 4.20 Service hub `customer_service_manager`

**Purpose.** Customer service operations and escalations.

**Landing summary.** Customers · Corrections open · Branches · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Customer lookup**
  - Customer directory `/customers`
- **Queries and tickets**
  - Tickets `/capability/tickets`
- **Escalations**
  - Escalations `/recovery`
- **Refund requests (raise)**
  - Raise correction `/service`
- **Reports**
  - Reports `/reports`

### 4.21 Service hub (reduced) `customer_service_officer`

**Purpose.** Customer queries and record support within scope.

**Landing summary.** My branch customers · Corrections open · Notifications

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Customer lookup**
  - Customer directory `/customers`
- **Own queue**
  - Tickets `/capability/tickets`
- **Profile updates**
  - Permitted fields `/customers`
- **Reports (own)**
  - Reports `/reports`

### 4.22 Reporting hub `mis_reporting_officer`

**Purpose.** Pure reporting: build, run, schedule, export.

**Landing summary.** Reports available · Branches in reports · Audit events (24h) · Notifications

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Report library**
  - Run a report `/reports`
- **Report builder**
  - Builder `/capability/report_builder`
- **Scheduled reports**
  - Schedules `/capability/scheduled_reports`
- **Performance views (read)**
  - Performance `/performance`
- **Audit trail (metadata)**
  - Audit trail `/audit`

### 4.23 Technical hub `it_system_administrator`

**Purpose.** Technical health of the tenant: providers, integrations, webhooks, sessions.

**Landing summary.** Webhook exceptions · Providers configured · Notifications · Audit events (24h)

**Branch Workplace.** Every branch, unlimited.

**Navigation groups.**

- **Provider health**
  - Providers `/providers`
  - Health checks `/technical`
- **Webhook exceptions**
  - Webhook queue `/technical`
- **Integration settings**
  - Integration settings `/technical`
- **System logs**
  - System logs `/capability/system_logs`
  - Technical audit `/audit`
- **Sessions**
  - Active sessions `/capability/sessions`

### 4.24 Branch hub `branch_manager`

**Purpose.** Runs one branch: its customers, collections, workers and day-to-day discipline.

**Landing summary.** Collected today · Expected today · My customers · Pending approvals

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Branch dashboard**
  - Branch command `/`
  - My branch money `/performance`
- **My workers**
  - Branch workers `/people`
- **Groups**
  - Branch groups `/groups`
- **Customers**
  - Branch customers `/customers`
- **Loans and applications**
  - Applications `/credit`
  - Approvals `/approvals`
- **Collections ledger**
  - Collections ledger `/reconciliation`
  - Awaiting allocation `/field`
- **Reports**
  - Branch reports `/reports`
- **Notifications**
  - Notifications `/notifications`

### 4.25 Branch hub (delegated) `deputy_branch_manager`

**Purpose.** Branch coverage and delegated branch duties within company limits.

**Landing summary.** Collected today · Expected today · My customers · Pending approvals

**Branch Workplace.** His own branch's records only.

**Navigation groups.**

- **Branch dashboard**
  - Branch command `/`
  - My branch money `/performance`
- **Worker supervision**
  - Branch workers `/people`
- **Group management**
  - Branch groups `/groups`
- **Customers**
  - Branch customers `/customers`
- **Loans and applications**
  - Applications `/credit`
  - Approvals `/approvals`
- **Reports**
  - Branch reports `/reports`
- **Notifications**
  - Notifications `/notifications`

### 4.26 Area hub `area_manager`

**Purpose.** Oversight of a group of branches in a region.

**Landing summary.** Branches in area · Collected today (area) · Pending approvals · Workers in area

**Branch Workplace.** Every branch inside his area only.

**Navigation groups.**

- **Area performance**
  - Area performance `/performance`
  - Area command `/`
- **Branches in area**
  - My branches `/branches`
  - Branch workplaces `/workplace`
- **Worker performance in area**
  - Staff performance `/performance`
- **Approvals**
  - Approval inbox `/approvals`
- **Reports**
  - Area reports `/reports`

### 4.27 C.O. hub `collection_officer`

**Purpose.** The field worker: registers customers, submits applications, keeps customers paying, allocates money.

**Landing summary.** Expected today · Realised today · Collection rate · Awaiting allocation

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **Today**
  - Today dashboard `/`
  - My performance `/performance`
- **My Customers**
  - My customers `/customers`
- **My Groups**
  - My groups `/groups`
- **Register Customer**
  - Registration form `/customers`
- **New Loan Application**
  - New application `/credit`
- **Collections Ledger**
  - My ledger `/field`
- **Awaiting Allocation**
  - Allocation queue `/field`
- **My Performance**
  - Trend & ranking `/performance`
- **Notifications**
  - Notifications `/notifications`
- **Support**
  - Raise a query `/capability/support`

### 4.28 C.O. hub (senior) `senior_collection_officer`

**Purpose.** The same field function with light mentoring and escalation over junior officers.

**Landing summary.** Expected today · Realised today · Team overdue cases · Awaiting allocation

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **Today**
  - Today dashboard `/`
  - My performance `/performance`
- **Team overdue cases**
  - Junior officer overdue `/recovery`
- **My Customers**
  - My customers `/customers`
- **My Groups**
  - My groups `/groups`
- **Register Customer**
  - Registration form `/customers`
- **New Loan Application**
  - New application `/credit`
- **Collections Ledger**
  - My ledger `/field`
- **Awaiting Allocation**
  - Allocation queue `/field`
- **Notifications**
  - Notifications `/notifications`

### 4.29 Recovery hub `recovery_officer`

**Purpose.** Aged-debt recovery across branches where assigned.

**Landing summary.** My overdue cases · Escalations open · Collected on cases · Notifications

**Branch Workplace.** None. A branch worker never enters the Branch Workplace (prohibition 16).

**Navigation groups.**

- **My overdue cases**
  - Case list `/recovery`
- **Case detail**
  - Loans & payments (read) `/recovery`
- **Contact log**
  - Contact log `/recovery`
- **Escalations**
  - Escalations `/recovery`
- **Recovery performance**
  - My performance `/performance`
- **Notifications**
  - Notifications `/notifications`

### 4.30 Custom-role templates `template_*`

A company may enable a custom role built from one of these templates. Each template is a starting navigation set that the company's administrator then adjusts. Templates are not separate people and must not be given screens of their own beyond what is listed.

- **Finance workspace (custom)** `template_finance_officer` — Custom role built from the Finance Officer template: exactly the granted permissions.
  - Cash book `/money`
  - Reconciliation `/reconciliation`
  - Reports `/reports`
- **HR workspace (custom)** `template_hr_assistant` — Custom role built from the HR Assistant template.
  - Worker directory `/people`
  - Staff `/performance`
- **Administration workspace (custom)** `template_administrative_officer` — Custom role built from the Administrative Officer template.
  - Company control `/control`
  - Branches `/branches`
- **Loan processing workspace (custom)** `template_loan_processing_officer` — Custom role built from the Loan Processing Officer template.
  - Processing queue `/credit`
  - Approvals `/approvals`
- **Credit analysis workspace (custom)** `template_credit_analyst` — Custom role built from the Credit Analyst template.
  - Applications `/credit`
  - Portfolio `/reports`
- **Operations workspace (custom)** `template_operations_officer` — Custom role built from the Operations Officer template.
  - Performance `/performance`
  - Branches `/branches`
- **Portfolio workspace (custom)** `template_portfolio_manager` — Custom role built from the Portfolio Manager template.
  - Portfolio views `/reports`
  - Loans `/credit`
- **Treasury workspace (custom)** `template_treasury_officer` — Custom role built from the Treasury Officer template.
  - Cash book `/money`
  - Reconciliation `/reconciliation`
- **Reporting workspace (custom)** `template_data_reporting_analyst` — Custom role built from the Data/Reporting Analyst template.
  - Report library `/reports`
  - Performance `/performance`

---

## 5. Every flow, step by step

Each flow lists the screens involved, so you can draw them as one connected surface rather than isolated pages.

**Company creation (Platform Owner).** Companies list → Create company (name, slug, MD's full name, colour, logo,
secondary colour, login background) → live branding preview → Create → one-time credential panel (company URL, MD
username, MD initial password) shown once → Companies list where the new company appears as *in setup* until activated.
Atomic: company, theme, URL, MD Board, MD account, MD credential, audit and notification all succeed or none do.

**MD first login.** Login → credential ritual step 1 (change password) → step 2 (authenticator setup) → step 3 (verify) →
step 4 (profile) → MD Board. Nothing else in the product opens until all four are done. Re-using the initial password fails.

**Worker creation.** People → Create worker (full name, branch, role, scope) → a temporary password is generated and shown
once → the worker signs in with username = full name and password = `@` + first name → completes the ritual. The worker ID
is permanent and follows the company's code convention; nobody types it.

**Credential hand-over.** The one-time password is displayed once to the creating actor. It is never emailed, never texted,
and never retrievable in plain text afterwards — by anyone, including the MD.

**Branch creation.** Branches → Create branch → the code and portal URL are **generated**, never typed → the branch portal
exists at `{company}-{branch}.nexora.app`. Branch worker creation happens inside the branch portal or the Branch Workplace.

**Branch workplace entry.** Choose a branch in the picker → the entry is audited → no password is ever requested. A branch
worker can never enter it.

**Provider setup, including failure.** Providers → Add connection → choose the provider → **the form fields change to that
provider's requirement set**, each with how-to-get guidance → save → Test connection. A wrong key must fail and the
configuration stays inactive. A correct key activates immediately for the MD; for anyone else it waits in the MD's queue
and the MD is notified. Changing the provider re-shapes the form.

**Customer registration.** Customers → Register customer → profile and KYC fields → **no virtual account exists yet**.
Virtual accounts are created only at disbursement.

**Face capture, including failure.** A live in-camera capture with liveness. There is no file picker, no gallery path and
no upload control anywhere in the product. A failed liveness check says what failed and lets the person retry; it never
offers a fallback photograph.

**Loan application.** Credit → New application → the preview assembles customer, group, guarantor, loan cycle, terms,
bank details, fees and missing evidence → submit → the chain assigns stages.

**Approval.** Approvals → your own inbox → the decision dialog (approve / reject / request information, reason required) →
the chain advances and the next approver's inbox updates. You only ever see your own queue.

**Disbursement.** Application detail → Disburse → one atomic transaction creates the virtual account, the repayment
schedule, the ledger entries and the customer's portal access. A disbursement without a virtual account and a schedule
cannot happen.

**Customer portal first login.** Portal access is generated with the customer's full name as username and `@` + first name
as password → the customer signs in → completes their ritual → sees only their own records.

**Payment arrival and allocation.** The provider's webhook arrives, is signature-verified, de-duplicated and stored raw →
the payment appears *awaiting allocation* → the Collection Officer allocates it: loan repayment + savings = the verified
amount, exactly → allocation, ledger, performance and accounting all update. Money is still received and still lands
awaiting-allocation when the officer's portfolio is held.

**Portfolio hold.** Worker detail → Hold portfolio with a reason → the worker cannot collect or follow up; incoming money is
still received and lands awaiting allocation.

**Portfolio transfer.** Hold, then transfer to a new worker → the old credentials die immediately → the new worker gets new
credentials and completes the ritual → the portfolio is live with its history intact. Nothing is deleted.

**Worker freeze.** People → Freeze with a reason → login is impossible and both the password and the authenticator stop
working immediately, from everywhere.

---

## 6. The colour system

### 6.1 What never changes

Backgrounds, card surfaces, body text, secondary text, borders, table rules and all semantic states are fixed neutrals for
every company and every role. Depth comes from subtle borders and soft shadows, never from colour. Semantic colours keep
their meaning: a company whose accent is red does not show red success messages.

### 6.2 The accent token table — the authoritative list

Every element below takes the company's colour. **Nothing outside this table does.**

| Token | Where it appears |
|---|---|
| Primary action button | The main action on each screen: Save, Create, Submit, Approve, Disburse, Add provider, Create worker, Copy credentials |
| Secondary emphasis button | The second-most-important action, as an outline or accent tint |
| Active navigation item | The current sidebar/tab item and its indicator bar |
| Active tab underline | The selected tab in any tabbed workspace |
| Focus ring | The outline around the focused control |
| Input focus border | A focused text field or select |
| Selected-state controls | Toggle, switch, checkbox, radio in the selected state |
| Link | Text links inside content |
| Progress indicator | Target-progress bars |
| Selected row | A light accent tint, never a solid block behind body text |
| Key status markers | Branded "active"/"on target" chips — semantic markers such as overdue stay semantic |
| Logo and site identity | Logo area, login brand block, browser theme colour |
| Avatar and user identity | Avatar ring or initial background |
| Header accents | A thin accent line or element in the header |
| First chart series | Only the first; later series use the neutral palette |
| Badge and notification dot | Unread counts and attention dots |
| Empty-state illustration accents | The accent parts of empty-state graphics |
| PDF/export brand elements | Header rule, logo, accent bar, table-header tint |
| Email brand block | Logo and accent bar in the company's notification emails |
| Customer portal accents | The same token set, in the customer's portal |
| Mobile primary action | The main action button in mobile layouts |

### 6.3 Colour rules with examples (required by the Vision)

**When the company chooses blue:** the primary button, the active navigation item, the active tab underline, the focus
ring, the input focus border, selected toggles and checkboxes, links, the progress bar, the selected row tint, the avatar
ring, the company's logo lockup, the header accent line, the first chart series, the unread badge dot, the accent parts of
empty-state illustrations, the report header rule and accent bar, the email accent bar, and the mobile primary action all
become blue. Backgrounds, card surfaces, every paragraph, every table cell, every number, every field label, every border,
and the semantic states remain exactly as they are for every other company.

**When the company chooses green:** the identical list becomes green. There is no element in that list that behaves
differently, and no element outside it that changes.

### 6.4 Defaults

With no company chosen, the product accent is **near-black** (`#111111`). The **Platform Owner portal uses green**. The
default identity is a neutral monochrome system; a company's colour is applied on top of it as CSS custom properties, so
changing a company's colour updates every listed element at once with no per-screen work.

### 6.5 Contrast

- Label colour on the accent is **computed per company**: light accent → near-black label; dark accent → white label.
  Never assume one.
- The branding screen warns — without blocking — when a chosen colour would make text hard to read, and suggests a
  passing shade of the same colour.
- The accent is never the only signal. A status is a status because of its **words**; colour supports and never replaces
  them.

### 6.6 Logo and name law

The logo appears on the login screen, sidebar/header, customer portal, notification emails, exported reports, receipts,
statements and the browser tab — and never inside another company's workspace or the Platform Owner portal. It is
validated for format and size, shown without distortion, and a company without one shows its name as a styled
placeholder. The logo never replaces the company name in body text: the logo is for recognition, the name for clarity.
Every screen a company's users see carries **the company's** name, never the platform's.

---

## 7. States for every screen

Design all eight. Each must look intentional, not broken.

| State | Required behaviour |
|---|---|
| **Loading** | Skeleton rows that match the shape of the content, or a labelled row ("Loading your inbox…"). Never a bare spinner over an empty page. |
| **Empty** | Say what is empty and why it is plausible, in plain words: "No correction requests awaiting a decision." Never an illustration with no explanation. |
| **Error** | What failed, why, and a **Retry** action. Never a raw stack trace, never a silent failure. |
| **Partial failure** | When a page has several independent panels, show the ones that loaded and mark the one that did not — inline, never collapsing the whole page into one error. |
| **Permission denied** | A plain, non-accusing explanation: "Your role has no permission for this action." Never a blank page, never a broken layout. |
| **Offline** | A persistent banner: the last change was not saved. Disable the action rather than pretending it worked. |
| **First use** | An onboarding step **on the screen itself** — empty state plus one primary action, not a modal tour. |
| **Long content** | Long names truncate with the full value available; tables scroll horizontally rather than reflowing into unreadable cards; a 500-row table paginates at 25 with a clear count. |

---

## 8. Data density rules

- **Currency:** group thousands, always show the currency (UGX), right-align numerics, and never abbreviate a money figure
  in a table cell where the exact value matters. Totals are visually distinct from rows.
- **Dates:** absolute and unambiguous (`12 Mar 2026`), with relative time only as a secondary hint ("3 days ago").
- **Ages:** durations in days and cycles.
- **Names:** a person's full name reads as a name, never as a truncated id. Where an id is shown, show it small, in a
  monospaced tint, and truncated to eight characters — the same convention everywhere.
- **Statuses:** words first, always (`awaiting allocation`, `overdue`, `allocated`), with colour supporting.
- **Tables:** 25 rows a page, a visible count ("1–25 of 312"), a search box that filters the list, and empty/loading/error
  states inside the table body.
- **A 500-branch table:** paginated, sortable, with the branch code as the primary identifier. Never a wall.
- **Mobile:** a table becomes a list of the two or three fields that matter, each row opening the same detail screen.
  Never a horizontally squashed desktop table.

---

## 9. Interaction rules

- **Click to open:** a row opens its record; the whole row is clickable and keyboard-reachable; the cursor changes.
- **Breadcrumbs** on every page below the top level, as words that are also links.
- **Context bars:** the Branch Workplace keeps its branch picker, date range and period visibly in context for the whole
  session, because the same numbers mean different things in different branches.
- **Drill-down chains:** dashboard figure → the list behind it → the record → its history. Each step is one click.
- **Search:** filters the visible list as you type, never navigates away, and is combined with filters and pagination
  rather than replacing them.
- **Destructive or irreversible actions** always open a confirmation dialog that names what will happen and requires a
  reason where the vision demands one.
- **No dead clicks.** Every visible control performs a real action or is not rendered.

---

## 10. Responsive rules

| Breakpoint | Behaviour |
|---|---|
| **Desktop (≥1200px)** | Full layout: persistent sidebar, dense tables, multi-column panels. All work happens here. |
| **Tablet (760–1199px)** | Sidebar collapses to icons or an overlay; tables keep their essential columns and drop the rest behind row click; grids reflow to two columns. |
| **Mobile (<760px)** | Single column; navigation behind a menu; tables become lists; the primary action becomes a sticky bottom bar. |

**Desktop-primary tasks** (mobile may view but not complete): the provider form, the branding wizard and live preview, the
application preview, the traceability chain, bulk work, and wide financial tables. For these, mobile shows a clear "this
needs a bigger screen" affordance with a way to continue in read-only form, rather than a broken layout.

---

## 11. Accessibility

- Contrast: body text and all semantic states meet WCAG AA on their surfaces in **every** company colour; the accent's
  label colour is computed, never assumed.
- Every interactive element is keyboard reachable with a **visible** focus ring (the accent focus ring is the one themed
  control that must never be removed).
- Status is never colour-only: every status carries words, and where it matters an icon too.
- Every form control has a real `<label>`; placeholders are examples, never labels.
- Errors are announced (`role="alert"`), tied to their field, and say how to fix it.
- Icon-only controls carry an accessible name.
- Tables use real headers and expose row headers for screen readers.
- Motion respects `prefers-reduced-motion`.

---

## 12. Component inventory

| Component | Variants and states |
|---|---|
| Button | primary (accent), secondary (outline), ghost, danger; sizes sm/md/lg; loading; disabled; icon-only with a name |
| Input / Select / Textarea | default, focus (accent border + ring), error, disabled, with label, hint and error text |
| Search input | default, with clear action, empty result message |
| Table | default, clickable rows, selected row, empty state, loading skeleton, horizontally scrollable on small screens |
| Column definition | text, numeric (right-aligned), status badge, money, date, actions |
| Pagination | first/previous/next, page count, total count |
| Tabs | default, active (accent underline), with counts, overflow scroll on mobile |
| Modal | default, destructive confirm, with footer actions, long-content scroll |
| Confirm dialog | destructive and non-destructive; reason field where required |
| Drawer | right-side, used for record detail on wide screens, full-screen on mobile |
| Stat tile | label, value, hint, optional accent emphasis; `—` when not computable |
| Badge / Status badge | neutral, accent, success, warning, danger, info; always with words; optional dot |
| KV panel | label/value pairs for detail views |
| Timeline | audit and history events with relative time |
| Empty state | illustration accent, one-line explanation, single primary action |
| Error state | what failed, detail, retry action |
| Loading row / skeleton | label-matched placeholders |
| Toast | success, warning, danger; one at a time; auto-dismiss; never the only record of an outcome |
| Menu | header avatar menu, row action menu; keyboard navigable |
| Stepper | credential ritual steps: done, active, pending (pending not clickable) |
| Progress bar | accent fill, labelled target |
| Card / Panel | surface, border, optional header and footer |
| Toolbar | search, filters, actions; wraps on small screens |
| Page header | eyebrow, title, description, breadcrumbs, actions |

---

## 13. Copy and language rules

- **Plain words, full sentences.** "No correction requests awaiting a decision." not "0 items".
- **Say what happened and what to do next.** "The provider did not accept this configuration." not "Error 401".
- **Never reveal existence.** No message may distinguish "this user does not exist" from "this password is wrong" —
  they are the same message. The same applies to companies and branches.
- **Never blame the reader.** "Enter the date range again." not "You entered an invalid date".
- **No jargon without a definition** on first use (use the plain word, then the product term in brackets if needed).
- **No "coming soon", no "coming soon", no fake data.** If a surface does not exist, say that plainly and point to where
  the real one is. Prohibition: fake balances, sample customers or dead controls in a live view.
- **Numbers in words where a status depends on them** ("3 items", not "3 it.").
- Consistency with existing product names: "Collection Officer", "MD Board", "Branch Workplace", "credential ritual",
  "virtual account", "approval chain".

---

## 14. What the design must not do

- No hard-coded company colour in any component. Everything comes from a theme token.
- No page whose background is the company colour.
- No body text, paragraph, table cell or number in the company colour.
- No company colour used for a semantic state it would contradict.
- No company's logo or colour inside another company's workspace, and no platform brand inside a company's workspace.
- No colour-coded element without a text alternative.
- No themed element that does not come from the theme record.
- **No control that edits money, for any role.** No payment form. No allocation editor that changes a verified amount. No
  ledger cell you can type into. No delete on any financial record or audit entry.
- No "record a payment", "add savings", "adjust balance", "edit loan" or "delete" affordance anywhere.
- No savings-only concept, no Savings Officer role, no virtual account at customer registration.
- No file-upload or gallery path for a photograph anywhere — face capture is live only.
- No "Head Office portal" wording, and no route, record or label named that way.
- No company switcher.
- No role shown a page it does not need, and no role missing a page its duty requires.
- No dashboard figure computed independently of the shared performance engine.
- No dead click, ever.

---

## 15. Decisions this document makes where the vision left it open

The Vision requires these to be stated rather than guessed. Recommended defaults are given so the designer is not left
inventing product behaviour.

| Decision | Recommended default |
|---|---|
| Base font | Poppins (the product already ships it). 400/500/600/700. |
| Type scale | 12 / 13 / 14 / 16 / 20 / 24 / 30 px, mobile-first. |
| Spacing | 4px base grid; page padding 24px desktop / 16px mobile. |
| Radii | 6px inputs and buttons, 10px cards, 14px modals, pill for chips. |
| Sidebar width | 240px expanded, 64px collapsed. |
| Page width | Fluid, max 1440px for dense tables; statements and forms cap at 1120px for readability. |
| Icon set | One outline set, 16/20px, stroke-consistent. Never mixed styles. |
| Elevation | Subtle shadow plus a 1px border; two levels only (card, overlay). |
| Tabular numbers | Required for every money and count column. |
| Empty-state illustrations | Line style, accent-coloured parts only, one per state family. |
| Motion | 120–180ms, ease-out, for state changes only; none for content. |
| Z-index scale | 0 base, 10 sticky, 20 overlay, 30 modal, 40 palette, 50 toast. |
| Density toggle | Not offered. Dense is the product's default. |

---

## 16. Acceptance checklist for the design

Before the design is accepted, confirm each of these. They are the design half of the vision's own acceptance law.

1. Every role in §4 has its own screens, and no two roles share a workspace by accident.
2. No control on any screen edits money, and none is a dead click.
3. Every screen in §7 shows all eight states.
4. Changing the accent to any colour changes exactly the tokens in §6.2 and nothing else.
5. A company whose accent is red shows no red success message; a green company shows no green error.
6. A 500-row table paginates and stays readable; a mobile table becomes a list.
7. The credential ritual cannot be skipped, and no step ahead is clickable.
8. Loading, empty and error states read as designed parts of the product, not as failures.
9. Keyboard-only use reaches every control, with a visible focus ring throughout.
10. No screen contains fake data, "coming soon", or a disabled placeholder.
