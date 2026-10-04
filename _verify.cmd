@echo off
REM ============================================================================
REM Runs a verification job with PostgreSQL's lifecycle owned by this script,
REM and PROVES the job ran before it is allowed to report success.
REM
REM PostgreSQL started here inherits THIS console, so it stays alive for as long
REM as this script runs: start -> wait -> execute -> validate. A later shell
REM teardown can therefore never kill the database mid-run.
REM
REM Usage: _verify.cmd <label> <job.cmd> <artifact> [minBytes]
REM   artifact = NONE  -> skip JSON-artifact checks (marker/log/exit still apply)
REM
REM WHY THIS EXISTS
REM   The previous version did:  call "!JOB!" > log 2>&1
REM                              echo EXITCODE=!ERRORLEVEL!
REM and nothing else. It appended EXITCODE=0 even when the job never ran and no
REM fresh artifact or log was produced, so a broken run was indistinguishable
REM from a passing one. Now EXITCODE is emitted ONLY by the validator, and the
REM validator requires proof the job ran and produced fresh, valid evidence.
REM ============================================================================
setlocal enabledelayedexpansion

set "LABEL=%~1"
set "JOB=%~2"
set "ART=%~3"
set "MINB=%~4"
if "%MINB%"=="" set "MINB=200"

set "ROOT=C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"
set "PGBIN=C:\Users\adede\nexora\.pg\16\bin"
set "PGDATA=C:\Users\adede\nexora\.pg\data"
set "OUTDIR=%ROOT%\_probe_out"
set "LOG=%OUTDIR%\%LABEL%-log.txt"
set "STATUS=%OUTDIR%\%LABEL%-status.txt"

REM ---- establish this run's identity BEFORE anything can produce artifacts ---
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(String(Date.now()))"`) do set "RUN_START_MS=%%i"
for /f "usebackq delims=" %%i in (`node -e "process.stdout.write(String(Date.now())+'-'+process.pid)"`) do set "HARNESS_RUN_ID=%%i"

echo START %date% %time% > "%STATUS%"
echo RUN_ID=!HARNESS_RUN_ID! >> "%STATUS%"
echo RUN_START_MS=!RUN_START_MS! >> "%STATUS%"

REM ---- freshness markers: destroy prior evidence up front --------------------
REM Anything found later MUST therefore have been created by this run.
if exist "%LOG%" del /f /q "%LOG%"
if not "%ART%"=="NONE" if exist "%ART%" del /f /q "%ART%"

netstat -ano | findstr ":5432" | findstr "LISTENING" > nul
if errorlevel 1 (
  echo [verify] starting PostgreSQL...
  if exist "%PGDATA%\postmaster.pid" del /f /q "%PGDATA%\postmaster.pid"
  "%PGBIN%\pg_ctl.exe" -D "%PGDATA%" -l "%OUTDIR%\pg-verify.log" -w -t 180 start >> "%STATUS%" 2>&1
  echo PECTL_EXIT=!ERRORLEVEL! >> "%STATUS%"
) else (
  echo [verify] PostgreSQL already listening
)

REM Apply pending migrations before the health probe. The journey harnesses run
REM through tsx rather than vitest, so vitest's globalSetup (which migrates) does
REM not run for them; without this a new migration is invisible to the journeys.
REM DATABASE_URL is pinned so migrate.ts does not fall back to the stale
REM nexora_dev database. It is published BEFORE any import that builds a Pool.
cd /d "%ROOT%\packages\server"
set "DATABASE_URL=postgres://nexora:nexora@localhost:5432/nexora_test"
call npx tsx src/db/migrate.ts >> "%STATUS%" 2>&1
echo MIGRATE_EXIT=!ERRORLEVEL! >> "%STATUS%"

REM Confirm readiness by actually connecting, not by assuming.
node _dbcheck.mjs >> "%STATUS%" 2>&1
set "DBCONNECT_EXIT=!ERRORLEVEL!"
echo DBCONNECT_EXIT=!DBCONNECT_EXIT! >> "%STATUS%"

REM The readiness probe is GATING, not advisory. Running a long suite against an
REM unreachable or wrongly-credentialed database produces failures that look
REM like product defects, so stop here instead of burning the run.
if not "!DBCONNECT_EXIT!"=="0" (
  echo ABORT health probe failed - refusing to run the job >> "%STATUS%"
  echo VERDICT=1 >> "%STATUS%"
  echo EXITCODE=1 >> "%STATUS%"
  echo END %date% %time% >> "%STATUS%"
  type "%OUTDIR%\%LABEL%-validation.txt" 2> nul
  exit /b 1
)

echo [verify] running job: !JOB!
call "!JOB!" > "%LOG%" 2>&1
set "JOB_EXIT=!ERRORLEVEL!"
echo JOB_EXIT=!JOB_EXIT! >> "%STATUS%"

REM ---- validate evidence. This is the ONLY source of the verdict. -----------
node "%ROOT%\_harness_validate.mjs" --run-start=!RUN_START_MS! --run-id=!HARNESS_RUN_ID! ^
  --log="%LOG%" --artifact="%ART%" --job-exit=!JOB_EXIT! --min-bytes=!MINB! > "%OUTDIR%\%LABEL%-validation.txt" 2>&1
set "VERDICT=!ERRORLEVEL!"

echo VERDICT=!VERDICT! >> "%STATUS%"
if "!VERDICT!"=="0" (echo EXITCODE=0 >> "%STATUS%") else (echo EXITCODE=1 >> "%STATUS%")
echo END %date% %time% >> "%STATUS%"

type "%OUTDIR%\%LABEL%-validation.txt"
if "!VERDICT!"=="0" exit /b 0
exit /b 1
