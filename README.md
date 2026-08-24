# Nexora

Multi-tenant microfinance operating system, built to the four specification documents in
`docs/specs/` (SRS v2.1 Part 1 & Part 2, Role Specifications A–Z Complete, Platform Owner Portal Spec).

## Layout

| Package | Purpose |
|---|---|
| `packages/shared` | Domain constants: 32-role catalogue, scopes, permission verbs, API types |
| `packages/server` | Express REST API (`/api/v1` company side, `/platform/v1` owner side), PostgreSQL 16 + RLS groundwork |
| `packages/web` | Company portals SPA (Head Office, branches, 32 role workspaces, customer portal) |
| `packages/platform-web` | Platform Owner Portal SPA — separate surface, Nexora's own theme |

See `docs/ROADMAP.md` for the staged plan and `docs/CHECKLIST.md` for verification status.

## Prerequisites

- Node.js ≥ 20 (uses npm workspaces)
- PostgreSQL 16 — this repo uses a user-local instance under `.pg/` (no admin rights needed)

## Local PostgreSQL

```powershell
npm run db:start        # starts .pg instance on port 5432 (data in .pg/data)
npm run db:stop         # stops it
npm run db:provision    # creates role nexora + databases nexora_dev / nexora_test (idempotent)
```

Superuser is `postgres` / `nexora-dev`; the app connects as `nexora` / `nexora`.

## Run

```powershell
npm install
npm run typecheck       # all workspaces
npm test                # server integration tests against nexora_test
npm run dev             # boots server :4000, web :5173, platform-web :5174 concurrently per workspace
```

- Company portal dev URL: http://localhost:5173 (proxies `/api` → :4000)
- Platform Owner portal dev URL: http://localhost:5174 (proxies `/platform` → :4000)
- API health: http://localhost:4000/api/v1/healthz and http://localhost:4000/platform/v1/healthz
