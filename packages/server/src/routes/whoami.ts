import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { getRequestContext } from "../lib/async-context";

export const whoamiRouter = Router();

whoamiRouter.get("/whoami", requireAuth, (req, res) => {
  const principal = req.principal;
  res.status(200).json({
    userId: principal?.sub,
    companyId: principal?.companyId,
    branchId: principal?.branchId ?? null,
    roles: principal?.roles.map((r) => r.roleKey) ?? [],
    requestId: getRequestContext()?.requestId
  });
});
