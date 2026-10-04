# ISSUE LOG — Cornelius Nexora Finance

One entry per issue, written **as it is found during a run phase**.
Nothing here is fixed during a run; fixes land in Phase 12.

Legend: `SEV-1` critical / `SEV-2` high / `SEV-3` medium / `SEV-4` low.
`AREA` is `prod` or `harness`.

---

## ISS-001 — Duplicate group name returns 500 instead of 409

| | |
|---|---|
| **Severity** | SEV-3 Medium |
| **Area** | prod |
| **Found in** | PHASE 0 (carried from the previous reactive loop) |
| **Status** | OPEN — not fixed |

**Repro**
1. Create group in company/branch with name `X`.
2. Create another group in the same company + branch with name `X`.

**Observed:** `500 INTERNAL_ERROR`
```
duplicate key value violates unique constraint "groups_company_id_branch_id_name_key"
  at packages/server/src/modules/groups/service.ts:128
```

**Expected:** `409 CONFLICT` with a message such as
"A group with this name already exists in this branch."

**Why it matters:** a predictable user mistake (reusing a group name) surfaces
as an opaque server error. It also leaks a raw Postgres constraint name to the
client via logs, and it gives the caller no way to distinguish "you already have
this group" from "the server broke".

**Evidence:** `_probe_out/both-log.txt` (DatabaseError, groups/service.ts:128)

**Note:** also treated as the reason the ops journey could not complete — the
harness previously reused fixed group names across runs, so the second run
collided. Harness now generates run-scoped names.

---

## ISS-002 — No production build step; `start` runs a TypeScript loader

| | |
|---|---|
| **Severity** | SEV-3 Medium (deployment readiness) |
| **Area** | prod |
| **Found in** | PHASE 1 — Infrastructure & Boot |
| **Status** | OPEN — not fixed |

**Repro:** `npm run build --workspace=@nexora/server`

**Observed**
```
npm error Missing script: "build"
```

Actual `packages/server/package.json` scripts:
```
dev        tsx watch src/index.ts
start      tsx src/index.ts
typecheck  tsc --noEmit -p tsconfig.json
test       vitest run
```

**Expected:** a build step producing compiled JS, with `start` running the
compiled output — so production does not depend on a TypeScript loader.

**Why it matters:** `typecheck` is clean, so this is not a correctness bug, but
`start` executes TypeScript directly through `tsx`. Production boot therefore
depends on a dev-oriented loader, which is slower to start, not covered by the
typecheck guarantee at runtime, and typical of a setup that has never been
packaged for deployment. Root `package.json` has no build script either.

**Note:** whether the Vision mandates a compiled artefact is not yet confirmed —
that check belongs to Phase 2/14 against the authority text. Flagged, not judged.

**Evidence:** `_probe_out/p1-build.txt`, `_probe_out/p1-scripts.txt`

---

## PHASE 1 — Infrastructure & Boot: RESULT (no product fixes applied)

| Check | Result |
|---|---|
| Node | v24.18.0 — OK |
| npm | 11.16.0 — OK |
| PostgreSQL | 16.14, reachable — OK |
| Migration files on disk | 82 — OK |
| Migrations applied to `nexora_test` | 82 — consistent with disk — OK |
| Server typecheck | **clean**, zero diagnostics — OK |
| Server boot + health probe | boots and serves (proven by every journey run) — OK |
| Production build | **fails — no `build` script → ISS-002** |
| Working tree | 201 changed/untracked paths (expected: restored project, uncommitted) |

**Issues raised in Phase 1: ISS-002.**
**Product code edited during Phase 1: none** (phase discipline held).

---

## ISS-003 — Phase 2 harness gap: journey1 never ran — **RESOLVED**

| | |
|---|---|
| **Severity** | SEV-3 Medium (blocked verification) |
| **Area** | harness |
| **Found in** | PHASE 2 |
| **Status** | **RESOLVED (harness) — proven, not assumed** |

**Root cause:** `_go_roles.cmd` called `_job_journey2.cmd`, which ran **only**
`journey2`. Platform Owner onboarding (`journey1`) was never invoked, and the
runner still reported `EXITCODE=0`.

**Fix — two defences, because editing the script alone proves nothing:**

