@echo off
REM Roles journey first (regenerates journey2-state.json), then the ops/isolation
REM journey which depends on it.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/journey2.ts
echo JOURNEY2_DONE
call npx tsx verify/journey3.ts
echo JOURNEY3_DONE