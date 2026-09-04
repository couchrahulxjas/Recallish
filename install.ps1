<# ============================================================================
   Recallish - One-command installer (Windows / PowerShell)
   ----------------------------------------------------------------------------
   Install the backend, frontend, and Chrome extension, and optionally set up
   the local summarizer LLM. Run from anywhere:

       powershell -ExecutionPolicy Bypass -File install.ps1

   What it does:
     1. Creates/downloads dependencies
     2. Creates a Python venv and installs the Recallish backend package
     3. Installs frontend npm dependencies and builds the Chrome extension
     4. Optionally detects llama.cpp and downloads the Qwen3 summarizer model
     5. Prints the next steps to start everything
   ============================================================================ #>

[CmdletBinding()]
param(
    [switch]$NoLLM,        # skip the local LLM / llama.cpp prompt
    [switch]$NoFrontend     # skip npm install + extension build (backend only)
)

$ErrorActionPreference = "Stop"

# ---- Locate the project root (this script lives in the project root) --------
$ProjectRoot = $PSScriptRoot
$BackendDir  = Join-Path $ProjectRoot "backend"
$ConfigPath  = Join-Path $BackendDir "config\recallish.yaml"

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Recallish installer" -ForegroundColor Cyan
Write-Host "  Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 0. Prerequisites --------------------------------------------------------
$HavePython = $false
if (Get-Command python -ErrorAction SilentlyContinue) {
    $HavePython = $true
}
if (-not $HavePython) {
    Write-Error "Python 3.10+ was not found on PATH. Install it from https://www.python.org/downloads/ (check 'Add to PATH') and re-run this script."
    exit 1
}

$HaveNode = $false
if (Get-Command node -ErrorAction SilentlyContinue) {
    $HaveNode = $true
}
if (-not $HaveNode) {
    Write-Host "WARNING: Node.js was not found." -ForegroundColor Yellow
    Write-Host "You can still use the Python backend + CLI + MCP without the web UI."
    Write-Host "Install Node 20+ from https://nodejs.org to enable the web UI and extension build."
    if ($NoFrontend) { } # continue anyway
}

# ---- 1. Python venv + backend install ----------------------------------------
Write-Host ""
Write-Host "[1/4] Setting up Python backend..." -ForegroundColor Green
$VenvDir     = Join-Path $BackendDir ".venv"
$Pip         = Join-Path $VenvDir "Scripts\pip.exe"
$VenvPython  = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "  Creating virtual environment at backend\.venv ..."
    python -m venv $VenvDir
    if (-not $?) { Write-Error "Failed to create venv."; exit 1 }
} else {
    Write-Host "  Using existing backend\.venv"
}

Write-Host "  Installing backend package (editable) + dependencies..."
& $Pip install --upgrade pip | Out-Null
& $Pip install -e $BackendDir
if (-not $?) { Write-Error "Backend install failed."; exit 1 }

# Initialize the store if it doesn't exist yet
Write-Host "  Initializing local memory store..."
& $VenvPython -m recallish.cli --config $ConfigPath init
if (-not $?) { Write-Host "  (init returned non-zero; continuing - it may already be initialized)" -ForegroundColor Yellow }

# ---- 2. Frontend + extension ---------------------------------------------------
if ($HaveNode -and -not $NoFrontend) {
    Write-Host ""
    Write-Host "[2/4] Installing frontend + building Chrome extension..." -ForegroundColor Green
    Push-Location $ProjectRoot
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "  Running npm install ..."
            & npm install
            if (-not $?) { Write-Error "npm install failed."; exit 1 }
        } else {
            Write-Host "  node_modules already present, skipping npm install"
        }
        Write-Host "  Building extension (dist-extension/)..."
        & npm run build:extension
        if (-not $?) { Write-Host "  WARNING: extension build failed (Node may be outdated). The web UI may still work." -ForegroundColor Yellow }
    } finally {
        Pop-Location
    }
} else {
    Write-Host ""
    Write-Host "[2/4] Skipping frontend + extension (no Node / --NoFrontend)." -ForegroundColor DarkGray
}

# ---- 3. Local summarizer LLM (optional) ---------------------------------------
if (-not $NoLLM) {
    Write-Host ""
    $UseLLM = $true
    if ($env:RUN_INSTALLER_NONINTERACTIVE -eq "1") { $UseLLM = $false }
    else {
        $ans = Read-Host "[3/4] Set up the local summarizer LLM (Qwen3-1.7B) for the 'Summarise' feature? [y/N]"
        $UseLLM = ($ans -match "^[yY]")
    }
    if (-not $UseLLM) {
        Write-Host "  Skipping local LLM. You can still add, search, and retrieve memories." -ForegroundColor DarkGray
    } else {
        & "$PSScriptRoot\setup-llm.ps1" -ProjectRoot $ProjectRoot
    }
} else {
    Write-Host ""
    Write-Host "[3/4] Skipping local LLM (--NoLLM)." -ForegroundColor DarkGray
}

# ---- 4. Summary ---------------------------------------------------------------
Write-Host ""
Write-Host "[4/4] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Recallish is installed." -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Start everything with:" -ForegroundColor White
Write-Host "    powershell -ExecutionPolicy Bypass -File start.ps1"
Write-Host ""
Write-Host "  - Backend API : http://localhost:8765"
Write-Host "  - Web UI      : http://localhost:3000/memories"
if ($UseLLM) {
    Write-Host "  - Local LLM   : http://localhost:8080/health"
}
Write-Host ""
Write-Host "Manual start (each in its own terminal):"
Write-Host "  Backend : cd backend; .\.venv\Scripts\python -m recallish.cli --config config\recallish.yaml serve"
Write-Host "  Frontend: npm run build && npm run serve"
if ($UseLLM) {
    Write-Host "  LLM     : llama-server -m <model>.gguf -c 4096 --port 8080"
}
Write-Host ""
if ($HaveNode) {
    Write-Host "Load the Chrome extension:"
    Write-Host "  1. Open chrome://extensions"
    Write-Host "  2. Enable 'Developer mode' (top-right)"
    Write-Host "  3. Click 'Load unpacked' and select:"
    Write-Host "     $ProjectRoot\dist-extension"
    Write-Host ""
}
Write-Host "To connect Cursor / Claude Desktop via MCP, see MCP_SETUP.md." -ForegroundColor DarkGray
Write-Host ""
