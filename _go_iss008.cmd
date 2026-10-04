@echo off
REM ISS-008 functional proof, launched detached so a console teardown cannot kill
REM it mid-run (the failure that invalidated earlier captures).
REM Writes to _probe_out\iss008-proof.txt and records the exit code.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"
set "OUT=_probe_out"
echo START %date% %time% > "%OUT%\iss008-status.txt"

REM Ensure PostgreSQL is up (lifecycle owned here, as with _verify.cmd).
netstat -ano | findstr ":5432" | findstr "LISTENING" > nul
if errorlevel 1 (
  if exist "C:\Users\adede\nexora\.pg\data\postmaster.pid" del /f /q "C:\Users\adede\nexora\.pg\data\postmaster.pid"
  "C:\Users\adede\nexora\.pg\16\bin\pg_ctl.exe" -D "C:\Users\adede\nexora\.pg\data" -l "%OUT%\pg-verify.log" -w -t 180 start >> "%OUT%\iss008-status.txt" 2>&1
)

cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
call npx tsx verify/iss008-proof.ts > "..\..\_probe_out\iss008-proof.txt" 2>&1
echo EXITCODE=%ERRORLEVEL% >> "%OUT%\iss008-status.txt"
echo END %date% %time% >> "%OUT%\iss008-status.txt"