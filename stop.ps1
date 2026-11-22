# stop.ps1 -- stop the API server started by start.ps1.
#
#   .\stop.ps1              stop watchdog and the python listening on 8000
#   .\stop.ps1 -Port 8010   stop the one on another port
#
# Keep this file ASCII-only (Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM).

param(
    [int]$Port = 0
)

$root   = $PSScriptRoot
$logs   = Join-Path $root 'logs'
$pidFile = Join-Path $logs 'watchdog.pid'
$effectivePort = if ($Port -gt 0) { $Port } else { 8000 }

# 1. stop the watchdog first, otherwise it would immediately restart the server.
#    Find it by command line, so a lost/stale watchdog.pid cannot leave it running.
$self = $PID
$watchdogs = @()
$killedIds = @()
try {
    $watchdogs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.ProcessId -ne $self -and $_.CommandLine -like '*start.ps1*' -and $_.CommandLine -like '*-WatchDog*' }
} catch { }

foreach ($watchdog in $watchdogs) {
    Stop-Process -Id $watchdog.ProcessId -Force -ErrorAction SilentlyContinue
    "stopped watchdog pid=$($watchdog.ProcessId)"
    $killedIds += $watchdog.ProcessId
}

if (Test-Path -LiteralPath $pidFile) {
    $text = ((Get-Content -LiteralPath $pidFile -Raw) -replace '\s', '')
    if ($text -match '^\d+$') {
        $watchId = [int]$text
        if ($killedIds -notcontains $watchId) {
            $proc = Get-Process -Id $watchId -ErrorAction SilentlyContinue
            if ($proc) {
                Stop-Process -Id $watchId -Force -ErrorAction SilentlyContinue
                "stopped watchdog pid=$watchId"
            }
        }
    }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
} elseif ($killedIds.Count -eq 0) {
    "no watchdog found (foreground run?)"
}

# 2. stop whatever python still listens on the port
Start-Sleep -Milliseconds 300
$stopped = 0
Get-NetTCPConnection -LocalPort $effectivePort -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -like 'python*') {
        Stop-Process -Id $proc.Id -Force
        "stopped python pid=$($proc.Id)"
        $stopped++
    } else {
        "port $effectivePort is held by '$($proc.ProcessName)', left alone"
    }
}

Start-Sleep -Milliseconds 500
if (Get-NetTCPConnection -LocalPort $effectivePort -State Listen -ErrorAction SilentlyContinue) {
    "warning: port $effectivePort is still listening"
} else {
    "port $effectivePort is free"
}
