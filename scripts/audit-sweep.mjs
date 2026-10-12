import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const data = JSON.parse(readFileSync("docs/verification/vision-rules.json", "utf8"));

/* ---------- build a corpus of the repo's source ---------- */
const ROOT = ".";
const SKIP = new Set(["node_modules", "dist", ".git", "coverage", ".next", "build"]);
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (SKIP.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if ([".ts", ".tsx", ".js", ".mjs", ".sql", ".json", ".css", ".md"].includes(extname(e))) files.push(p);
  }
})(ROOT);

const corpus = [];
for (const f of files) {
  try {
    corpus.push({ path: f.replace(/\\/g, "/"), text: readFileSync(f, "utf8") });
  } catch {
    /* ignore unreadable */
  }
}

console.log("corpus files:", corpus.length);

const hits = (needles) => {
  const out = [];
  const pats = needles.map((n) => new RegExp(n, "i"));
  for (const f of corpus) {
    for (const p of pats) {
      const m = p.exec(f.text);
      if (m) {
        const line = f.text.slice(0, m.index).split(/\r?\n/).length;
        out.push({ path: f.path, line, match: m[0].slice(0, 90) });
        break;
      }
    }
  }
  return out;
};

writeFileSync(
  "docs/verification/_corpus-stats.json",
  JSON.stringify({ files: corpus.length, paths: corpus.map((c) => c.path) }, null, 2),
  "utf8"
);

/* ---------- Part 15 prohibitions: literal absence proofs ---------- */
const PROHIBITIONS = [
  ["Head Office portal", [/head[ _-]?office portal/i]],
  ["MD board not generated", [/company_provisioning|provisionCompany|md_board|createCompanyWithBoard/i]],
  ["Data before ritual", [/requireCompleteSession/g]],
  ["Initial password still valid", [/credential_state|initial_password_used|one[-_]?time/i]],
  ["Credential that cannot log in", [/issueInitialCredential|initialPassword|generateCredential/i]],
  ["Username != full name", [/username\s*[:=]\s*fullName|full_name.*username|usernameFromName|buildUsername/i]],
  ["Authenticator exemption", [/exempt.*authenticat|skip.*mfa|no_mfa|totp.*optional/i]],
  ["Manual money entry", [/createManualPayment|manualPaymentEntry|INSERT INTO payments\b/i]],
  ["Edit over money", [/updatePayment|UPDATE payments\b|UPDATE ledger_entries/i]],
  ["Delete over financial record", [/DELETE FROM (payments|ledger_entries|audit_entries|loans)\b/i]],
  ["Savings-only role", [/savings_officer|Savings Officer/i]],
  ["VA at registration", [/virtual.?account/i]],
  ["Upload/gallery photo", [/type=["']file["']|accept=["']image|uploadPhoto|fileUpload|multipart\/form-data/i]],
  ["Disburse without VA+schedule", [/disburs/i]],
  ["Duplicate customer on loan/portal", [/INSERT INTO customers\b/i]],
  ["Branch workplace password gate", [/branch[_-]?workplace|branchActor/i]],
  ["Worker sees HO looked at book", [/notify.*book|book.*notification/i]],
  ["Typed webhook URL", [/webhook_url|webhookUrl/i]],
  ["Provider activated w/o test", [/activate.*provider|testConnection|connection_test/i]],
  ["Non-MD provider change", [/md_approved|mdApproved|provider.*approve/i]],
  ["Provider secret displayed", [/api_key|apiKey|secret/i]],
  ["Fixed provider form", [/provider.*requirement|requirementSet|requirement_set/i]],
  ["Hard-coded company colour", [/#(?!fff|000|1[0-9a-f]{5})\b[0-9a-f]{6}\b/i]],
  ["Cross-company visibility", [/company_id/]],
  ["Platform brand in company workspace", [/powered by|poweredBy|nexora finance/i]],
  ["Dashboard off-engine", [/performance\/summary|calculatePerformanceSet/i]],
  ["Role rendered from another role", [/workspaceFor|descriptors/i]],
  ["Role page mismatch", [/descriptor/i]],
  ["Fake data in live view", [/lorem|sample[-_ ]?data|mock[-_ ]?data|dummyData|Faker|faker/i]],
  ["Owner view of company data", [/support_access|supportAccess|support session/i]],
  ["Worker record deleted on leaving", [/DELETE FROM users\b|deleteUser|hardDelete/i]],
];

const sweep = PROHIBITIONS.map(([name, pats]) => {
  const found = [];
  for (const f of corpus) {
    for (const p of pats) {
      const re = new RegExp(p.source, p.flags.includes("g") ? p.flags.replace("g", "") : p.flags);
      const m = re.exec(f.text);
      if (m) {
        found.push({ path: f.path, line: f.text.slice(0, m.index).split(/\r?\n/).length, match: m[0].slice(0, 100) });
      }
    }
  }
  return { name, occurrences: found.length, sample: found.slice(0, 8) };
});

writeFileSync("docs/verification/_prohibition-sweep.json", JSON.stringify(sweep, null, 2), "utf8");
for (const s of sweep) console.log(`${s.name}: ${s.occurrences} occurrences`);