1. **Pre-run evidence deletion.** `_job_journey2.cmd` deletes both expected
   reports *before* running, so a stale report can never be mistaken for fresh.
2. **Post-run evidence gate.** New `packages/server/_evidence_guard.mjs` requires
   each expected report to exist, be non-empty and contain the harness summary
   marker. Failure forces exit code **9**, so the runner can no longer report
   green while skipping a journey.

The job now runs `journey1` then `journey2`, then the gate.

**Proof of execution** (`_probe_out/roles-log.txt`, `roles-status.txt`):
```
[phase2] clearing prior evidence so freshness is provable...
[phase2] running journey1 (Platform Owner onboarding)...
JOURNEY1_EXIT=0
[phase2] running journey2 (role matrix)...
JOURNEY2_EXIT=0
PASS  evidence OK  ...\independent-e2e.txt        :: total: 24  passed: 24  failed: 0
PASS  evidence OK  ...\independent-e2e-roles.txt  :: total: 11  passed: 11  failed: 0
EVIDENCE_GUARD: all 2 evidence file(s) verified
```
Evidence was deleted immediately before the run and reappeared only because both
journeys genuinely executed. **journey1 24/24, journey2 11/11.**

---

## ISS-004 — Draft company workflow (RULE 3.3.3) DOES NOT EXIST

| | |
|---|---|
| **Severity** | **SEV-2 High — missing documented capability** |
| **Area** | prod |
| **Found in** | PHASE 2 (TESTED, not guessed) |
| **Status** | OPEN — for Fix Sprint |

**Authority — RULE 3.3.3, verbatim (line 408):**
> "The wizard **may be saved as a draft** before creation is completed; a draft
> company **sits in "In setup" status and cannot be logged into**. Once the
> Platform Owner completes Create Company successfully, the company is
> provisioned and becomes live immediately... A completed company must never
> remain unnecessarily in 'In setup'."

**Driven through real HTTP against real PostgreSQL** (`verify/p2-draft-probe.ts`;
report `_probe_out/p2-draft-probe.txt`, log `_probe_out/draft-log.txt`):

| Probe | Result |
|---|---|
| `POST /platform/v1/companies/draft` | **404** `NOT_FOUND` |
| `POST /platform/v1/companies/drafts` | **404** `NOT_FOUND` |
| `POST /platform/v1/companies/save-draft` | **404** `NOT_FOUND` |
| `PUT  /platform/v1/companies/draft` | **404** `NOT_FOUND` |
| `POST /platform/v1/companies?draft=true` | **201 — draft flag SILENTLY IGNORED, created a LIVE company** |

**Conclusion from actual behaviour, not inspection:** there is **no draft-save
capability at all**. No route persists a partial company, so no company can ever
reach `in_setup` through the application. The Vision's first obligation in
RULE 3.3.3 is unimplemented.

**Severity rationale (set only after testing):**
- Not SEV-1: nothing is exposed and no auth hole opens. The "cannot be logged
  into" guarantee is *unverifiable* because no draft can exist — not *violated*.
- SEV-2: a workflow the Vision explicitly requires is unavailable, so the
  Platform Owner cannot save and resume the Create Company wizard.

**Corroborating inconsistency (recorded, not fixed):**
`packages/platform-web/src/Portal.tsx` renders an **Activate** button for
`status === "in_setup" || "pending_activation"`, and `platform/service.ts`
comments *"A draft company, if ever saved separately, is a different flow and
still starts in 'in_setup'"*. With no draft flow, that UI branch is unreachable
dead code describing a capability that does not exist.

**F-02 explicitly NOT changed.** RULE 3.3.3 requires a completed company to
become live immediately, which is what the product does. RULE 3.6.1's separate
activation controls are not a reason to revert it.

**Outstanding sub-test (honest gap):** the login gate for a non-live company was
not conclusively captured — my probe hit a prefix-collision harness bug
(409 `PREFIX_TAKEN`) that aborted the suspend/login steps. The draft conclusion
does not depend on it, but the login-gate check should be re-driven in the Fix
Sprint once a draft company can actually be created.

