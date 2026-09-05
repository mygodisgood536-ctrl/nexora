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
  app.use("/api/v1", api);

  const platformApi = express.Router();
  platformApi.use(platformRouter);
  app.use("/platform/v1", platformApi);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
