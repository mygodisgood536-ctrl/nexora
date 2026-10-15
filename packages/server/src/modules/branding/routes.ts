import { Router } from "express";
import { parsePortalAddress } from "../../lib/host";
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
    // Resolve the tenant from the SAME address the credential resolver uses, so
    // the login screen is already branded for the company being entered
    // (Part 1 §26, RULE 13.4.1).
    const address = parsePortalAddress(req.headers.host, req.tenantPath);
    const record = await withBypass(async (db) => {
      for (const candidate of address.candidates) {
        const { rows } = await db.query(
          `SELECT c.name, c.slug, t.*
             FROM companies c JOIN themes t ON t.company_id = c.id
            WHERE c.slug=$1`,
          [candidate.companySlug]
        );
        if (rows.length > 0) return rows[0];
      }
      if (address.customDomain) {
        // A verified company domain resolves to the same company theme.
        const { rows } = await db.query(
          `SELECT c.name, c.slug, t.*
             FROM company_domains d
             JOIN companies c ON c.id = d.company_id
             JOIN themes t ON t.company_id = c.id
            WHERE lower(d.domain)=lower($1) AND d.verified_at IS NOT NULL`,
          [address.customDomain]
        );
        if (rows.length > 0) return rows[0];
      }
      return undefined;
    });
    if (!record) throw AppError.notFound("No company portal on this host");
    res.json({
      // RULE 13.6.1 - the company logo appears on the login screen. It is read
      // here, pre-auth, from the same theme row the colour tokens come from, so
      // the login screen carries the full company identity and not just a hue.
      // RULE 13.6.2 - a company without a logo gets a null url and the client
      // renders its name in a styled placeholder, never a broken image.
      company: {
        name: record.name,
        slug: record.slug,
        logoUrl: typeof record.logo_url === "string" && record.logo_url.length > 0
          ? record.logo_url
          : null
      },
      tokens: themeRowToCssVars(record)
    });
  })().catch(next);
});
