@echo off
REM Lifecycle-owned verification run of the independent journey harness:
REM starts PostgreSQL if needed, proves it connects, then runs the harness.
cd /d "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored"
call _verify.cmd journey "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_job_journey.cmd"
