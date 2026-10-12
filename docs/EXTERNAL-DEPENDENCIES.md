# External Dependencies Register

Every service the finished product needs that is **not** part of the Nexora codebase. For each: what it is for, where it
should be hosted, what credentials are required, what the owner must provide, and whether it can stay pending.

Status legend: **PENDING** = cannot be completed without it · **OPTIONAL** = degrades gracefully · **BUILD-TIME** = only
needed to produce a release artefact.

---

## 1. Database — PostgreSQL

| | |
|---|---|
| **Purpose** | Every financial record. RLS-enforced multi-tenancy; the ledger; audit. |
| **Status** | **PENDING** — not installed on your PC, by your instruction. |
| **Technology already chosen** | PostgreSQL, `pg` v8 driver, RLS with `app.company_id` / `app.branch_id` GUCs, `FORCE ROW LEVEL SECURITY`, 85 migrations. |
| **Version** | 15 or 16 (uses `gen_random_uuid()`, `set_config`, standard RLS; no exotic extensions). |
| **Hosting recommendation** | Managed PostgreSQL: Neon, Supabase, RDS or Cloud SQL. Connection over TLS with `sslmode=require`. |
| **Credential you must provide** | `DATABASE_URL` — a pooled connection string. For production, the app role must **not** be the table owner (RLS is only enforced for non-owner roles unless `FORCE` is set; the migrations already `FORCE` it, but a separate role is still correct). |
| **Minimum production grants** | `nexora` role: `SELECT/INSERT/UPDATE/DELETE` on application tables, **except** the `REVOKE`s in migration `0010_rls.sql` (`DELETE` on payments/loans/VA, `UPDATE` on payments except `status`). `MIGRATOR` role: schema DDL only. |
| **Blocker today** | All 298 server tests, every flow walkthrough and the isolation attack suite. |

## 2. OpenCode AI provider

