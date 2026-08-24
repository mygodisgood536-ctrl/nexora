# NEXORA — PLATFORM OWNER PORTAL SPECIFICATION (COMPLETE, A–Z IMPLEMENTATION-GRADE)
## Companion document to SRS v2.1 (Part 1: Architecture, Part 2: Systems & Requirement Log) and `Nexora_Role_Specifications_AZ_Complete.md`

**Status:** [v2.1 NEW REQUIREMENT — PLATFORM OWNER PORTAL, EXPANDED FROM EXISTING FOUNDATION]. Part 1 §4, §8, and §26 already established that the Platform Owner creates companies, deduplicates company prefixes platform-wide, and owns Nexora's own default visual identity as the portal's theme; Part 1 §4 and Part 2 §50 already established that Platform Owner tooling connects through a separate, explicitly-audited support-access path, never through the normal company data layer. This document does not replace or contradict any of that — it is the full A-to-Z implementation specification the earlier sections pointed to but did not yet provide. Nothing in the existing SRS is changed by this document; every existing Platform Owner requirement listed above is carried forward unchanged and expanded below.

**Scope of this document:** the Platform Owner Portal is a distinct application surface from every company portal (MD portal, Head Office Administrator portal, Branch Manager portal, Collection Officer portal, Customer Portal, etc.). It is not reachable from any company's login screen, does not use any company's branding, and does not share navigation chrome, dashboard components, or data-scoping logic with the company-side product. Where this document says "the Platform Owner," it means the single owner-operator role of the Nexora platform itself — not a company-side role, and not part of the 32-role built-in catalogue in `Nexora_Role_Specifications_AZ_Complete.md`.

**Per-page documentation convention used throughout this document:** every page/workspace below states, where applicable: Purpose, Layout, Components, KPI Cards, Tables/Columns, Filters, Search, Actions, Buttons, Modals, Forms, Validation, Notifications, Drill-down behavior, Loading behavior, Error behavior, Empty state, and Responsive behavior. A field is omitted only where it is genuinely not applicable to that page (e.g. a settings page has no "drill-down behavior"); it is never silently skipped where applicable.

---

## 1. PLATFORM OWNER LOGIN

**Purpose:** Single, dedicated authentication entry point for the Platform Owner. This is not the same login screen used by any company — it is not reachable by typing a company's branch URL, and no company-side login screen links to it.

**Layout:** Centered single-column card on Nexora's own premium dark-navy/royal-blue default theme (Part 1 §26), Nexora logo and wordmark, no company branding of any kind, no company selector.

**Components:** Email field, password field, "Remember this device" checkbox, Sign In button, forgot-password link, mandatory second factor step (Section 40 below covers the permission/security model this enforces).

**Forms:** Email (required, valid email format), Password (required, minimum policy-defined length/complexity).

**Validation:** Inline validation on blur for email format; password field never echoes complexity rules on failed submit beyond a generic "Incorrect email or password" — the failure message never reveals which field was wrong, to avoid account enumeration.

**Actions:** Sign In (submits credentials, then routes to the mandatory 2FA challenge screen before any dashboard data loads); Forgot Password (sends a reset link to the registered email, never reveals whether the email exists).

**Error states:** Invalid credentials → generic inline error, no field-specific detail. Account locked after configurable failed-attempt threshold → explicit lockout message with a cooldown timer and a support-contact path (this is the Platform Owner's own account — there is no "contact your administrator" fallback, since the Platform Owner is the platform's own administrator; the message instead explains the cooldown and, if configured, an out-of-band recovery path). Network/server error → retry affordance, no partial state persisted.

**Loading behavior:** Sign In button shows an inline spinner and disables itself on submit to prevent double-submission; no skeleton screen needed since no data loads until after 2FA.

**Notifications:** A successful login from a new device/location triggers an email notification to the Platform Owner's registered email, independent of and in addition to the in-portal Platform Notifications feed (Section 22).

**Responsive behavior:** Identical single-column layout at every breakpoint — this screen has no dense-data component that needs to reflow.

---

## 2. PLATFORM OWNER DASHBOARD

**Purpose:** The Platform Owner's landing screen after login — a platform-health-and-growth overview, deliberately not a company-operations view. It answers "is the platform healthy, and is it growing," never "how much money did any one company collect today."

**Layout:** Desktop-primary, KPI card row across the top, two-column body below (left: platform activity feed and health summary; right: company snapshot and quick actions), fully responsive per Section 36–38.

**Components:**
- Platform KPI card row (Section 15 below)
- Platform Health summary card (Section 16 below, condensed — full detail lives on its own page)
- Company Snapshot panel: New Companies (7/30-day), Active Companies, Suspended Companies, Companies in Setup
- Platform Activity feed (condensed, most recent items, Section 21 below)
- Quick Actions panel (Section 28 below)
- Platform Announcements banner, dismissible, shown only when an active announcement exists (Section 23 below)

**KPI Cards:** Total Companies, Active Companies, Suspended Companies, Companies in Setup, Total Platform Users (all companies, aggregate count only — never a per-company financial figure), New Companies This Month, Platform Uptime (rolling 30-day), Open Platform Support/Escalation Items (if the support-access mechanism, Section 40, has any open authorized sessions or pending requests).

**Charts:** Company growth trend (new companies per month, 12-month), Company status breakdown (donut: Active/Suspended/Setup), Platform user growth trend.

**Drill-down behavior:** Clicking any company-count KPI or chart segment routes to the Companies Workspace (Section 4) pre-filtered to match (e.g. clicking "Suspended Companies" opens the Company List filtered to Status = Suspended). Clicking a Platform Activity item routes to that item's detail context (e.g. a company-creation activity item routes to that Company Detail Workspace).

