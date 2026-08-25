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
  api.use(whoamiRouter);
  api.use("/auth", authRouter);
  app.use("/api/v1", api);

  const platformApi = express.Router();
  platformApi.use(platformRouter);
  app.use("/platform/v1", platformApi);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
