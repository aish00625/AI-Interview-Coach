<#
.SYNOPSIS
  Opens one window per service: AI service (8000), backend (5000), frontend (5173) and, with -WithExecutor, the code
  executor (9000, needs Docker Desktop running). Close a window to stop that service.
      powershell -ExecutionPolicy Bypass -File scripts\windows\start-all.ps1 -WithExecutor
  NOT TESTED ON WINDOWS BY ITS AUTHOR.
#>
param([switch]$WithExecutor)
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Start-Window($title, $dir, $command) {
  $inner = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $command"
  Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $inner)
}

$svc = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($svc -and $svc.Status -ne "Running") { Write-Host "PostgreSQL service '$($svc.Name)' is not running. Start it from Services (services.msc)." -ForegroundColor Yellow }

Start-Window "AI service :8000" "$proj\ai-service" ".\venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"
if ($WithExecutor) {
  $dockerOk = $false
  try { & docker info *> $null; $dockerOk = ($LASTEXITCODE -eq 0) } catch { $dockerOk = $false }
  if (-not $dockerOk) { Write-Host "Docker Desktop is not running - start it first, then re-run with -WithExecutor." -ForegroundColor Yellow }
  else { Start-Window "Code executor :9000" "$proj\code-executor" ".\venv\Scripts\python.exe -m uvicorn app.main:app --port 9000" }
}
Start-Sleep -Seconds 3
Start-Window "Backend :5000" "$proj\backend" "npm run dev"
Start-Window "Frontend :5173" "$proj\frontend" "npm run dev"
Write-Host "Started. Open http://localhost:5173 in Chrome or Edge."
Write-Host "The first voice answer may wait while the AI service finishes loading its speech model (watch the AI service window)."
