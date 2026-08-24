import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: undefined,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.new_password",
      "*.current_password",
      "*.temporary_password",
      "*.token"
    ],
    censor: "[REDACTED]"
  }
});
