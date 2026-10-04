@echo off
REM Lifecycle-owned full-suite run: PostgreSQL is started, proven, and kept
REM alive by this same script for the whole (long) run.
REM
REM The third argument is the evidence artifact the validator must find, fresh
REM and valid, before a GREEN can be reported.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"
call _verify.cmd suite "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_job_suite.cmd" "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\packages\server\_probe_out_suite.json" 200
