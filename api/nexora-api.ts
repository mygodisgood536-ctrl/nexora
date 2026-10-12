/**
 * Vercel serverless entrypoint for the Nexora API.
 *
 * Vercel treats every file under `/api` as a Node.js serverless function. This
 * one exports the SAME Express application the local server runs
 * (`packages/server/src/app.ts`), so there is exactly one implementation of
 * every rule — no separate "serverless API" that could drift from the real one.
 *
 * What this means for the serverless execution model:
 *   - `createApp()` returns an `express.Express`, which Vercel drives directly.
 *     There is no `listen()`, no port binding and no long-lived process: a
 *     serverless function lives only for the request.
 *   - Body parsing is deliberately NOT done here. The app registers its own
 *     parsers, and it must capture the raw webhook body before `express.json()`
 *     so the provider's HMAC can be verified against the exact bytes received.
 *     A platform-level body parser here would break that.
 *   - No background work runs in-process. There is no cron or interval loop in
 *     this codebase: end-of-day and the provider polling job are external
 *     operator/scheduler calls (VISION Part 1 §21/§23, RULE 8.5.6), which is
 *     exactly the right shape for serverless.
 *   - Database connections are pooled per instance and bounded by
 *     DATABASE_POOL_MAX with a bounded connect timeout; point DATABASE_URL at a
 *     pooled endpoint so the database, not the function, caps concurrency.
 *   - `config/env.ts` throws at import time in production if the development
 *     secrets are still set. That is intentional fail-closed behaviour, so the
 *     required environment variables must be configured before first deploy.
 */
import { createApp } from "../packages/server/src/app";

const app = createApp();

export default app;
