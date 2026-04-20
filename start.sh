#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Port layout (as of §27): the *user-facing* default is the Vite dev server,
# because the embedded bundle the backend serves from src/xsafeclaw/static/
# can lag behind the source (and cloud VMs that only map 6874 then see an
# outdated Setup / Configure page). We swap:
#   6874 → frontend (Vite dev server, always in sync with frontend/src/)
#   3022 → backend  (FastAPI + /api/*, proxied from Vite)
# Users only need to expose 6874 on their VM / reverse proxy.
BACKEND_PORT=3022
FRONTEND_PORT=6874
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"
LOG_DIR="$PROJECT_DIR/.logs"
STATIC_DIR="$PROJECT_DIR/src/xsafeclaw/static"
STATIC_INDEX="$STATIC_DIR/index.html"
FRONTEND_DIR="$PROJECT_DIR/frontend"

mkdir -p "$LOG_DIR"

# ── CLI flags ──────────────────────────────────────────────────────────────
#   --force-build   Always rebuild the embedded frontend bundle (equivalent
#                   to FORCE_BUILD=1). Use when the mtime-based staleness
#                   check misses edits (e.g. git checkout rewrote mtimes).
#   --skip-build    Never rebuild; use whatever is already in
#                   src/xsafeclaw/static/. Use with care — the backend
#                   (on $BACKEND_PORT, behind Vite's /api proxy) will
#                   serve the stale bundle if you browse it directly.
FORCE_BUILD="${FORCE_BUILD:-0}"
SKIP_BUILD=0
for arg in "$@"; do
    case "$arg" in
        --force-build)  FORCE_BUILD=1 ;;
        --skip-build)   SKIP_BUILD=1 ;;
        -h|--help)
            cat <<EOF
Usage: bash start.sh [--force-build] [--skip-build]

  --force-build   Rebuild the frontend bundle even if it looks up-to-date.
  --skip-build    Do not rebuild; serve the existing static bundle as-is.

Environment:
  FORCE_BUILD=1   Same as --force-build.
EOF
            exit 0 ;;
        *) ;;
    esac
done

if [ ! -x "$VENV_PYTHON" ]; then
    echo "Missing backend venv: $VENV_PYTHON"
    echo "Run once from project root:  bash setup.sh"
    echo "Or manually:  python3 -m venv .venv && .venv/bin/pip install -e ."
    exit 1
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    echo "Missing frontend/node_modules"
    echo "Run once:  cd frontend && npm install"
    exit 1
fi

# ── Decide whether to rebuild the embedded frontend bundle ─────────────────
# The backend on port $BACKEND_PORT serves src/xsafeclaw/static/ directly, so
# when that bundle lags behind frontend/ any direct visit to the backend
# (e.g. python run.py without Vite) sees an outdated Setup / Configure page.
# With §27's port layout the user-facing $FRONTEND_PORT is Vite — which
# reads frontend/src/ live — so the rebuild below is mostly insurance for
# people who still hit the backend port directly.
needs_build=0
build_reason=""

if [ "$SKIP_BUILD" -eq 1 ]; then
    needs_build=0
    build_reason="skip (--skip-build)"
elif [ "$FORCE_BUILD" -eq 1 ]; then
    needs_build=1
    build_reason="forced (--force-build / FORCE_BUILD=1)"
elif [ ! -f "$STATIC_INDEX" ]; then
    needs_build=1
    build_reason="no embedded bundle yet"
else
    # Widened watch list — not just frontend/src. Vite also depends on the
    # HTML entry points, config files and public assets. Any of them being
    # newer than the static index means the bundle is out of date.
    watch_targets=(
        "$FRONTEND_DIR/src"
        "$FRONTEND_DIR/public"
        "$FRONTEND_DIR/index.html"
        "$FRONTEND_DIR/agent-town.html"
        "$FRONTEND_DIR/agent-valley.html"
        "$FRONTEND_DIR/package.json"
        "$FRONTEND_DIR/package-lock.json"
        "$FRONTEND_DIR/vite.config.ts"
        "$FRONTEND_DIR/vite.config.js"
        "$FRONTEND_DIR/tailwind.config.ts"
        "$FRONTEND_DIR/tailwind.config.js"
        "$FRONTEND_DIR/postcss.config.js"
        "$FRONTEND_DIR/postcss.config.cjs"
        "$FRONTEND_DIR/tsconfig.json"
        "$FRONTEND_DIR/tsconfig.app.json"
        "$FRONTEND_DIR/tsconfig.node.json"
    )
    existing=()
    for t in "${watch_targets[@]}"; do
        [ -e "$t" ] && existing+=("$t")
    done
    if [ "${#existing[@]}" -gt 0 ]; then
        newer=$(find "${existing[@]}" -type f -newer "$STATIC_INDEX" -print -quit 2>/dev/null || true)
        if [ -n "$newer" ]; then
            needs_build=1
            build_reason="detected newer source: $newer"
        fi
    fi
