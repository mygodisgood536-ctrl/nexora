@echo off
REM Runs the harness self-test. This is run BEFORE trusting any GREEN, so the
REM harness must prove it cannot manufacture a pass.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"

REM stdout goes to its OWN file. The script writes selftest-result.txt itself;
REM pointing a shell redirect at that same path gave two file handles on one
REM file and silently lost output.
node _harness_selftest.mjs > "_probe_out\selftest-stdout.txt" 2>&1
echo SELFTEST_EXIT=%ERRORLEVEL% >> "_probe_out\selftest-result.txt"
exit /b %ERRORLEVEL%