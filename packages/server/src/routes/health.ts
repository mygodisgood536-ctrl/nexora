import { Router } from "express";
import { dbHealth } from "../db/pool";

export const healthRouter = Router();

healthRouter.get("/healthz", async (_req, res) => {
  const db = await dbHealth();
  res.status(db === "up" ? 200 : 503).json({
    status: "ok",
    service: "nexora-api",
    db,
    uptime_s: Math.round(process.uptime()),
    time: new Date().toISOString()
  });
});
