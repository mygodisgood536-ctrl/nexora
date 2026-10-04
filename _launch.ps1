# Launches a .cmd fully detached via WMI Win32_Process.Create.
#
# Why WMI: a process started with `start`/Start-Process is a child of the shell
# that the tool tears down when a later command is issued, so it dies with it.
# WMI creates the process parented by the WMI provider host, so it outlives the
# shell session entirely. It also lets us CAPTURE the new PID for health checks.
#
# This script never kills anything. It only creates and reports.
param(
  [Parameter(Mandatory = $true)][string]$CmdPath,
  [string]$Tag = "job"
)

if (-not (Test-Path $CmdPath)) { Write-Output "MISSING: $CmdPath"; exit 1 }

$full = (Resolve-Path $CmdPath).Path
$line = 'cmd.exe /c "' + $full + '"'

$proc = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $line }
$out = "C:\Users\adede\.cline\data\workspaces\chat\nexora-restored\_probe_out\launch-$Tag.txt"
if ($proc.ReturnValue -eq 0) {
  "LAUNCHED $Tag pid=$($proc.ProcessId) cmd=$full" | Set-Content $out
  Write-Output "LAUNCHED $Tag pid=$($proc.ProcessId)"
} else {
  "FAILED $Tag ReturnValue=$($proc.ReturnValue)" | Set-Content $out
  Write-Output "FAILED $Tag ReturnValue=$($proc.ReturnValue)"
}
