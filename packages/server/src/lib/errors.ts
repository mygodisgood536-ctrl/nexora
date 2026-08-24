import type { ZodIssue } from "zod";

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new AppError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message = "Resource conflict", details?: unknown) {
    return new AppError(409, "CONFLICT", message, details);
  }

  static unprocessable(message = "Validation failed", details?: unknown) {
    return new AppError(422, "VALIDATION_ERROR", message, details);
  }

  static internal(message = "Internal server error") {
    return new AppError(500, "INTERNAL_ERROR", message);
  }
}

export interface ValidationErrorDetail {
  path: string;
  message: string;
  code: string;
}

export function zodIssuesToDetails(issues: ZodIssue[]): ValidationErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code
  }));
}
