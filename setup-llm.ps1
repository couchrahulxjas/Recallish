<# ============================================================================
   Recallish - Local LLM setup helper (Windows / PowerShell)
   ----------------------------------------------------------------------------
   Called by install.ps1, or run on its own:
       powershell -ExecutionPolicy Bypass -File setup-llm.ps1

   Detects a llama.cpp llama-server on PATH, and downloads the Qwen3-1.7B
   Q4_K_M GGUF model into <project>/models/ so summarization works locally.
   ============================================================================ #>

[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$ModelsDir = Join-Path $ProjectRoot "models"
$GgufName  = "Qwen3-1.7B-Q4_K_M.gguf"
$GgufPath  = Join-Path $ModelsDir $GgufName

# Stable mirror URL (bartowski quantization of Qwen3-1.7B, Q4_K_M)
$ModelUrl  = "https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf"

Write-Host "[3/4] Setting up local summarizer LLM..." -ForegroundColor Green

# ---- 1. Find llama-server ----------------------------------------------------
$LlamaServer = $null
if (Get-Command llama-server -ErrorAction SilentlyContinue) {
    $LlamaServer = (Get-Command llama-server).Source
}
$HaveLlama = ($null -ne $LlamaServer)

if (-not $HaveLlama) {
    Write-Host "  llama.cpp 'llama-server' was not found on PATH." -ForegroundColor Yellow
    Write-Host "  It is only needed for the built-in 'Summarise' feature."
    Write-Host "  Options:"
    Write-Host "    1. Install llama.cpp:  winget install ggml.llamacpp"
    Write-Host "    2. Build from source:  https://github.com/ggml-org/llama.cpp"
    Write-Host "  You can install it later and re-run this script." -ForegroundColor DarkGray
    return
}
Write-Host "  Found llama-server: $LlamaServer"

# ---- 2. Download the model (if not already present) ---------------------------
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

if (Test-Path $GgufPath) {
    $Size = [math]::Round((Get-Item $GgufPath).Length / 1MB, 1)
    Write-Host "  Model already present: $GgufPath ($Size MB)"
} else {
    Write-Host "  Downloading Qwen3-1.7B Q4_K_M (~1.28 GB) to $GgufPath ..."
    Write-Host "  This may take a while depending on your connection." -ForegroundColor DarkGray
    curl.exe -L --progress-bar -o $GgufPath $ModelUrl
    if (-not $?) { Write-Error "Model download failed. Check your network and re-run." }
}

# ---- 3. Verify GGUF magic bytes ----------------------------------------------
$Bytes = [System.IO.File]::ReadAllBytes($GgufPath)[0..3]
$Magic = "{0:X2} {1:X2} {2:X2} {3:X2}" -f $Bytes[0],$Bytes[1],$Bytes[2],$Bytes[3]
if ($Magic -ne "47 47 55 46") {
    Write-Host "  WARNING: Downloaded file does not look like a valid GGUF (magic: $Magic)." -ForegroundColor Yellow
}

# ---- 4. Point the recallish config at this model ------------------------------
$ConfigPath = Join-Path $ProjectRoot "backend\config\recallish.yaml"
if (Test-Path $ConfigPath) {
    try {
        $cfg = Get-Content $ConfigPath -Raw
        $OldModel = 'model:\s*"[^"]*"'
        $NewModel = 'model: "' + $GgufName + '"'
        if ($cfg -match $OldModel) {
            $cfg = $cfg -replace $OldModel, $NewModel
            Set-Content -Path $ConfigPath -Value $cfg -NoNewline -Encoding UTF8
            Write-Host "  Updated recallish.yaml -> model: `"$GgufName`""
        }
    } catch {
        Write-Host "  Could not auto-update recallish.yaml - edit 'model:' manually." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "  Local LLM ready. Start it with:" -ForegroundColor Green
Write-Host "      llama-server -m `"$GgufPath`" -c 4096 --port 8080"
Write-Host "  Verify: http://localhost:8080/health  ->  {`"status`":`"ok`"}"