| | |
|---|---|
| **Severity** | SEV-3 Medium (blocks verification) |
| **Area** | harness |
| **Found in** | PHASE 2 — Platform Owner Onboarding |
| **Status** | OPEN — not fixed (Phase 12) |

**Repro:** run `_launch.ps1 -CmdPath _go_roles.cmd`

**Observed:** only the 11-check roles journey (journey2) executes. The Platform
Owner onboarding journey (journey1) produces no output file; `_probe_out/journey1.txt`
does not exist. `roles-status.txt` shows `EXITCODE=0`, so the runner reports
success while silently skipping the onboarding checks.

**Impact:** Phase 2 was supposed to exercise Platform Owner → Create Company →
MD ritual end-to-end. That did not happen, so a green `_go_roles` must not be
read as "onboarding verified". This is exactly the kind of false-green the phase
discipline exists to catch.

**Evidence:** `_probe_out/roles-status.txt`, absence of `_probe_out/journey1.txt`

---

## ISS-004 — Draft company / "In setup" must be loggable-into-proof (UNTESTED)

| | |
|---|---|
| **Severity** | SEV-2 High (if absent) |
| **Area** | prod |
| **Found in** | PHASE 2 — Platform Owner Onboarding |
| **Status** | OPEN — **not yet tested, not yet judged** |

**Authority — RULE 3.3.3 (verified verbatim, line 408):**
> "The wizard may be saved as a draft before creation is completed; a draft
> company sits in 'In setup' status and cannot be logged into. Once the Platform
> Owner completes Create Company successfully, the company is provisioned and
> becomes live immediately, appears in the Companies workspace, and is ready for
> the Platform Owner to open and manage. A completed company must never remain
> unnecessarily in 'In setup'."

**Two obligations in one rule.** The second half (completed ⇒ live immediately)
was F-02 and is now **confirmed correct against the authority**.

The first half — *draft exists, sits in `in_setup`, and cannot be logged into* —
has **never been exercised**. Open questions, deliberately left open:
- Can the Platform Owner save the Create Company wizard as a draft at all?
- Is a draft company visible in the Companies workspace?
- Is login into a draft company actually refused (and with which status code)?

**Not fixed and not judged yet.** Must be driven in Phase 2 before any conclusion.
If draft-save does not exist, this is a missing feature (SEV-2); if it exists but
permits login, it is an auth defect (SEV-1).

---

## ISS-005 — Malformed company id in path returns 500 instead of a 4xx

| | |
|---|---|
| **Severity** | SEV-3 Medium |
| **Area** | prod |
| **Found in** | PHASE 2 (surfaced incidentally by the ISS-004 probe) |
| **Status** | OPEN — for Fix Sprint |

**Repro:** `POST /platform/v1/companies/undefined/status` (any non-UUID `:id`).

**Observed:** `500 INTERNAL_ERROR`, with Postgres `22P02 invalid input syntax for
type uuid ... "unnamed portal parameter $1 = '...'"` at `platform/service.ts:732`,
raised through `platform/routes.ts:204`.

**Expected:** `400`/`422` rejecting a malformed id. `GET /companies/:id/detail`
already validates via `uuidParam(req)`; the status route does not.

**Why it matters:** same class as ISS-001. A client-side id bug surfaces as an
opaque server error, and a raw database error code is logged instead of a clean
validation failure.

**Evidence:** `_probe_out/draft-log.txt` (entry with
`"path":"/platform/v1/companies/undefined/status"`)

---

## PHASE 2 — Platform Owner Onboarding: **CLOSED**

| Requirement | Evidence | Verdict |
|---|---|---|
| ISS-003 — every required journey demonstrably executes | journey1 24/24, journey2 11/11; evidence deleted pre-run and regenerated; gate verified | **RESOLVED** |
| ISS-004 — RULE 3.3.3 draft obligation driven | 4 draft routes 404; `?draft=true` silently ignored (201 live company) | **MISSING FEATURE (SEV-2)** |
| F-02 — completed company live immediately | RULE 3.3.3 re-read verbatim; `status=active` in DB | **RESOLVED, retained** |
| Company prefix 3–6 uppercase, platform-unique | `DSNDOC`, `DSNZJW` | PASS |
| MD full name becomes username | observed | PASS |
| Branch code + portal URL system-persisted (RULE 7.4.3) | `DSNDOC-001` + portal_url | PASS |

