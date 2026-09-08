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
  app.use(express.json({ limit: "1mb" }));
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
  app.use("/api/v1", api);

  const platformApi = express.Router();
  platformApi.use(platformRouter);
  app.use("/platform/v1", platformApi);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
