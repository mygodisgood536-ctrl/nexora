param(
  [string]$DataDir = "$PSScriptRoot\..\..\.pg\data",
  [string]$PGBin = "$PSScriptRoot\..\..\.pg\16\bin",
  [int]$Port = 5432
)
$ErrorActionPreference = "Stop"

# PostgreSQL creates a separate process for every connection on Windows, and those
# processes inherit the postmaster's environment. A shell that has accumulated
# hostile variables (a very long PATH, an overridden SystemRoot, a tool's own
# runtime variables) makes every backend fail to initialise with
# STATUS_DLL_INIT_FAILED (0xC0000142) and the cluster shuts itself down on the
# first connection. Starting the postmaster from a deliberately minimal
# environment removes that class of failure entirely.
$launcher = Join-Path $PSScriptRoot "postgres-clean-env.cmd"

Write-Host "Starting PostgreSQL on port $Port from $DataDir with a clean environment."
& $launcher $DataDir $Port