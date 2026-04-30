#!/usr/bin/env bash
# One-time bootstrap: creates .venv, installs frontend deps + builds the
# bundle, then installs the backend.
#
# Order matters: ``pip install -e .`` triggers hatch_build.py which shells
# out to ``npm run build`` inside ./frontend. That command only works when
# ``./frontend/node_modules/.bin/tsc`` exists, otherwise the install fails
# with ``sh: 1: tsc: not found``. So we run ``npm install`` *first* and
# ``pip install -e .`` *second* — the hatch hook then reuses the populated
# node_modules and the second build is a near-instant no-op.
#
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

if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found. Install Node.js 18+ first (e.g. from nodesource or apt)."
    echo "Then re-run: bash setup.sh"
    exit 1
fi

echo "Creating .venv ..."
python3 -m venv .venv
"$PROJECT_DIR/.venv/bin/pip" install -U pip

echo "Installing frontend dependencies ..."
cd "$PROJECT_DIR/frontend"
npm install

# The backend (port 6874) serves the production bundle from
# src/xsafeclaw/static/. Without this build step the cached bundle shipped
# in the repo would be used, which may lag behind frontend/src — e.g. the
# Setup page would be missing newly added agent-framework cards.
echo "Building frontend bundle into src/xsafeclaw/static ..."
npm run build

cd "$PROJECT_DIR"
echo "Installing backend (editable) ..."
"$PROJECT_DIR/.venv/bin/pip" install -e .

if [ ! -f "$PROJECT_DIR/.env" ]; then
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "Created .env from .env.example"
fi

echo ""
echo "Done. Start with:  bash start.sh"
