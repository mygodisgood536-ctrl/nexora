import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { requestContext } from "./middleware/request-context";
import { tenantPrefix } from "./middleware/tenant-prefix";
import { attachPrincipal } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { whoamiRouter } from "./routes/whoami";
import { cronRouter } from "./routes/cron";
import { platformRouter } from "./modules/platform/routes";
import { authRouter } from "./modules/auth/routes";
import { themeRouter } from "./modules/branding/routes";
import { branchesRouter } from "./modules/branches/routes";
import { workersRouter, rolesRouter, assignmentsRouter } from "./modules/workers/routes";
import { customersRouter } from "./modules/customers/routes";
import { virtualAccountsRouter } from "./modules/customers/va-routes";
import { groupsRouter } from "./modules/groups/routes";
import {
  loanProductsRouter,
  approvalChainsRouter,
  loanApplicationsRouter,
  loanDisbursementsRouter,
  adjustmentsRouter,
  stageReassignmentsRouter,
} from "./modules/loans/routes";
import {
  paymentsRouter,
  paymentProvidersRouter,
  webhookRouter,
  reconciliationItemsRouter,
  webhookExceptionsRouter,
} from "./modules/payments/routes";
import { auditRouter } from "./modules/audit/routes";
import { notificationsRouter } from "./modules/notifications/routes";
import { accountingRouter } from "./modules/accounting/routes";
import {
  performanceRouter,
  assignmentsRouter as customerAssignmentsRouter,
} from "./modules/performance/routes";
import { customerPortalRouter } from "./modules/customer-portal/routes";
import { branchWorkplaceRouter } from "./modules/branch-workplace/routes";
import { reportsRouter } from "./modules/reports/routes";
import { eodRouter } from "./modules/eod/routes";
import { visitsRouter } from "./modules/visits/routes";
import { companyAiRouter } from "./modules/company-ai/routes";
import { recoveryRouter } from "./modules/recovery/routes";
import { collectionWatchRouter } from "./modules/collection-watch/routes";
import { overdueEscalationRouter } from "./modules/overdue-escalation/routes";
import { traceabilityRouter } from "./modules/traceability/routes";
import { healthRouter } from "./routes/health";