| | |
|---|---|
| **Purpose** | Part 21 read-only company AI: live model discovery, provider catalogue, configuration verification and execution. |
| **Status** | **PENDING** — not installed on your PC, by your instruction. |
| **Technology already chosen** | The server shells out to the OpenCode CLI via `child_process.spawn` (`packages/server/src/lib/opencode.ts`). It resolves the binary in this order: `OPENCODE_BIN` → `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe` → the npm shim directory → `PATH`. |
| **Hosting recommendation** | Run the API container with the OpenCode CLI installed alongside it (e.g. `npm i -g opencode-ai` in the image, or bake the binary in). Set `OPENCODE_BIN` explicitly so resolution is deterministic. |
| **Environment already honoured** | `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_TELEMETRY` are passed through. |
| **Credentials you must provide** | Per-company AI provider keys (entered by each company's own admin, encrypted at rest, never returned). Plus, for the owner's default: the platform AI key. |
| **Important** | Nothing about AI is faked. Without the CLI present, `listFreeModels`, `listProviders` and `verify` return an honest unavailable state rather than a fake model list. |
| **Blocker today** | Part 21's "real provider/model discovery, real verification, real execution, concurrent company operations, failure isolation and cross-company isolation" (RULE 16.2.3A). |

## 3. Payment providers (virtual accounts + collections)

| | |
|---|---|
| **Purpose** | Virtual-account issuance at disbursement, and inbound payment collection. Both money-in paths depend on them. |
| **Registry already built** | `monnify`, `opay`, `palmpay`, and a `generic` HTTP provider — each with its own requirement set, field-level validation, and "how to get it" guidance (migration `0045`). |
| **Status** | **PENDING** — no live merchant account. |
| **Hosting** | The provider's own sandbox/production API; Nexora only needs outbound HTTPS and an inbound public webhook URL. |
| **Credentials you must provide** | Per company and per provider: merchant id, API key, secret key, contract code, settlement reference (which fields apply depends on the provider's requirement set — the platform asks for exactly those). |
| **Note** | Webhook URL is **generated and bound by the platform** (prohibition 18). You paste it into the provider dashboard; you never type it into Nexora. |
| **Blocker today** | Payments can only be created by webhook, so no money-in can be exercised without a provider (or a signed test harness). |

## 4. Email (transactional notifications)

| | |
|---|---|
| **Purpose** | Credential hand-over notices, approval requests, MD authorisation notices, password/reset mail, statement delivery. |
| **Status** | **OPTIONAL for a pilot; PENDING for production.** The Notification Center (in-app) is fully built; outbound email is not wired. |
| **Hosting** | Any SMTP or transactional provider (Postmark, Resend, SES, SendGrid). |
| **Credentials** | API key / SMTP credentials, verified sending domain. |
| **Hard rule** | Credentials are **never emailed or texted** (RULE 3.4.3). Email carries *notifications*, never a generated password. |

## 5. SMS

| | |
|---|---|
| **Purpose** | Same as email where a number is on file. |
| **Status** | **OPTIONAL.** Same hard rule: no credentials by SMS. |
| **Credentials** | Provider API key, sender id. |

## 6. Object storage (evidence, face captures, live-capture proof)

| | |
|---|---|
| **Purpose** | Encrypted storage for face captures and evidence artefacts, referenced by hash. |
| **Technology already chosen** | Local filesystem root today — `EVIDENCE_STORAGE_ROOT` (defaults to a temp dir). Encryption keys `EVIDENCE_ENCRYPTION_KEY`, `FACE_CAPTURE_PROOF_SECRET`, `LIVE_CAPTURE_PROOF_SECRET` already exist and are enforced in production. |
| **Status** | **PENDING for production.** Works on a mounted disk for development. |
| **Hosting** | S3-compatible: AWS S3, Cloudflare R2, Backblaze B2, or a mounted volume with `BACKUP_WORK_ROOT`. |
| **Credentials** | Bucket + region + access key/secret (or workload identity). |
| **Must be decided** | Whether evidence lives in object storage or on a volume. The code reads a storage root, so a volume is the zero-change answer; S3 needs an adapter. |

## 7. KYC / liveness / face verification vendor

| | |
|---|---|
| **Purpose** | Live face capture with liveness for customers, applicants and guarantors (prohibition 13: no upload or gallery path, ever). |
| **Status** | **PENDING** — no vendor chosen. |
| **Hosting** | Vendor SaaS. |
| **Credentials** | API key, plus any per-company reference. |
| **Note** | The *capture* flow and its proof signing are built; the vendor call is the missing piece. The Vision forbids substituting an upload, so this cannot be faked. |

## 8. Scheduler / job runner (end of day, polling, retries, scheduled reports)

| | |
|---|---|
| **Purpose** | The end-of-day trigger (Part 1 §21/§23), the RULE 8.5.6 provider polling/reconciliation job, webhook retries, and (later) scheduled reports. |
| **Technology already chosen** | A `pipeline_jobs` table exists; the end-of-day endpoint exists and is role-gated. What is missing is the *runner*. |
| **Status** | **PENDING.** |
| **Hosting** | Platform cron, Kubernetes CronJob, Cloud Scheduler, or a dedicated worker. |
| **Credentials** | None beyond the database credential. |
| **Note** | The Vision expects a deployment scheduler to call end-of-day once per company per day; the portal's manual button is the operator equivalent, not a replacement. |

## 9. Backup / object storage for disaster recovery

| | |
|---|---|
| **Purpose** | Part 20 — encrypted backups, retention policy, and the post-restore verification drill. |
| **Technology already chosen** | `BACKUP_ENCRYPTION_KEY` (must differ from `EVIDENCE_ENCRYPTION_KEY`), `BACKUP_WORK_ROOT`, `BACKUP_POLICY_PATH` (`config/backup-policy.json`). |
| **Status** | **PENDING** for production. |
| **Credentials** | Destination bucket credentials. |

## 10. TLS certificates / domain / DNS

| | |
|---|---|
| **Purpose** | The host grammar `{company}.nexora.app` / `{company}-{branch}.nexora.app`, plus secure cookies in production. |
| **Status** | **PENDING** for any real deployment. |
| **Credentials** | Domain, DNS control, a wildcard certificate. |
| **Note** | `secure` cookies are already conditional on `NODE_ENV=production`. |

## 11. Observability (logs, metrics, alerting) — OPTIONAL

| | |
|---|---|
| **Purpose** | Log aggregation and alerting for lockouts, webhook failure spikes, job failures. |
| **Status** | **OPTIONAL.** `pino` / `pino-http` structured logging already ships. |
| **Credentials** | Provider ingest key. |

---

## Summary: what can stay pending right now

| Can remain pending | Cannot |
|---|---|
| Email, SMS (in-app notifications cover the pilot) | PostgreSQL — blocks 298 tests and every flow/isolation proof |
| Object storage (use a mounted volume) | OpenCode CLI — blocks all of Part 21 |
| Backup destination (restore drill is a Part 20 proof) | Payment provider — no money-in without it |
| Observability | KYC/liveness vendor — prohibition 13 forbids faking it |
| Scheduler (manual end-of-day exists for operators) | TLS/DNS — required before any real URL is handed out |

**Nothing in this register has been faked, stubbed to look present, or marked as passing.** Each is reported honestly as
pending, with the exact remaining work stated.