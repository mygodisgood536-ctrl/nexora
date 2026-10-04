@echo off
REM Full server suite. Detached launcher writes explicit start/end/exit markers.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server"
del /f /q "..\..\_probe_out\runS-status.txt" > nul 2>&1
echo START %date% %time% > ..\..\_probe_out\runS-status.txt
call npx vitest run --reporter=default > ..\..\_probe_out\runS.log 2>&1
echo EXITCODE=%ERRORLEVEL% >> ..\..\_probe_out\runS-status.txt
echo END %date% %time% >> ..\..\_probe_out\runS-status.txt
