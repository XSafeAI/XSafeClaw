#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=6874
FRONTEND_PORT=3003
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"
LOG_DIR="$PROJECT_DIR/.logs"

mkdir -p "$LOG_DIR"

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
echo "🚀 Starting backend (port $BACKEND_PORT)..."
cd "$PROJECT_DIR"
CHOKIDAR_USEPOLLING=true nohup "$VENV_PYTHON" -m xsafeclaw \
    > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "   PID: $BACKEND_PID | Log: $LOG_DIR/backend.log"

# --- Start Frontend ---
echo "🎨 Starting frontend (port $FRONTEND_PORT)..."
cd "$PROJECT_DIR/frontend"
nohup npx vite --host 0.0.0.0 --port "$FRONTEND_PORT" \
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
echo "📡 Backend API:  http://localhost:$BACKEND_PORT"
echo "🌐 Frontend UI:  http://localhost:$FRONTEND_PORT"
echo "📁 Logs:         $LOG_DIR/"
echo ""
echo "To stop:  kill $BACKEND_PID $FRONTEND_PID"
