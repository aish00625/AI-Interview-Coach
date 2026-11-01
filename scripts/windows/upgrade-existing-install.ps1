<#
.SYNOPSIS
  Safe one-command upgrade of an EXISTING install (your real database). Run from the project root:
      powershell -ExecutionPolicy Bypass -File scripts\windows\upgrade-existing-install.ps1

.DESCRIPTION
  1. Finds psql / pg_dump (PATH, or C:\Program Files\PostgreSQL\<version>\bin).
  2. Reads DATABASE_URL from backend\.env (nothing is printed or stored elsewhere).
  3. Makes a full pg_dump backup into backups\ BEFORE touching anything. Stops if the backup fails.
  4. Records row counts for every table, the migrations already applied and the coding problems already present.
  5. Runs scripts\windows\setup.ps1 (npm install, python packages, ordered additive migrations 001-013,
     seed of the 46-problem bank, speech diagnostics). Nothing is dropped, reset or recreated.
  6. Records the counts again and compares: any table that has FEWER rows than before is reported loudly.

  NOT TESTED ON WINDOWS BY ITS AUTHOR (written against documented PowerShell 5.1 / psql / pg_dump behaviour).
  Use -SkipSetup to only take the backup and print the "before" report.
#>
param(
  [string]$PsqlDir = "",
  [switch]$SkipSetup,
  [switch]$WithVision
)
$ErrorActionPreference = "Stop"
$proj = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $proj

function Step($t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Find-Tool($name) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $dirs = @()
  if ($PsqlDir) { $dirs += $PsqlDir }
  $root = "C:\Program Files\PostgreSQL"
  if (Test-Path $root) { $dirs += (Get-ChildItem $root -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName "bin" }) }
  foreach ($d in $dirs) { $p = Join-Path $d "$name.exe"; if (Test-Path $p) { return $p } }
  return $null
}

Step "Locating PostgreSQL tools"
$psql = Find-Tool "psql"
$dump = Find-Tool "pg_dump"
if (-not $psql -or -not $dump) { throw "psql / pg_dump not found. Install PostgreSQL client tools or run with -PsqlDir 'C:\Program Files\PostgreSQL\<version>\bin'." }
Write-Host "psql:    $psql"
Write-Host "pg_dump: $dump"
$env:Path = (Split-Path -Parent $psql) + ";" + $env:Path

Step "Reading DATABASE_URL from backend\.env"
if (-not (Test-Path "backend\.env")) { throw "backend\.env not found." }
$line = Get-Content "backend\.env" | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is not set in backend\.env." }
$url = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if ($url -match '^postgres(?:ql)?://([^:@/]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/([^?\s]+)') {
  $dbUser = $Matches[1]; $dbPass = [uri]::UnescapeDataString($Matches[2]); $dbHost = $Matches[3]
  $dbPort = "5432"; if ($Matches[4]) { $dbPort = $Matches[4] }
  $dbName = $Matches[5]
} else { throw "Could not parse DATABASE_URL (expected postgres://user:password@host:port/database)." }
$env:PGPASSWORD = $dbPass
Write-Host "Database: $dbName on ${dbHost}:${dbPort} as $dbUser"

function Q($sql) {
  $out = & $psql -h $dbHost -p $dbPort -U $dbUser -d $dbName -t -A -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql query failed: $sql" }
  return $out
}
$countSql = "SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1;"
function Get-Counts {
  $h = @{}
  foreach ($l in (Q $countSql)) { if ($l -match '^(\w+)=(\d+)$') { $h[$Matches[1]] = [int64]$Matches[2] } }
  return $h
}

Step "Checking the database is reachable"
Write-Host (Q "SELECT 'connected to ' || current_database() || ' (' || split_part(version(), ',', 1) || ')'")

