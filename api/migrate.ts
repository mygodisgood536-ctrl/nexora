import type { Request, Response } from "express";

export default async function handler(_req: Request, res: Response): Promise<void> {
  // TEMPORARY: expose DATABASE_URL for local test runs
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    res.status(500).json({ error: "DATABASE_URL not configured" });
    return;
  }
  res.status(200).json({ databaseUrl });
}
