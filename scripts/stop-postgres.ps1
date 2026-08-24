$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
& "$root\.pg\16\bin\pg_ctl.exe" -D "$root\.pg\data" stop -m fast
