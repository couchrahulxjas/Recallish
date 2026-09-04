#!/usr/bin/env bash
# ============================================================================
# Recallish - Local LLM setup helper (macOS / Linux)
# ----------------------------------------------------------------------------
# Called by install.sh, or run on its own:
#     bash setup-llm.sh [project_root]
# ============================================================================
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
MODELS_DIR="$PROJECT_ROOT/models"
GGUF_NAME="Qwen3-1.7B-Q4_K_M.gguf"
GGUF_PATH="$MODELS_DIR/$GGUF_NAME"
MODEL_URL="https://huggingface.co/bartowski/Qwen_Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf"

echo "[3/4] Setting up local summarizer LLM..."

# ---- 1. Find llama-server ---------------------------------------------------
if ! command -v llama-server >/dev/null 2>&1; then
  echo "  llama.cpp 'llama-server' was not found on PATH." >&2
  echo "  It is only needed for the built-in 'Summarise' feature." >&2
  echo "  Install it from https://github.com/ggml-org/llama.cpp, then re-run." >&2
  return 0 2>/dev/null || exit 0
fi
echo "  Found llama-server: $(command -v llama-server)"

# ---- 2. Download the model (if not already present) -------------------------
mkdir -p "$MODELS_DIR"
if [ -f "$GGUF_PATH" ]; then
  SIZE=$(du -h "$GGUF_PATH" | cut -f1)
  echo "  Model already present: $GGUF_PATH ($SIZE)"
else
  echo "  Downloading Qwen3-1.7B Q4_K_M (~1.28 GB) to $GGUF_PATH ..."
  echo "  This may take a while depending on your connection."
  curl -L --progress-bar -o "$GGUF_PATH" "$MODEL_URL"
fi

# ---- 3. Verify GGUF magic bytes ---------------------------------------------
HEX=$(xxd -p -l 4 "$GGUF_PATH" 2>/dev/null || true)
if [ "$HEX" != "47475546" ]; then
  echo "  WARNING: downloaded file does not look like a valid GGUF (magic: $HEX)." >&2
fi

# ---- 4. Point the recallish config at this model -----------------------------
CFG="$PROJECT_ROOT/backend/config/recallish.yaml"
if [ -f "$CFG" ]; then
  if grep -q '^  model: ' "$CFG"; then
    sed -i.bak 's|^\(  model: \).*|\1"'"$GGUF_NAME"'"|' "$CFG"
    rm -f "$CFG.bak"
    echo "  Updated recallish.yaml -> model: \"$GGUF_NAME\""
  fi
fi

echo ""
echo "  Local LLM ready. Start it with:"
echo "      llama-server -m \"$GGUF_PATH\" -c 4096 --port 8080"
echo "  Verify: http://localhost:8080/health  ->  {\"status\":\"ok\"}"
