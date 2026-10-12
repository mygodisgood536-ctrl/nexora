/**
 * Standalone verification of the portal address rules (Vision Part 1 §2.3).
 *
 * Pure string/parse logic, so it is proved without a database — which matters
 * because the DB-backed vitest suite cannot run until Neon is connected.
 *
 *   npx tsx scripts/verify-portal-address.ts
 */
import {
  parsePortalAddress,
  parsePortalAddressFromHost,
  parsePortalPath,
  splitSlugCandidates,
  RESERVED_PATH_SEGMENTS
} from "../packages/server/src/lib/host";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

/** "company" or "company/branch", first candidate first. */
const fmt = (list: { companySlug: string; branchSlug: string | null }[]) =>
  list.map((c) => `${c.companySlug}${c.branchSlug ? "/" + c.branchSlug : ""}`);

console.log("--- platform hostname form (the Vision default) ---");
check("acme.nexora.app", fmt(parsePortalAddressFromHost("acme.nexora.app").candidates), ["acme"]);
check(
  "acme-mukono.nexora.app tries the branch split",
  fmt(parsePortalAddressFromHost("acme-mukono.nexora.app").candidates),
  ["acme-mukono", "acme/mukono"]
);
check(
  "longest company first",
  fmt(parsePortalAddressFromHost("acme-kampala-mukono.nexora.app").candidates),
  ["acme-kampala-mukono", "acme-kampala/mukono", "acme/kampala-mukono"]
);
check("port stripped", fmt(parsePortalAddressFromHost("acme.nexora.app:443").candidates), ["acme"]);
check("trailing dot tolerated", fmt(parsePortalAddressFromHost("acme.nexora.app.").candidates), ["acme"]);
check("uppercase host lowercased", fmt(parsePortalAddressFromHost("ACME.Nexora.App").candidates), ["acme"]);

console.log("\n--- the apex itself is not a company ---");
check("nexora.app resolves nothing", parsePortalAddressFromHost("nexora.app"), {
  candidates: [],
  customDomain: null,
  empty: true
});
check("www.nexora.app is a legal slug (a company may be named www)", fmt(parsePortalAddressFromHost("www.nexora.app").candidates), ["www"]);
check("nested apex resolves nothing", parsePortalAddressFromHost("a.b.nexora.app").empty, true);

console.log("\n--- local dev hosts ---");
for (const h of ["localhost", "127.0.0.1", "acme.localhost", "acme.localhost:5173"]) {
  check(`${h} resolves nothing`, parsePortalAddressFromHost(h).empty, true);
}

console.log("\n--- company-owned domain (Vision-permitted) ---");
// A non-apex host is a company DOMAIN, never a slug. This is the bug the first
// pass of this script caught: multi-label hosts were being parsed as slugs, so a
// custom domain could never resolve and the whole-host string leaked through.
const cd = parsePortalAddressFromHost("portal.acme.com");
check("portal.acme.com -> customDomain", cd.customDomain, "portal.acme.com");
check("portal.acme.com yields no slug candidates", cd.candidates, []);
check("ACME.example.CO normalises to lowercase", parsePortalAddressFromHost("ACME.Example.CO").customDomain, "acme.example.co");

console.log("\n--- tenant path form (shared apex) ---");
// A prefix is only read when an API path follows it — the SPA's own pages never
// reach this server, and a page name must never be mistaken for a slug.
check("/acme/api/v1/theme", fmt(parsePortalPath("/acme/api/v1/theme")), ["acme"]);
check("/acme/api/v1/money", fmt(parsePortalPath("/acme/api/v1/money")), ["acme"]);
check("/acme/platform/v1/companies", fmt(parsePortalPath("/acme/platform/v1/companies")), ["acme"]);
check("/acme-mukono/api/v1/money", fmt(parsePortalPath("/acme-mukono/api/v1/money")), ["acme-mukono", "acme/mukono"]);
check(
  "/acme-kampala-mukono longest company first",
  fmt(parsePortalPath("/acme-kampala-mukono/api/v1/money")),
  ["acme-kampala-mukono", "acme-kampala/mukono", "acme/kampala-mukono"]
);
check("query string is irrelevant to parsing", fmt(parsePortalPath("/acme/api/v1/theme?x=1")), ["acme"]);

