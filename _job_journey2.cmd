@echo off
REM Phase 2 job: Platform Owner onboarding (journey1) THEN the role matrix
REM (journey2). journey2 builds on the company journey1 provisions, so the order
REM is mandatory.
REM
REM ISS-003 fix. Previously this runner called journey2 only, so Phase 2 reported
REM EXITCODE=0 while silently skipping the Platform Owner onboarding journey.
REM Two guards now make that impossible:
REM   1. expected evidence is DELETED before the run, so a stale report from an
REM      earlier run can never be mistaken for a fresh one;
REM   2. _evidence_guard.mjs re-checks every expected report afterwards and forces
REM      a non-zero exit if any is missing, empty or unmarked.
setlocal enabledelayedexpansion

set "OUT=C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_probe_out"
set "J1=!OUT!\independent-e2e.txt"
set "J2=!OUT!\independent-e2e-roles.txt"

echo [phase2] clearing prior evidence so freshness is provable...
if exist "!J1!" del /f /q "!J1!"
if exist "!J2!" del /f /q "!J2!"

cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"

REM ---- journey1: Platform Owner -> company -> fresh MD -> credential ritual ----
echo [phase2] running journey1 (Platform Owner onboarding)...
call npx tsx verify/journey1.ts
echo JOURNEY1_EXIT=!ERRORLEVEL!

REM ---- journey2: MD creates every Vision role, each credential really used ----
echo [phase2] running journey2 (role matrix)...
call npx tsx verify/journey2.ts
echo JOURNEY2_EXIT=!ERRORLEVEL!

REM ---- evidence gate: cannot finish green unless both journeys really ran ----
echo [phase2] verifying evidence...
node _evidence_guard.mjs "!J1!" "!J2!"
if errorlevel 1 (
  echo [phase2] EVIDENCE GATE FAILED - a required journey did not produce evidence
  endlocal & exit /b 9
)

echo [phase2] all required journeys executed and produced evidence
endlocal & exit /b 0