Step "Backup (pg_dump, custom format) BEFORE any change"
New-Item -ItemType Directory -Force -Path "backups" | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bk = Join-Path $proj "backups\pre-upgrade-$dbName-$stamp.backup"
& $dump -h $dbHost -p $dbPort -U $dbUser -d $dbName -F c -f $bk
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $bk) -or (Get-Item $bk).Length -lt 1024) { throw "Backup FAILED - nothing was changed. Fix the error above and re-run." }
Write-Host ("Backup written: {0} ({1:N0} bytes)" -f $bk, (Get-Item $bk).Length) -ForegroundColor Green
Write-Host "Restore later with: pg_restore -h $dbHost -U $dbUser -d <empty database> `"$bk`""

Step "BEFORE: row counts, applied migrations, existing coding problems"
$before = Get-Counts
$before.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host ("  {0,-28} {1,8}" -f $_.Name, $_.Value) }
if (Q "SELECT to_regclass('public.schema_migrations') IS NOT NULL") {
  $hasMig = (Q "SELECT to_regclass('public.schema_migrations') IS NOT NULL") -join ""
  if ($hasMig -eq "t") { Write-Host "  migrations already applied:"; Q "SELECT '    ' || version FROM schema_migrations ORDER BY version" | ForEach-Object { Write-Host $_ } }
  else { Write-Host "  no schema_migrations table yet (a pre-Phase-A database) - migration 001 will create it." }
}
Write-Host "  existing coding problems:"
Q "SELECT '    #' || id || '  ' || title FROM coding_problems ORDER BY id" | ForEach-Object { Write-Host $_ }

if ($SkipSetup) { Write-Host ""; Write-Host "-SkipSetup given: stopping after the backup and the BEFORE report." -ForegroundColor Yellow; return }

Step "Running setup.ps1 (installs packages, applies migrations, seeds problems)"
$setupArgs = @("-ExecutionPolicy", "Bypass", "-File", "scripts\windows\setup.ps1", "-DbName", $dbName, "-DbUser", $dbUser, "-DbHost", $dbHost, "-DbPort", $dbPort)
if ($WithVision) { $setupArgs += "-WithVision" }
& powershell @setupArgs
if ($LASTEXITCODE -ne 0) { throw "setup.ps1 failed (exit $LASTEXITCODE). Your data is untouched except for migrations that completed; the backup is at $bk" }

Step "AFTER: comparing row counts"
$after = Get-Counts
$lost = 0
foreach ($k in ($before.Keys | Sort-Object)) {
  $a = 0; if ($after.ContainsKey($k)) { $a = $after[$k] }
  $flag = ""
  if ($a -lt $before[$k]) { $flag = "  <-- FEWER ROWS THAN BEFORE"; $lost++ }
  Write-Host ("  {0,-28} before {1,6}   after {2,6}{3}" -f $k, $before[$k], $a, $flag)
}
foreach ($k in ($after.Keys | Sort-Object)) { if (-not $before.ContainsKey($k)) { Write-Host ("  {0,-28} NEW TABLE          {1,6}" -f $k, $after[$k]) } }
if ($lost -gt 0) { Write-Host "ATTENTION: $lost table(s) have fewer rows than before. Do not use the app; restore from $bk and tell Claude." -ForegroundColor Red }
else { Write-Host "No table lost rows." -ForegroundColor Green }

Step "Coding problem bank"
Write-Host ("  problems with a slug (from the bank): " + (Q "SELECT count(*) FROM coding_problems WHERE slug IS NOT NULL"))
Write-Host ("  problems without a slug (yours/older): " + (Q "SELECT count(*) FROM coding_problems WHERE slug IS NULL"))
$dups = Q "SELECT '  DUPLICATE TITLE: ' || title || ' x' || count(*) FROM coding_problems GROUP BY lower(title) , title HAVING count(*) > 1"
if ($dups) { $dups | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }; Write-Host "  (Duplicates mean an older problem has the same title as a bank problem. Nothing was deleted, because submissions may point at it. Tell Claude which to keep.)" }
else { Write-Host "  no duplicate titles." }
Write-Host ""
Write-Host "Next: in backend run npm run verify:problems, then start everything with scripts\windows\start-all.ps1" -ForegroundColor Green
