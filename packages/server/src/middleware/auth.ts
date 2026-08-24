import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AppError } from "../lib/errors";
import type { ScopeType } from "@nexora/shared";

export interface PrincipalRoleRef {
  roleKey: string;
  scopeType: ScopeType;
  branchIds: string[];
  permissions: string[];
}

export interface PrincipalPayload {
  sub: string;
  companyId: string;
  branchId?: string | null;
  roles: PrincipalRoleRef[];
}

const TOKEN_OPTIONS: jwt.VerifyOptions = { algorithms: ["HS256"] };

export function verifyAccessToken(token: string): PrincipalPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET, TOKEN_OPTIONS) as PrincipalPayload;
  } catch {
    throw AppError.unauthorized("Invalid or expired session token");
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

export function attachPrincipal(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req);
  if (!token) return next();
  try {
    req.principal = verifyAccessToken(token);
  } catch {
    return next();
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.principal) {
    next(AppError.unauthorized());
    return;
  }
  next();
}

export function requirePermission(verb: string): (req: Request, _res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    if (!req.principal) {
      next(AppError.unauthorized());
      return;
    }
    const granted = req.principal.roles.some((role) => role.permissions.includes(verb));
    if (!granted) {
      next(AppError.forbidden(`Missing permission: ${verb}`));
      return;
    }
    next();
  };
}
