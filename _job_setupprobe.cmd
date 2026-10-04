@echo off
REM Durable probe: run the real global-setup and capture its stack trace.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/_global-setup-probe.ts