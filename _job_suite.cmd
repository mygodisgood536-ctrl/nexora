@echo off
REM Full suite as a lifecycle-owned job (PostgreSQL stays up for its duration).
REM
REM The `default` reporter is TTY-oriented and, under redirection, has silently
REM produced NO summary at all while still exiting 1 - which made a broken run
REM indistinguishable from a passing one. The JSON reporter always writes a
REM complete machine-readable document, so the counts are trustworthy evidence
REM and _harness_validate.mjs can prove the file is fresh and valid.
REM
REM --no-file-parallelism is deliberately NOT used: forcing every suite into one
REM process deadlocked (measured: every node process sat below 4s CPU for 45
REM minutes while still running). Parallel execution is the configuration under
REM which the established 38-file / 298-test baseline was green.
REM
REM maxWorkers bounds CONCURRENCY, it does not disable file parallelism. With the
REM default (CPUs-1 workers on this 4-CPU host) the run was killed outright:
REM vitest exited -1 with no output at all, no artifact, and nothing in the
REM Windows Application event log. The machine has ~1.5GB free of 8GB, and each
REM worker loads the server plus tsx. Capping concurrent workers keeps file-level
REM parallelism (so the deadlock cannot come back) while staying inside the
REM memory budget.
REM
REM The json reporter is the evidence artifact. The default reporter is kept
REM alongside it so that a crash still leaves human-readable progress in the log
REM instead of an empty file.
REM
REM Announce the run so the harness can PROVE this job executed (not just that
REM the wrapper finished). HARNESS_RUN_ID is set by _verify.cmd.
echo HARNESS_JOB_START %HARNESS_RUN_ID%
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx vitest run --maxWorkers=2 --minWorkers=1 --reporter=json --reporter=default --outputFile=_probe_out_suite.json
echo VITEST_EXIT=%ERRORLEVEL%
exit /b %ERRORLEVEL%
