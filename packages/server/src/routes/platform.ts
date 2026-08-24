import { Router } from "express";
import { dbHealth } from "../db/pool";

export const platformRouter = Router();

platformRouter.get("/healthz", async (_req, res) => {
  const db = await dbHealth();
  res.status(db === "up" ? 200 : 503).json({
    status: "ok",
    service: "nexora-platform-api",
    db,
    uptime_s: Math.round(process.uptime()),
    time: new Date().toISOString()
  });
});
