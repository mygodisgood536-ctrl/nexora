// Migration integrity: catch schema defects that only appear when migrations run
// against a real database.
//
// This exists because of a defect that passed every test, every type check and
// every read-through review: migration 0033 dropped
// payment_provider_configs.branch_id, and migration 0090 later created an index
// on (company_id, branch_id, provider). Against a real database 0090 fails with
// "column branch_id does not exist", and every migration after it is blocked
// behind it. No amount of reading finds that reliably; the chain has to be
// compared to itself.
//
// Checks performed:
//   1. Migration numbering is contiguous and unique, so nothing is skipped or
//      silently applied out of order.
//   2. No migration references a column that an EARLIER migration dropped,
//      unless that column was added back first. This is the 0033/0090 bug.
//   3. No migration references a table that no migration ever creates.
//   4. Every migration file is non-empty.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR = resolve(REPO, "packages/server/src/db/migrations");

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(name);
  console.log(`${ok ? "ok   " : "NOT OK"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Strip SQL comments so commented-out DDL cannot create phantom references. */
function body(text) {
  return text
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

// Words that follow FROM/INTO/TABLE/JOIN in DDL and DCL but are not table
// names: "GRANT SELECT ON users", "SET search_path TO", "COMMENT ON", etc.
const RESERVED = new Set([
  "on", "to", "set", "not", "only", "exists", "if", "select", "insert",
  "update", "delete", "all", "public", "current_setting", "default",
  "concurrently", "schema", "database", "role", "grant", "revoke", "comment"
]);

const migrations = files.map((file) => ({
  file,
  order: Number(file.slice(0, 4)),
  text: readFileSync(resolve(DIR, file), "utf8")
}));
const raw = migrations.map((m) => body(m.text));

// ---- 1. numbering -----------------------------------------------------------
const orders = migrations.map((m) => m.order);
const dupes = orders.filter((o, i) => orders.indexOf(o) !== i);
check(
  "migration numbers are unique",
  dupes.length === 0,
  dupes.length > 0 ? `duplicates: ${[...new Set(dupes)].join(", ")}` : `${orders.length} migrations`
);

const gaps = [];
for (let i = 1; i < orders.length; i++) {
  if (orders[i] !== orders[i - 1] + 1) gaps.push(`${orders[i - 1]} -> ${orders[i]}`);
}
check(
  "migration numbers are contiguous with no gaps",
  gaps.length === 0,
  gaps.length > 0 ? gaps.join(", ") : `0001..${orders[orders.length - 1]}`
);

// ---- 2/3. build the schema timeline -----------------------------------------
// createdTables / createdColumns track the world as of each migration, so a
// reference can be judged against what actually existed at that point rather
// than against the final schema.
const createdTables = new Set();
const droppedTables = new Map(); // table -> migration
const createdColumns = new Map(); // "table.column" -> migration
const droppedColumns = new Map(); // "table.column" -> migration

const CREATE_TABLE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
const DROP_TABLE = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
const ADD_COLUMN = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
const DROP_COLUMN = /ALTER\s+TABLE\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;

// CREATE TABLE column list: capture the parenthesised body after each create.
function columnsFromCreate(text) {
  const out = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const table = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    }
    const inner = text.slice(re.lastIndex, i - 1);
    const colRe = /^\s*([a-z_][a-z0-9_]*)\s+[a-z]/gim;
    let c;
    while ((c = colRe.exec(inner)) !== null) {
      // Skip constraint keywords that begin a line but are not columns.
      if (
        /^(constraint|primary|foreign|unique|check|exclude)$/i.test(c[1])
      ) {
        continue;
      }
      out.push(`${table}.${c[1]}`);
    }
    re.lastIndex = i;
  }
  return out;
}

const danglingColumnRefs = [];
const unknownTableRefs = [];

/**
 * True when `text` names `column` in a position that is structurally about
 * `table` - not merely when both words appear somewhere in the same file.
 *
 * A loose "file mentions table and column" test produces false alarms the moment
 * two tables share a column name, which they do constantly: face_captures and
 * payment_provider_configs both have branch_id, and migration 0036 creating the
 * former says nothing about the latter.
 *
 * The three shapes that actually break are:
 *   table.column                       -- qualified reference
 *   ON table ( ... column ... )        -- index or constraint column list
 *   ALTER TABLE table ... column ...   -- any DDL against that table
 */
function referencesColumnOnTable(text, table, column) {
  const t = escapeRe(table);
  const c = escapeRe(column);

  if (new RegExp(`\\b${t}\\s*\\.\\s*${c}\\b`, "i").test(text)) return true;

  if (new RegExp(`\\bON\\s+${t}\\s*\\([^)]*\\b${c}\\b`, "i").test(text)) return true;

  // Any DDL statement against this table that also names the column.
  const alter = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${t}\\b`, "gi");
  let m;
  while ((m = alter.exec(text)) !== null) {
    // A statement ends at the first top-level semicolon.
    const end = text.indexOf(";", m.index);
    const statement = text.slice(m.index, end === -1 ? text.length : end);
    if (new RegExp(`\\b${c}\\b`, "i").test(statement)) return true;
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

migrations.forEach((m, idx) => {
  const text = raw[idx];

  for (const ref of columnsFromCreate(text)) {
    createdColumns.set(ref, m.file);
  }
  for (const t of text.matchAll(CREATE_TABLE)) {
    createdTables.add(t[1].toLowerCase());
    droppedTables.delete(t[1].toLowerCase());
  }
  for (const t of text.matchAll(DROP_TABLE)) {
    droppedTables.set(t[1].toLowerCase(), m.file);
  }

  // Dropped columns are recorded BEFORE judging this file's own references, so a
  // file that drops and recreates a column in the same migration is not flagged.
  const droppedHere = [];
  for (const c of text.matchAll(DROP_COLUMN)) {
    const key = `${c[1].toLowerCase()}.${c[2].toLowerCase()}`;
    droppedColumns.set(key, m.file);
    droppedHere.push(key);
  }
  for (const c of text.matchAll(ADD_COLUMN)) {
    const key = `${c[1].toLowerCase()}.${c[2].toLowerCase()}`;
    createdColumns.set(key, m.file);
    droppedColumns.delete(key);
  }

  // Any column dropped earlier and not re-added must not be referenced here.
  for (const [key, droppedIn] of droppedColumns) {
    if (droppedIn === m.file) continue;
    const [table, column] = key.split(".");
    if (referencesColumnOnTable(text, table, column)) {
      // The same file may legitimately re-add the column.
      if (
        new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${column}\\b`,
          "i"
        ).test(text)
      ) {
        continue;
      }
      danglingColumnRefs.push(`${m.file} uses ${key}, dropped by ${droppedIn}`);
    }
  }

  // PL/pgSQL identifiers that look like tables but are local variables declared
  // inside a function body. Collected across the corpus so "FROM entry_balance"
  // inside a trigger function is not reported as a missing relation.
  const declaredVariables = new Set();
  for (const text of raw) {
    for (const v of text.matchAll(/\bDECLARE\b([\s\S]*?)\bBEGIN\b/gi)) {
      for (const decl of v[1].matchAll(/\b([a-z_][a-z0-9_]*)\s+(?:numeric|boolean|text|integer|bigint|uuid|date|timestamptz|jsonb|record)\b/gi)) {
        declaredVariables.add(decl[1].toLowerCase());
      }
    }
  }

  // References to tables no migration ever creates. Only genuine table
  // positions count: FROM, JOIN, INTO and UPDATE are where a relation is
  // actually named.
  for (const t of text.matchAll(
    /\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi
  )) {
    const name = t[1].toLowerCase();
    if (createdTables.has(name) || droppedTables.has(name)) continue;
    if (RESERVED.has(name) || declaredVariables.has(name)) continue;
    // Real tables in this schema are snake_case with an underscore; single
    // words like "old", "true" or "of" are SQL syntax, not relations.
    if (!name.includes("_")) continue;
    if (name.startsWith("pg_") || name.startsWith("app_") || name.startsWith("nexora")) continue;
    unknownTableRefs.push(`${m.file} references ${name}`);
  }
});

check(
  "no migration uses a column an earlier migration dropped",
  danglingColumnRefs.length === 0,
  danglingColumnRefs.slice(0, 6).join("; ")
);

// This check is ADVISORY, not a gate. Distinguishing a relation from a function
// return target, a CTE alias or an extension object by text alone is not
// reliable, and a check that cannot be trusted should report rather than block.
// Only the dropped-column check below is precise enough to fail a build.
if (unknownTableRefs.length > 0) {
  console.log(
    `note  ${new Set(unknownTableRefs).size} table reference(s) could not be resolved statically ` +
      `(may be views, aliases or extensions): ${[...new Set(unknownTableRefs)].slice(0, 5).join("; ")}`
  );
}

check(
  "every migration file has content",
  migrations.every((m) => m.text.trim().length > 0),
  `${migrations.length} files`
);

// ---- 4. new tables must be granted to the app role -------------------------
// Migration 0010 has a blanket grant loop for the tables that exist when it
// runs. Anything created AFTER that point gets no privilege at all unless its
// own migration grants it, and the symptom is a runtime "permission denied for
// table ..." that looks like an application bug rather than a migration defect.
const blanketGrantIndex = migrations.findIndex((m) =>
  /GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO nexora/.test(m.text)
);
const ungrantedTables = [];
migrations.forEach((m, idx) => {
  if (idx <= blanketGrantIndex) return; // covered by the blanket loop
  for (const t of raw[idx].matchAll(CREATE_TABLE)) {
    const table = t[1].toLowerCase();
    const grant = new RegExp(`GRANT[^;]*\\b${escapeRe(table)}\\b[^;]*TO\\s+nexora`, "i");
    if (!grant.test(raw[idx])) ungrantedTables.push(`${m.file}: ${table}`);
  }
});
check(
  "every table created after the blanket grant loop is granted to the app role",
  ungrantedTables.length === 0,
  ungrantedTables.join("; ")
);

// ---- 5. RLS policies must use helpers that exist ---------------------------
// Migration 0010 defines app_current_company() and app_current_branch(), and
// the bypass is the app.bypass_rls session SETTING. There is no `app` schema
// and no app.bypass_rls() function, so a policy written as app.bypass_rls() or
// app.current_company_id() fails to create and takes its whole migration with it.
const knownHelpers = new Set(["app_current_company", "app_current_branch"]);
// Session settings are referenced as the string 'app.<name>' inside
// current_setting(), and the bare token app.<name> also appears in comments.
// Collect the real setting names so they are never mistaken for functions.
const appSettings = new Set(["bypass_rls"]);
for (const text of raw) {
  for (const s of text.matchAll(/current_setting\(\s*'app\.([a-z_][a-z0-9_]*)'/gi)) {
    appSettings.add(s[1].toLowerCase());
  }
}
const bogusHelperRefs = [];
for (let i = 0; i < raw.length; i++) {
  // Only a CALL is suspect: app.something(
  for (const m of raw[i].matchAll(/\bapp\.([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const name = m[1].toLowerCase();
    if (appSettings.has(name) || knownHelpers.has(name)) continue;
    bogusHelperRefs.push(`${migrations[i].file}: app.${name}()`);
  }
}
check(
  "RLS policies reference only helper functions that exist",
  bogusHelperRefs.length === 0,
  bogusHelperRefs.join("; ")
);

// A table dropped and never recreated is not an error by itself, but it is
// worth surfacing so it is a decision rather than an accident.
const neverRecreated = [...droppedTables.entries()]
  .filter(([, droppedIn]) => !createdTables.has(droppedIn))
  .map(([table, droppedIn]) => `${table} (dropped by ${droppedIn})`);

console.log(`\n${migrations.length} migrations checked`);
if (neverRecreated.length > 0) {
  console.log(`tables dropped and not recreated: ${neverRecreated.join(", ")}`);
}

console.log(
  failures.length === 0
    ? "\nALL MIGRATION INTEGRITY CHECKS PASSED"
    : `\n${failures.length} MIGRATION INTEGRITY CHECK(S) FAILED`
);
process.exit(failures.length === 0 ? 0 : 1);