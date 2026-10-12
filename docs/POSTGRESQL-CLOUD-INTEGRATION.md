# PostgreSQL Cloud Integration Plan

**Nothing is installed on your PC.** This plan describes how the existing, audited data layer connects to a managed cloud
PostgreSQL, what already exists, what you must supply, and how it is proved. PostgreSQL stays **PENDING** until you
approve a deployment.

---

## 1. What already exists (audited)

| Area | Reality in the repo |
|---|---|
| Driver | `pg` v8.16 (`packages/server/src/db/pool.ts`), connection from `DATABASE_URL` |
| Migrations | 85 numbered SQL files, applied in order by `db/migrate.ts` |
| Tenancy | `withTenantSession()` opens a transaction and sets `app.company_id` / `app.branch_id` / `app.branch_restricted` via `set_config(..., true)` (transaction-local) |
| Row-level security | `0010_rls.sql` enables **and forces** RLS on 33 tables, each with `rls_tenant` (`USING` + `WITH CHECK` on `company_id`), plus a `RESTRICTIVE` branch-scope policy on 7 branch-owned tables; `rls_companies` on `companies` with a bypass flag for the platform path |
| Financial write protection | `GRANT UPDATE (status) ON payments` only; `REVOKE DELETE` on payments/loans/VA/schedule rows; `REVOKE UPDATE/DELETE` on journal lines, receipts, allocations, reversals, audit logs |
| Secret at rest | Authenticator seeds, provider keys and webhook secrets are AES-256-GCM ciphertext, bound to company as AAD (`lib/secret-vault.ts`, `lib/ai-secret-vault.ts`) |
| Extensions used | `pgcrypto` (`gen_random_uuid`) only |
| Version floor | PostgreSQL **15+** (no version-specific syntax; 16 also fine) |

## 2. Recommended hosting

| Option | Why | Notes |
|---|---|---|
| **Neon** (recommended) | Serverless, pooled connections, branching for tests, point-in-time restore for Part 20 | Use the **pooled** URL for the app and the **direct** URL for migrations |
| AWS RDS / Cloud SQL | Maximum control, VPC peering, familiar backups | Needs a bastion or a public IP allowlist for migrations |
| Supabase | Fastest to stand up; RLS is a first-class concept here | Do not use the `postgres` superuser role — RLS is bypassed by the owner unless forced |

**Critical:** the application must connect as a **non-owner role**. `nexora` is granted specific table privileges and is
never the owner. The migrations already `FORCE ROW LEVEL SECURITY`, which additionally protects the owner, but a separate
role keeps blast radius correct.

## 3. Roles to create in the cloud database

```sql
-- Owner (used only by migrations; never by the running app)
CREATE ROLE nexora_migrator LOGIN PASSWORD :'migrator_pw';
CREATE DATABASE nexora OWNER nexora_migrator;

-- Application role (used by the running app)
CREATE ROLE nexora LOGIN PASSWORD :'app_pw';
GRANT CONNECT ON DATABASE nexora TO nexora;
-- schema + table grants are applied by the migrations, including the REVOKEs
-- that make financial rows non-editable.
```

Run migrations with the migrator URL, run the app with the `nexora` URL.

## 4. Environment variables you must supply

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Pooled connection string | `?sslmode=require`. Prefer the *pooled* endpoint for the API |
| `NODE_ENV` | `production` | Enables the production key checks in `config/env.ts` |
| `JWT_SECRET` | 32+ random bytes | The code refuses to run in production on the dev default |
| `EVIDENCE_ENCRYPTION_KEY` | 32+ random bytes, unique | Encrypts authenticator seeds, provider keys, evidence |
| `FACE_CAPTURE_PROOF_SECRET` / `LIVE_CAPTURE_PROOF_SECRET` | 32+ random bytes each | Live-capture proof signing |
| `BACKUP_ENCRYPTION_KEY` | 32+ random bytes, **different** from the above | `config/env.ts` throws if equal |
| `EVIDENCE_STORAGE_ROOT` | mounted path or adapter | Where face/evidence artefacts live |
| `CORS_ORIGIN` | your real origins | Comma-separated; must not be `*` in production |

Production already **refuses to start** if the dev keys are still in place — that guard is in place and was verified by
reading `config/env.ts`.

## 5. Connection and pooling

- The pool is `pg.Pool({ max: 10, idleTimeoutMillis: 30_000 })`. Against a serverless endpoint, prefer the provider's
  pooled URL; against a long-lived server, raise `max` to the tier's connection limit and put PgBouncer in front.
- **Every query that needs tenancy must run inside `withTenantSession`** so the GUCs are set for that transaction. A query
  on the bare pool sees `app.company_id` as NULL and therefore sees **no rows** — a fail-closed outcome by design.
- Set `application_name=nexora-api` for observability.

## 6. Deployment sequence (no local install required)

1. Provision the managed instance and record the region.
2. Create `nexora_migrator` and `nexora` (roles above).
3. Set `DATABASE_URL` (migrator, direct) and run `npm run migrate --workspace=packages/server` once.
4. Verify RLS is live: `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relrowsecurity;`
5. Grant the API's `nexora` role the pooled URL in the hosting dashboard / secret manager.
6. Deploy the API; confirm `GET /api/v1/healthz` reports `db: up`.
7. Backups: enable point-in-time / automated backups and set a retention that satisfies Part 20.

## 7. Proof required before "production ready"

Per RULE 16.2.3A and 16.3, once a database is available the following must actually run and pass:

- The 298-test server suite (`npm test --workspace=packages/server`).
- `stage13-isolation-attack`, `rls-isolation`, `multi-company-concurrency`, `stage6-branch-scope` — the cross-company
  isolation proofs.
- The 28 acceptance flows in RULE 16.3.1 (create company → MD ritual → branch → provider → customer → loan → disburse →
  VA → portal → pay → allocate).
- The Part 20 restore drill.

## 8. What is blocked until you approve

- Every server test, flow walkthrough and isolation attack.
- Any claim that the money pipeline, performance engine or reports are correct at runtime (they are correct **by
  construction and code review**, not yet by execution).
- Production deployment.

**Assumption stated plainly:** the code has been audited statically and typechecked/built; no claim of runtime correctness
is made until the suite runs green against a real database.