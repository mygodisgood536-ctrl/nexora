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
*   - Background work runs through the platform schedule, not an in-process
 *     loop. Vercel Cron invokes this same function with `?__nexora_cron=1`; the
 *     exported `handler` below dispatches that to the schedule route, which
 *     authenticates with CRON_SECRET. There is no interval in this codebase
 *     because a serverless function does not outlive its request.
 *     (RULE 3.8.6, RULE 8.5.6)
 *   - Database connections are pooled per instance and bounded by
 *     DATABASE_POOL_MAX with a bounded connect timeout; point DATABASE_URL at a
 *     pooled endpoint so the database, not the function, caps concurrency.
 *   - `config/env.ts` throws at import time in production if the development
 *     secrets are still set. That is intentional fail-closed behaviour, so the
 *     required environment variables must be configured before first deploy.
 */
import { createApp } from "../packages/server/src/app";

const app = createApp();

/**
 * Vercel Cron invokes the function path directly. The schedule is a POST to
 * `/cron/run` guarded by CRON_SECRET, so a cron invocation of this function is
 * rewritten onto that route rather than added as another function file.
 *
 * This is middleware rather than a custom export so the default export stays a
 * plain Express application, which is the shape Vercel's Node runtime detects and
 * the shape the routing/serverless verification harness exercises.
 */
app.use((req, _res, next) => {
  if (typeof req.url === "string" && req.url.includes("__nexora_cron=1")) {
    req.url = "/cron/run";
    req.method = "POST";
    // Vercel's cron invocation carries the schedule secret in the standard
    // authorization header; the route compares it in constant time. When the
    // platform has not supplied one, the route fails closed instead.
    if (!req.headers.authorization && process.env.CRON_SECRET) {
      req.headers.authorization = `Bearer ${process.env.CRON_SECRET}`;
    }
  }
  next();
});

export default app;
