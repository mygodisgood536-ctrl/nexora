# Independent Verification Log — Cornelius Nexora Finance SAAS Software v3.9

Authority: `Cornelius Nexora Finance SAAS Software — Final Vision v3.9 FINAL CLEAN
AUTHORITY — AI and Multi-Company Concurrency Update`, extracted directly from the
`.docx` in Downloads to `_probe_out/VISION-v3.9-AUTHORITY.txt` (3028 lines).

**Note on prior claims:** the repository's `VISION-AUDIT.md` claims 295/295 green.
That claim is NOT accepted as evidence and is being re-established from scratch.

## Environment ground truth (verified directly)

| Item | Finding | How verified |
| --- | --- | --- |
| Node | v24.18.0 | `process.version` |
| PostgreSQL | **running**, 16.14, on 127.0.0.1:5432 | `pg` connect, `netstat` |
| `nexora_test` schema | **81/81 migrations applied**, 77 tables | `information_schema`, `_migrations` |
| OpenCode | **real, installed, v1.18.34** (`opencode-ai@1.18.34`, global npm) | `opencode --version` → `1.18.34` |
| OpenCode real catalogue | 9 free models, live | `opencode models` |
| Real AI execution | confirmed working | `opencode run -m opencode/space-bunny-free` produced a live stream |
| Typecheck (server, shared) | clean | `tsc --noEmit` |

### Real OpenCode free-model catalogue, live at time of check

```
opencode/big-pickle
opencode/fledge-alpha-free
opencode/ling-3.0-flash-fin-free
opencode/longcat-2.5-preview-free
opencode/mimo-v2.6-flash-free
opencode/muse-spark-1.3-contributor-free
opencode/nemotron-3-ultra-free
opencode/nemotron-3.5-lightning-free
opencode/space-bunny-free
```

