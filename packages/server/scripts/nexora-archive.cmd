@echo off
rem Vision RULE 20.4.1 - the archiver PostgreSQL invokes for every completed WAL
rem segment. It receives only the backup key file, which is held apart from
rem every application credential, and a run id so one restore has one manifest.
rem Every path is absolute because PostgreSQL runs this from its data directory.
rem The tool is a prebuilt bundle, so no transpiler sits in this hot path.
setlocal
set "BACKUP_KEY_FILE=C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server/config/backup.key"
set "BACKUP_POLICY_PATH=C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server/config/backup-policy.json"
set "BACKUP_WORK_ROOT=C:/NexoraBackup/work"
set "BACKUP_RUN_ID=wal-continuous"
"C:/Program Files/nodejs/node.exe" "C:/Users/adede/.cline/data/workspaces/chat/nexora-restored/packages/server/dist/backup/nexora-backup.mjs" archive %1 %2
exit /b %ERRORLEVEL%
