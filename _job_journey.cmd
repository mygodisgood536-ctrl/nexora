@echo off
REM Wraps the independent journey harness for the _verify.cmd lifecycle runner.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/journey1.ts
