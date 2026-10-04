@echo off
REM Phase 2 ISS-004 probe runner. Evidence is cleared first so a fresh report is
REM provable, and the evidence guard prevents a false green on a silent skip.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"
call _verify.cmd draft "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_job_draftrun.cmd"