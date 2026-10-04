// Evidence validator for _verify.cmd.
//
// The contract: exit 0 if and only if the job genuinely executed during THIS
// run and produced fresh, valid, non-empty evidence. Any other outcome exits
// non-zero. This is the single place a GREEN verdict may be produced, so that
// a wrapper exit code can never manufacture a pass on its own.
//
// Invoked as:
//   node _harness_validate.mjs --run-start=<epochMs> --run-id=<id> --log=<p>
//                              --artifact=<p> --job-exit=<n> [--min-bytes=N]
//
// Why each check exists (each one corresponds to a real observed failure):
//   1. marker present + matching run-id  -> proves the JOB ran, not the wrapper
//   2. log exists, non-empty, fresh      -> proves output was rewritten here
//   3. artifact exists, non-empty, fresh -> proves evidence is not a leftover
//   4. artifact parses as JSON           -> proves it is not truncated/garbage
//   5. artifact has real test counts     -> proves it describes an actual run
//   6. job-exit == 0                     -> proves the job itself succeeded

import fs from 'node:fs';

const argv = {};
for (const raw of process.argv.slice(2)) {
  const eq = raw.indexOf('=');
  if (raw.startsWith('--') && eq > 2) argv[raw.slice(2, eq)] = raw.slice(eq + 1);
}

const runStart = Number(argv['run-start']);
const runId = argv['run-id'];
const logPath = argv.log;
const artifactPath = argv.artifact;
const jobExit = Number(argv['job-exit']);
const minBytes = Number(argv['min-bytes'] ?? '200');

const failures = [];
const notes = [];
const fail = (m) => failures.push(m);
const pass = (m) => notes.push('OK   ' + m);

// Filesystem timestamps can be slightly coarser than Date.now(), so allow a
// small negative tolerance. It is tiny compared with any real run duration,
// so it cannot let a previous run's artifact pass as fresh.
const TOLERANCE_MS = 2000;
const fresh = (p) => {
  const mtime = fs.statSync(p).mtimeMs;
  return {
    ok: Number.isFinite(runStart) && mtime >= runStart - TOLERANCE_MS,
    age: Number.isFinite(runStart) ? Math.round(runStart - mtime) : NaN,
  };
};

// --- 1. the job must prove it started, with this run's id -------------------
if (!runId) {
  fail('no run-id supplied: wrapper did not establish a run identity');
} else {
  let logText = '';
  try {
    logText = fs.readFileSync(logPath, 'utf8');
  } catch {
    /* handled by check 2 */
  }
  if (logText.includes(`HARNESS_JOB_START ${runId}`)) {
    pass(`job started and announced run-id ${runId}`);
  } else {
    fail(
      `job never announced HARNESS_JOB_START ${runId}: the job did not run ` +
        `(or ran outside the harness). A wrapper completing is NOT a job running.`
    );
  }
}

// --- 2. the log must exist, be non-empty, and be rewritten this run ----------
if (!fs.existsSync(logPath)) {
  fail(`log missing: ${logPath} (job produced no log at all)`);
} else {
  const st = fs.statSync(logPath);
  if (st.size === 0) fail(`log is empty: ${logPath}`);
  else pass(`log non-empty (${st.size} bytes)`);

  const f = fresh(logPath);
  if (!f.ok) fail(`log is stale: not rewritten this run (age ${f.age}ms) - evidence belongs to a previous run`);
  else pass(`log rewritten this run`);
}

// --- 3. the JSON artifact must exist, be non-empty, and be fresh ------------
let artifact = null;
if (!fs.existsSync(artifactPath)) {
  fail(`artifact missing: ${artifactPath} (vitest JSON reporter wrote nothing)`);
} else {
  const st = fs.statSync(artifactPath);
  if (st.size < minBytes) fail(`artifact too small (${st.size} bytes < ${minBytes}) - likely truncated or empty`);
  else pass(`artifact non-empty (${st.size} bytes)`);

  const f = fresh(artifactPath);
  if (!f.ok) fail(`artifact is stale: not written this run (age ${f.age}ms) - would be reporting a previous run`);
  else pass(`artifact written this run`);

  // --- 4/5. it must parse and describe a real test run ---------------------
  if (st.size >= minBytes) {
    try {
      artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      pass('artifact is valid JSON');
    } catch (e) {
      fail(`artifact is not valid JSON: ${e.message}`);
    }
    if (artifact) {
      const nums = ['numTotalTestSuites', 'numTotalTests', 'numPassedTests', 'numFailedTests'];
      for (const k of nums) {
        if (typeof artifact[k] !== 'number' || !Number.isFinite(artifact[k])) {
          fail(`artifact lacks numeric "${k}" - not a vitest results document`);
        }
      }
      if (!Array.isArray(artifact.testResults)) fail('artifact lacks testResults[] array');
      if (typeof artifact.numTotalTests === 'number' && artifact.numTotalTests <= 0) {
        fail('artifact reports zero total tests - the suite did not actually execute');
      }
      if (typeof artifact.numTotalTestSuites === 'number' && artifact.numTotalTestSuites <= 0) {
        fail('artifact reports zero test suites - the suite did not actually execute');
      }
      if (typeof artifact.numTotalTests === 'number' && typeof artifact.numPassedTests === 'number') {
        notes.push(
          `INFO suites ${artifact.numPassedTestSuites}/${artifact.numTotalTestSuites} ` +
            `tests ${artifact.numPassedTests}/${artifact.numTotalTests} failed ${artifact.numFailedTests}`
        );
      }
    }
  }
}

// --- 6. the job itself must have succeeded ----------------------------------
if (jobExit !== 0) {
  fail(`job exited non-zero (${jobExit}) - the verification job itself failed`);
} else {
  pass('job exited 0');
}

const report = [
  `=== harness validation ${runId ?? '(no run id)'} ===`,
  ...notes,
  ...(failures.length ? failures.map((f) => 'FAIL ' + f) : []),
  `=== ${failures.length === 0 ? 'GREEN' : 'RED'} (${failures.length} failure(s)) ===`,
].join('\n');

console.log(report);
process.exit(failures.length === 0 ? 0 : 1);