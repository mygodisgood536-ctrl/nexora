/**
 * Validates vercel.json (root and packages/platform-web) against the LIVE
 * schema published at https://openapi.vercel.sh/vercel.json.
 *
 * The schema sets "additionalProperties": false, so an unsupported or obsolete
 * key is not ignored by Vercel - it fails the deployment. This turns that from
 * something we discover during a deploy into something we catch here.
 *
 *   node scripts/validate-vercel-config.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_CACHE = resolve(REPO, "node_modules", ".cache", "vercel-schema.json");
const SCHEMA_URL = "https://openapi.vercel.sh/vercel.json";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    failures++;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

async function loadSchema() {
  if (existsSync(SCHEMA_CACHE)) return JSON.parse(readFileSync(SCHEMA_CACHE, "utf8"));
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) throw new Error(`schema fetch failed: ${res.status}`);
  const json = await res.json();
  const dir = dirname(SCHEMA_CACHE);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(SCHEMA_CACHE, JSON.stringify(json), "utf8");
  return json;
}

const schema = await loadSchema();
const topLevel = new Set(Object.keys(schema.properties));

const targets = [
  // The main project: static portal + one serverless API function.
  { name: "vercel.json", path: resolve(REPO, "vercel.json"), servesApi: true },
  // The owner console: static only. It reaches Project 1 over CORS instead.
  {
    name: "packages/platform-web/vercel.json",
    path: resolve(REPO, "packages", "platform-web", "vercel.json"),
    servesApi: false
  }
];

for (const { name, path, servesApi } of targets) {
  console.log(`\n=== ${name} ===`);
  if (!existsSync(path)) {
    check(`${name} exists`, false);
    continue;
  }
  let raw = readFileSync(path, "utf8");
  const json = JSON.parse(raw);

  // Enum / type validation for the properties we actually rely on.
  for (const key of Object.keys(json)) {
    check(`"${key}" is a supported vercel.json property`, topLevel.has(key));
  }

  const fw = schema.properties.framework;
  if ("framework" in json) {
    const ok =
      json.framework === null ||
      (Array.isArray(fw.enum) ? fw.enum.includes(json.framework) : false);
    check("framework value is valid", ok, String(json.framework));
  }

  const fn = schema.properties.functions;
  if (json.functions) {
    for (const [glob, opts] of Object.entries(json.functions)) {
      const allowed = new Set(Object.keys(fn.patternProperties["^.{1,256}$"].properties));
      const bad = Object.keys(opts).filter((k) => !allowed.has(k));
      check(
        `functions["${glob}"] keys`,
        bad.length === 0,
        bad.length ? `unsupported: ${bad.join(", ")}` : Object.keys(opts).join(", ")
      );
    }
  }

// Rewrites must be well formed and, critically, ordered so that the SPA
    // catch-all can never shadow an API route.
    if (json.rewrites) {
      for (const r of json.rewrites) {
        check(
          `rewrite ${r.source} -> ${r.destination}`,
          typeof r.source === "string" && typeof r.destination === "string"
        );
      }
      const catchAll = json.rewrites.findIndex((r) => r.destination === "/index.html");
      check("a SPA catch-all exists", catchAll !== -1);
      if (servesApi) {
        const apiFirst = json.rewrites.findIndex((r) => r.destination === "/api/nexora-api");
        check(
          "API rewrites precede the SPA catch-all",
          apiFirst !== -1 && apiFirst < catchAll,
          `api@${apiFirst} catchall@${catchAll}`
        );
        // Raw-body guarantee: the webhook route must be reachable through a
        // rewrite, and no platform body parser may sit in front of it.
        const webhookCovered = json.rewrites.some(
          (r) => r.source.includes("/api/v1/:path*") && r.destination.includes("nexora-api")
        );
        check("webhook path is covered by the generic API rewrite", webhookCovered);
        check(
          "no platform body parser is configured (it would break webhook HMAC)",
          !("api" in json) || json.api?.bodyParser !== false,
          '"api" is not a valid vercel.json property — the app captures the raw body itself'
        );
      } else {
        const apiDest = json.rewrites.findIndex((r) => r.destination.includes("nexora-api"));
        check("static-only project does not route to the API function", apiDest === -1);
      }
    }

  check("file ends with a newline", raw.endsWith("\n"));
}

console.log(
  failures === 0 ? "\nALL VERCEL CONFIG CHECKS PASSED" : `\n${failures} VERCEL CONFIG CHECK(S) FAILED`
);
process.exit(failures === 0 ? 0 : 1);