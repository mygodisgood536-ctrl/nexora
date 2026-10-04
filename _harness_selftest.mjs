// Self-test for the verification harness.
//
// Purpose: prove a GREEN verdict is IMPOSSIBLE unless the job really ran and
// produced fresh, valid evidence. Each scenario breaks one guarantee and MUST
// yield a non-zero verdict. The last scenario proves zero is still returned for
// a genuine run.
//
// Scenarios 1/5/6 drive the real _verify.cmd, so the wrapper path itself is
// exercised - including the "wrapper finished but job never ran" case that
// originally produced a phantom EXITCODE=0.
// Scenarios 2/3/4 drive _harness_validate.mjs directly with crafted fixtures,
// isolating each artifact rule deterministically.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\nexora-restored';
const FIX = path.join(ROOT, '_probe_out', 'selftest');
const ART = path.join(FIX, 'stub-artifact.json');
const MAKER = path.join(FIX, 'make-artifact.mjs');
const VALID_JSON = JSON.stringify({
  success: true,
  numTotalTestSuites: 1,
  numPassedTestSuites: 1,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  testResults: [],
});

fs.mkdirSync(FIX, { recursive: true });

// Own result file, written incrementally and exclusively by this process.
// It must NOT also be the target of a shell stdout redirect: two independent
// file handles on one path race and silently clobber each other's writes.
const RESULT_LOG = path.join(ROOT, '_probe_out', 'selftest-result.txt');
fs.writeFileSync(RESULT_LOG, '');
const note = (s) => fs.appendFileSync(RESULT_LOG, s + '\n');

const W = (f, s) => fs.writeFileSync(f, s);

// A killed or hostile run must still leave a diagnosis behind, rather than an
// empty file that could be mistaken for "nothing to report".
process.on('uncaughtException', (e) => {
  note(`CRASH uncaughtException: ${e && e.stack ? e.stack : e}`);
  process.exit(70);
});
process.on('unhandledRejection', (e) => {
  note(`CRASH unhandledRejection: ${e && e.stack ? e.stack : e}`);
  process.exit(71);
});

function runValidator({ runStart, runId, jobExit, log, artifact }) {
  const args = [
    path.join(ROOT, '_harness_validate.mjs'),
    `--run-start=${runStart}`,
    `--run-id=${runId}`,
    `--log=${log}`,
    `--artifact=${artifact}`,
    `--job-exit=${jobExit}`,
    '--min-bytes=200',
  ];
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function runVerify(label, jobFile, artifact) {
  try {
    const out = execFileSync(
      'cmd.exe',
      ['/c', path.join(ROOT, '_verify.cmd'), label, jobFile, artifact, '200'],
      { encoding: 'utf8' }
    );
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const results = [];
// Persist each verdict the moment it is decided so that a mid-run death is
// attributable to one specific scenario instead of losing the whole run.
const check = (name, got, wantZero, detail) => {
  const pass = wantZero ? got === 0 : got !== 0;
  results.push({ name, pass, got, detail });
  note(`${pass ? 'PASS' : 'FAIL'}  ${name}  [${detail}]`);
  return pass;
};
const lastLine = (s) => s.trim().split('\n').pop().trim();

// PART2_MARKER
// --- scenario 2: log is stale / never rewritten ----------------------------
{
  const runStart = Date.now();
  const runId = 'selftest-stale';
  const log = path.join(FIX, 'stale-log.txt');
  const artifact = path.join(FIX, 'stale-artifact.json');
  W(log, `HARNESS_JOB_START ${runId}\nsome output\n`);
  W(artifact, VALID_JSON);
  // Log is timestamped an hour ago; artifact stays fresh, isolating the log rule.
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(log, old, old);
  const r = runValidator({ runStart, runId, jobExit: 0, log, artifact });
  check('2. log stale / not rewritten', r.code, false, lastLine(r.out));
}

// --- scenario 3: JSON artifact missing -------------------------------------
{
  const runStart = Date.now();
  const runId = 'selftest-missing';
  const log = path.join(FIX, 'missing-log.txt');
  const artifact = path.join(FIX, 'does-not-exist.json');
  W(log, `HARNESS_JOB_START ${runId}\nsome output\n`);
  if (fs.existsSync(artifact)) fs.unlinkSync(artifact);
  const r = runValidator({ runStart, runId, jobExit: 0, log, artifact });
  check('3. JSON artifact missing', r.code, false, lastLine(r.out));
}

// --- scenario 4: artifact empty, then invalid JSON -------------------------
{
  const runStart = Date.now();
  const runId = 'selftest-empty';
  const log = path.join(FIX, 'empty-log.txt');
  const artifact = path.join(FIX, 'empty-artifact.json');
  W(log, `HARNESS_JOB_START ${runId}\nsome output\n`);
  W(artifact, '');
  const r = runValidator({ runStart, runId, jobExit: 0, log, artifact });
  check('4a. artifact empty', r.code, false, lastLine(r.out));
}
{
  const runStart = Date.now();
  const runId = 'selftest-invalid';
  const log = path.join(FIX, 'invalid-log.txt');
  const artifact = path.join(FIX, 'invalid-artifact.json');
  W(log, `HARNESS_JOB_START ${runId}\nsome output\n`);
  W(artifact, '{ "numTotalTests": 12, "testResults": [ truncated');
  const r = runValidator({ runStart, runId, jobExit: 0, log, artifact });
  check('4b. artifact invalid JSON', r.code, false, lastLine(r.out));
}

// --- scenario 1: wrapper completes but the job never runs ------------------
{
  const silent = path.join(FIX, 'stub_silent.cmd');
  W(silent, '@echo off\r\nREM deliberately does nothing: no marker, no artifact\r\n');
  const r = runVerify('selftest-silent', silent, ART);
  check('1. job not executed', r.code, false, `_verify.cmd exit ${r.code}`);
}

// --- scenario 5: job really runs but exits non-zero ------------------------
{
  const fail = path.join(FIX, 'stub_fail.cmd');
  W(
    fail,
    '@echo off\r\n' +
      'echo HARNESS_JOB_START %HARNESS_RUN_ID%\r\n' +
      'echo running, producing valid evidence, then failing\r\n' +
      'node "' + MAKER + '" "' + ART + '"\r\n' +
      'exit /b 3\r\n'
  );
  const r = runVerify('selftest-fail', fail, ART);
  check('5. job exits non-zero', r.code, false, `_verify.cmd exit ${r.code}`);
}

// --- scenario 6: genuine run -> harness returns zero ----------------------
{
  const ok = path.join(FIX, 'stub_ok.cmd');
  W(
    ok,
    '@echo off\r\n' +
      'echo HARNESS_JOB_START %HARNESS_RUN_ID%\r\n' +
      'echo genuine run completed\r\n' +
      'node "' + MAKER + '" "' + ART + '"\r\n' +
      'exit /b 0\r\n'
  );
  const r = runVerify('selftest-ok', ok, ART);
  check('6. genuine run returns zero', r.code, true, `_verify.cmd exit ${r.code}`);
}

const failed = results.filter((r) => !r.pass);
note(
  `\n${results.length - failed.length}/${results.length} harness scenarios behaved correctly`
);
process.exit(failed.length === 0 ? 0 : 1);