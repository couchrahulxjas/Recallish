#!/usr/bin/env bash
# ============================================================================
# Recallish - One-command installer (macOS / Linux)
# ----------------------------------------------------------------------------
# Install the backend, frontend, and Chrome extension, and optionally set up
# the local summarizer LLM.
#
#     bash install.sh
#
# Flags:
#     --no-llm       skip the local LLM / llama.cpp prompt
#     --no-frontend  skip npm install + extension build (backend only)
# ============================================================================
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
CONFIG_PATH="$BACKEND_DIR/config/recallish.yaml"

NO_LLM=0
NO_FRONTEND=0
for arg in "$@"; do
  case "$arg" in
    --no-llm) NO_LLM=1 ;;
    --no-frontend) NO_FRONTEND=1 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

echo ""
echo "=============================================="
echo "  Recallish installer"
echo "  Project: $PROJECT_ROOT"
echo "=============================================="
echo ""

# ---- 0. Prerequisites -------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 3.10+ not found. Install it and re-run." >&2
  exit 1
fi
HAVE_NODE=0
if command -v node >/dev/null 2>&1; then HAVE_NODE=1; fi
if [ "$HAVE_NODE" -eq 0 ]; then
  echo "WARNING: Node.js not found. You can still use the backend CLI + MCP."
  echo "Install Node 20+ from https://nodejs.org for the web UI + extension."
fi

# ---- 1. Python venv + backend install ---------------------------------------
echo ""
echo "[1/4] Setting up Python backend..."
VENV_DIR="$BACKEND_DIR/.venv"
if [ ! -x "$VENV_DIR/bin/python" ]; then
  echo "  Creating virtual environment at backend/.venv ..."
  python3 -m venv "$VENV_DIR"
fi
"$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
"$VENV_DIR/bin/pip" install -e "$BACKEND_DIR"
echo "  Initializing local memory store..."
"$VENV_DIR/bin/python" -m recallish.cli --config "$CONFIG_PATH" init >/dev/null 2>&1 || \
  echo "  (init returned non-zero; continuing - it may already be initialized)"

# ---- 2. Frontend + extension -------------------------------------------------
if [ "$HAVE_NODE" -eq 1 ] && [ "$NO_FRONTEND" -eq 0 ]; then
  echo ""
  echo "[2/4] Installing frontend + building Chrome extension..."
  ( cd "$PROJECT_ROOT"
    if [ ! -d node_modules ]; then
      echo "  Running npm install ..."
      npm install
    else
      echo "  node_modules already present, skipping npm install"
    fi
    echo "  Building extension (dist-extension/)..."
    npm run build:extension
  )
else
  echo ""
  echo "[2/4] Skipping frontend + extension (no Node / --no-frontend)."
fi

# ---- 3. Local summarizer LLM (optional) -------------------------------------
USE_LLM=0
if [ "$NO_LLM" -ne 1 ]; then
  echo ""
  read -r -p "[3/4] Set up the local summarizer LLM (Qwen3-1.7B)? [y/N] " ans
  case "$ans" in
    y|Y) USE_LLM=1 ;;
    *) echo "  Skipping local LLM. You can still add, search, and retrieve memories." ;;
  esac
  if [ "$USE_LLM" -eq 1 ]; then
    bash "$PROJECT_ROOT/setup-llm.sh" "$PROJECT_ROOT"
  fi
else
  echo ""
  echo "[3/4] Skipping local LLM (--no-llm)."
fi

# ---- 4. Summary --------------------------------------------------------------
echo ""
echo "============================================================"
echo "  Recallish is installed."
echo "============================================================"
echo ""
echo "Start everything with:"
echo "    bash start.sh"
echo ""
echo "  - Backend API : http://localhost:8765"
echo "  - Web UI      : http://localhost:3000/memories"
[ "$USE_LLM" -eq 1 ] && echo "  - Local LLM   : http://localhost:8080/health"
echo ""
echo "Manual start (each in its own terminal):"
echo "  Backend : cd backend && ./.venv/bin/python -m recallish.cli --config config/recallish.yaml serve"
echo "  Frontend: npm run build && npm run serve"
echo ""
if [ "$HAVE_NODE" -eq 1 ]; then
  echo "Load the Chrome extension:"
  echo "  1. Open chrome://extensions"
  echo "  2. Enable 'Developer mode' (top-right)"
  echo "  3. Click 'Load unpacked' and select:"
  echo "     $PROJECT_ROOT/dist-extension"
  echo ""
fi
echo "To connect Cursor / Claude Desktop via MCP, see MCP_SETUP.md."
echo ""
