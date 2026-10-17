// Scheduled platform work (Vision RULE 3.8.6 / 8.5.6).
//
// RULE 3.8.6 - "the platform must support concurrent operations without
// serialising unrelated companies through one global worker ... The platform
// must support horizontal/background execution scaling, bounded resource use,
// queue backpressure where needed, observability and graceful failure without
// cross-tenant contamination."
//
// RULE 8.5.6 - "The platform must never rely only on webhooks: a scheduled
// polling or reconciliation job must periodically confirm that every provider
// transaction matches a recorded payment, and must raise an exception for
// anything found only on the provider side."
//
// Until now every one of these ran only when a person manually POSTed it, so
// nothing aged, escalated or expired on its own.
//
// This route is that schedule. It is a SYSTEM route, not a company route: it
// iterates active companies and runs each company's work inside that company's
// own tenant transaction, so one company's failure cannot corrupt or block
// another's (RULE 3.8.3). It is protected by CRON_SECRET and fails closed when
// that secret is absent, because no human performs this work.

import type { Request, Response, NextFunction } from "express";
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { withBypass } from "../db/repo";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { runEndOfDayForCompany } from "../modules/eod/service";
import { runCollectionWatchForCompany } from "../modules/collection-watch/service";
import { runOverdueEscalationForCompany } from "../modules/overdue-escalation/service";
import { expireTemporaryAssignments } from "../modules/workers/service";

export const cronRouter = Router();

/** RULE 14.3.1 - automated work is attributed to a named, non-human principal. */
export const SCHEDULE_PRINCIPAL = "NEXORA_PLATFORM_SCHEDULE";

function authorized(req: Request): boolean {
  const configured = env.CRON_SECRET;
  // Fail closed: with no secret configured the schedule cannot be triggered at
  // all, rather than running open to anyone who finds the URL.
  if (!configured) return false;
  const header = req.header("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface CompanyRow {
  id: string;
  name: string;
}

interface JobOutcome {
  company: string;
  job: string;
  ok: boolean;
  detail?: string;
}

async function activeCompanies(): Promise<CompanyRow[]> {
  return withBypass(async (db) => {
    const r = await db.query<CompanyRow>(
      `SELECT id, name FROM companies WHERE status = 'active' ORDER BY id`
    );
    return r.rows;
  });
}

async function runPerCompany(
  companies: CompanyRow[],
  job: string,
  fn: (companyId: string, scheduleActorId: string) => Promise<unknown>
): Promise<JobOutcome[]> {
  const results: JobOutcome[] = [];
  for (const company of companies) {
    try {
      await fn(company.id, await schedulePrincipalFor(company.id));
      results.push({ company: company.name, job, ok: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // RULE 3.8.4 - a failure scoped to one company is logged and contained;
      // unrelated companies continue.
      logger.error({ job, companyId: company.id, err: detail }, "scheduled job failed");
      results.push({ company: company.name, job, ok: false, detail });
    }
  }
  return results;
}

/**
 * Migration 0095 provisions one suspended system principal per company so that
 * automated audit entries name something true. If a company somehow lacks one
 * (created before the migration, or provision interrupted) it is created here,
 * still suspended, so attribution never silently degrades to a person who did
 * not act.
 */
async function schedulePrincipalFor(companyId: string): Promise<string> {
  return withBypass(async (db) => {
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE company_id=$1 AND username=$2`,
      [companyId, SCHEDULE_PRINCIPAL]
    );
    if ((existing.rowCount ?? 0) > 0) return existing.rows[0]!.id;
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (company_id, worker_code, username, password_hash,
                          must_change_password, first_name, last_name,
                          birth_day, birth_month, status, credential_state)
       VALUES ($1,'SYS-SCHEDULE',$2,'!',true,'Nexora','Platform Schedule',1,1,
               'suspended','suspended')
       RETURNING id`,
      [companyId, SCHEDULE_PRINCIPAL]
    );
    return created.rows[0]!.id;
  });
}

export async function runScheduledPlatformWork(): Promise<JobOutcome[]> {
  const companies = await activeCompanies();
  const outcomes: JobOutcome[] = [];

  // Credential expiry is deliberately NOT swept here: RULE 5.2.3.5 is enforced
  // at the login path, so an unused initial credential expires on first use
  // whether or not a schedule ever runs.
  outcomes.push(
    ...(await runPerCompany(companies, "auto_expire_role_assignments", (companyId) =>
      expireTemporaryAssignments(companyId)
    ))
  );
  outcomes.push(
    ...(await runPerCompany(companies, "end_of_day", (companyId, actorId) =>
      runEndOfDayForCompany(companyId, actorId)
    ))
  );
  outcomes.push(
    ...(await runPerCompany(companies, "collection_watch", (companyId, actorId) =>
      runCollectionWatchForCompany(companyId, actorId)
    ))
  );
  outcomes.push(
    ...(await runPerCompany(companies, "overdue_escalation", (companyId, actorId) =>
      runOverdueEscalationForCompany(companyId, actorId)
    ))
  );

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    logger.warn(
      { total: outcomes.length, failed: failed.length },
      "scheduled platform work completed with failures"
    );
  }
  return outcomes;
}

cronRouter.post("/run", (req: Request, res: Response, next: NextFunction) => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  runScheduledPlatformWork()
    .then((outcomes) => res.json({ ran: outcomes.length, outcomes }))
    .catch(next);
});