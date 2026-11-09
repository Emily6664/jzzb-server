# start.ps1 -- start the API server and KEEP it running (background by default).
#
#   .\start.ps1                background + auto-restart; closing the terminal does not stop it
#   .\start.ps1 -Foreground    run in this console instead (Ctrl+C stops it, logs go to the console)
#   .\start.ps1 -Port 8010     another port
#   .\start.ps1 -WatchDog      internal: the supervisor loop (used by the background launch
#                              and by the scheduled task registered by service.ps1)
#
# Stop with: .\stop.ps1
# Background logs live in .\logs\:
#   server.log     uvicorn output (UTF-8)
#   watchdog.log   one line per process exit: timestamp, exit code, uptime
#   watchdog.pid   pid of the supervising process
#
# Notes
#   * .venv\Scripts\python.exe is used directly on purpose: "uv run" adds a parent process
#     and may re-sync the environment, which can break a long-running server.
#   * Output redirection goes through cmd.exe on purpose. PowerShell 5.1 turns a native
#     command's stderr into NativeCommandError; with a terminating error preference the
#     supervisor would die the moment uvicorn logs its first line (uvicorn logs to stderr).
#   * Keep this file ASCII-only: Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM.

param(
    [switch]$Foreground,
    # kept for compatibility: background is the default now
    [switch]$Background,
    [int]$Port = 0,
    # internal: this process is the supervising loop
    [switch]$WatchDog
)

$ErrorActionPreference = 'Continue'

$root   = $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$entry  = Join-Path $root 'run.py'
$logs   = Join-Path $root 'logs'

if (-not (Test-Path -LiteralPath $python)) {
    throw "venv not found: $python`nRun 'uv sync' in $root first."
}
if (-not (Test-Path -LiteralPath $entry)) {
    throw "run.py not found: $entry"
}

New-Item -ItemType Directory -Force -Path $logs | Out-Null
if ($Port -gt 0) { $env:PORT = "$Port" }

$effectivePort = if ($Port -gt 0) { $Port } else { 8000 }
$serverLog = Join-Path $logs 'server.log'
$watchLog  = Join-Path $logs 'watchdog.log'
$pidFile   = Join-Path $logs 'watchdog.pid'

function Test-Port([int]$port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $port); return $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}

# ---------------------------------------------------------------- supervisor loop
if ($WatchDog) {
    # make python write UTF-8 into the redirected log file
    $env:PYTHONIOENCODING = 'utf-8'

    # another supervisor already serving this port would just produce a bind error every
    # few seconds; refuse early instead of looping
    if (Test-Port $effectivePort) {
        $line = "[{0}] port {1} is already in use, watchdog exits" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $effectivePort
        Add-Content -LiteralPath $watchLog -Value $line -Encoding utf8
        return
    }

    # Record this process so .\stop.ps1 can stop the supervisor before the server; otherwise
    # the supervisor would simply restart run.py three seconds after it was killed.
    Set-Content -LiteralPath $pidFile -Value $PID -Encoding ascii
    try {
        while ($true) {
            # single-file rotation so the log cannot grow forever
            if ((Test-Path -LiteralPath $serverLog) -and ((Get-Item -LiteralPath $serverLog).Length -gt 5MB)) {
                Move-Item -LiteralPath $serverLog -Destination "$serverLog.1" -Force
            }

            $startedAt = Get-Date
            # cmd.exe performs the redirection: no PowerShell stream handling involved
            $inner = '"{0}" "{1}" >> "{2}" 2>&1' -f $python, $entry, $serverLog
            & cmd.exe /c $inner
            $code = $LASTEXITCODE

            $seconds = ((Get-Date) - $startedAt).TotalSeconds
            $line = "[{0}] run.py exited code={1} after {2:N0}s" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code, $seconds
            Add-Content -LiteralPath $watchLog -Value $line -Encoding utf8

            # crashed immediately (bad config, port taken, db locked...)? do not spin
            if ($seconds -lt 5) { Start-Sleep -Seconds 15 } else { Start-Sleep -Seconds 3 }
        }
    } finally {
        # only remove it if it is still ours
        if (Test-Path -LiteralPath $pidFile) {
            $current = ((Get-Content -LiteralPath $pidFile -Raw) -replace '\s', '')
            if ($current -eq "$PID") { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
        }
    }
}

# ---------------------------------------------------------------- foreground (debug)
if ($Foreground) {
    # Say it in one line instead of letting uvicorn dump "[Errno 10048] ..." after it has
    # already printed a full startup banner (that looks like a crash, it is just "already running").
    if (Test-Port $effectivePort) {
        "port $effectivePort is already in use - the service is probably already running."
        "  check:   curl http://127.0.0.1:$effectivePort/healthz"
        "  restart: .\stop.ps1; .\start.ps1 -Foreground"
        "  (or just keep using the running instance)"
        exit 1
    }

    & cmd.exe /c ('"{0}" "{1}"' -f $python, $entry)
    exit $LASTEXITCODE
}

# ---------------------------------------------------------------- background (default)
# Never start a second supervisor for the same port.
if (Test-Port $effectivePort) {
    "already running on port $effectivePort - nothing to do"
    "  health:  curl http://127.0.0.1:$effectivePort/healthz"
    "  stop:    .\stop.ps1"
    exit 0
}

$psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'start.ps1'), '-WatchDog')
if ($Port -gt 0) { $psArgs += @('-Port', "$Port") }

$watch = Start-Process -FilePath 'powershell.exe' -ArgumentList $psArgs -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidFile -Value $watch.Id -Encoding ascii

for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $effectivePort) { break }
}

if (Test-Port $effectivePort) {
    "started in background on http://127.0.0.1:$effectivePort  (watchdog pid=$($watch.Id))"
    "closing this terminal does NOT stop it. logs: $serverLog"
    "stop: .\stop.ps1    watchdog log: $watchLog"
} else {
    "watchdog started (pid=$($watch.Id)) but port $effectivePort is not listening yet."
    "check: $serverLog and $watchLog"
}
