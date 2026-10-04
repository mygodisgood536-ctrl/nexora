@echo off
REM PHASE 2 / ISS-004 probe: drive RULE 3.3.3 draft-company behaviour.
REM Verification only - no product code is touched.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/p2-draft-probe.ts
echo PROBE_EXIT=%ERRORLEVEL%