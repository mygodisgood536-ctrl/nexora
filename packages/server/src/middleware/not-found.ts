import type { Request, Response } from "express";
import { AppError } from "../lib/errors";

export function notFoundHandler(req: Request, res: Response): void {
  const err = AppError.notFound(`No route for ${req.method} ${req.path}`);
  res.status(err.status).json({
    error: {
      code: err.code,
      message: err.message
    }
  });
}