fi

if [ "$needs_build" -eq 1 ]; then
    if ! command -v npm >/dev/null 2>&1; then
        echo "❌ Frontend bundle needs rebuild ($build_reason) but npm is not available."
        echo "   Install Node.js (>=18), then:  cd frontend && npm run build"
        exit 1
    fi
    echo "🔧 Rebuilding frontend bundle  →  $build_reason"
    echo "   (log: $LOG_DIR/frontend-build.log)"
    if ! (cd "$FRONTEND_DIR" && npm run build) > "$LOG_DIR/frontend-build.log" 2>&1; then
        echo "❌ npm run build failed. Last 40 lines:"
        tail -n 40 "$LOG_DIR/frontend-build.log" || true
        echo ""
        echo "   Bundle at $STATIC_INDEX was NOT updated; refusing to start with"
        echo "   a stale UI. Fix the build error above and re-run start.sh, or"
        echo "   pass --skip-build to ignore this check."
        exit 1
    fi
    echo "✅ Frontend bundle rebuilt → $STATIC_DIR"
else
    if [ -f "$STATIC_INDEX" ]; then
        bundle_mtime=$(date -r "$STATIC_INDEX" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c %y "$STATIC_INDEX" 2>/dev/null || echo "?")
        echo "ℹ Embedded bundle looks up-to-date (built: $bundle_mtime). Use --force-build to rebuild anyway."
    fi
fi

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "⏹  Stopping processes on port $port (PIDs: $pids)"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# --- Stop existing processes ---
echo "🔄 Checking for running instances..."
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

# --- Start Backend ---
# API_PORT is read by src/xsafeclaw/config.py::Settings via pydantic-settings;
# the inline export below wins over anything in .env, so we guarantee uvicorn
# binds to $BACKEND_PORT regardless of stale .env values left from older
# installations that still use 6874.
echo "🚀 Starting backend (port $BACKEND_PORT)..."
cd "$PROJECT_DIR"
CHOKIDAR_USEPOLLING=true API_PORT="$BACKEND_PORT" nohup "$VENV_PYTHON" -m xsafeclaw \
    > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "   PID: $BACKEND_PID | Log: $LOG_DIR/backend.log"

# --- Start Frontend ---
# BACKEND_PORT is picked up by frontend/vite.config.ts (via process.env) so
# its /api proxy follows our chosen backend port. Keeping the env indirection
# here means users running "python run.py" on default port 6874 still get a
# working proxy because vite.config.ts falls back to 6874 when unset.
echo "🎨 Starting frontend (port $FRONTEND_PORT)..."
cd "$FRONTEND_DIR"
BACKEND_PORT="$BACKEND_PORT" nohup npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" \
    > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "   PID: $FRONTEND_PID | Log: $LOG_DIR/frontend.log"

# --- Wait & verify ---
echo ""
echo "⏳ Waiting for services to start..."
sleep 3

check_service() {
    local name=$1 port=$2 pid=$3
    if kill -0 "$pid" 2>/dev/null; then
        echo "✅ $name is running (PID: $pid, port: $port)"
    else
        echo "❌ $name failed to start — check $LOG_DIR/${name,,}.log"
    fi
}

check_service "Backend"  "$BACKEND_PORT"  "$BACKEND_PID"
check_service "Frontend" "$FRONTEND_PORT" "$FRONTEND_PID"

echo ""
echo "🌐 Frontend UI:  http://localhost:$FRONTEND_PORT    ← open this"
echo "📡 Backend API:  http://localhost:$BACKEND_PORT    (internal; Vite proxies /api here)"
echo "📁 Logs:         $LOG_DIR/"
echo ""
echo "To stop:  kill $BACKEND_PID $FRONTEND_PID"
echo "Tip:      bash start.sh --force-build   # only needed if you browse the backend port directly"
