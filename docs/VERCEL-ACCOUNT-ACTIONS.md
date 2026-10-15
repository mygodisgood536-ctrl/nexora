# Vercel account actions required

Everything on the code side of both deployments is done and verified
(`npm run verify`). What is left cannot be done without access to your Vercel
account, so this file is the complete list: two projects, six variables, and
one toggle. Nothing here requires debugging anything.

---

## Generate these five secrets first

On any machine with OpenSSL (or run the PowerShell equivalent):

```bash
openssl rand -base64 48   # run five times, label each result
```

| Label | Goes into |
|---|---|
| S1 | `JWT_SECRET` |
| S2 | `EVIDENCE_ENCRYPTION_KEY` |
| S3 | `FACE_CAPTURE_PROOF_SECRET` |
| S4 | `LIVE_CAPTURE_PROOF_SECRET` |
| S5 | `BACKUP_ENCRYPTION_KEY` — **must be a different value from S2** |

`config/env.ts` refuses to boot in production while any of these is still the
`nexora-dev-…` placeholder. That is deliberate: a deploy that starts with a
known secret should fail loudly, not run insecurely.

---

## Project 1 — `nexora` (company portal + API)

1. **Add New → Project → Import** `mygodisgood536-ctrl/nexora`
   (note: `-ctrl-`, not `-ctn-`).
2. **Framework Preset:** Vercel may show "Other". Correct — `vercel.json`
   supplies everything.
3. Confirm Build and Output settings:
   - Install Command `npm install --no-audit --no-fund`
   - Build Command `npm run build --workspace=packages/web`
   - Output Directory `packages/web/dist`
   - **Root Directory:** leave at the repository root.
4. **Settings → Environment Variables** — add for **Production**, **Preview**
   and **Development** where noted:

   | Variable | Value | Scope |
   |---|---|---|
   | `DATABASE_URL` | Neon **pooled** connection string | all |
   | `JWT_SECRET` | S1 | all |
   | `EVIDENCE_ENCRYPTION_KEY` | S2 | all |
   | `FACE_CAPTURE_PROOF_SECRET` | S3 | all |
   | `LIVE_CAPTURE_PROOF_SECRET` | S4 | all |
   | `BACKUP_ENCRYPTION_KEY` | S5 | all |
   | `NODE_ENV` | `production` | production |
   | `DATABASE_POOL_MAX` | `2` | all |
   | `DATABASE_CONNECT_TIMEOUT_MS` | `10000` | all |
   | `CORS_ORIGIN` | `https://<project-2-domain>` | all |
   | `LOG_LEVEL` | `info` | all |
   | `PLATFORM_BASE_URL` | `https://<project-1-domain>` | all |
   | `COMPANY_URL_MODE` | `path` | all |

   Leave `VITE_API_BASE_URL` **unset or empty** — the company portal is
   same-origin, and empty preserves that.

5. **Deploy.**

### Run the migrations once, before the first real use

From your machine, with the Neon **direct** (unpooled) string:

```powershell
$env:DATABASE_URL = "<neon-direct-connection-string>"
npm run db:provision
```

Use the pooled string for the function and the direct one for migrations.

### Smoke test after deploy

- `https://<domain>/` → the sign-in screen loads
- `https://<domain>/acme/api/v1/healthz` → JSON with `service` and `db`
- Refresh a deep link such as `https://<domain>/<slug>/money` → the page
  loads (this is the SPA fallback; it is the most common thing to break)

---

## Project 2 — `nexora-platform` (Platform Owner console)

1. **Add New → Project → Import** the **same repository**.
2. **Root Directory:** `packages/platform-web`.
3. ⚠️ **Settings → Build and Development → Root Directory → Build Step →
   "Include source files outside of the Root Directory": ON.**

   This is the one setting that decides whether this project builds. The
   console imports `@nexora/ui` and `@nexora/shared`, which are its **siblings**
   in the workspace. With this off, Vercel uploads only
   `packages/platform-web`, `npm install` cannot find the workspace root, and
   the build fails on the first import. It is on by default for projects
   created after 27 August 2020 — check it before the first deploy.
4. Confirm Build and Output settings (they come from
   `packages/platform-web/vercel.json`, which deliberately runs both commands
   from the workspace root):
   - Install Command `cd ../.. && npm install --no-audit --no-fund`
   - Build Command `cd ../.. && npm run build --workspace=packages/platform-web`
   - Output Directory `dist`
5. **Settings → Environment Variables:** `VITE_PLATFORM_API_BASE_URL`
   = `https://<project-1-domain>` (no trailing slash). All scopes.
6. **Deploy**, then attach a **distinct** domain (for example
   `owner.nexora.app`).

The console must never be reachable from a company address — that separation is
a Vision requirement, and a distinct domain is what makes it real.

---

## If the import screen still complains

It will not: `vercel.json` exists at the repository root and validates against
Vercel's live schema. If a stale suggestion appears, ignore it. The multi-service
configuration Vercel's wizard offers is **not** what this repository needs —
`packages/server` is exposed as the single serverless function
`api/nexora-api.ts`, not as a separate backend project.

---

## What still will not work on day one, and why

- **Face-capture evidence does not persist.** `EVIDENCE_STORAGE_ROOT` writes to
  local disk and a serverless instance's filesystem is ephemeral. Object
  storage is required before real evidence capture. This is recorded in
  `docs/EXTERNAL-DEPENDENCIES.md` and is not something a Vercel setting fixes.
- **The database-backed test suite has not run.** It needs a reachable
  PostgreSQL server. Point `ADMIN_DATABASE_URL`, `APP_DATABASE_URL` and
  `DATABASE_URL` at Neon and run `npm run test:db`; it provisions an isolated
  `nexora_unittest` database and applies all 87 migrations. Do this before
  treating the deployment as verified — a green build is not the same thing.
- **OpenCode AI (Vision Part 21) is pending** until that integration stage.