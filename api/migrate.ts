import type { Request, Response } from "express";
import { runMigrations } from "../packages/server/src/db/migrate";

export default async function handler(_req: Request, res: Response): Promise<void> {
  // Require cron secret for safety
  if (_req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    res.status(500).json({ error: "DATABASE_URL not configured" });
    return;
  }

  try {
    const applied = await runMigrations(databaseUrl);
    res.status(200).json({
      applied: applied.length,
      migrations: applied,
      message: applied.length > 0 ? `applied ${applied.length} migration(s)` : "already up to date",
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