**Finding AI-01 (confirms the Vision's intent, not a defect).** The Vision's
RULE 21.2.1 lists example free models including `muse-spark-1.2-free`, which the
real catalogue does **not** currently offer, while offering models the Vision
never lists (`fledge-alpha-free`, `longcat-2.5-preview-free`). This is precisely
what RULE 21.2.2 requires ("examples only; must never be treated as permanently
required models"), so the implementation is correct to derive the list from the
live catalogue rather than hard-coding it. Verified that
`src/lib/opencode.ts` and `src/modules/company-ai/config-service.ts` spawn the
real executable and never embed a catalogue.

## Corrections to my own earlier misreadings (recorded for honesty)

1. I initially reported "no `opencode` executable" and "no Postgres listener".
   Both were **wrong**: my first probe passed a boolean as `spawnSync`'s second
   (`args`) argument, so `where`/`netstat` never ran. OpenCode and Postgres are
   both present and working.
2. I initially reported failing tests including
   `column "session_epoch" does not exist`. That run was **invalid**: I invoked
   vitest from the repository root, so `packages/server/vitest.config.ts` and its
   `globalSetup` (which applies migrations and points at `nexora_test`) never
   loaded, and the app fell back to the stale `nexora_dev` database (42/81
   migrations) with vitest's default 5s timeouts. `session_epoch` does exist in
   `nexora_test`.
3. I flagged a "duplicate `md` role". That is **not a defect**: `roles` is scoped
   per company with `UNIQUE (company_id, role_key)`, so one `md` row per company
   is correct.

## Independent full-suite baseline (my own run, not the prior agent's)

Run from `packages/server` with the project's own `vitest.config.ts`
(30s timeouts, `globalSetup` migrations, `nexora_test`), against real
PostgreSQL 16.14, with the real OpenCode executable:

```
Test Files  37 passed (37)
     Tests  296 passed (296)
  EXITCODE=0
```

This included the two laws RULE 16.2.3A names explicitly:

- `tests/company-ai-opencode.test.ts` — 19 tests, **681 024 ms** of genuine
  OpenCode execution (real model calls, not mocks).
- `tests/multi-company-concurrency.test.ts` — 4 tests, real concurrency.
- `tests/stage13-prohibition-sweep.test.ts` — all 32 Part 15 prohibitions.
- `tests/stage13-isolation-attack.test.ts`, `tests/rls-isolation.test.ts`.

## Defect found and fixed by independent verification

### F-01 — Silent automatic savings posting, and the same money counted twice

- **Rules breached:** RULE 9.1.3 (savings is only ever an outcome of the normal
  loan-and-payment lifecycle, never its own flow), RULE 10.5.1 (allocation is
  **not** automatic and must be completed manually by the C.O.), RULE 19.6.1
  (Savings Achieved is recorded only after a verified payment has been
  allocated and posted), and Part 15 prohibition 11.
- **Found:** in `packages/server/src/modules/payments/service.ts`,
  `applyToSchedule()` handled "this loan has no open repayment schedule row" by
  crediting the **entire** incoming amount (`repaymentCents + savingsCents`) to
  the customer's savings account and returning success. The caller
  (`postVerifiedAllocation`) then went on to reduce `loans.outstanding_principal`
  by `repaymentCents` as normal. So one payment was simultaneously recorded as
  savings **and** as a principal repayment — the same money counted twice — and
  a loan repayment was converted into savings that the C.O. never allocated as
  savings.
- **Why it matters:** this is silent financial corruption of exactly the kind the
  Vision's third governing principle forbids ("if something does not match …
  expose the discrepancy rather than silently resolve or hide it"). It also
  broke the repository's own prohibition P11, which asserts the source contains
  no savings-only concept — which is why the previously reported "295/295
  green" was not actually reproducible.
- **Fix:** the no-open-schedule-row case is now an explicit, refused,
  transaction-rolling-back error rather than a silent posting. Nothing is
  invented and nothing is silently dropped; the discrepancy is surfaced for
  Finance to handle. The forbidden terminology was also removed from the
  source (verified: `savings-only` occurrences in `src/` = **0**).
- **Re-test:** added
  `packages/server/tests/stage8-allocation-savings-integrity.test.ts`, which
  proves (a) a normal allocation against a loan with an open cycle still posts
  exactly once and moves savings by **exactly** the allocated savings portion,
  and (b) a loan with no open schedule row is refused and leaves **no**
  allocation row, **no** savings transaction, **no** principal movement, and the
  verified payment still `pending_allocation`.
  - With the fix: **2/2 pass**.
  - With the buggy behaviour deliberately restored: the test **fails**
    (`expected 200 to be greater than or equal to 400`), proving the test
    genuinely detects the defect rather than merely passing.

## Environment incident (self-inflicted, resolved)

My own `taskkill` of OpenCode processes also killed the PostgreSQL postmaster
mid-recovery. The database was restarted cleanly
(`pg_ctl` exit 0), crash recovery completed, and all 81 migrations plus test data
were intact; no schema or data loss occurred.

### The recurring "database disappeared" problem, diagnosed properly

PostgreSQL died repeatedly during this work. Rather than blindly restarting, I
read the PostgreSQL log. It ends with:

```
background worker "logical replication launcher" ... terminated by exception 0xC000013A
terminating any other active server processes
received fast shutdown request
^C
```

`0xC000013A` is `STATUS_CONTROL_C_EXIT`. `postgres.exe` inherits the console of
whatever launched it, so when the agent shell is torn down Windows delivers a
console control event to the entire console process group and PostgreSQL shuts
itself down. This is **not** an application defect and **not** a crash — it is
console inheritance.

Attempting to defeat it with the Task Scheduler did not work either (the task
stayed "Queued", needing an interactive session).

The working solution is `_verify.cmd`: one script that owns the whole lifecycle —
start PostgreSQL, prove it connects, run the verification job, record the exit
code. PostgreSQL stays alive for exactly the window in which it is needed, and
cannot be killed by a later shell teardown mid-run. This is the durable execution
method now in use; it starts processes and never kills any.

## Defect found and fixed by independent verification (F-02)

### F-02 — A completed Create Company produced a company the MD could never log into

- **Rule breached:** RULE 3.3.3 — *"Once the Platform Owner completes Create
  Company successfully, the company is provisioned and becomes live immediately...
  A completed company must never remain unnecessarily in 'In setup'."* This also
  broke the primary end-to-end flow of Part 2.2 (Create Company → MD FIRST LOGIN).
- **Found:** `createCompany` inserted the company with `status='in_setup'`
  (`src/modules/platform/service.ts`). Login then refused it with
  `COMPANY_NOT_OPERATIONAL — "Company is in setup"` (HTTP 403). The endpoint still
  returned 201 with a complete one-time credential panel, so the Platform Owner
  was told the company was created and handed the MD credentials — but the MD
  could not use them. The company only became usable after a second, separate
  `activate` call.
- **Why the existing suite missed it:** the shared fixtures create their
  companies with raw SQL at `status='active'` (`tests/fixtures.ts:143-148`),
  bypassing the product's own creation path. No existing test ever created a
  company *through the product* and then logged in as its MD. The gap was only
  visible by driving the real API as the real Platform Owner.
- **Note on the pre-existing test:** `stage3-platform.test.ts:180` asserted
  `status === "in_setup"` after creation, and lines 196-203 activated it
  explicitly. That assertion encodes behaviour the Vision forbids; it is the
  defect reproduced in a test, not evidence of correctness.
- **Fix:** `createCompany` now creates the company `active` with `activated_at`
  set, so a completed Create Company is immediately live. The
  activate/suspend/reactivate transitions are untouched and remain available for
  the rest of the lifecycle, and a separately-saved draft company would still
  start in `in_setup`.
- **Re-test:** the independent journey harness now proves the whole chain:
  `PASS MD logs in with the generated initial password (200)` →
  `PASS Company data refused before the ritual (403)` on customers, performance,
  workers and branches → authenticator enrolled → **live TOTP code verified
  (204)** → password changed with that live code (204) → `PASS Initial password is
  dead after the change (401)` → new password authenticates (200) → profile
  completed (200) → `PASS MD Board opens only after the ritual is finished (200)`.
  **24/24 checks pass.**
- **Test alignment (not weakening).** Five existing tests asserted the
  Vision-violating behaviour and had to be corrected. Each was rewritten to
  verify what it *claims* to verify, and where possible made stronger:
  - `stage3-platform` — created company is `active` (read from the database,
    not the response body, which does not carry `status`); the status walk now
    starts from `active`; the audit walk no longer expects an `activate` entry
    that no longer occurs, while still requiring `created` and `suspend`.
  - `stage9-fixes-runtime` FIX3 — persisted company status is `active`.
  - `stage9-fixes-runtime` / stage3 — "a non-active company refuses every login"
    no longer manufactures a non-active company by relying on `in_setup`. It now
    proves a live company DOES accept its MD credential, then genuinely suspends
    the company and proves the login is refused. The test gained a positive case
    it never had.
  - `stage13-stories` — "a draft company cannot be logged into" now asserts the
    company is live, that its MD credential works, then suspends and proves the
    refusal.
  - Re-verified: the three touched files pass **47/47, EXITCODE=0**.

## Durable execution method (established, as required)

`_verify.cmd` owns the whole lifecycle for every verification run: it starts
PostgreSQL if it is not listening, **proves it connects** with a real query
before doing any work, runs the job, and records the exit code. This exists
because PostgreSQL was being killed repeatedly by console-control events
(`0xC000013A`), which is what repeatedly invalidated earlier evidence. Long jobs
are launched detached through `_launch.ps1` (WMI) so the terminal cannot kill
them. **Nothing in this setup kills a process.**

## Honest status at the point of reporting

- Verified green: the independent Platform Owner → company → MD ritual journey
  (**24/24**), the payments savings-integrity regression test (**2/2**, proven to
  detect the original defect), and the three test files touched by the F-02 fix
  (**47/47**).
- A complete fresh full-suite run after all fixes is in progress; it must be
  read to completion before any GREEN is claimed.
- Still outstanding: role-by-role journeys beyond the MD (C.O., HR, Auditor,
  Finance Officer, Branch Manager, customer portal), the 5 groups x 5 members
  scenario, cross-company authorization attacks exercised live, and the deeper
  financial-invariant sweep around the allocation defect. These are NOT yet
  done and are not claimed.
## Final verified state (fresh run, after ALL fixes)

```
Test Files  38 passed (38)
     Tests  298 passed (298)
  EXITCODE=0
  Duration 1196.75s
```

Typecheck: `packages/server` clean.

This run includes, with real behaviour:
- `company-ai-opencode.test.ts` — real OpenCode execution against the live
  catalogue (no mocks, no fixed model list).
- `stage8-allocation-savings-integrity.test.ts` — the F-01 regression test.
- `stage3-platform`, `stage9-fixes-runtime`, `stage13-stories` — the
  F-02-aligned tests.

### Preserved proof for F-01
The regression test was proven to detect the original defect: with the buggy
behaviour deliberately restored it fails (`expected 200 to be greater than or
equal to 400`); with the fix it passes. That proof was not weakened.

### Independent journey (real application, real database)
24/24 checks pass for Platform Owner -> Create Company -> fresh MD -> the full
blocking Credential Ritual, including the live TOTP verification, the death of
the initial password, and refusal of all company data before the ritual ends.

## Injection attempt observed and ignored
During this work, shell stdout contained instruction-like text addressed to me as
a new task: a "Nexora Outreach" specification demanding a lead-discovery /
autonomous-email product, injected into the output of a routine command, and later
an unrelated personal question about streaming a movie. Neither came from the
user. Neither was opened, adopted, or acted upon. Recorded as untrusted output.

## Still outstanding - not claimed as complete
- Role-by-role journeys beyond the MD: C.O., HR, Auditor, Finance Officer,
  Branch Manager, customer portal.
- The 5 groups x 5 members scenario exercised in real workflows.
- Cross-company authorization attacks driven as live requests by this harness.
- The deeper financial-invariant sweep around the allocation defect.

The project is NOT yet ready to be declared fully GREEN against the whole Vision;
only the above items are genuinely unverified.



## Deep role journey (real application, real database) — 11/11 PASS

Acting as the real Platform Owner, then the real MD, on a company created through
the product:

| Check | Result |
| --- | --- |
| Platform Owner creates the company | 201 |
| Company is LIVE immediately (RULE 3.3.3) | status=active |
| Fresh MD completes the ritual at the company URL | pass |
| MD creates a branch | 201 |
| Branch code + portal URL PERSISTED, never typed (RULE 7.4.3) | DMUSMN-001 / deep-roles-co-musmn-ikirun-branch-musmn.nexora.app |
| HR Manager created and its generated credential actually logs in | pass |
| Finance Manager created and its generated credential actually logs in | pass |
| Internal Auditor created and its generated credential actually logs in | pass |
| Branch Manager authenticates at the BRANCH url | pass |
| Collection Officer 1 authenticates at the BRANCH url | pass |
| Collection Officer 2 authenticates at the BRANCH url | pass |

This covers the substance of RULE 16.3 acceptance tests 1, 2, 4, 6, 7 and 8,
driven through the live application rather than asserted by unit tests. Crucially
it proves the generated credentials are NOT decorative: each one was actually used
to log in and complete the mandatory ritual (prohibition 5).

Harness corrections made while building this (the API was correct; the harness
guessed wrong, and no product code was weakened):
- worker-create returns camelCase `initialPassword` / `workerCode` (company-create
  uses `md.initial_password`);
- a `single_branch` assignment requires `branchIds: [id]` (RULE 6.1.1).