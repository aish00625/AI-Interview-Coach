<#
.SYNOPSIS
  One-time (and safe to re-run) setup of the AI Interview Coach on Windows. Run from the project root:
      powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1

.DESCRIPTION
  - installs backend and frontend npm packages
  - creates the ai-service and code-executor virtual environments and installs their requirements
    (core + speech by default; add -WithVision for the optional webcam packages)
  - creates any MISSING .env file from its .env.example with freshly generated secrets, and only APPENDS missing keys
    to .env files you already have (it never changes a value you already set)
  - applies every database migration in order (idempotent; never drops or resets anything)
  - runs the AI-service diagnostics (downloads the speech model once and transcribes a test clip)

  NOT TESTED ON WINDOWS BY ITS AUTHOR. It was written against the documented behaviour of npm, pip, psql and PowerShell 5.1.
  If a step fails it stops and prints the command it was running; nothing it does is destructive.
#>
param(
  [string]$DbName = "ai_interview_coach",
  [string]$DbUser = "postgres",
  [string]$DbHost = "localhost",
  [int]$DbPort = 5432,
  [switch]$WithVision,
  [switch]$SkipSpeech,
  [switch]$SkipMigrations,
  [switch]$SkipDiagnostics
)
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $proj
Write-Host "Project folder: $proj" -ForegroundColor Cyan

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "'$cmd' was not found. $hint" }
}
function Run($label, [scriptblock]$block) {
  Write-Host "-> $label"
  & $block
  if ($LASTEXITCODE -ne 0) { throw "FAILED: $label (exit code $LASTEXITCODE)" }
}
function New-Secret {
  $b = New-Object byte[] 48
  $rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
  $rng.GetBytes($b)
  return (($b | ForEach-Object { $_.ToString('x2') }) -join '')
}

Step "Checking required tools"
Need node "Install Node.js 20 or newer from https://nodejs.org"
Need npm  "Install Node.js 20 or newer from https://nodejs.org"
$py = $null
foreach ($c in @("py", "python")) { if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break } }
if (-not $py) { throw "Python was not found. Install Python 3.11 or 3.12 from https://python.org and tick 'Add to PATH'." }
$havePsql = [bool](Get-Command psql -ErrorAction SilentlyContinue)
if (-not $havePsql -and -not $SkipMigrations) {
  Write-Host "psql was not found on PATH - migrations will be skipped. Add C:\Program Files\PostgreSQL\<version>\bin to PATH and re-run." -ForegroundColor Yellow
  $SkipMigrations = $true
}

Step "Environment files"
$secrets = @{ ai = New-Secret; exec = New-Secret; jwt = New-Secret }
function Read-Env($path) {
  $h = @{}
  if (Test-Path $path) { Get-Content $path | ForEach-Object { if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { $h[$Matches[1]] = $true } } }
  return $h
}
function Ensure-Key($path, $key, $value) {
  $have = Read-Env $path
  if (-not $have.ContainsKey($key)) { Add-Content -Path $path -Value "$key=$value"; Write-Host "   added $key to $path" }
}
function Existing-Value($path, $key) {
  if (-not (Test-Path $path)) { return $null }
  foreach ($l in Get-Content $path) { if ($l -match "^\s*$key\s*=\s*([^#\s]+)") { return $Matches[1] } }
  return $null
}
# Reuse keys that already exist so the three services keep agreeing with each other.
$aiKey   = Existing-Value "backend\.env" "AI_SERVICE_API_KEY";   if (-not $aiKey   -or $aiKey   -eq "change-me") { $aiKey   = Existing-Value "ai-service\.env" "AI_SERVICE_API_KEY" }
$execKey = Existing-Value "backend\.env" "CODE_EXECUTOR_API_KEY"; if (-not $execKey -or $execKey -eq "change-me") { $execKey = Existing-Value "code-executor\.env" "CODE_EXECUTOR_API_KEY" }
if (-not $aiKey   -or $aiKey   -eq "change-me") { $aiKey   = $secrets.ai }
if (-not $execKey -or $execKey -eq "change-me") { $execKey = $secrets.exec }