**Phase 2 is NOT green** — it is *complete as a verification pass*, with two
product defects recorded and deferred to the Fix Sprint per phase discipline.

**Product code edited during Phase 2: none.** Only harness/verification scripts
were created or corrected: `_evidence_guard.mjs`, `_job_journey2.cmd`,
`_job_draft.cmd`, `_job_draftrun.cmd`, `_go_draft.cmd`, `verify/p2-draft-probe.ts`.

---

## Previously fixed

**Authority cross-check — F-02 re-confirmed.** RULE 3.3.3 read in full at line 408
independently confirms the F-02 fix is right: *"becomes live immediately... A
completed company must never remain unnecessarily in 'In setup'."* The earlier
worry that RULE 3.6.1's "create, **activate**, suspend and reactivate" implied a
separate mandatory activation step is **resolved against** — 3.3.3 governs
creation and requires immediate liveness. No defect raised from that.

**Observed and consistent with the authority (roles journey, 11/11 pass):**

| Authority | Observed |
|---|---|
| Company prefix: 3–6 uppercase letters derived from the name, platform-unique | `DSNDOC` (6 chars) — OK |
| MD full name "becomes the MD's username" | `Deep …` used as username — OK |
| Branch code + portal URL system-persisted, never typed | `DSNDOC-001`, `...portal_url` — OK (RULE 7.4.3) |
| Completed company is live immediately (RULE 3.3.3) | `status=active` — OK |

**Database state:** 82 migrations applied, 10 companies, 62 users, EXITCODE=0.

**Issues raised in Phase 2: ISS-003 (harness), ISS-004 (prod, untested).**
**Product code edited during Phase 2: none** (phase discipline held).

---

---

## ISS-006 — **BLOCKER**: test database emptied and app DB user lost write privileges

| | |
|---|---|
| **Severity** | **SEV-1 Critical — possible destructive data loss / Law 12 violation** |
| **Area** | prod (or environment) |
| **Found in** | PHASE 3 — Role & Permission Matrix (PREPARE) |
| **Status** | OPEN — **Phase 3 BLOCKED until explained** |

**Observed state of `nexora_test` (`_probe_out/p3-state.txt`):**
```
connected: db=nexora_test user=nexora
  companies                              0
  users                                  0
  branches                               0
  roles                                  0
  role_permissions                       0
  platform_role_permission_bundles     188
  customers                              0
error: permission denied for table _migrations   (42501)
```

The database is **completely empty** — every tenant table at zero — yet minutes
earlier the Phase 2 run reported:
```
DB OK migrations=82 companies=13 users=77
```
and journey1 (24/24) + journey2 (11/11) had just created companies, branches,
workers and roles, and logged each role in successfully.

**Two independent anomalies:**

1. **Total data loss.** All tenant data vanished between those observations.
   Nothing in `_probe_out` records a truncate, drop or reset.
2. **Privilege loss.** The `nexora` role can `SELECT` but gets `42501 permission
   denied` on `INSERT INTO companies` and on reading `_migrations`. The app
   connects as `nexora` (`verify/journey1.ts`:
   `postgres://nexora:nexora@localhost:5432/nexora_test`), so a freshly created
   company is no longer insertable by the application user.

**Prime suspect — UNVERIFIED:** `_verify.cmd` runs `npx tsx src/db/migrate.ts`
before every journey. If migrate resets, then **every verification run destroys
the previous run's data**, which would invalidate any evidence depending on prior
state and would violate the Vision's Law 12 ("financial truth survives failure...
never destructively deleted"). I attempted a marker-row experiment
(`_p3_migratecheck.mjs`) and **could not complete it**, because the `nexora` user
cannot INSERT — which is itself anomaly 2.

**Why this blocks Phase 3.** Phase 3's method is to build the permission reference
from live database evidence and drive real HTTP workflows for every role. With
zero tenant rows there is nothing to authorise against, and with INSERT revoked
the journeys cannot provision the roles they need to test. Proceeding would
produce meaningless results.

**Not fixed, not diagnosed to a root cause, deliberately not worked around.**
Re-granting privileges or re-seeding by hand would hide the cause. This needs a
real diagnosis in the Fix Sprint.

