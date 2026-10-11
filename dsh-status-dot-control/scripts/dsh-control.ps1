param(
  [string]$Action = 'status',
  [string]$AppPath = '',
  [string]$ProcessName = 'DeepSeek Harness',
  [int]$DelaySeconds = 0,
  [int]$Port = 0,
  [switch]$DryRun
)

# dsh-control.ps1 -- the generic control handler shipped with
# dsh-status-dot-control. It is what makes the control edition install-and-use:
# no protocol handler to register, no script of your own to write.
#
# It is started by the sibling dsh-control.vbs (which the server half fires with
# wscript, so the action outlives the app it stops). Actions:
#   start    launch the app (exe discovered from the running process, a known
#            install folder, or config appPath)
#   stop     ONE force sweep of every process of the app (see below)
#   restart  schedule the relaunch first, then stop -- so the app always comes
#            back even though this script may die with it
#   logs     open the folder holding this script's log
#   status   report what was discovered (safe; used by tests and probes)
#
# Why ONE sweep on stop: the app's main process, its --type= helpers and its host
# child all share the image name, and the host child is the only one that listens
# on a port. Killing just the listener leaves the shell alive, and a shell whose
# host died renders the "app quit unexpectedly" recovery dialog (measured
# 2026-10-11). A single Stop-Process call takes the tree down together and never
# leaves that half-dead moment.
#
# ASCII only on purpose (PowerShell 5.1 without a BOM mangles non-ASCII text).

$ErrorActionPreference = 'Continue'

$logRoot = Join-Path $env:USERPROFILE '.dsh'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$log = Join-Path $logRoot 'dsh-status-dot-control.log'

function Note($m) { "$(Get-Date -Format 'MM-dd HH:mm:ss')  $m" | Out-File -FilePath $log -Append -Encoding UTF8 }

# Port liveness via netstat rather than Get-NetTCPConnection: the cmdlet returns
# nothing in some hosts even while netstat shows the listener, and a false "not
# listening" here would mean a destroyed service with no relaunch.
function Listening($port) {
  foreach ($l in @(netstat -ano -p TCP 2>$null)) {
    if ($l -match (':' + $port + '\s') -and $l -match 'LISTENING') { return $true }
  }
  return $false
}

function Get-AppProcesses {
  return @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
}

function Resolve-AppExe {
  if ($AppPath -ne '' -and (Test-Path -LiteralPath $AppPath)) { return $AppPath }
  foreach ($p in @(Get-AppProcesses)) {
    try { if ($p.Path -and (Test-Path -LiteralPath $p.Path)) { return $p.Path } } catch { }
  }
  $roots = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})
  $names = @('DeepSeek Harness', 'deepseek-harness', 'DeepSeek-Harness')
  foreach ($root in $roots) {
    if (-not $root) { continue }
    foreach ($sub in @('Programs', '')) {
      foreach ($n in $names) {
        $dir = if ($sub -eq '') { Join-Path $root $n } else { Join-Path (Join-Path $root $sub) $n }
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $exe = Get-ChildItem -LiteralPath $dir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'DeepSeek|Harness|dsh' } | Select-Object -First 1
        if ($exe) { return $exe.FullName }
      }
    }
  }
  return ''
}

function Stop-App {
  $procs = @(Get-AppProcesses)
  if ($procs.Count -eq 0) {
    # No process matched -- which is NOT the same as "nothing is running": the
    # service may be alive under another image name (config.processName). When
    # the caller told us which port it is serving, say so instead of quietly
    # reporting success.
    if ($Port -gt 0 -and (Listening $Port)) {
      Note ('  FAIL no app process named "' + $ProcessName + '" to stop, but port ' + $Port + ' is still listening -- check config.processName')
    } else {
      Note '  no app process to stop'
    }
    return
  }
  $ids = @($procs | ForEach-Object { [int]$_.Id })
  Note ('  stopping app pids (single sweep): ' + ($ids -join ','))
  if ($DryRun) { Note '  dry run: nothing was killed'; return }
  Stop-Process -Id $ids -Force -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline -and @(Get-AppProcesses).Count -gt 0) { Start-Sleep -Milliseconds 300 }
  $left = @(Get-AppProcesses)
  if ($left.Count -gt 0) {
    Note ('  force killing leftovers: ' + (($left | ForEach-Object { $_.Id }) -join ','))
    $left | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Note ('  done, app processes = ' + @(Get-AppProcesses).Count)
}

