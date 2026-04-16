#!/usr/bin/env bash
# One-time bootstrap: creates .venv, installs backend + frontend deps.
# After this, use: bash start.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 not found. Install Python 3.11+ first."
    exit 1
fi

PYVER="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if ! python3 -c 'import sys; assert sys.version_info >= (3, 11)' 2>/dev/null; then
    echo "Need Python >= 3.11 (found $PYVER). On Ubuntu: sudo apt install python3.11 python3.11-venv"
    exit 1
fi

echo "Creating .venv ..."
python3 -m venv .venv
"$PROJECT_DIR/.venv/bin/pip" install -U pip
"$PROJECT_DIR/.venv/bin/pip" install -e .

if [ ! -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "Created .env from .env.example"
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found. Install Node.js 18+ (e.g. from nodesource or apt), then run:"
    echo "  cd \"$PROJECT_DIR/frontend\" && npm install"
    exit 1
fi

echo "Installing frontend dependencies ..."
cd "$PROJECT_DIR/frontend"
npm install

echo ""
echo "Done. Start with:  bash start.sh"
