import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, zodIssuesToDetails } from "../lib/errors";
import { logger } from "../lib/logger";
import { getRequestContext } from "../lib/async-context";

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = getRequestContext()?.requestId;

  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: zodIssuesToDetails(err.issues),
        requestId
      }
    };
    res.status(422).json(body);
    return;
  }

  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        requestId
      }
    };
    res.status(err.status).json(body);
    return;
  }

  logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
  const body: ErrorBody = {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      requestId
    }
  };
  res.status(500).json(body);
}
