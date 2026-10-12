# Deploying Nexora to Vercel

**Read this before you deploy.** Several things in this repository are not obvious, and two of them are security rules rather
than preferences. Getting them wrong will break money-in or weaken tenant isolation.

---

## 1. What this repository actually is

An npm-workspaces monorepo with five packages:

| Package | What it is | Deployable? |
|---|---|---|
| `packages/web` | **The Nexora company portal** — the primary product UI. Roles, workspaces, every workflow. | Yes — this is the main app |
| `packages/platform-web` | **The Platform Owner console** — the internal admin for creating/brandling companies. Vision Part 3: "not reachable from any company URL". | Yes — as a **separate** Vercel project |
| `packages/server` | Express API. `/api/v1/*` for the company portal, `/platform/v1/*` for the owner console. | Yes — as a Vercel serverless function |
| `packages/ui` | Shared React design system (source is shipped directly to Vite) | No — compiled into the frontends |
| `packages/shared` | Shared types + constants | No — compiled in |

`platform-web` and `web` are **not** duplicates. They serve different audiences with deliberately different powers. They are
kept as separate applications, as the Vision requires.

### How the frontends reach the API

| App | Calls | Deployment |
|---|---|---|
| `web` | `/api/v1/*` (relative) | Same origin as the API in the main project → no CORS, nothing to configure |
| `platform-web` | `/platform/v1/*` (relative) | **Different origin** → set `VITE_PLATFORM_API_BASE_URL` and grant CORS |

Both are configurable via environment variables now (`VITE_API_BASE_URL`, `VITE_PLATFORM_API_BASE_URL`). **Leave them empty
for the main project** — empty preserves same-origin requests, which is the simplest and safest setup.

---

## 2. The deployment architecture

```
Project 1  "nexora"  (root directory: repository root)
├── Static build : packages/web        -> packages/web/dist   (the company portal)
└── Function     : api/nexora-api.ts   -> Express app
      serves /api/v1/*   (company API, company portal, customer portal, webhooks)
      serves /platform/v1/* (only reachable by the owner console)

Project 2  "nexora-platform"  (root directory: packages/platform-web)
└── Static build : packages/platform-web -> packages/platform-web/dist
      calls the Project 1 API via VITE_PLATFORM_API_BASE_URL
```

Why one project for the portal + API, and a separate one for the owner console:
- Same-origin means the portal needs **no CORS grant**, the refresh cookie is first-party, and there are no
  cross-origin failures to debug.
- The Vision forbids the owner console being reachable from a company URL. A separate project (ideally on its own
  domain, e.g. `owner.nexora.app`) keeps that boundary real.

---

## 3. Company addresses: three forms, all resolving

The URL law (Vision Part 1 §2.3, RULE 2.3.1–2.3.3) fixes what an address must *do*, and one company must never be
reachable through another company's address:

```
RULE 2.3.1 — the company slug is fixed at creation, unique platform-wide, derived from the
              company name. The company's own optional domain is pointed at the same
              application and never changes the internal slug.
§2.4       — the URL supplies the scope; the credential identifies the person; the role
              assignment supplies the portal.
```

So the **slug is the identity and the address is presentation.** Three forms are implemented, all resolving to the
same company through the same tenant session and the same row-level security:

| Form | Example | When you use it |
| --- | --- | --- |
| Platform hostname | `acme.nexora.app` | You own the apex and can point `*.nexora.app` at Project 1. This is the Vision's default. |
| Company domain | `portal.acme.com` | A company brings its own domain. Must be DNS-verified before it resolves. |
| Tenant path | `myplatform.vercel.app/acme` | **The default on Vercel.** No domain purchase, no DNS, no redeploy per company. |

### Why the tenant path exists

Vercel issues one apex per project and **no user subdomains**, so `acme.myplatform.vercel.app` cannot exist. Rather
than weaken RULE 2.3.1 or force a domain purchase, the path form addresses the same tenant on the same application.
It still satisfies every rule the Vision is protecting:

- the address is system-generated at company creation — no manual per-company setup;
- the slug is stable, platform-unique and never changes;
- the credential still decides the portal, with no company picker anywhere in the flow;
- branch URLs work as `…/acme-mukono`.

### Configuration

```bash
PLATFORM_APEX=nexora.app              # apex used to BUILD the subdomain form
PLATFORM_BASE_URL=https://myplatform.vercel.app
COMPANY_URL_MODE=path                 # `path` on Vercel; `subdomain` once you own a wildcard apex
```

`COMPANY_URL_MODE` only decides what the Platform Owner is **shown** in the one-time credential panel. Both forms
resolve regardless, so flipping it later needs no data migration and no redeploy — the stored `portal_url` always
keeps the Vision's `{slug}.{apex}` form.

### What is *not* weakened

The prefix is a **lookup key, never an authority**. It is resolved against a real company row before any credential is
checked, exactly as a `Host` header is. An unknown, unverified or forged address resolves to nothing and is rejected
with a neutral error (RULE 2.4.3). In particular:

