# start.ps1 -- start the xiangyu-xinxu API server, optionally in background with auto-restart.
#
#   .\start.ps1                 run in this console (Ctrl+C to stop)
#   .\start.ps1 -Background     run hidden, keeps running after you close the terminal
#   .\start.ps1 -Port 8010      use another port
#
# Background mode writes into .\logs\:
#   server.log     uvicorn output (UTF-8)
#   watchdog.log   one line per process exit: timestamp, exit code, uptime
#   watchdog.pid   pid of the supervising process
#
# Stop with: .\stop.ps1
#
# Notes
#   * .venv\Scripts\python.exe is used directly on purpose: running through
#     "uv run" adds a parent process and lets uv re-sync the environment, which
#     can break a long-running server.
#   * Output redirection goes through cmd.exe on purpose. PowerShell 5.1 turns a
#     native command's stderr into NativeCommandError records, and with
#     $ErrorActionPreference = 'Stop' the supervisor would die as soon as uvicorn
#     logs its first line (uvicorn logs to stderr).
#   * Keep this file ASCII-only: Windows PowerShell 5.1 reads .ps1 as ANSI unless
#     it carries a BOM.

param(
    [switch]$Background,
    [int]$Port = 0,
    # internal: this process is the watchdog loop
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

# ---------------------------------------------------------------- background
if ($Background) {
    # never start a second supervisor for the same port
    if (Test-Port $effectivePort) {
        "already running on port $effectivePort - use .\stop.ps1 first"
        return
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
        "started in background: http://127.0.0.1:$effectivePort  (watchdog pid=$($watch.Id))"
        "logs: $serverLog"
    } else {
        "watchdog started (pid=$($watch.Id)) but port $effectivePort is not listening yet."
        "check: $serverLog and $watchLog"
    }
    return
}

# ---------------------------------------------------------------- watchdog loop
if ($WatchDog) {
    # make python write UTF-8 into the redirected log file
    $env:PYTHONIOENCODING = 'utf-8'

    # starting a second watchdog while one is already serving would just produce a
    # bind error every 3 seconds; refuse early instead of looping
    if (Test-Port $effectivePort) {
        $line = "[{0}] port {1} is already in use, watchdog exits" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $effectivePort
        Add-Content -LiteralPath $watchLog -Value $line -Encoding utf8
        return
    }

    while ($true) {
        # single-file rotation so the log cannot grow forever
        if ((Test-Path -LiteralPath $serverLog) -and ((Get-Item -LiteralPath $serverLog).Length -gt 5MB)) {
            Move-Item -LiteralPath $serverLog -Destination "$serverLog.1" -Force
        }

        $startedAt = Get-Date
        # cmd.exe does the redirection: no PowerShell stream/error-record handling involved
        $inner = '"{0}" "{1}" >> "{2}" 2>&1' -f $python, $entry, $serverLog
        & cmd.exe /c $inner
        $code = $LASTEXITCODE

        $seconds = ((Get-Date) - $startedAt).TotalSeconds
        $line = "[{0}] run.py exited code={1} after {2:N0}s" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $code, $seconds
        Add-Content -LiteralPath $watchLog -Value $line -Encoding utf8

        # crashed immediately (bad config, port taken, db locked...)? do not spin
        if ($seconds -lt 5) { Start-Sleep -Seconds 15 } else { Start-Sleep -Seconds 3 }
    }
}

# ---------------------------------------------------------------- foreground
# Port already taken? Say it in one line instead of letting uvicorn dump
# "[Errno 10048] error while attempting to bind on address" after it has
# already printed a full startup banner (that looks like a crash, but it is
# just "another instance is already serving").
if (Test-Port $effectivePort) {
    "port $effectivePort is already in use - the service is probably already running."
    "  check:   curl http://127.0.0.1:$effectivePort/healthz"
    "  restart: .\stop.ps1; .\start.ps1"
    "  (or keep using the running instance; no need to start a second one)"
    exit 1
}

& cmd.exe /c ('"{0}" "{1}"' -f $python, $entry)
exit $LASTEXITCODE
