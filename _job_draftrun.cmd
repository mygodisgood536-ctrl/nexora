@echo off
REM Wraps the draft probe with a freshness gate: the report is deleted first, the
REM probe runs, then the evidence guard proves the report was actually produced.
setlocal enabledelayedexpansion
set "OUT=C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_probe_out"
set "REP=!OUT!\p2-draft-probe.txt"

if exist "!REP!" del /f /q "!REP!"

cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/p2-draft-probe.ts
echo PROBE_EXIT=!ERRORLEVEL!

node _evidence_guard.mjs "!REP!"
if errorlevel 1 (
  echo [draft] EVIDENCE GATE FAILED
  endlocal & exit /b 9
)
endlocal & exit /b 0