- a **portal page name** (`/money`, `/people`, …) is never mistaken for a company slug — a prefix is only read when
  an API path follows it;
- an unknown **branch** in the address does **not** fall back to Head Office, so a mistyped address never widens scope;
- the **Platform Owner console is never reachable** from a company address (Part 3 line 155).

### Moving to the subdomain form later

When you own an apex: add it to Project 1, add a wildcard DNS record (`*.yourdomain.com` → Project 1), then set
`COMPANY_URL_MODE=subdomain` and `PLATFORM_APEX=yourdomain.com`. Existing companies keep their slugs, so nothing
breaks and nothing is re-created.

---

## 4. Environment variables

Set these in **Project 1 → Settings → Environment Variables**. Values are placeholders; generate real secrets with
`openssl rand -base64 48`.

### Required — the API will refuse to start without them

| Variable | Notes |
|---|---|
| `DATABASE_URL` | **Use a pooled endpoint** (Neon pooler / PgBouncer / Supabase pooler). A serverless function runs many instances; each has its own pool, so the pooler is what protects the database. |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `EVIDENCE_ENCRYPTION_KEY` | `openssl rand -base64 48`. Encrypts authenticator seeds, provider credentials, webhook secrets. |
| `FACE_CAPTURE_PROOF_SECRET` | `openssl rand -base64 48` |
| `LIVE_CAPTURE_PROOF_SECRET` | `openssl rand -base64 48` |
| `BACKUP_ENCRYPTION_KEY` | `openssl rand -base64 48`. **Must differ from `EVIDENCE_ENCRYPTION_KEY`.** Required in production. |

`packages/server/src/config/env.ts` throws at import time in production if any of these is still a `nexora-dev…`
placeholder. That is intentional fail-closed behaviour — the deploy will fail loudly rather than run insecurely.

### Recommended