function Start-App {
  if (@(Get-AppProcesses).Count -gt 0) { Note '  app already running'; return }
  $exe = Resolve-AppExe
  if ($exe -eq '') {
    Note '  FAIL no app executable found -- set config appPath, or start the app yourself'
    return
  }
  Note ('  launching ' + $exe)
  if ($DryRun) { Note '  dry run: nothing was launched'; return }
  Start-Process -FilePath $exe -ErrorAction SilentlyContinue
}

function Wait-AppGone([int]$seconds) {
  # The relaunch is scheduled BEFORE the stop (this script may die with the app),
  # so it must not start while the old processes still hold the port: Start-App
  # would answer 'already running' and the restart would leave nothing up.
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline -and @(Get-AppProcesses).Count -gt 0) { Start-Sleep -Milliseconds 400 }
  return (@(Get-AppProcesses).Count -eq 0)
}

function Schedule-Relaunch([int]$delay) {
  $vbs = Join-Path $PSScriptRoot 'dsh-control.vbs'
  if (-not (Test-Path -LiteralPath $vbs)) { Note ('  FAIL missing ' + $vbs); return }
  $line = '"' + $vbs + '" "meowdsh://relaunch" "' + $AppPath + '" "' + $ProcessName + '" ' + $delay
  Note ('  scheduling relaunch in ' + $delay + 's (wscript, detached)')
  if ($DryRun) { Note ('  dry run: would run wscript.exe ' + $line); return }
  Start-Process -FilePath 'wscript.exe' -ArgumentList $line -WindowStyle Hidden
}

$act = $Action.ToLowerInvariant()

# One line per run, so the log proves what the caller actually passed (the .vbs
# forwards config appPath / processName / delay as positional arguments).
Note ('  action=' + $act + '; processName=' + $ProcessName + '; appPath=' + $(if ($AppPath -eq '') { '(auto)' } else { $AppPath }) + '; delay=' + $DelaySeconds + '; port=' + $Port + $(if ($DryRun) { '; dryRun' } else { '' }))

if ($AppPath -match '"' -or $ProcessName -match '"') {
  # A double quote in either value tears the argv list apart (the .vbs builds the
  # powershell command line by hand), so refuse it instead of running something else.
  Note '  FAIL appPath/processName must not contain a double quote'
  exit 2
}

# Only the relaunch hop waits; a plain start/stop must act immediately.
# v1.0.2: the fixed relaunch delay dropped 6s -> 3s. The client half already waits
# 1s after the click before it fires the action, so 3s is plenty for the reply to
# reach the page -- and it is 3 seconds less staring at a frozen panel.
if ($DelaySeconds -gt 0 -and $act -eq 'start') {
  Note ('  waiting ' + $DelaySeconds + 's before start')
  Start-Sleep -Seconds $DelaySeconds
}

switch ($act) {
  'start' { Start-App }
  'relaunch' {
    # Scheduled by the restart branch before the stop; waits for the old
    # processes to really disappear, then starts (see Wait-AppGone).
    $gone = Wait-AppGone 25
    Note ('  relaunch: old app gone = ' + $gone)
    Start-App
  }
  'stop' { Stop-App }
  'restart' {
    # Explicit: an explicit -DelaySeconds wins (never below 2s, so the reply
    # still reaches the page first), otherwise the 3s default.
    $d = if ($DelaySeconds -gt 0) { [Math]::Max(2, $DelaySeconds) } else { 3 }
    Schedule-Relaunch $d
    Stop-App
  }
  'logs' {
    Note ('  opening log folder ' + $logRoot)
    if (-not $DryRun) { Start-Process -FilePath 'explorer.exe' -ArgumentList $logRoot }
  }
  'status' {
    $app = @(Get-AppProcesses)
    Note ('  status: app processes = ' + $app.Count + '; exe = ' + (Resolve-AppExe) + '; log = ' + $log)
  }
  default { Note "  unknown action '$act' (expected start|stop|restart|relaunch|logs|status)" }
}
