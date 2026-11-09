# service.ps1 -- make the API start with Windows and stay running.
#
#   .\service.ps1 -Action install              autostart at logon via HKCU\...\Run (no admin needed)
#   .\service.ps1 -Action install -AtStartup   autostart at boot as SYSTEM (needs an admin shell)
#   .\service.ps1 -Action status               autostart entry + port + health + watchdog
#   .\service.ps1 -Action start                start it now
#   .\service.ps1 -Action stop                 stop the server (keeps autostart)
#   .\service.ps1 -Action remove               remove autostart and stop the server
#
# How it works
#   Default install writes one HKCU Run value:
#       HKCU\Software\Microsoft\Windows\CurrentVersion\Run  ->  xiangyu-api
#       "powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden
#                        -File <root>\start.ps1 -WatchDog
#   No admin rights, no Startup-folder write (Defender's Controlled Folder Access blocks that),
#   and no window in the tray: the launcher is hidden.
#
#   start.ps1 -WatchDog is a supervisor: it restarts run.py ~3s after it exits and appends
#   "[time] run.py exited code=... after Ns" to logs\watchdog.log. So the service survives
#   closing terminals, logging off and back on, and crashes.
#
#   -AtStartup registers a Task Scheduler entry instead (runs before logon, as SYSTEM).
#   That needs an elevated shell; without one it falls back to the HKCU Run value and says so.
#
# If you need a real Windows service (services.msc, no logon at all), use NSSM; see README 8.2.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM.

param(
    [ValidateSet('install', 'remove', 'start', 'stop', 'status')]
    [string]$Action = 'status',
    [switch]$AtStartup
)

$ErrorActionPreference = 'Continue'

$TaskName     = 'xiangyu-api'
$root         = $PSScriptRoot
$startScript  = Join-Path $root 'start.ps1'
$stopScript   = Join-Path $root 'stop.ps1'
$port         = 8000
$runKeyPath   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runValueName = 'xiangyu-api'

# old mechanism (Startup folder); cleaned up if present
$startupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'xiangyu-api.vbs'

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $powershell)) { $powershell = 'powershell.exe' }

$taskCommand = '"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}" -WatchDog' -f $powershell, $startScript

function Test-Port([int]$p) {
    $client = New-Object System.Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $p); return $client.Connected }
    catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Port([int]$seconds = 25) {
    for ($i = 0; $i -lt ($seconds * 2); $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-Port $port) { return $true }
    }
    return (Test-Port $port)
}

function Get-RunEntry {
    try {
        $item = Get-ItemProperty -Path $runKeyPath -Name $runValueName -ErrorAction Stop
        return $item.$runValueName
    } catch {
        return $null
    }
}

function Install-RunEntry {
    New-ItemProperty -Path $runKeyPath -Name $runValueName -Value $taskCommand -PropertyType String -Force | Out-Null
    return (Get-RunEntry)
}

function Get-TaskRegistered {
    $null = & schtasks /Query /TN $TaskName 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Show-State {
    $run = Get-RunEntry
    if ($run) {
        "autostart: ON  (HKCU Run '$runValueName', starts hidden at logon)"
    } elseif (Test-Path -LiteralPath $startupFile) {
        "autostart: ON  (Startup folder: $startupFile)"
    } else {
        "autostart: OFF (run: .\service.ps1 -Action install)"
    }

    "task    : $TaskName -> $(if (Get-TaskRegistered) { 'registered (boot/SYSTEM)' } else { 'not registered' })"

    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        "port    : $port LISTENING (pid $($conn.OwningProcess) $($proc.ProcessName))"
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$port/healthz" -UseBasicParsing -TimeoutSec 5
            "healthz : $($resp.StatusCode)"
        } catch {
            "healthz : FAILED - $($_.Exception.Message)"
        }
    } else {
        "port    : $port NOT listening"
    }

    $pidFile = Join-Path $root 'logs\watchdog.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $watchdogId = ((Get-Content -LiteralPath $pidFile -Raw) -replace '\s', '')
        if ($watchdogId -match '^\d+$') {
            $alive = [bool](Get-Process -Id ([int]$watchdogId) -ErrorAction SilentlyContinue)
            "watchdog: pid $watchdogId alive=$alive"
        }
    }
}

switch ($Action) {
    'install' {
        if (-not (Test-Path -LiteralPath $startScript)) { throw "start.ps1 not found: $startScript" }

        $mode = 'run'
        if ($AtStartup) {
            & schtasks /Create /TN $TaskName /TR $taskCommand /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $mode = 'task'
                "registered task '$TaskName': at boot, as SYSTEM"
            } else {
                "could not register the boot task (schtasks exit $LASTEXITCODE) - it needs an elevated shell."
                "falling back to the per-user autostart (starts at logon, still hidden and auto-restarted)."
            }
        }

        if ($mode -eq 'run') {
            $null = Install-RunEntry
            "installed autostart: HKCU\Software\Microsoft\Windows\CurrentVersion\Run\$runValueName"
            if (Test-Path -LiteralPath $startupFile) {
                Remove-Item -LiteralPath $startupFile -Force -ErrorAction SilentlyContinue
                "removed the old Startup-folder entry"
            }
        }

        # start it right now
        if (Test-Port $port) {
            "already serving on http://127.0.0.1:$port"
        } else {
            if ($mode -eq 'task') {
                & schtasks /Run /TN $TaskName | Out-Null
            } else {
                & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript | Out-Null
            }
            if (Wait-Port 25) {
                "service is serving on http://127.0.0.1:$port"
            } else {
                "started but port $port is not listening yet."
                "check: $root\logs\server.log and $root\logs\watchdog.log"
            }
        }
    }

    'remove' {
        Remove-ItemProperty -Path $runKeyPath -Name $runValueName -Force -ErrorAction SilentlyContinue
        "removed autostart value: HKCU Run '$runValueName'"

        if (Test-Path -LiteralPath $startupFile) {
            Remove-Item -LiteralPath $startupFile -Force -ErrorAction SilentlyContinue
            "removed autostart entry: $startupFile"
        }

        & schtasks /End /TN $TaskName 2>&1 | Out-Null
        & schtasks /Delete /TN $TaskName /F 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { "unregistered task '$TaskName'" }

        if (Test-Path -LiteralPath $stopScript) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript
        }
    }

    'start' {
        if (Test-Port $port) {
            "already serving on http://127.0.0.1:$port"
            return
        }
        if ($AtStartup -and (Get-TaskRegistered)) {
            & schtasks /Run /TN $TaskName | Out-Null
        } else {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript | Out-Null
        }
        if (Wait-Port 25) { "started, serving on http://127.0.0.1:$port" }
        else { "started but port $port is not listening - see logs\watchdog.log" }
    }

    'stop' {
        & schtasks /End /TN $TaskName 2>&1 | Out-Null
        if (Test-Path -LiteralPath $stopScript) {
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $stopScript
        }
    }

    'status' {
        Show-State
    }
}
