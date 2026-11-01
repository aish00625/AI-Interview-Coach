<#
.SYNOPSIS
  Checks that the optional local AI (Ollama) is reachable from this project, using the real model. Changes nothing.
  Run from the project folder:   powershell -ExecutionPolicy Bypass -File scripts\windows\check-local-ai.ps1
#>
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location (Join-Path $root 'ai-service')
$py = if (Test-Path 'venv\Scripts\python.exe') { 'venv\Scripts\python.exe' } else { 'python' }
Write-Host "1) Is Ollama answering?" -ForegroundColor Cyan
try { (Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5).models | ForEach-Object { "   installed: " + $_.name } }
catch { Write-Host "   Ollama did not answer on http://127.0.0.1:11434 - start the Ollama app and re-run." -ForegroundColor Yellow }
Write-Host "2) Running the app's own prompts and validation against the model" -ForegroundColor Cyan
& $py 'scripts\check_local_ai.py'