| Variable | Suggested value |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://your-domain.com` (the company portal is same-origin, so this is mainly for the owner console) |
| `DATABASE_POOL_MAX` | `2`–`5` per function instance when using a pooler (default `10`) |
| `DATABASE_CONNECT_TIMEOUT_MS` | `10000` |
| `DATABASE_SSL` | `url` (let the connection string's `sslmode=` decide) or `verify-full` |
| `LOG_LEVEL` | `info` |

### Project 2 only

| Variable | Value |
|---|---|
| `VITE_PLATFORM_API_BASE_URL` | `https://<project-1-domain>` (no trailing slash) |

### Never commit

`.env`, `.env.local`, `.env.production`. `.env.example` is committed as documentation only and contains no real values.
`.gitignore` and `.vercelignore` both exclude `.env*`.

---

## 5. Exact steps in Vercel

### Project 1 — the company portal + API

1. Vercel dashboard → **Add New → Project** → import `mygodisgood536-ctn/nexora`.
2. Vercel will now detect the workspace instead of erroring, because `vercel.json` exists at the root.
3. **Framework Preset:** Vercel may show "Other". That is correct — `vercel.json` supplies everything.
4. Confirm the settings Vercel shows:
   - Build Command: `npm run build --workspace=packages/web`
   - Output Directory: `packages/web/dist`
   - Install Command: `npm install --no-audit --no-fund`
5. **Settings → Environment Variables** — add everything from §4.
6. **Settings → Domains** — optional. Only add an apex/wildcard if you want the subdomain address form (§3); the
   tenant-path form works on the default `*.vercel.app` domain with no domain purchase.
7. **Deploy.**
8. Smoke test after deploy:
   - `https://<domain>/` → the login screen loads
   - `https://<domain>/api/v1/healthz` → JSON with `service` and `db`
   - Create a company in the owner console, then open the URL it shows. With `COMPANY_URL_MODE=path` that is
     `https://<domain>/<company-slug>` and it must show that company's branding before any credential is entered.

### Project 2 — the Platform Owner console

1. **Add New → Project** → import the same repository.
2. **Root Directory:** `packages/platform-web`
3. Environment variable: `VITE_PLATFORM_API_BASE_URL=https://<project-1-domain>`
4. Also add Project 1's domain to Project 1's `CORS_ORIGIN`.
5. **Deploy**, then attach a distinct domain (e.g. `owner.nexora.app`).

### Migrations

Run migrations **before** the first deploy, from your machine or CI:

```powershell
$env:DATABASE_URL = "<pooled-or-direct-connection-string>"
npm run db:provision
```

Use the **direct** (unpooled) connection string for migrations and the **pooled** one for the function.

---

## 6. What was changed for serverless, and why

These are real code changes, not just configuration.

### 6.1 Webhook raw body now captured before JSON parsing — **critical**

`express.json()` was consuming the request stream before the payment webhook could read it, so `req.body` arrived as a
parsed object. The handler then re-serialised it to rebuild the signed payload — and re-serialisation is **not**
byte-identical. A verified demonstration:

```
BEFORE (json first) : {"b":2,"a":1000000.5,"z":[1,2]}          ← bytes differ
AFTER  (raw first)  : { "b" : 2,\n  "a" : 1000000.50, ... }    ← byte-for-byte
```

`1000000.50` had become `1000000.5`. The provider's HMAC is computed over the original bytes, so **every inbound
payment would have been rejected as an invalid signature** — money-in silently dead. `api/nexora-api.ts` also sets
`api.bodyParser: false` in `vercel.json` for the same reason: a platform-level body parser would break HMAC again.

### 6.2 Host-independent routing

The same Express app now runs locally and as a function. A small middleware resolves the effective request path from
`req.url`, `x-invoke-path`, `x-vercel-original-path` and `originalUrl`, so `/api/v1/...` and `/platform/v1/...` resolve
identically no matter how the host invokes the handler.

### 6.3 Bounded database pool

`DATABASE_POOL_MAX`, `DATABASE_IDLE_TIMEOUT_MS` and `DATABASE_CONNECT_TIMEOUT_MS` are configurable. A bounded connect
timeout means an unreachable database fails the request quickly instead of burning the function's wall-clock.

### 6.4 No background work in-process — correct as-is

There is no cron, interval or worker loop in the server. End-of-day and provider polling are external operator/scheduler
calls (Vision Part 1 §21/§23, RULE 8.5.6), which is exactly the right shape for serverless. Nothing needed removing.

### 6.5 Still pending (unchanged, and honestly so)

- **PostgreSQL** is not installed on your PC. 298 server tests, the 28 acceptance flows and the isolation attack suite
  therefore have **not** been run. Do not read a green build as proof they pass.
- **OpenCode AI** is not installed. Part 21's live discovery/verification/execution is unproven.
- **Object storage.** `EVIDENCE_STORAGE_ROOT` writes to local disk. On Vercel the filesystem is ephemeral per instance, so
  face-capture evidence will **not persist**. Switch to object storage before real use.
- **Payment provider, KYC/liveness vendor, email/SMS** remain pending. See `docs/EXTERNAL-DEPENDENCIES.md`.

---

## 7. Files changed for deployment

| File | Change |
|---|---|
| `vercel.json` | **New.** Multi-service config: portal build, API function, SPA fallback. |
| `api/nexora-api.ts` | **New.** Serverless entrypoint exporting the real Express app. |
| `packages/platform-web/vercel.json` | **New.** Config for the separate owner-console project. |
| `.vercelignore` | **New.** Keeps tests, docs and scratch output out of the deployment. |
| `.env.example` | **New.** Placeholder env documentation, no secrets. |
| `packages/server/src/app.ts` | Raw-body capture before `express.json()`; host-independent path resolution. |
| `packages/server/src/db/pool.ts` | Serverless-aware, bounded pool configuration. |
| `packages/server/src/config/env.ts` | New pool/TLS environment variables with honest semantics. |
| `packages/web/src/lib/api.ts` | `apiUrl()` helper; optional `VITE_API_BASE_URL` (empty = same-origin). |
| `packages/web/src/lib/theme.ts` | Uses `apiUrl()` instead of a hard-coded path. |
| `packages/web/src/pages/ReportsPage.tsx` | CSV export uses `apiUrl()`. |
| `packages/platform-web/src/lib/api.ts` | `platformUrl()` helper; optional `VITE_PLATFORM_API_BASE_URL`. |

Nothing was removed, and the two frontends remain separate applications.

---

## 8. Local verification performed

| Check | Result |
|---|---|
| `npm run typecheck` (5 workspaces) | pass |
| `npx eslint` (server, web, platform-web, api) | pass |
| `npm run build --workspace=packages/web` | pass — assets emitted as `/assets/…` |
| `npm run build --workspace=packages/platform-web` | pass |
| Serverless bundle (esbuild, node target, CJS as Vercel emits) | pass — 2.49 MB, workspace TS source inlined |
| Bundled function boots and routes | pass — see below |
| Webhook raw-body ordering | **proved fixed** with a before/after byte comparison |
| Dev server smoke (`:5173`) | pass, no transform errors |

Routing verified against the **bundled** function (the actual deploy artifact):

| Request | Result | Meaning |
|---|---|---|
| `GET /api/v1/healthz` | 503 | reached the health route; DB down as expected here |
| `POST /api/v1/auth/login` | 401 | reached auth; refused at host resolution (correct) |
| `POST /api/v1/webhooks/payments/x` | 400 | reached the webhook handler (missing company header) |
| `GET /api/v1/definitely-not-here` | 404 | API 404, **not** swallowed by the SPA fallback |
| `GET /platform/v1/definitely-not` | 404 | platform router mounted |

**Not verified:** the actual Vercel build and the deployed URLs — no Vercel account or CLI is available here. The bundling
and routing evidence above is strong but is not a substitute for the real deploy; treat the first deploy as the final check.
