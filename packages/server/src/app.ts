import express from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { requestContext } from "./middleware/request-context";
import { attachPrincipal } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { whoamiRouter } from "./routes/whoami";
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

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true
    })
  );
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
  api.use(themeRouter); // public pre-auth branding (Part 1 §26)
  api.use(whoamiRouter);
  api.use("/auth", authRouter);
  api.use("/branches", branchesRouter); // branch lifecycle (Part 1 §7–9)
  api.use("/workers", workersRouter); // workers + role assignments (Stage 6, Part 1 §12–17)
  api.use("/roles", rolesRouter); // role catalogue + custom roles (Stage 6, Part 1 §15)
  api.use("/assignments", assignmentsRouter); // role-assignment lifecycle (Stage 6, Part 1 §17)
  api.use("/customers", customersRouter); // customer domain (Stage 7A, Part 1 §22)
  api.use("/virtual-accounts", virtualAccountsRouter); // disbursed VA lifecycle (RULE 9.5.1)
  api.use("/audit", auditRouter); // tenant audit trail (Part 1 §26)
  api.use("/notifications", notificationsRouter); // notifications (Part 1 §26)
  api.use("/accounting", accountingRouter); // statement reads from the journal (Part 2 §38-39)
  api.use("/performance", performanceRouter); // performance analytics (Part 2 §37)
  api.use("/customer-assignments", customerAssignmentsRouter); // C.O. customer assignments (Part 2 §34)
  api.use("/customer-portal", customerPortalRouter); // customer portal (Part 2 §25)
  api.use("/groups", groupsRouter); // group management (Stage 7B, Part 2 §27)
  api.use("/loan-products", loanProductsRouter); // loan product catalogue (Stage 7C, Part 1 §23)
  api.use("/approval-chains", approvalChainsRouter); // approval chains (Stage 7C, Part 1 §23)
  api.use("/loan-applications", loanApplicationsRouter); // loan applications (Stage 7C, Part 1 §23)
  api.use("/loan-disbursements", loanDisbursementsRouter); // disbursement trigger (Stage 7C, Part 1 §22-23)
  api.use("/payment-providers", paymentProvidersRouter); // per-company payment provider config (Stage 7D, Part 1 §21)
  api.use("/payments", paymentsRouter); // payment pipeline queries (Stage 7D, Part 1 §21)
  api.use("/reconciliation-items", reconciliationItemsRouter); // reconciliation diff queue (Stage 7D, Part 1 §21)
  api.use("/webhook-exceptions", webhookExceptionsRouter); // signature/schema exceptions (Stage 7D, Part 1 §21)
  // Webhook entry is signature-authenticated, not session-authenticated.
  // The provider supplies the company slug in a header so the per-company
  // signing secret can be loaded.
  api.use("/webhooks", webhookRouter);
  api.use("/reports", reportsRouter); // report library (Part 12 §12.22, RULE 11.6.2)
  api.use("/branch-workplace", branchWorkplaceRouter); // Branch Workplace (Part 7 §7.1-7.3)
  api.use("/visits", visitsRouter); // field activity records (Part 6 §6.4)
  api.use("/company-ai", companyAiRouter); // read-only tenant-isolated company AI (Part 21)
  api.use("/recovery", recoveryRouter); // restore/recovery integrity verification (Part 20)
  api.use("/collection-watch", collectionWatchRouter); // collection watch notifications (Part 6.4.2, 9.9)
  api.use("/overdue-escalation", overdueEscalationRouter); // overdue escalation ladder (Part 10.6.2)
  api.use("/traceability", traceabilityRouter); // real traceability chain (Part 10.9.1, 6.5.4)
  api.use("/eod", eodRouter); // end-of-day settlement operations (Part 1 §21, §23)
  app.use("/api/v1", api);

  const platformApi = express.Router();
  platformApi.use(platformRouter);
  app.use("/platform/v1", platformApi);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