if (-not (Test-Path "backend\.env")) {
  $sec = Read-Host "PostgreSQL password for user '$DbUser' (stored only in backend\.env)" -AsSecureString
  $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $lines = Get-Content "backend\.env.example" | ForEach-Object {
    if     ($_ -match '^DATABASE_URL=')          { "DATABASE_URL=postgres://${DbUser}:$([uri]::EscapeDataString($pw))@${DbHost}:${DbPort}/$DbName" }
    elseif ($_ -match '^JWT_SECRET=')            { "JWT_SECRET=$($secrets.jwt)" }
    elseif ($_ -match '^AI_SERVICE_API_KEY=')    { "AI_SERVICE_API_KEY=$aiKey" }
    elseif ($_ -match '^CODE_EXECUTOR_API_KEY=') { "CODE_EXECUTOR_API_KEY=$execKey" }
    else { $_ }
  }
  Set-Content -Path "backend\.env" -Value $lines
  Write-Host "   created backend\.env"
}
if (-not (Test-Path "ai-service\.env")) {
  $lines = Get-Content "ai-service\.env.example" | ForEach-Object { if ($_ -match '^AI_SERVICE_API_KEY=') { "AI_SERVICE_API_KEY=$aiKey" } else { $_ } }
  Set-Content -Path "ai-service\.env" -Value $lines
  Write-Host "   created ai-service\.env"
}
if (-not (Test-Path "code-executor\.env")) {
  $lines = Get-Content "code-executor\.env.example" | ForEach-Object { if ($_ -match '^CODE_EXECUTOR_API_KEY=') { "CODE_EXECUTOR_API_KEY=$execKey" } else { $_ } }
  Set-Content -Path "code-executor\.env" -Value $lines
  Write-Host "   created code-executor\.env"
}
# Existing files: only add keys introduced by this version.
Ensure-Key "backend\.env" "AI_SERVICE_SPEECH_TIMEOUT_MS" "120000"
Ensure-Key "ai-service\.env" "SPEECH_MODEL_SIZE" "small"
Ensure-Key "ai-service\.env" "SPEECH_LANGUAGE" "en"
Ensure-Key "ai-service\.env" "SPEECH_PRELOAD" "true"
Ensure-Key "ai-service\.env" "SPEECH_VAD_FILTER" "true"
$curModel = Existing-Value "ai-service\.env" "SPEECH_MODEL_SIZE"
if ($curModel -eq "tiny" -or $curModel -eq "base") {
  Write-Host "   NOTE: ai-service\.env has SPEECH_MODEL_SIZE=$curModel. That smaller model makes more transcription mistakes. It was left as is; change it to 'small' (or 'medium') and restart the AI service to improve accuracy." -ForegroundColor Yellow
}
Write-Host "   Existing values were left untouched. Check that AI_SERVICE_API_KEY is identical in backend\.env and ai-service\.env." -ForegroundColor Yellow

Step "Backend packages"
Push-Location backend; Run "npm install (backend)" { npm install --no-audit --no-fund }; Pop-Location
Step "Frontend packages"
Push-Location frontend; Run "npm install (frontend)" { npm install --no-audit --no-fund }; Pop-Location

function Setup-Venv($dir, $reqs) {
  Push-Location $dir
  if (-not (Test-Path "venv\Scripts\python.exe")) { Run "create venv ($dir)" { & $py -m venv venv } }
  Run "upgrade pip ($dir)" { & .\venv\Scripts\python.exe -m pip install --upgrade pip }
  foreach ($r in $reqs) { Run "pip install -r $r ($dir)" { & .\venv\Scripts\python.exe -m pip install -r $r } }
  Pop-Location
}
Step "AI service (core packages)"
Setup-Venv "ai-service" @("requirements.txt")
if (-not $SkipSpeech) {
  Step "AI service (speech-to-text package)"
  try { Setup-Venv "ai-service" @("requirements-speech.txt") }
  catch { Write-Host "Speech package install failed: $_" -ForegroundColor Yellow; Write-Host "Text answers will still work; voice answers will report 'speech_package_missing'." -ForegroundColor Yellow }
}
if ($WithVision) {
  Step "AI service (webcam analysis packages)"
  try { Setup-Venv "ai-service" @("requirements-vision.txt") }
  catch { Write-Host "Vision package install failed: $_" -ForegroundColor Yellow }
}
Step "Code executor packages"
Setup-Venv "code-executor" @("requirements.txt")

if (-not $SkipMigrations) {
  Step "Database migrations (ordered, additive)"
  $env:PGPASSWORD = $null
  $dbUrl = Existing-Value "backend\.env" "DATABASE_URL"
  if ($dbUrl -match '^postgres(ql)?://[^:]+:([^@]*)@') { $env:PGPASSWORD = [uri]::UnescapeDataString($Matches[2]) }
  $files = Get-ChildItem "database\migrations\*.sql" | Where-Object { $_.Name -notlike "*.down.sql" } | Sort-Object Name
  foreach ($f in $files) {
    Write-Host "-> $($f.Name)"
    & psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -q -f $f.FullName
    if ($LASTEXITCODE -ne 0) { throw "Migration $($f.Name) failed. Nothing was dropped; fix the error above and re-run this script." }
  }
  & psql -h $DbHost -p $DbPort -U $DbUser -d $DbName -t -c "SELECT count(*) || ' migrations recorded' FROM schema_migrations;"
  Push-Location backend
  Run "seed coding problems (idempotent)" { npm run seed:problems }
  Pop-Location
}

if (-not $SkipSpeech -and -not $SkipDiagnostics) {
  Step "AI service diagnostics (downloads the speech model the first time - about 460 MB for 'small')"
  Push-Location ai-service
  & .\venv\Scripts\python.exe -m app.diagnostics
  if ($LASTEXITCODE -ne 0) { Write-Host "Diagnostics reported a problem - see the [FAIL] lines above. Text interviews work regardless." -ForegroundColor Yellow }
  if ($WithVision) { & .\venv\Scripts\python.exe -m app.diagnostics --download-vision-model }
  Pop-Location
}

Step "Done"
Write-Host "Start everything with:  powershell -ExecutionPolicy Bypass -File scripts\windows\start-all.ps1" -ForegroundColor Green
Write-Host "Docker Desktop and the four code-runner images are only needed for the coding rounds (see the guide)."