**Evidence:** `_probe_out/p3-state.txt`, `_probe_out/p3-migrate.txt`,
`_probe_out/roles-status.txt`, `_probe_out/assign2.txt` (earlier non-empty state)

---

## ISS-006 — **RETRACTED: not a product defect. My earlier report was WRONG.**

| | |
|---|---|
| **Originally reported** | SEV-1 Critical — "database emptied + write privileges lost" |
| **Status** | **RETRACTED — invalid evidence, correct diagnosis** |

**I was wrong, and here is the proof.** I previously reported `nexora_test` was
empty (0 companies/users/roles/customers) and that `nexora` had lost write
privileges. Both were **artifacts of my own measurement method**, not faults.

**Measured correctly as superuser** (`_probe_out/p3-diag3.txt`):
```
companies 17   users 81   branches 13   roles 70   role_permissions 652   customers 30
```
**The data was never lost.** `nexora` also holds correct table privileges on
every domain table.

**Actual cause — Row-Level Security.** My probe used a raw `pg` client that never
establishes the application's security context:
```
nexora SELECT companies -> 0
nexora INSERT companies -> DENIED (42501) new row violates row-level security policy
```
RLS is a **deliberate, correct** tenant-isolation layer, and the app uses two
wrappers (`src/db/repo.ts`):
- `withTenant(companyId, branchId, fn)` — tenant session; every tenant query must
  pass through it and it **fails closed** if company context is missing.
- `withBypass(fn)` — sets `app.bypass_rls='on'` for pre-auth/platform paths
  (e.g. the Platform Owner creating a company, which has no tenant yet).

So the application works correctly; **my probe bypassed the app's own security
context and was punished by it.** This is also direct evidence that tenant
isolation is enforced *in the database* — exactly what Vision Law 1 demands and
what Phase 3 must verify.

**Two genuine lower-severity findings survive:**

1. **Tests and verification journeys share one database.**
   `tests/fixtures.ts:130` runs `TRUNCATE TABLE companies CASCADE`, wiping all
   tenant data in the same `nexora_test` the journeys use. Evidence is therefore
   **order-dependent**: any vitest run invalidates journey evidence produced
   earlier. This is why I saw an empty database. Fix: isolate the test database
   from the verification database.
2. **Latent privilege bug — `resetDatabase()` under-grants.**
   `src/db/migrate.ts:56-58` does `DROP SCHEMA public CASCADE` then
   `GRANT USAGE ON SCHEMA public TO nexora` — **schema usage only, no table or
   default privileges**. Any path invoking `resetDatabase()` would leave the app
   role unable to read or write any table, with no error at migration time. Not on
   the current test path (vitest `global-setup.ts` only calls `runMigrations`),
   which is why nothing has broken yet.

**Action:** retracted as a product defect; the two survivors tracked separately.
No database was recreated, no privileges manually re-granted, no data seeded —
diagnosis only, so the cause stays visible.

**Evidence:** `_probe_out/p3-diag3.txt`, `_probe_out/p3-scan.txt`,
`src/db/repo.ts`, `src/db/migrate.ts`, `tests/fixtures.ts`

---

## Previously fixed

(kept for traceability — NOT to be reopened without cause)

(kept for traceability — NOT to be reopened without cause)

| Id | Severity | Summary | Proof |
|---|---|---|---|
| F-01 | SEV-1 Critical | A payment with no open repayment schedule was silently converted entirely into savings, so repayment money could be recorded **both** as principal repayment and as savings. Now rejected transactionally. | `tests/stage8-allocation-savings-integrity.test.ts` — proven to fail when the bug is restored |
| F-02 | SEV-2 High | Create Company returned 201 + MD credentials but left the company unusable in `in_setup`. Now persists `status='active'` and `activated_at`. | Updated `stage3-platform`, `stage9-fixes-runtime`, `stage13-stories` |
| F-03 | SEV-2 High | Collection Officer could not manage his own group's membership (Vision RULE 9.3.1 / Part 12.27). Route now requires `assign`; migration 0082 grants it. | Migration applied (82 applied, 7 C.O. roles hold `assign`); **full e2e still outstanding** |