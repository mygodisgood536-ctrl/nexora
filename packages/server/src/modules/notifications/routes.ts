// Notification Center routes (Part 2 §40): the staff inbox is the user's own
// notifications only — other users' rows are never visible or touchable.
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../../lib/errors";
import { requireCompleteSession, requirePermission } from "../../middleware/auth";
import {
  listUserNotifications,
  unreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
} from "./service";

export const notificationsRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(req: Request): { sub: string; companyId: string; branchId: string | null } {
  const p = req.principal!;
  return { sub: p.sub, companyId: p.companyId, branchId: p.branchId ?? null };
}

function wrap(fn: (req: Request, res: Response) => Promise<void>): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}

notificationsRouter.get(
  "/",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    const read = req.query.read === "true" ? true
      : req.query.read === "false" ? false : null;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    res.json(await listUserNotifications(actor(req), { read, limit, offset }));
  })
);

notificationsRouter.get(
  "/unread-count",
  requireCompleteSession,
  requirePermission("view"),
  wrap(async (req, res) => {
    res.json({ count: await unreadNotificationCount(actor(req)) });
  })
);

notificationsRouter.post(
  "/read-all",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    res.json(await markAllNotificationsRead(actor(req)));
  })
);

notificationsRouter.post(
  "/:id/read",
  requireCompleteSession,
  requirePermission("edit"),
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) throw AppError.badRequest("Invalid notification id");
    res.json(await markNotificationRead(actor(req), id));
  })
);