console.log("\n--- path form must never swallow platform resources ---");
check("/api/v1/theme", parsePortalPath("/api/v1/theme"), []);
check("/platform/v1/companies", parsePortalPath("/platform/v1/companies"), []);
check("/assets/index.js", parsePortalPath("/assets/index.js"), []);
check("/ (root)", parsePortalPath("/"), []);
check("empty", parsePortalPath(""), []);
check("undefined", parsePortalPath(undefined), []);
check("/favicon.ico", parsePortalPath("/favicon.ico"), []);
check("reserved list contains api", RESERVED_PATH_SEGMENTS.has("api"), true);

console.log("\n--- case folding is normalisation, not rejection ---");
// Slugs are stored lowercase by construction, so /UPPERCASE legitimately folds
// to "uppercase" and can only ever address the same company.
check("/UPPERCASE/api -> folded", fmt(parsePortalPath("/UPPERCASE/api")), ["uppercase"]);
check("/Acme/api -> folded", fmt(parsePortalPath("/Acme/api")), ["acme"]);

console.log("\n--- the parser mirrors the DB slug constraint ---");
// companies.slug is CHECK (slug ~ '^[a-z0-9-]+$'), so anything the DB can store
// must be addressable. Stricter parsing would lock a company out of its own URL.
check("/trailing-/api is addressable", fmt(parsePortalPath("/trailing-/api")), ["trailing-"]);
check("/-leading/api is addressable", fmt(parsePortalPath("/-leading/api")), ["-leading"]);
check("but a dash may not be a whole label", parsePortalPath("/-/api"), []);

console.log("\n--- a portal PAGE name must never become a tenant ---");
// The single most dangerous case: on a hostname-resolved portal the SPA serves
// /money, /people, /branches … If a page name were read as a tenant prefix, the
// company "money" would be addressed instead of the one the host names.
for (const page of ["/money", "/people", "/branches", "/customers", "/reports", "/eod", "/profile"]) {
  check(`${page} -> []`, parsePortalPath(page), []);
}
check("page path still lets the HOST name the tenant", fmt(parsePortalAddress("acme.nexora.app", "/money").candidates), ["acme"]);

console.log("\n--- combined address resolution ---");
const combined = (h: string, p: string) => {
  const a = parsePortalAddress(h, p);
  return { candidates: fmt(a.candidates), customDomain: a.customDomain, empty: a.empty };
};
check(
  "path prefix outranks the hostname",
  combined("acme.nexora.app", "/other/api/v1/money"),
  { candidates: ["other"], customDomain: null, empty: false }
);
check(
  "falls back to the hostname when the path carries no tenant",
  combined("acme.nexora.app", "/api/v1/money"),
  { candidates: ["acme"], customDomain: null, empty: false }
);
check(
  "a portal page path leaves the hostname in charge",
  combined("acme.nexora.app", "/money"),
  { candidates: ["acme"], customDomain: null, empty: false }
);
check(
  "custom domain still resolves on a path-addressed host",
  combined("portal.acme.com", "/money"),
  { candidates: [], customDomain: "portal.acme.com", empty: false }
);
check("empty address", combined("nexora.app", "/"), { candidates: [], customDomain: null, empty: true });

console.log("\n--- hostile input (fail closed) ---");
const hostile = [
  "/../etc/passwd",
  "/..%2f..%2fetc",
  "/.hidden",
  "/acme_uk",
  "/" + "a".repeat(61),
  "/api",
  "/platform",
  "/acme/../../etc"
];
for (const h of hostile) {
  check(`${h} -> []`, parsePortalPath(h), []);
}
// Path traversal through an API-shaped path must not escape the prefix.
check("/acme/../../etc/passwd/api -> []", parsePortalPath("/acme/../../etc/passwd/api"), []);

console.log("\n--- splitSlugCandidates guards ---");
check("non-slug label rejected", splitSlugCandidates("Acme!"), []);
check("single dash edge rejected", splitSlugCandidates("-"), []);
check("plain slug single candidate", fmt(splitSlugCandidates("acme")), ["acme"]);

console.log(
  failures === 0
    ? "\nALL PORTAL ADDRESS CHECKS PASSED"
    : `\n${failures} PORTAL ADDRESS CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);