**Loading behavior:** KPI cards and panels render skeleton placeholders independently and populate as each data source resolves — the dashboard never blocks entirely on the slowest panel (e.g. Platform Health's live status check is allowed to resolve after the KPI cards have already rendered).

**Error behavior:** Any panel that fails to load shows an inline retry affordance scoped to that panel only; one failed panel never blanks the rest of the dashboard.

**Empty state:** On a brand-new platform instance with zero companies, the dashboard replaces the Company Snapshot and Activity panels with a single prominent "Create your first company" call to action routing into the Create Company Wizard (Section 9).

**Responsive behavior:** See Section 35–38.

---

## 3. COMPLETE SIDEBAR NAVIGATION

**Purpose:** Primary navigation chrome for the entire Platform Owner Portal, present on every authenticated screen.

**Structure (top to bottom):** Dashboard · Companies · Platform Users & Usage · Platform Health · Platform Activity · Notifications (with unread badge count) · Announcements · Global Settings · Platform Configuration · Audit Trail · AI Platform Insights · (footer) Platform Owner account menu — profile, security/2FA settings, sign out.

**Components:** Each item shows an icon + label; the active section is highlighted; Companies, Global Settings, and Platform Configuration are expandable groups (Companies expands to List / Search-and-Filters view is inline, not a sub-item; Global Settings expands to sub-pages per Section 24; Platform Configuration expands to sub-pages per Section 25).

**Behavior:** Sidebar state (expanded/collapsed) persists per Platform Owner session. Badge counts (unread Notifications, open Announcements requiring acknowledgment) update in real time without a full page reload.

**Navigation behavior (general rule, applies platform-wide):** every list-to-detail transition (Company List → Company Detail, Audit Trail list → Audit Trail entry detail, etc.) preserves the originating list's filter/search/sort state, so using the browser/in-app back action returns to the exact same filtered view, not a reset list.

**Responsive behavior:** Full labeled sidebar on desktop; icon-only collapsed rail on tablet (expandable on tap/hover); bottom tab bar or slide-out drawer on mobile, condensed to the highest-priority items (Dashboard, Companies, Notifications, Account menu) with the remainder under a "More" entry — see Section 38.

---

## 4. COMPANIES WORKSPACE

**Purpose:** The Platform Owner's operational home for managing the tenant base — every company on the platform, in one place.

**Layout:** Company List as the default view (Section 5), with persistent Search (Section 6) and Filters (Section 7) above the table, and a prominent "Create Company" button routing to the wizard (Section 9).

**Components:** Search bar, filter bar, Create Company button, bulk-context toolbar (appears when rows are selected — see Actions below), the Company List table itself, pagination control.

**Actions:** Create Company (Section 9); open a company (routes to Company Detail Workspace, Section 8); Activate / Suspend / Reactivate a company directly from the row-level action menu (opens the corresponding confirmation dialog, Section 33, rather than acting instantly); export the current filtered list to CSV.

**Loading behavior:** Table renders a skeleton-row placeholder set matching the configured page size while the company list resolves; filters and search remain interactive during load (a fresh request supersedes the in-flight one).

**Error behavior:** A failed list fetch shows an inline error banner above the table with a Retry button; previously loaded rows (if any, e.g. after a filter change failed but the base list had loaded) are not discarded.

**Empty state:** Zero companies platform-wide → the first-company call to action (Section 2). Zero companies matching the current filter/search → "No companies match these filters" with a one-click "Clear filters" action, table chrome remains visible so the person isn't disoriented.

**Responsive behavior:** See Section 35–38; the table becomes a card list on tablet/mobile per Section 5.

---

## 5. COMPANY LIST

**Purpose:** The authoritative, sortable, filterable table of every company on the platform.

**Table columns:** Company Name, Company Prefix/Code, Status (Active/Suspended/In Setup, shown as a colored badge), Branch Count, Total Platform Users (staff, not customers), Created Date, Last Activity Date, Plan/Tier (if the platform has tiers configured), row-level action menu.

**Sort behavior:** Every column is sortable; default sort is Created Date descending (newest company first).

**Row action menu:** View (opens Company Detail Workspace), Activate/Suspend/Reactivate (opens the matching confirmation dialog, Section 33), Edit Branding (opens Company Branding Preview in edit mode, Section 10).

**Pagination:** Standard page-size selector (e.g. 25/50/100 rows) plus page navigation; the current page number and filter/search state are preserved in the URL so the view is shareable/bookmarkable and survives a back-navigation.

**Bulk actions:** Multi-select via row checkboxes enables a bulk-context toolbar for: bulk export (CSV of selected rows), bulk status-change is intentionally **not** offered in bulk (suspending multiple companies at once is a high-risk action and is deliberately restricted to one confirmed action at a time, per Section 33's confirmation-dialog requirement).

**Responsive behavior:** Desktop/tablet render the full table (tablet may hide lower-priority columns such as Plan/Tier behind a row-expand affordance); mobile renders each company as a stacked card (Company Name + Status badge prominent, remaining fields as labeled key-value pairs beneath, tap to open Company Detail Workspace).

---

## 6. COMPANY SEARCH

**Purpose:** Fast, platform-wide lookup of a specific company by name, prefix/code, or an associated identifier (e.g. an admin's registered email), without paging through the full list.

**Behavior:** Type-ahead search with debounce; matches against Company Name, Company Prefix, and (if entered) MD/Head Office Administrator email on file; results render as a dropdown of matching companies beneath the search bar for quick jump, and pressing Enter or "View all results" applies the search as a filter to the Company List table below it.

**Empty state:** "No companies found for '<query>'" with a suggestion to check spelling or use Filters instead.

**Loading behavior:** Inline spinner inside the search field itself while a query is in flight; results update in place without a full-page reload.

---

## 7. COMPANY FILTERS

**Purpose:** Narrow the Company List to a working subset without a free-text search.

**Filter fields:** Status (Active / Suspended / In Setup — multi-select), Created Date range, Branch Count range, Plan/Tier (if configured), Setup Status (Section 14 below — e.g. "Branding incomplete," "No branches created yet," "Fully configured").

**Behavior:** Filters combine with AND logic; each active filter renders as a removable chip above the table; a single "Clear all filters" action resets to the unfiltered list. Filter state is part of the shareable/bookmarkable URL (see Section 5).

**Empty state:** Handled by the Company List's own empty state (Section 5) when a filter combination matches nothing.

---

## 8. COMPANY DETAIL WORKSPACE

**Purpose:** The single-company command center for the Platform Owner — everything the Platform Owner is allowed to see and do about one tenant, and nothing the Platform Owner is not (see the explicit financial-data exclusion in Section 40).

**Layout:** Header band (Company Name, Status badge, Prefix, primary action buttons) above a tabbed body: Overview · Branding · Users & Roles Overview · Branches Overview · Setup Status · Activity Log (company-scoped).

**Components (Overview tab):**
- Company profile card: Name, Prefix, Created Date, Contact info on file, Plan/Tier
- Branch Count and a link into a read-only branch list (branch names, codes, and creation dates only — no branch financial or performance figures, per Section 40)
- Platform User Count (staff accounts, by role category, aggregate counts only — e.g. "3 Executive-category users, 12 Operations/Field-category users" — never a name-by-name financial-performance breakdown)
- Setup Status summary (Section 14), with direct links into whatever step is incomplete

**Components (Branding tab):** Read view of the company's current brand tokens (logo, colors, login background) with an Edit action opening Company Branding Preview (Section 10) in edit mode.

**Components (Users & Roles Overview tab):** A count-only breakdown of how many platform users hold each built-in/custom role category at this company (e.g. "1 MD, 1 GM, 4 Branch Managers, 11 Collection Officers"). This is a staffing/deployment overview for platform-support purposes, not a performance dashboard — it never shows individual worker performance figures, which belong exclusively to the company's own Performance Visibility Layer (SRS Part 1 §25-C) and are never surfaced to the Platform Owner by default (Section 40).

**Components (Branches Overview tab):** Branch Name, Branch Code, Branch Portal URL, Created Date, Status (Active/Suspended) — again, structural/administrative fields only, no collection or loan figures.

**Components (Setup Status tab):** See Section 14.

**Components (Activity Log tab):** Company-scoped slice of the Platform-level Audit Trail (Section 26) — platform-level actions taken about this company (creation, activation, suspension, branding edits, any authorized support-access session), not the company's own internal operational audit trail (which belongs to the company's own Internal Auditor role and is never surfaced here by default).

**Actions:** Suspend Company / Reactivate Company / Activate Company (whichever is applicable to current status — opens the matching confirmation dialog, Section 33); Edit Branding; view Setup Status; (if the support-access mechanism is separately authorized for this company) initiate/view a Support Access session, clearly labeled and separately audited per Section 40.

**Drill-down behavior:** Clicking a branch in the Branches Overview tab opens a read-only branch detail panel (structural fields only, as above) — it does not drill further into that branch's customers, loans, or payments; that boundary is absolute (Section 40).

**Loading/Error/Empty states:** Each tab loads and fails independently (skeleton-per-tab, retry-per-tab); a company with zero branches yet shows the Branches Overview tab's empty state ("No branches created yet") linking into the Setup Status tab rather than a dead end.

**Responsive behavior:** Tabs collapse into a dropdown/segmented selector on mobile; each tab's content reflows per Section 35–38's general rules for tables/cards.

---

## 9. CREATE COMPANY WIZARD

**Purpose:** Multi-step guided flow the Platform Owner uses to provision a new tenant, extending the existing wizard requirement already established in SRS Part 1 §26 (branding step with live preview) with the full surrounding flow.

**Steps:**
1. **Company Profile** — Company Name (required), Company Prefix (auto-suggested from name per Part 1 §8's deduplication rule, editable, validated unique platform-wide in real time), primary contact/MD email (required, valid email), Plan/Tier selection (if configured).
2. **Branding** — Logo upload, Primary/Secondary/Accent color pickers, optional login background image, other brand tokens — with the **live preview** (login screen + sample dashboard) required by Part 1 §26, rendering as the Platform Owner edits each token.
3. **Initial Head Office Setup** — Head Office Administrator name/email (required) so the company has a first login the moment it activates; this does not create branches (branch creation is the company's own subsequent action per Part 1 §7–8), only the seed administrator account.
4. **Review & Confirm** — read-only summary of every value entered across steps 1–3, with an Edit link back to any step; explicit confirmation checkbox ("I confirm this company's details are correct") before the Create action is enabled.

**Forms/Validation:** Company Name required, 2–100 characters; Prefix required, 3–6 uppercase letters, real-time uniqueness check against the platform-wide prefix registry (Part 1 §8), inline error if a collision is detected as the Platform Owner types; contact email required and validated as a proper email format; color fields validated as proper hex/color values with a live-updating preview swatch; logo upload validated for file type and a maximum size, with an inline error naming the specific problem (wrong format vs. too large) rather than a generic failure.

**Buttons:** Back / Next per step; Save as Draft (persists partial progress so the wizard can be resumed later, landing the in-progress company in the "In Setup" status shown in the Company List); Create Company (final step only, disabled until the confirmation checkbox is checked).

**Modals:** A confirmation modal appears on Create Company summarizing that the company will immediately become able to log in (if Activation, Section 11, is configured to happen automatically) or will land in a Pending Activation state requiring a separate explicit Activation action — whichever the platform is configured to do — so the Platform Owner is never surprised by which behavior occurs.

**Notifications:** On successful creation, a Platform Notification confirms the company was created and (if applicable) that the Head Office Administrator's welcome/invite email was sent.

**Error states:** A failed submission (e.g. a race-condition prefix collision at the final step) returns the Platform Owner to the Review step with the specific field-level error surfaced, never silently discarding the entered data.

**Loading behavior:** The Create action shows an inline progress state (this can involve provisioning steps — theme record creation, seed admin account, welcome email dispatch — and the button remains disabled with a spinner until all provisioning steps succeed or a specific one fails).

**Responsive behavior:** Fully usable on tablet; on mobile the step content stacks vertically with Back/Next as a sticky footer bar; the Branding step's live preview becomes a toggle-to-view panel rather than a permanent side-by-side split, to preserve screen space.

---

## 10. COMPANY BRANDING PREVIEW

**Purpose:** Real-time visual preview of a company's brand tokens, used both inside the Create Company Wizard (step 2) and from the Company Detail Workspace's Branding tab when editing an existing company.

**Layout:** Split view — brand-token form controls on one side, a live-rendered miniature of the company's login screen and a sample dashboard on the other, matching Part 1 §26's theme-variable architecture exactly (the preview renders using the same CSS custom-property theming mechanism the real company portal will use — it is not a separate mocked image).

**Components:** Logo preview, color swatches with hex input, font preview (if font is configurable), login-background preview, a "Reset to Nexora defaults" action (restores Nexora's own default palette values, per Part 1 §26, as the fallback).

**Validation:** Same as the wizard's Branding step (Section 9); additionally, a contrast-check warning (non-blocking) appears if a chosen text/background color combination would be hard to read, so the Platform Owner can catch accessibility problems before saving.

**Actions:** Save (commits the new theme record for that company — takes effect for that company's users at their next session per Part 1 §26); Discard changes; Reset to Nexora defaults.

**Loading/Error behavior:** Preview updates optimistically and instantly as tokens change (client-side render, no server round-trip needed to preview); Save shows a spinner and a specific error if the theme record fails to persist, without losing the Platform Owner's in-progress edits.

**Responsive behavior:** Side-by-side split on desktop/tablet landscape; stacked with a view-toggle ("Edit" / "Preview") on mobile and tablet portrait.

---

## 11. COMPANY ACTIVATION

**Purpose:** Explicit action that moves a company from "In Setup" / "Pending Activation" to "Active," making its portal reachable and its users able to log in.

**Trigger points:** Automatically at the end of the Create Company Wizard (if the platform is configured that way), or manually from the Company List row menu / Company Detail Workspace header for a company still in a pending state.

**Modal (Confirmation Dialog, per Section 33):** "Activate <Company Name>? Users will be able to log in immediately." Confirm / Cancel. No destructive-action styling (this is a positive action), but still requires explicit confirmation rather than firing on a single ambiguous click, consistent with every state-changing action in this portal.

**Notifications:** A Platform Notification confirms activation; if configured, an automated welcome email is sent to the Head Office Administrator seeded during company creation.

**Error behavior:** If activation fails (e.g. a provisioning dependency did not complete), the company remains in its prior state and an inline error explains what is blocking activation (e.g. "Branding incomplete") with a direct link to fix it — this ties directly into Company Setup Status (Section 14).

**Audit:** Every activation is written to the Platform-level Audit Trail (Section 26) with Platform Owner identity, timestamp, and company.

---

## 12. COMPANY SUSPENSION

**Purpose:** Explicit, reversible action that blocks all login and portal access for a company's users without deleting any of the company's data.

**Trigger points:** Company List row menu; Company Detail Workspace header action.

**Modal (Confirmation Dialog, per Section 33 — destructive-leaning styling):** "Suspend <Company Name>? All users at this company will be immediately signed out and unable to log in until reactivated." A **mandatory reason field** (free text, required, minimum length) captures why the company is being suspended — this becomes part of the permanent audit record. Confirm (styled as a caution action, not a routine button) / Cancel.

**Effect:** All active sessions for that company's users are invalidated; the company's status badge updates platform-wide (Company List, Company Detail header) immediately; the company's data is fully retained and untouched — suspension is an access gate, never a data-deletion action.

**Notifications:** A Platform Notification confirms the suspension and logs the reason; if configured, an automated notice is sent to the company's registered contact explaining the suspension has occurred (the specific reason disclosed externally, if any, is a platform policy decision — at minimum the fact of suspension and a support-contact path are communicated).

**Error behavior:** If the suspension action fails partway (e.g. session invalidation succeeds but the status write fails), the portal surfaces this as an inconsistent-state error requiring the Platform Owner to retry rather than silently reporting success — this is treated with the same rigor as the SRS's Core Principle on financial discrepancies (Part 1 §3): a suspension action must not report success unless it fully succeeded.

**Audit:** Every suspension, with its mandatory reason, is written to the Platform-level Audit Trail (Section 26).

---

## 13. COMPANY REACTIVATION

**Purpose:** Explicit action restoring a suspended company's access.

**Trigger points:** Company List row menu (visible only when Status = Suspended); Company Detail Workspace header.

**Modal (Confirmation Dialog, per Section 33):** "Reactivate <Company Name>? Users will be able to log in again immediately." An optional notes field allows the Platform Owner to record why reactivation is happening (e.g. "payment issue resolved"), though unlike suspension this is not mandatory, since reactivation is not itself the risk-bearing action. Confirm / Cancel.

**Effect:** Status returns to Active; users can log in again; nothing about the company's prior data or configuration is altered by the suspend/reactivate cycle.

**Notifications/Audit:** Identical mechanism to Activation (Section 11) and Suspension (Section 12) — Platform Notification plus a permanent Platform-level Audit Trail entry.

---

## 14. COMPANY SETUP STATUS

**Purpose:** At-a-glance and detailed view of how complete a company's configuration is, so the Platform Owner can tell a genuinely operational company from one still mid-setup, and can help unblock a stalled setup.

**Components:** A checklist-style status panel with one row per setup requirement: Branding configured (yes/no), Head Office Administrator account created (yes/no), At least one branch created (yes/no — this is the company's own action per Part 1 §7, not something the Platform Owner does for them, but its absence is visible here), Company activated (yes/no).

**Visual treatment:** Each row shows a clear complete/incomplete state (checkmark vs. outline circle); an overall completion percentage or fraction (e.g. "3 of 4 complete") heads the panel; incomplete rows link to the relevant action (e.g. "Branding configured: No" links into Company Branding Preview in edit mode).

**Where shown:** Condensed on the Company List (as a Setup Status filter value and an optional column), full detail on the Company Detail Workspace's Setup Status tab.

**Empty/edge state:** A company that is fully set up shows a simple "Setup complete" confirmation rather than an empty checklist — the panel does not linger as clutter once its job is done, though it remains accessible for reference.

---

## 15. PLATFORM USER/USAGE OVERVIEW

**Purpose:** Aggregate, platform-wide visibility into how many staff users exist across all companies and how the platform is being used — explicitly aggregate and structural, never a per-user financial-performance view (that boundary is Section 40).

**Layout:** KPI card row plus two supporting tables/charts.

**KPI Cards:** Total Platform Users (all companies, staff accounts only — never customer accounts, which are company-owned data), New Users This Month, Active Sessions (current), Users by Role Category (Executive/Finance/HR-Admin/Audit-Compliance/Credit-Loans/Customer-Accounts/Operations-Field/Other, matching the category groupings in `Nexora_Role_Specifications_AZ_Complete.md`), Companies with No Active Login in 30+ Days (a health signal, not a financial one).

**Tables:** Users-by-company breakdown (Company Name, Total Users, Last Login Activity Date) — company-level aggregate counts only, no individual worker names or performance tied to money; Role-category distribution table (Role Category, Total Users Platform-Wide, % of Total).

**Filters:** Date range, Company (to see one company's user count trend), Role Category.

**Search:** Search is scoped to company name here, not to individual company users — the Platform Owner does not have a platform-wide "find this specific worker" search, since individual staff records are company-owned data (Section 40).

**Drill-down behavior:** Clicking a company row routes into that Company Detail Workspace's Users & Roles Overview tab (Section 8) — still aggregate counts, never individual performance.

**Charts:** Platform user growth trend (12-month), Role-category distribution (donut).

**Loading/Error/Empty states:** Standard pattern (skeleton on load, scoped retry on error, empty state directs to Companies Workspace if zero companies exist yet).

**Responsive behavior:** Table becomes a card list on mobile; charts stack vertically below KPI cards on tablet/mobile per Section 36–38.

---

## 16. PLATFORM HEALTH

**Purpose:** Infrastructure and system-health monitoring for the platform as a whole — this is an operations/reliability view, distinct from and never mixed with any company's business performance data.

**Layout:** Status-card grid (one card per monitored system) at the top, with expandable detail sections for Server Status, Database Status, API Status, and Storage Usage beneath.

**Components:** Overall Platform Status indicator (a single, prominent all-clear/degraded/outage badge, color-coded); per-system status cards; an incident/status history list.

**Sections (each with its own status, latency/response metrics where applicable, and a short history of recent status changes):**
- **Server Status (Section 17):** application server health, response time, current load.
- **Database Status (Section 18):** database connectivity, query latency, replication lag if applicable.
- **API Status (Section 19):** external-facing API availability and error rate.
- **Storage Usage (Section 20):** file/object storage consumption, trend, and remaining headroom.

**Drill-down behavior:** Each status card expands in place (accordion) to show its detailed metrics and recent incident history rather than navigating away, so the Platform Owner can scan multiple systems without losing context.

**Loading behavior:** Each status card polls/refreshes independently on its own interval; a card shows its own "last checked" timestamp so the Platform Owner always knows data freshness per system, not just for the page as a whole.

**Error behavior:** If a health check itself fails to report (distinct from the monitored system being unhealthy), the card shows an explicit "status unknown — check failed" state rather than defaulting to a false "healthy" appearance — this follows the SRS's Core Principle of exposing discrepancies rather than hiding them (Part 1 §3).

**Notifications:** A status change on any monitored system (healthy → degraded → outage, and back) triggers a Platform Notification and, for outage-level severity, is also eligible for the higher-urgency alert channel configured in Platform Notifications settings (Section 22).

**Responsive behavior:** Status-card grid reflows from a multi-column grid (desktop) to a two-column (tablet) to a single stacked column (mobile); accordion detail sections behave identically at every breakpoint.

---

## 17. SERVER STATUS

**Purpose:** Detail view of application-server health, nested within Platform Health (Section 16).

**Metrics shown:** Current status (Healthy/Degraded/Down), Uptime (rolling 30/90-day), Average response time, Current load/CPU utilization (if exposed), Recent restart/deploy events.

**Drill-down/behavior:** Inherits the accordion expand/collapse, independent refresh, "status unknown" fallback, and notification behavior defined once in Section 16 — not re-specified redundantly per system, since it is one shared status-card component instantiated per monitored system.

---

## 18. DATABASE STATUS

**Purpose:** Detail view of database health, nested within Platform Health (Section 16).

**Metrics shown:** Current status, Connection pool health, Query latency (average/95th percentile), Replication lag (if a replica topology is in use), Recent slow-query or connection-exhaustion incidents.

**Drill-down/behavior:** Inherits the shared status-card behavior defined in Section 16.

---

## 19. API STATUS

**Purpose:** Detail view of externally-facing API health (including the webhook-receiving endpoints central to the cashless payment architecture, SRS Part 1 §21), nested within Platform Health (Section 16).

**Metrics shown:** Current status, Availability (rolling 30-day), Error rate, Average latency, Recent incident history — with particular attention to webhook-endpoint health, since a degraded webhook path directly threatens the "if money moves, Nexora must know" core principle (Part 1 §3) across every company on the platform.

**Drill-down/behavior:** Inherits the shared status-card behavior defined in Section 16.

---

## 20. STORAGE USAGE

**Purpose:** Detail view of platform-wide file/object storage consumption (logos, uploaded documents, exported reports, etc. — aggregate, not per-company financial data), nested within Platform Health (Section 16).

**Metrics shown:** Total storage used, Total capacity/quota, Usage trend (chart), Top storage-consuming companies by aggregate file volume (company name and total MB/GB only — never the content or nature of what's stored, which is company-owned data).

**Drill-down/behavior:** Inherits the shared status-card behavior defined in Section 16; the "top consuming companies" list links to the Company Detail Workspace, not to any file browser into a company's actual documents.

---

## 21. PLATFORM ACTIVITY

**Purpose:** A chronological, platform-level activity feed — what has happened at the platform-operations layer (companies created/activated/suspended, Platform Owner configuration changes, support-access sessions), distinct from any company's own internal audit trail.

**Layout:** Reverse-chronological list/table, condensed version shown on the Dashboard (Section 2), full version as its own page.

**Table columns:** Timestamp, Event Type (Company Created / Activated / Suspended / Reactivated / Branding Changed / Global Setting Changed / Support Access Session / Role Catalogue Change / other platform-level event types), Company (if applicable), Actor (always the Platform Owner, since this is a single-owner portal — this column exists for forward-compatibility if the platform ever supports additional platform-level administrator accounts), Summary text.

**Filters:** Event Type, Company, Date range.

**Search:** Free-text search across the Summary field and Company name.

**Drill-down behavior:** Clicking an activity row opens the relevant detail (a company-related event opens that Company Detail Workspace's Activity Log tab; a global-setting-change event opens the Audit Trail entry, Section 26, for full before/after detail).

**Loading/Error/Empty states:** Standard pattern; an empty platform (or an empty filtered result) shows "No activity recorded" / "No activity matches these filters" respectively.

**Responsive behavior:** Table becomes a reverse-chronological card list on mobile, each card showing Event Type + Company + relative timestamp prominently.

---

## 22. PLATFORM NOTIFICATIONS

**Purpose:** The Platform Owner's real-time alert feed for platform-operations events requiring attention — separate from Platform Activity's full historical log (Notifications is the "what needs my attention," Activity is the "what happened" record).

**Components:** Bell icon with unread-count badge in the sidebar (Section 3); a notification panel/page listing items with Read/Unread state, grouped by recency (Today/This Week/Earlier).

**Notification triggers include:** Platform Health status changes (Section 16), a new company completing setup and awaiting activation, a company nearing a configured storage or usage threshold, a failed scheduled process (e.g. a health-check job itself failing), a new device/location login to the Platform Owner's own account (Section 1), and any event configured as notification-worthy in Global Platform Settings (Section 24).

**Actions:** Mark as read / Mark all as read; click-through navigates to the relevant page (mirrors the drill-down pattern of Platform Activity, Section 21); dismiss (removes from the active feed without deleting the underlying Platform Activity record, since Activity is the permanent log and Notifications is the transient attention-queue).

**Empty state:** "You're all caught up" with no error styling — an empty notification feed is a normal, positive state, not a failure state.

**Responsive behavior:** Full panel on desktop/tablet; a slide-down or dedicated screen on mobile, reachable from the bottom tab bar (Section 38).

---

## 23. PLATFORM ANNOUNCEMENTS

**Purpose:** A mechanism for the Platform Owner to record/manage platform-wide announcements — e.g. planned maintenance windows the Platform Owner wants visibly tracked, or (if the platform later supports company-facing broadcast messages) the authoring surface for those. Within this portal, at minimum it functions as the Platform Owner's own maintenance/incident-communication log.

**Components:** Announcement list (Title, Status — Draft/Active/Expired, Start/End time if scheduled, Created date); Create/Edit Announcement form (Title, Body, Severity — Info/Warning/Critical, Start time, optional End time, Target — Platform-wide or specific companies if the platform supports scoped announcements).

**Actions:** Create, Edit (while still Draft or Active), Archive/Expire (manually end an announcement before its scheduled end time), Duplicate (start a new announcement from an existing one's template).

**Validation:** Title and Body required; End time, if set, must be after Start time; Critical-severity announcements require an explicit confirmation before publishing, mirroring the caution-styling pattern used for Suspension (Section 12).

**Where surfaced:** An Active announcement renders as the dismissible banner on the Dashboard (Section 2) described there.

**Empty state:** "No announcements" with a Create action, no error styling.

**Responsive behavior:** List becomes a card list on mobile; the Create/Edit form is a full-screen flow on mobile rather than a modal, consistent with Section 34's modal-sizing rules.

---

## 24. GLOBAL PLATFORM SETTINGS

**Purpose:** Platform-wide configuration that applies across every company — distinct from Platform Configuration (Section 25), which covers deeper technical/system configuration. Global Platform Settings covers business-facing platform policy; Platform Configuration covers system-facing technical policy. (This split keeps each settings area's form set focused rather than one enormous undifferentiated settings page — a concrete implementation requirement for Cline: these are two separate route/component trees, not one page with an internal tab hack.)

**Sub-pages/sections:**
- **Default Company Theme:** Nexora's own fallback brand tokens (Part 1 §26) that pre-fill a new company's theme and serve as the fallback wherever a company hasn't overridden a value — editable here by the Platform Owner, with the same live-preview mechanism as Company Branding Preview (Section 10).
- **Company Plans/Tiers (if configured):** define what tiers exist and what they gate (e.g. branch-count ceilings, feature flags) — Create/Edit/Archive a tier, with validation preventing deletion of a tier currently assigned to an active company without first reassigning those companies.
- **Notification Policy:** which platform-health events (Section 16) trigger a Platform Notification vs. also an out-of-band alert (e.g. email/SMS) for higher-severity events.
- **Security Policy:** 2FA enforcement settings for the Platform Owner's own account, session-timeout duration, device-trust duration (ties to Section 1's "Remember this device").

**Forms/Validation:** Each sub-page has its own scoped form with inline validation; a global "unsaved changes" guard warns before navigating away from a sub-page with pending edits.

**Actions:** Save (per sub-page, not a single platform-wide Save-everything button, so a Platform Owner editing Notification Policy is never at risk of also submitting an in-progress, unfinished edit on Security Policy).

**Audit:** Every Global Platform Settings change is written to the Platform-level Audit Trail (Section 26) with a before/after value diff.

---

## 25. PLATFORM CONFIGURATION

**Purpose:** Deeper, system-facing technical configuration — the platform-level counterpart to a system administrator's settings, distinct from the business-policy focus of Global Platform Settings (Section 24).

**Sub-pages/sections:**
- **Role Catalogue Management:** platform-wide control over which of the 32 built-in roles (`Nexora_Role_Specifications_AZ_Complete.md`) and which of the 11 Custom Role templates (Part 1 §19) are available for companies to enable — this is the platform-level ceiling; a company's own enable/disable choice (Part 2 §48) operates within whatever the Platform Owner has made available here.
- **Integration/Webhook Endpoints:** platform-level configuration of the payment-gateway webhook infrastructure underlying Part 1 §21 (endpoint health surfaces in Platform Health/API Status, Section 19; the configuration of which gateways are integrated lives here).
- **Data Retention Policy:** platform-wide retention rules for audit-trail and activity-log data (never for a company's core financial records, which are governed by the company's own accounting/audit requirements and are never platform-owner-editable).
- **Environment/Release Info:** current platform version, last deployment timestamp — read-only informational panel, useful for support conversations.

**Forms/Validation:** Same scoped-save, unsaved-changes-guard pattern as Global Platform Settings (Section 24).

**Actions:** Save per sub-page; Role Catalogue Management additionally has an explicit confirmation dialog (Section 33) before disabling a role that is currently in active use by any company, since doing so could strand that company's existing role assignments — the dialog states how many companies/users are currently using the role being disabled.

**Audit:** Every Platform Configuration change is written to the Platform-level Audit Trail (Section 26) with a before/after value diff, identical rigor to Section 24.

---

## 26. PLATFORM-LEVEL AUDIT TRAIL

**Purpose:** The permanent, immutable record of every platform-operations action the Platform Owner has taken — this is the platform's own audit trail, distinct from and never merged with any company's internal audit trail (Part 1 §25), which remains that company's own data and is not surfaced here.

**Table columns:** Timestamp, Action Type (Company Created/Activated/Suspended/Reactivated, Branding Edited, Global Setting Changed, Platform Configuration Changed, Role Catalogue Changed, Support Access Session Opened/Closed, Announcement Published), Company (if applicable), Before Value / After Value (for edits — a structured diff, not just a text summary), Platform Owner identity, Session/IP metadata.

**Filters:** Action Type, Company, Date range.

**Search:** Free-text across Action Type and Company name.

**Drill-down behavior:** Clicking an entry opens a detail panel with the full before/after diff and any associated reason text (e.g. a Suspension's mandatory reason field, Section 12).

**Immutability:** Entries are append-only; there is no edit or delete action anywhere in this portal's UI for an audit-trail entry, matching the same "reversal, never edit" discipline the company-side audit trail already enforces (Part 1 §25/§21).

**Export:** Full or filtered export to CSV, for the Platform Owner's own compliance/record-keeping needs.

**Empty/Loading/Error states:** Standard pattern, consistent with every other table in this portal (Sections 30–33).

**Responsive behavior:** Table becomes a card list on mobile with the diff detail reachable via tap-to-expand.

---

## 27. AI PLATFORM INSIGHTS

**Purpose:** An analytical/advisory panel surfacing platform-level patterns worth the Platform Owner's attention — growth trends, health anomalies, and setup-stalled companies — computed from the aggregate, structural, non-financial data this portal already has access to. It never surfaces or infers anything about a company's internal loan/payment/customer data, since that data is not visible to this portal in the first place (Section 40).

**Components:** A card-based insight feed, each insight showing a short natural-language summary, the metric(s) behind it, and a direct link into the relevant workspace (e.g. "3 companies have been 'In Setup' for over 14 days — review Setup Status" links into the Companies Workspace filtered to Setup Status = Incomplete).

**Example insight categories:** Company growth trend commentary (e.g. accelerating/decelerating new-company rate), companies stalled in setup, companies with no login activity in 30+ days, platform-health anomalies worth flagging even if not yet outage-severity, storage-usage trend warnings.

**Actions:** Dismiss an insight (removes it from the active feed; does not affect the underlying data); "Why am I seeing this" affordance on each card explaining the metric/threshold that generated it, so insights are explainable rather than opaque.

**Loading/Error/Empty states:** Skeleton cards while insights compute; a scoped error if the insight engine fails, without blocking the rest of the Dashboard/portal; "No insights right now" as a normal empty state.

**Responsive behavior:** Card feed reflows from a grid (desktop) to a single column (mobile), identical pattern to other card-based panels in this portal.

---

## 28. QUICK ACTIONS

**Purpose:** A small, fixed set of one-click shortcuts to the Platform Owner's most frequent tasks, surfaced on the Dashboard (Section 2) and optionally pinned in the sidebar.

**Actions offered:** Create Company (Section 9); View Suspended Companies (jumps to Company List pre-filtered); View Platform Health (Section 16); View Recent Activity (Section 21); Create Announcement (Section 23).

**Behavior:** Each Quick Action is a direct route, not a modal — it takes the Platform Owner to the full corresponding page/workflow rather than trying to compress that workflow into a small widget, so nothing about the underlying page's validation/error handling is duplicated or diverges here.

**Responsive behavior:** Rendered as a horizontally-scrollable chip row on mobile rather than a card grid, to preserve vertical space on the Dashboard.

---

## 29. SEARCH BEHAVIOR (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention every search field in this portal follows, so behavior is predictable rather than re-invented per page.

**Rules:** Debounced type-ahead (results update after a brief pause in typing, not on every keystroke); minimum 2-character query before searching; loading indicator inline within the search field itself; results are scoped to whatever entity that page's search is defined against (Section 6 for company search, Section 21/26 for activity/audit search, etc. — there is no single platform-wide omnisearch that reaches into company-owned data, consistent with the visibility boundary in Section 40); pressing Escape or clicking outside closes an open results dropdown without clearing the typed query, so the Platform Owner can resume.

---

## 30. EMPTY STATES (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention every list/table in this portal follows for the zero-results case.

**Rules:** Distinguish clearly between "genuinely zero data exists" (e.g. a brand-new platform with no companies) and "your filter/search matched nothing" (e.g. no Suspended companies right now) — the former offers a create/get-started action, the latter offers a clear-filters action; empty states never use error styling (red/alert coloring) since an empty result is not a failure; empty states retain the surrounding page chrome (filters, search bar, sidebar) so the Platform Owner is never dropped into a dead-end blank screen.

---

## 31. LOADING STATES (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention every page in this portal follows while data is in flight.

**Rules:** Skeleton placeholders matching the shape of the eventual content (skeleton KPI cards, skeleton table rows) rather than a generic full-page spinner, wherever the layout is already known; a full-page spinner is reserved for the very first authenticated load (before the sidebar/shell itself has rendered); independently-loading panels (Section 2's dashboard, Section 16's health cards) load and resolve independently rather than blocking on the slowest one; any action button that triggers a request (Save, Create, Activate/Suspend/Reactivate) disables itself and shows an inline spinner for the duration of that request, to prevent double-submission.

---

## 32. ERROR STATES (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention every page/action in this portal follows on failure.

**Rules:** Errors are scoped to the smallest failing unit (one panel, one form field, one row-level action) rather than surfacing as a full-page failure whenever a partial failure is possible; every scoped error includes a Retry affordance where a retry is meaningful; destructive/state-changing actions (Suspend, Activate, Reactivate, Save on a settings page) never report success unless the underlying write is confirmed — a partial or ambiguous outcome is surfaced explicitly as "we couldn't confirm this completed — please check and retry," per the SRS's Core Principle of exposing discrepancies rather than hiding them (Part 1 §3); network-level failures (no connectivity) are distinguished in messaging from server-side failures (the platform itself returned an error), since the correct next step differs.

---

## 33. CONFIRMATION DIALOGS (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention for every state-changing action in this portal — company Activation/Suspension/Reactivation (Sections 11–13), disabling a role in active use (Section 25), publishing a Critical-severity announcement (Section 23), and any comparable action.

**Rules:** Every such action requires an explicit confirmation step — never a single ambiguous click; the dialog names the exact object being acted on (e.g. the company name, not just "this company"); destructive or access-restricting actions (Suspension) use caution styling (distinct color/iconography from a routine Confirm button) and, where specified above, a mandatory reason field that becomes part of the permanent audit record; non-destructive/reversible actions (Reactivation, Activation) still require confirmation but do not use caution styling, since over-using alarming styling for routine actions trains people to click through it without reading; every confirmed action is written to the Platform-level Audit Trail (Section 26) regardless of severity.

---

## 34. SUCCESS STATES (PLATFORM-WIDE CONVENTION)

**Purpose:** A single documented convention for confirming a completed action.

**Rules:** A brief, dismissible toast/banner confirms completion (e.g. "Company Activated," "Announcement Published") without blocking further interaction; the affected data (a status badge, a list row) updates in place immediately rather than requiring a manual refresh; where the action has a natural next step (e.g. after Create Company, the Platform Owner likely wants to see the new Company Detail Workspace), the success state offers a direct link to that next step rather than forcing manual navigation.

---

## 35. DESKTOP LAYOUT

**Purpose:** The primary, full-featured layout target for this portal — most Platform Owner work (Company Detail review, Global Settings/Platform Configuration editing, Audit Trail investigation, the Create Company Wizard's Branding step) is treated as desktop-primary, consistent with the density of these workflows.

**Behavior:** Full labeled sidebar (Section 3) always visible; multi-column dashboard layout (Section 2); full data tables with every column shown (no column-hiding); side-by-side split views (e.g. Company Branding Preview's form-and-preview split, Section 10) render side by side by default.

---

## 36. TABLET LAYOUT

**Purpose:** A fully usable, slightly condensed layout target — the Platform Owner can do essentially everything on tablet, with some density trade-offs.

**Behavior:** Sidebar collapses to an icon-only rail, expandable on tap (Section 3); tables hide their lowest-priority columns behind a row-expand affordance rather than horizontal scrolling (e.g. Company List keeps Company Name/Status/Branch Count visible, tucks Plan/Tier and Last Activity behind an expand); side-by-side split views (Branding Preview) remain side by side in landscape orientation, stack in portrait; KPI card rows reflow from a single row to a two-row grid.

---

## 37. MOBILE LAYOUT

**Purpose:** A condensed, priority-ordered layout target — mobile is treated as a capable companion surface for review and light action-taking (confirming an Activation, checking Platform Health, reading Notifications), not the primary surface for dense configuration work (Global Settings, Platform Configuration, the Create Company Wizard's Branding step remain fully functional but are acknowledged as desktop-preferred).

**Behavior:** Sidebar becomes a bottom tab bar or slide-out drawer (Section 38); every data table becomes a stacked card list (Section 5's pattern, applied consistently across Companies, Platform Activity, Audit Trail); the Dashboard's two-column body (Section 2) stacks into a single column, KPI cards scroll horizontally or stack; modals (Section 23's Create Announcement, confirmation dialogs) become full-screen flows rather than centered overlays, to preserve legibility on a small screen.

---

## 38. NAVIGATION BEHAVIOR

**Purpose:** How the Platform Owner moves through the portal, across breakpoints.

**Rules:** Bottom tab bar on mobile surfaces the highest-priority destinations directly (Dashboard, Companies, Notifications, Account menu) with a "More" entry housing the remainder (Platform Health, Platform Activity, Announcements, Global Settings, Platform Configuration, Audit Trail, AI Platform Insights); every list-to-detail transition preserves filter/search/sort state on back-navigation (Section 3's general rule); deep links (e.g. a link from a Platform Notification directly into a specific Company Detail Workspace tab) work identically regardless of entry point — there is no "you must navigate from the Dashboard first" requirement anywhere in this portal.

---

## 39. COMPANY DRILL-DOWN BEHAVIOR

**Purpose:** The single, explicit statement of exactly how far the Platform Owner's drill-down goes into a company, and exactly where it stops — this is the concrete implementation of the visibility boundary stated in Section 40.

**The allowed chain:**
```
Company List → Company Detail Workspace → Branches Overview (structural fields only:
   name, code, portal URL, created date, status)
                                        → Users & Roles Overview (aggregate role-category
   counts only)
                                        → Setup Status
                                        → Branding
                                        → Activity Log (platform-level events about this
   company only)
```

**Where the chain explicitly stops:** there is no link, button, or route anywhere in this portal from a branch into that branch's customers, from a role-category count into an individual worker's identity or performance, or from any point in this chain into a loan, payment, savings balance, or accounting record. This is not an oversight to be filled in later — it is the intended, permanent boundary, matching the requirement that the Platform Owner must not automatically see company operational financial data. The only path past this boundary is the separately defined, explicitly authorized, and fully audited Support Access mechanism (Section 40), which is never reachable by an ordinary click through this drill-down chain — it requires its own distinct, logged authorization step every time.

---

## 40. PLATFORM OWNER PERMISSIONS AND RESTRICTIONS

**Purpose:** The explicit permission boundary for the entire portal — what the Platform Owner can and cannot do, stated once, authoritatively, so no other section needs to re-litigate it.

**Can:**
- Create, activate, suspend, and reactivate companies.
- Configure and preview company branding, including the platform-wide default theme.
- View aggregate, structural, non-financial data about every company: branch names/codes/URLs, staff counts by role category, setup status, storage usage, login activity recency.
- Configure the platform-wide role catalogue ceiling (which built-in roles and Custom Role templates exist for companies to enable), Global Platform Settings, and Platform Configuration.
- View and export the Platform-level Audit Trail and Platform Activity feed.
- Author and publish Platform Announcements.
- Monitor Platform Health (servers, database, API, storage).
- Initiate a Support Access session, if and only if that mechanism has been separately, explicitly authorized (see below) — never as a default, ambient capability of the ordinary Platform Owner account.

**Cannot, by default, under any ordinary use of this portal:**
- View any company's customer records, loan records, payment/transaction records, savings balances, or accounting/reconciliation data.
- View any individual worker's personal performance figures (Expected/Actual Collection, Collection %, etc. — the Performance Visibility Layer of SRS Part 1 §25-C is a company-internal capability, granted to company-side roles by company-side scope rules; it is never extended to the Platform Owner Portal).
- Edit, reverse, or otherwise act on any financial record belonging to a company.
- Access a company's own internal audit trail (Part 1 §25) — only the platform-level record of what the Platform Owner itself did regarding that company.
- Impersonate a company user to browse the company portal as them, outside of the separately authorized Support Access mechanism below.

**The Support Access mechanism (referenced throughout this document, defined once here):** where genuine support access to a company's operational data is required (e.g. diagnosing a customer-reported issue), it must exist as its own distinct, separately authorized, fully audited pathway — never as an implicit extension of ordinary Platform Owner visibility. At minimum: (1) it requires an explicit "Request Support Access" action naming the company and a reason; (2) it is time-bound — access automatically expires after a short, configurable window rather than persisting indefinitely; (3) every action taken during a Support Access session is written to both the Platform-level Audit Trail (Section 26, as "Support Access Session Opened/Closed" with the reason and duration) and, if technically feasible, surfaced within the company's own audit trail so the company itself is never kept in the dark about platform-level access to their data; (4) it connects through the separate, explicitly-audited support-access path already required by Part 1 §4, never through the normal company data layer used by that company's own users. This mechanism is out of scope to fully re-specify here beyond these requirements — its full workflow (request/approval, if any additional approval step is required, session UI, expiry handling) is a discrete future specification item, but its existence, its audit obligations, and the fact that it is the *only* path past the boundary in Section 39 are permanent, non-negotiable requirements of this portal.

**Interface/branding note (ties to the top of this document):** every screen in this specification renders using Nexora's own premium default theme (Part 1 §26) — a company's brand tokens are never applied to any Platform Owner Portal screen, including during a Support Access session, where the session is visually distinguished (e.g. a persistent banner naming the company and session expiry) rather than silently rendering as if the Platform Owner were simply using that company's portal unannounced.

---

# END OF PLATFORM OWNER PORTAL SPECIFICATION

**Traceability check for Cline:** every one of the 40 numbered items required for this specification (Platform Owner Login through Platform Owner Permissions and Restrictions) is addressed above as its own section, each stating Purpose, Layout/Components, and the applicable subset of KPI Cards / Tables / Columns / Filters / Search / Actions / Buttons / Modals / Forms / Validation / Notifications / Drill-down / Loading / Error / Empty / Responsive behavior — omitted only where a field is genuinely not applicable to that specific page. This document adds a fully separate application surface to the Nexora specification; it does not modify, shorten, or contradict any requirement in `Nexora_SRS_v2_1_Part1_Architecture.md`, `Nexora_SRS_v2_1_Part2_Roles_and_Systems.md`, or `Nexora_Role_Specifications_AZ_Complete.md`.
