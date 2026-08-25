import { Router } from "express";
import { parsePortalHost } from "../../lib/host";
import { AppError } from "../../lib/errors";
import { withBypass } from "../../db/repo";
import { themeRowToCssVars } from "@nexora/shared";

/**
 * Public pre-auth branding endpoint (Part 1 §26): each company's own portal
 * resolves its theme record at session start via the portal Host header —
 * before any login — so even the login screen renders the tenant identity.
 * Resolution uses immutable slugs behind the host grammar and reads through
 * the audited bypass path; an unknown/ambiguous host yields 404.
 */
export const themeRouter = Router();

themeRouter.get("/theme", (req, res, next) => {
  void (async () => {
    const candidates = parsePortalHost(req.headers.host);
    const record = await withBypass(async (db) => {
      for (const candidate of candidates) {
        const { rows } = await db.query(
          `SELECT c.name, c.slug, t.*
             FROM companies c JOIN themes t ON t.company_id = c.id
            WHERE c.slug=$1`,
          [candidate.companySlug]
        );
        if (rows.length > 0) return rows[0];
      }
      return undefined;
    });
    if (!record) throw AppError.notFound("No company portal on this host");
    res.json({
      company: { name: record.name, slug: record.slug },
      tokens: themeRowToCssVars(record)
    });
  })().catch(next);
});
