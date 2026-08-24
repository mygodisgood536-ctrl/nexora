import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { runWithRequestContext } from "../lib/async-context";

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers["x-request-id"] as string | undefined) ?? randomUUID();
  res.setHeader("x-request-id", requestId);
  runWithRequestContext({ requestId }, () => next());
}
