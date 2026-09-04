<# ============================================================================
   Recallish - One-command launcher (Windows / PowerShell)
   ----------------------------------------------------------------------------
   Starts the backend API and (if Node is present) the web UI, plus the local
   LLM if a GGUF is found in <project>/models/ or already running on :8080.

       powershell -ExecutionPolicy Bypass -File start.ps1
   ============================================================================ #>

$ErrorActionPreference = "Continue"
$ProjectRoot = $PSScriptRoot
$BackendDir  = Join-Path $ProjectRoot "backend"
$VenvPython  = Join-Path $BackendDir ".venv\Scripts\python.exe"
$ConfigPath  = Join-Path $BackendDir "config\recallish.yaml"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Starting Recallish" -ForegroundColor Cyan
Write-Host "  Ctrl+C in this window stops everything" -ForegroundColor DarkGray
Write-Host "==============================================" -ForegroundColor Cyan

if (-not (Test-Path $VenvPython)) {
    Write-Host "Venv not found. Run: powershell -ExecutionPolicy Bypass -File install.ps1" -ForegroundColor Red
    exit 1
}

$jobs = @()

# ---- 1. Local LLM (if available) ---------------------------------------------
$Gguf = Get-ChildItem -Path (Join-Path $ProjectRoot "models") -Filter *.gguf -ErrorAction SilentlyContinue | Select-Object -First 1
$LlamaRunning = $false
try { $LlamaRunning = ((Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8080/health" -TimeoutSec 2).Content -match "ok") } catch { $LlamaRunning = $false }

if ($Gguf -and -not $LlamaRunning -and (Get-Command llama-server -ErrorAction SilentlyContinue)) {
    Write-Host "[LLM] Starting llama-server on :8080 ..." -ForegroundColor Green
    $jobs += Start-Process -FilePath "llama-server" -ArgumentList "-m `"$($Gguf.FullName)`" -c 4096 --port 8080" -PassThru
} elseif ($Gguf -and -not $LlamaRunning) {
    Write-Host "[LLM] Model found but llama-server not on PATH. Start it manually:" -ForegroundColor Yellow
    Write-Host "      llama-server -m `"$($Gguf.FullName)`" -c 4096 --port 8080"
} elseif ($LlamaRunning) {
    Write-Host "[LLM] Already running on :8080 (skipping)." -ForegroundColor DarkGray
} else {
    Write-Host "[LLM] No local model - Summarise feature disabled (install llama.cpp + model)." -ForegroundColor DarkGray
}

# ---- 2. Backend API ------------------------------------------------------------
Write-Host "[API] Starting backend on http://localhost:8765 ..." -ForegroundColor Green
$jobs += Start-Process -FilePath $VenvPython -ArgumentList "-m recallish.cli --config `"$ConfigPath`" serve" -WorkingDirectory $BackendDir -PassThru -NoNewWindow

# ---- 3. Web UI -----------------------------------------------------------------
if (Get-Command node -ErrorAction SilentlyContinue) {
    Push-Location $ProjectRoot
    try {
        if (-not (Test-Path ".output\server\index.mjs")) {
            Write-Host "[UI] Building frontend (first run) ..." -ForegroundColor Green
            & npm run build
        }
        Write-Host "[UI] Starting web UI on http://localhost:3000/memories ..." -ForegroundColor Green
        $jobs += Start-Process -FilePath "npm" -ArgumentList "run", "serve" -WorkingDirectory $ProjectRoot -PassThru
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[UI] Node not found - web UI skipped. Backend API + MCP still work." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Recallish running." -ForegroundColor Cyan
Write-Host "  Backend API : http://localhost:8765" 
Write-Host "  Health      : http://localhost:8765/api/health"
if ($Gguf -or $LlamaRunning) {
    Write-Host "  Local LLM   : http://localhost:8080/health"
}
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host "  Web UI      : http://localhost:3000/memories"
}
Write-Host "  Ctrl+C to stop" -ForegroundColor DarkGray
Write-Host "==============================================" -ForegroundColor Cyan

try {
    while ($true) { Start-Sleep -Seconds 1 }
} finally {
    Write-Host ""
    Write-Host "Stopping Recallish ..."
    foreach ($j in $jobs) {
        if ($j -and -not $j.HasExited) { Stop-Process -Id $j.Id -Force -ErrorAction SilentlyContinue }
    }
}
