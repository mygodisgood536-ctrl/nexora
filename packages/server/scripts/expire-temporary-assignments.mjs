#!/usr/bin/env node
/**
 * Scheduled job: Expire temporary role assignments.
 *
 * This script implements the automatic lifecycle handling required by
 * Part 1 §17: "On End Date, it deactivates automatically at end-of-day
 * in the company's configured timezone — no cron-dependent human step
 * required, though the deactivation event itself fires an audit log
 * entry and a notification to the user and to whoever assigned it."
 *
 * Usage: node packages/server/scripts/expire-temporary-assignments.mjs
 * Should be run daily (e.g., via cron at 00:05 in each company's timezone).
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", "..", ".env") });

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://nexora:nexora@localhost:5432/nexora_dev";

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 5
});

async function getAllCompanyIds(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT id FROM companies WHERE status = 'active'`
  );
  return rows.map((r) => r.id);
}

async function expireTemporaryAssignmentsForCompany(companyId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.company_id', $1, true)", [companyId]);

    // Find all active temporary assignments where ends_at < now()
    const expired = await client.query<{
      id: string;
      user_id: string;
      role_id: string;
      ends_at: Date;
      assigned_by: string | null;
      branch_id: string | null;
      role_key: string;
    }>(
      `SELECT ra.id, ra.user_id, ra.role_id, ra.ends_at, ra.assigned_by,
              u.branch_id, r.role_key
         FROM role_assignments ra
         JOIN users u ON u.id = ra.user_id
         JOIN roles r ON r.id = ra.role_id
        WHERE ra.company_id = $1
          AND ra.assignment_type = 'temporary'
          AND ra.status = 'active'
          AND ra.ends_at IS NOT NULL
          AND ra.ends_at < now()`,
      [companyId]
    );

    let count = 0;
    for (const assignment of expired.rows) {
      const endedBy = assignment.assigned_by;
      const reason = `Automatic expiry: temporary assignment ended at ${assignment.ends_at.toISOString()}`;

      await client.query(
        `UPDATE role_assignments
            SET status='ended', ended_at=now(), ended_by=$2, end_reason=$3
          WHERE id=$1`,
        [assignment.id, endedBy, reason]
      );

      // Audit log entry
      await client.query(
        `INSERT INTO audit_logs (company_id, branch_id, actor_user_id, action, entity_type,
                                 entity_id, previous_value, new_value, reason, ip_address, user_agent, request_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12)`,
        [
          companyId,
          assignment.branch_id,
          endedBy ?? "system",
          "role_assignment.auto_expired",
          "role_assignments",
          assignment.id,
          JSON.stringify({ status: "active", ends_at: assignment.ends_at.toISOString() }),
          JSON.stringify({ status: "ended", ended_at: new Date().toISOString() }),
          reason,
          null,
          null,
          null
        ]
      );

      // TODO: Send notification to user and assigner (Part 1 §17)
      // This would integrate with the notification system when implemented

      count++;
      console.log(`  Expired assignment ${assignment.id} (role: ${assignment.role_key}) for user ${assignment.user_id}`);
    }

    await client.query("COMMIT");
    return count;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log("Starting temporary assignment expiry job...");
  const startTime = Date.now();

  try {
    const companyIds = await getAllCompanyIds();
    console.log(`Found ${companyIds.length} active companies`);

    let totalExpired = 0;
    for (const companyId of companyIds) {
      const count = await expireTemporaryAssignmentsForCompany(companyId);
      if (count > 0) {
        console.log(`Company ${companyId}: expired ${count} assignment(s)`);
        totalExpired += count;
      }
    }

    console.log(`Job completed in ${Date.now() - startTime}ms. Total expired: ${totalExpired}`);
  } catch (error) {
    console.error("Job failed:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();