export function createApp(): express.Express {
  const app = express();

  // HOST-INDEPENDENT ROUTING.
  //
  // The same Express app is mounted two ways:
  //   - locally: `node src/index.ts`, where req.url is already the real path;
  //   - on Vercel, where a rewrite routes the request to this function and the
  //     handler is invoked on the function's own path ("/api/nexora-api").
  //
  // Vercel appends every captured rewrite parameter to the destination's query
  // string, which is what makes the original path recoverable without relying on
  // any undocumented header. Verified against Vercel's own routing engine
  // (@vercel/routing-utils), which compiles:
  //
  //   /api/v1/:path*                 -> /api/nexora-api?path=$1
  //   /platform/v1/:poPath*          -> /api/nexora-api?poPath=$1
  //   /:tenant/api/v1/:path*         -> /api/nexora-api?tenant=$1&path=$2
  //   /:tenant/platform/v1/:poPath*  -> /api/nexora-api?tenant=$1&poPath=$2
  //
  // `poPath` exists only to distinguish the Platform Owner API from the company
  // API: without it, `/platform/v1/companies` and `/api/v1/companies` would both
  // arrive as `?path=companies` and be indistinguishable. The names `path`,
  // `tenant` and `poPath` are reserved here and deliberately do not collide with
  // any query parameter the application itself reads (limit, offset, status,
  // branchId, from, to, search, company, â€¦).
  // NOTE: "/api" is deliberately NOT in this list. The function's own path is
  // "/api/nexora-api", and treating that as "already an API path" would make
  // every rewritten request pass through un-rebuilt and 404 in production.
  const API_PREFIXES = ["/api/v1", "/platform/v1"];
  const VERCEL_PARAMS = new Set(["path", "poPath", "tenant"]);

  app.use((req, _res, next) => {
    const current = req.url ?? "";

    // Already an API path: local development, or a direct function invocation.
    if (API_PREFIXES.some((p) => current === p || current.startsWith(`${p}/`))) {
      return next();
    }

    const queryStart = current.indexOf("?");
    if (queryStart === -1) return next();
    const params = new URLSearchParams(current.slice(queryStart + 1));

    const tenant = params.get("tenant");
    // A recovered segment may itself carry a `?â€¦` tail if the host folded the
    // original query into the captured value. Splitting it off keeps list
    // filters and pagination working instead of corrupting the path.
    const split = (raw: string | null): [string | null, string | null] => {
      if (raw === null) return [null, null];
      const at = raw.indexOf("?");
      return at === -1 ? [raw, null] : [raw.slice(0, at), raw.slice(at + 1)];
    };
    const [apiPath, apiTail] = split(params.get("path"));
    const [poPath, poTail] = split(params.get("poPath"));

    let rebuilt: string | null = null;
    let tail: string | null = null;
    if (apiPath !== null) {
      rebuilt = `${tenant ? `/${tenant}` : ""}/api/v1${apiPath ? `/${apiPath}` : ""}`;
      tail = apiTail;
    } else if (poPath !== null) {
      rebuilt = `${tenant ? `/${tenant}` : ""}/platform/v1${poPath ? `/${poPath}` : ""}`;
      tail = poTail;
    }
    if (rebuilt === null) return next();

    // Carry the caller's own query parameters through, minus the ones Vercel
    // added for routing. Anything the application filters or paginates on must
    // survive the rewrite.
    const passthrough = new URLSearchParams();
    for (const [key, value] of params) {
      if (!VERCEL_PARAMS.has(key)) passthrough.append(key, value);
    }
    if (tail) {
      const fromTail = new URLSearchParams(tail);
      for (const [key, value] of fromTail) {
        if (!VERCEL_PARAMS.has(key) && !passthrough.has(key)) passthrough.append(key, value);
      }
    }
    const search = passthrough.toString();
    req.url = search ? `${rebuilt}?${search}` : rebuilt;
    return next();
  });

  // TENANT ADDRESS PREFIX.
  //
  // The Vision requires that the URL supplies the scope, with no company picker
  // in the flow. This accepts BOTH address forms for the same tenant:
  //   acme.nexora.app/...            (hostname â€” the Vision default)
  //   example.vercel.app/acme/...    (path â€” same application, shared apex)
  // The path form is what lets the platform run on a host that does not issue
  // wildcard subdomains without changing a single rule. The prefix is only ever
  // a lookup key for a real company slug; every request is still authorised
  // inside that company's tenant session under row-level security.
  app.use(tenantPrefix);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true
    })
  );
  // WEBHOOK RAW BODY â€” MUST PRECEDE express.json().
  //
  // The payment webhook verifies an HMAC computed over the EXACT bytes the
  // provider sent. `express.json()` consumes the request stream, so if it ran
  // first, `req.body` would already be a parsed object and the handler would
  // have to re-serialise it (JSON.stringify) to rebuild the signed payload.
  // Re-serialisation is not byte-identical â€” key order, spacing and number
  // formatting can all differ â€” so the signature would never match and every
  // inbound payment would be rejected as invalid (VISION acceptance test 13/20,
  // RULE 8.5.2). Capturing the raw bytes here, scoped to the webhook ingress
  // path only, keeps signature verification honest in every environment.
  app.use("/api/v1/webhooks", express.raw({ type: "*/*", limit: "1mb" }));
  app.use(express.json({ limit: "8mb" }));
  app.use(requestContext);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? req.id ?? "",
      autoLogging: {
        ignore: (req) => req.url?.includes("/healthz") === true
      }
    })
  );
  app.use(attachPrincipal);

  const api = express.Router();
  api.use(healthRouter);
  api.use(themeRouter); // public pre-auth branding (Part 1 Â§26)
  api.use(whoamiRouter);
  api.use("/auth", authRouter);
  api.use("/branches", branchesRouter); // branch lifecycle (Part 1 Â§7â€“9)
  api.use("/workers", workersRouter); // workers + role assignments (Stage 6, Part 1 Â§12â€“17)
  api.use("/roles", rolesRouter); // role catalogue + custom roles (Stage 6, Part 1 Â§15)
  api.use("/assignments", assignmentsRouter); // role-assignment lifecycle (Stage 6, Part 1 Â§17)
  api.use("/customers", customersRouter); // customer domain (Stage 7A, Part 1 Â§22)
  api.use("/virtual-accounts", virtualAccountsRouter); // disbursed VA lifecycle (RULE 9.5.1)
  api.use("/audit", auditRouter); // tenant audit trail (Part 1 Â§26)
  api.use("/notifications", notificationsRouter); // notifications (Part 1 Â§26)
  api.use("/accounting", accountingRouter); // statement reads from the journal (Part 2 Â§38-39)
  api.use("/performance", performanceRouter); // performance analytics (Part 2 Â§37)
  api.use("/customer-assignments", customerAssignmentsRouter); // C.O. customer assignments (Part 2 Â§34)
  api.use("/customer-portal", customerPortalRouter); // customer portal (Part 2 Â§25)
  api.use("/groups", groupsRouter); // group management (Stage 7B, Part 2 Â§27)
  api.use("/loan-products", loanProductsRouter); // loan product catalogue (Stage 7C, Part 1 Â§23)
  api.use("/approval-chains", approvalChainsRouter); // approval chains (Stage 7C, Part 1 Â§23)
  api.use("/loan-applications", loanApplicationsRouter); // loan applications (Stage 7C, Part 1 Â§23)
  api.use("/loan-disbursements", loanDisbursementsRouter); // disbursement trigger (Stage 7C, Part 1 Â§22-23)
  api.use("/approval-stage-reassignments", stageReassignmentsRouter); // RULE 19.12.3 mandatory-stage cover
  api.use("/loan-adjustments", adjustmentsRouter); // RULE 10.6.3 write-off / restructuring decisions
  api.use("/payment-providers", paymentProvidersRouter); // per-company payment provider config (Stage 7D, Part 1 Â§21)
  api.use("/payments", paymentsRouter); // payment pipeline queries (Stage 7D, Part 1 Â§21)
  api.use("/reconciliation-items", reconciliationItemsRouter); // reconciliation diff queue (Stage 7D, Part 1 Â§21)
  api.use("/webhook-exceptions", webhookExceptionsRouter); // signature/schema exceptions (Stage 7D, Part 1 Â§21)
  // Webhook entry is signature-authenticated, not session-authenticated.
  // The provider supplies the company slug in a header so the per-company
  // signing secret can be loaded.
  api.use("/webhooks", webhookRouter);
  api.use("/reports", reportsRouter); // report library (Part 12 Â§12.22, RULE 11.6.2)
  api.use("/branch-workplace", branchWorkplaceRouter); // Branch Workplace (Part 7 Â§7.1-7.3)
  api.use("/visits", visitsRouter); // field activity records (Part 6 Â§6.4)
  api.use("/company-ai", companyAiRouter); // read-only tenant-isolated company AI (Part 21)
  api.use("/recovery", recoveryRouter); // restore/recovery integrity verification (Part 20)
  api.use("/collection-watch", collectionWatchRouter); // collection watch notifications (Part 6.4.2, 9.9)
  api.use("/overdue-escalation", overdueEscalationRouter); // overdue escalation ladder (Part 10.6.2)
  api.use("/traceability", traceabilityRouter); // real traceability chain (Part 10.9.1, 6.5.4)
  api.use("/eod", eodRouter); // end-of-day settlement operations (Part 1 Â§21, Â§23)
  app.use("/api/v1", api);

  const platformApi = express.Router();
  platformApi.use(platformRouter);
  app.use("/platform/v1", platformApi);

  // RULE 3.8.6 / 8.5.6 - the platform schedule. It sits outside /api/v1 because
  // it is not a company API: it authenticates with CRON_SECRET, not a session,
  // and it iterates companies itself so each company's work runs in its own
  // tenant transaction.
  app.use("/cron", cronRouter);

  // TEMPORARY: migration runner - remove after migrations are applied
  app.use("/migrate", async (_req: Request, res: Response) => {
    if (_req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      res.status(500).json({ error: "DATABASE_URL not configured" });
      return;
    }
    try {
      const { runMigrations } = await import("../packages/server/src/db/migrate");
      const applied = await runMigrations(databaseUrl);
      res.status(200).json({
        applied: applied.length,
        migrations: applied,
        message: applied.length > 0 ? `applied ${applied.length} migration(s)` : "already up to date",
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
