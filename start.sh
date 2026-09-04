#!/usr/bin/env bash
# ============================================================================
# Recallish - One-command launcher (macOS / Linux)
# ----------------------------------------------------------------------------
# Starts the backend API and (if Node is present) the web UI, plus the local
# LLM if a GGUF is found in <project>/models/ or already running on :8080.
#
#     bash start.sh
#     Ctrl+C stops everything
# ============================================================================
set -u
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
VENV_PY="$BACKEND_DIR/.venv/bin/python"
CONFIG_PATH="$BACKEND_DIR/config/recallish.yaml"

echo ""
echo "=============================================="
echo "  Starting Recallish"
echo "  Ctrl+C in this window stops everything"
echo "=============================================="

if [ ! -x "$VENV_PY" ]; then
  echo "Venv not found. Run: bash install.sh" >&2
  exit 1
fi

PIDS=()

# ---- 1. Local LLM (if available) --------------------------------------------
GGUF=""
if compgen -G "$PROJECT_ROOT/models/*.gguf" >/dev/null 2>&1; then
  GGUF=$(ls "$PROJECT_ROOT"/models/*.gguf | head -n1)
fi
LLAMA_RUNNING=0
if curl -s --max-time 2 http://127.0.0.1:8080/health | grep -q "ok"; then
  LLAMA_RUNNING=1
fi

if [ -n "$GGUF" ] && [ "$LLAMA_RUNNING" -eq 0 ] && command -v llama-server >/dev/null 2>&1; then
  echo "[LLM] Starting llama-server on :8080 ..."
  ( llama-server -m "$GGUF" -c 4096 --port 8080 >/dev/null 2>&1 & )
  PIDS+=($!)
elif [ -n "$GGUF" ] && [ "$LLAMA_RUNNING" -eq 0 ]; then
  echo "[LLM] Model found but llama-server not on PATH. Start it manually:"
  echo "      llama-server -m \"$GGUF\" -c 4096 --port 8080"
elif [ "$LLAMA_RUNNING" -eq 1 ]; then
  echo "[LLM] Already running on :8080 (skipping)."
else
  echo "[LLM] No local model - Summarise feature disabled (install llama.cpp + model)."
fi

# ---- 2. Backend API -----------------------------------------------------------
echo "[API] Starting backend on http://localhost:8765 ..."
( cd "$BACKEND_DIR" && exec "$VENV_PY" -m recallish.cli --config "$CONFIG_PATH" serve ) &
PIDS+=($!)

# ---- 3. Web UI -----------------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  ( cd "$PROJECT_ROOT"
    if [ ! -f .output/server/index.mjs ]; then
      echo "[UI] Building frontend (first run) ..."
      npm run build
    fi
    echo "[UI] Starting web UI on http://localhost:3000/memories ..."
    npm run serve
  ) &
  PIDS+=($!)
else
  echo "[UI] Node not found - web UI skipped. Backend API + MCP still work."
fi

trap 'echo ""; echo "Stopping Recallish ..."; kill "${PIDS[@]}" 2>/dev/null' INT TERM

echo ""
echo "=============================================="
echo "  Recallish running."
echo "  Backend API : http://localhost:8765"
echo "  Health      : http://localhost:8765/api/health"
if [ -n "$GGUF" ] || [ "$LLAMA_RUNNING" -eq 1 ]; then
  echo "  Local LLM   : http://localhost:8080/health"
fi
if command -v node >/dev/null 2>&1; then
  echo "  Web UI      : http://localhost:3000/memories"
fi
echo "  Ctrl+C to stop"
echo "=============================================="

wait
