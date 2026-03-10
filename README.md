# SafeClaw

<div align="center">

**Keeping Your Claw Safe.**

Real-time monitoring, security scanning, and red team testing for OpenClaw AI agents.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## What is SafeClaw?

SafeClaw is a security-focused companion for [OpenClaw](https://openclaw.ai) AI agents. It provides a unified dashboard to monitor agent activity, scan system assets, and perform automated red team testing — all from a single `safeclaw start` command.

### Core Modules

| Module | Description |
|---|---|
| **Claw Monitor** | Real-time session timeline with event tracking, token usage, and tool call inspection |
| **Safe Chat** | Secure gateway to chat with your OpenClaw agent through a managed interface |
| **Asset Shield** | Hardware inventory, file system scanning, software audit, and security risk assessment |
| **Red Teaming** | Automated multi-turn attack simulation — select a category, generate decomposed attacks, and execute them against a live agent |
| **Onboard Setup** | Interactive wizard to install and configure OpenClaw CLI with full PTY support |

---

## Installation

### Option A: Install from GitHub (recommended)

```bash
pip install git+https://github.com/dyf-2316/SafeClaw.git
```

### Option B: Clone and install locally

```bash
git clone https://github.com/dyf-2316/SafeClaw.git
cd SafeClaw
pip install .
```

### Option C: Development install

```bash
git clone https://github.com/dyf-2316/SafeClaw.git
cd SafeClaw
pip install -e ".[dev]"
```

> Requires Python 3.11+. The frontend is pre-built and bundled in the package — no Node.js needed for production use.

---

## Quick Start

```bash
safeclaw start
```

Browser opens automatically at `http://127.0.0.1:6874`. Database is created at `~/.safeclaw/data.db` on first launch.

### CLI Reference

```
Usage: safeclaw [OPTIONS] COMMAND [ARGS]...

Commands:
  start    Start the SafeClaw server
  version  Show SafeClaw version

Options for `safeclaw start`:
  -p, --port INTEGER       Server port              [default: 6874]
  -h, --host TEXT          Bind address             [default: 127.0.0.1]
      --no-browser         Don't open browser automatically
      --reload             Enable auto-reload (dev mode)
```

Examples:

```bash
safeclaw start                          # default settings
safeclaw start --port 8080              # custom port
safeclaw start --host 0.0.0.0           # accessible from LAN
safeclaw start --no-browser --reload    # headless dev mode
```

---

## Development Setup

For contributing or modifying SafeClaw, run the backend and frontend as separate processes with hot reload.

### Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### 1. Clone & Install Backend

```bash
git clone https://github.com/dyf-2316/SafeClaw.git
cd SafeClaw

uv venv
uv pip install -e ".[dev]"
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Configure Environment (optional)

```bash
cp .env.example .env
```

Defaults work out of the box. Edit `.env` only if you need to change ports or paths.

### 4. Start Backend (Terminal 1)

```bash
source .venv/bin/activate
python run.py
```

Backend runs at `http://localhost:6874` with auto-reload enabled.

### 5. Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs at `http://localhost:3000` with HMR. API calls are proxied to the backend automatically.

### 6. Build Frontend into Package

```bash
cd frontend
npm run build
```

Outputs to `src/safeclaw/static/`. After building, `safeclaw start` serves the embedded frontend directly.

---

## Architecture

```
                  Browser
                    |
            :6874 (production)
            :3000 (dev, proxied)
                    |
        +-----------+-----------+
        |     FastAPI Server    |
        |                       |
        |  /api/*   REST APIs   |
        |  /*       Static SPA  |
        +-----------+-----------+
                    |
        +-----------+-----------+
        |                       |
   SQLite DB           OpenClaw Sessions
 ~/.safeclaw/           ~/.openclaw/
   data.db            agents/main/sessions/
```

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy (async), uvicorn |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Database | SQLite (via aiosqlite) |
| CLI | Typer + Rich |
| File Sync | Watchdog (real-time JSONL parsing) |

---

## Project Structure

```
SafeClaw/
├── src/safeclaw/                  # Python package
│   ├── cli.py                     # CLI entry point (safeclaw start)
│   ├── config.py                  # Settings (pydantic-settings)
│   ├── database.py                # SQLite async engine
│   ├── gateway_client.py          # OpenClaw gateway client
│   ├── api/
│   │   ├── main.py                # FastAPI app + static serving
│   │   └── routes/
│   │       ├── sessions.py        # Session CRUD
│   │       ├── events.py          # Event timeline
│   │       ├── messages.py        # Message history
│   │       ├── stats.py           # Token & usage stats
│   │       ├── assets.py          # Hardware & file scanning
│   │       ├── redteam.py         # Red team attack generation
│   │       ├── chat.py            # Agent chat gateway
│   │       ├── system.py          # OpenClaw install/onboard (PTY)
│   │       ├── guard.py           # AgentDoG safety guard
│   │       └── trace.py           # Trace inspection
│   ├── models/                    # ORM models (Session, Message, Event, ToolCall)
│   ├── services/                  # Background sync & stats
│   ├── asset_scanner/             # System asset scanner
│   └── static/                    # Built frontend (auto-generated)
├── frontend/                      # React SPA
│   ├── src/
│   │   ├── pages/                 # Monitor, Chat, Assets, RiskScanner, Setup, Home
│   │   ├── components/            # Layout, shared UI
│   │   └── services/api.ts        # Axios API client
│   └── vite.config.ts
├── external/                      # External tools (RedWork data)
├── pyproject.toml                 # Package metadata
├── run.py                         # Dev server script
└── .env.example                   # Configuration template
```

---

## Configuration

SafeClaw reads settings from environment variables or a `.env` file:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `~/.safeclaw/data.db` | Database path (auto-created) |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw session JSONL directory |
| `API_HOST` | `0.0.0.0` | Server bind address |
| `API_PORT` | `6874` | Server port |
| `LOG_LEVEL` | `INFO` | Logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |
| `ENABLE_FILE_WATCHER` | `true` | Auto-watch and sync session files |
| `WATCH_INTERVAL_SECONDS` | `1` | File watcher polling interval |
| `DATA_DIR` | `~/.safeclaw` | Data directory for DB and config |

---

## API Overview

All endpoints are prefixed with `/api`. Full OpenAPI docs available at `http://localhost:6874/docs` when running.

| Prefix | Description |
|---|---|
| `/api/sessions` | List, inspect, and delete agent sessions |
| `/api/events` | Query interaction events with timing and stats |
| `/api/messages` | Browse messages with content and token info |
| `/api/stats` | Aggregated stats by model, daily usage, overview |
| `/api/assets` | Hardware scan, file scan, software audit, safety check |
| `/api/redteam` | List instructions, generate decomposed attacks |
| `/api/chat` | Start sessions, send messages to OpenClaw agent |
| `/api/system` | OpenClaw status, install, onboard (PTY streaming) |
| `/api/guard` | AgentDoG safety check for sessions |
| `/api/trace` | Trace and inspect agent execution |

---

## License

MIT
