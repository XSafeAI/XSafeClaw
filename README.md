# XSafeClaw

<div align="center">

[中文文档](README_zh.md)

**Keeping Your Claw Safe.**

Real-time monitoring, security guard, and red team testing for OpenClaw AI agents.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## What is XSafeClaw?

XSafeClaw is a security-focused companion platform for [OpenClaw](https://openclaw.ai) AI agents. It monitors agent activity in real time, intercepts unsafe tool calls before they execute, scans system assets for risk, and provides automated red team testing — all from a single `xsafeclaw start` command.

### Core Modules

| Module | Description |
|---|---|
| **Claw Monitor** | Real-time session timeline with event tracking, token usage, tool call inspection, skills & memory scanning |
| **Safe Chat** | Secure gateway to chat with your OpenClaw agent with built-in guard protection |
| **Asset Shield** | File system scanning with risk classification (L0–L3), software audit, hardware inventory, and safety checks |
| **Guard (AgentDoG)** | Trajectory-level & tool-call-level safety evaluation with human-in-the-loop approval workflow |
| **Agent Office** | PixiJS-powered 2D visualization of all agents' status and activities |
| **Onboard Setup** | Interactive wizard to install and configure OpenClaw CLI |

### Guard: How It Works

XSafeClaw's guard system protects users through a two-layer defense:

1. **Trajectory-level evaluation** — The full conversation history is sent to a guard model (AgentDoG) that evaluates the entire interaction sequence for emerging risks across multiple turns.

2. **Tool-call interception** — Every tool call passes through a `before_tool_call` hook. If the guard model deems it unsafe, the call is held in a pending queue for human review.

```
Agent wants to run a tool
        │
        ▼
  Guard Model evaluates
        │
   ┌────┴────┐
   │         │
  Safe     Unsafe
   │         │
   ▼         ▼
 Execute   Hold for human review
           ┌────┴────┐
           │         │
        Approve    Reject
           │         │
           ▼         ▼
        Execute   Block + notify agent
                  "inform user of risk,
                   halt further actions"
```

When rejected (or timed out after 5 min), the agent receives an instruction to **stop all subsequent actions**, **inform the user about the risk**, and **wait for explicit confirmation** before proceeding.

### Event Status Model

Each interaction round (Event) follows this lifecycle:

| Status | Meaning |
|---|---|
| `running` | Agent is actively processing |
| `pending` | Tool call is held by guard, awaiting human approval |
| `completed` | Agent finished the round normally |
| `fail` | Agent finished after a guard rejection |
| `error` | An error occurred during processing |

---

## Installation

### Option A: Install from GitHub (recommended)

```bash
pip install git+https://github.com/dyf-2316/XSafeClaw.git
```

### Option B: Clone and install locally

```bash
git clone https://github.com/dyf-2316/XSafeClaw.git
cd XSafeClaw
pip install .
```

### Option C: Development install

```bash
git clone https://github.com/dyf-2316/XSafeClaw.git
cd XSafeClaw
pip install -e ".[dev]"
```

> Requires Python 3.11+. The frontend is pre-built and bundled — no Node.js needed for production.

### Install the Guard Plugin

To enable real-time tool-call interception, install the safeclaw-guard plugin into your OpenClaw instance:

```bash
cp -r plugins/safeclaw-guard ~/.openclaw/extensions/safeclaw-guard
```

Then add it to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "safeclaw-guard": {
        "path": "~/.openclaw/extensions/safeclaw-guard"
      }
    }
  }
}
```

---

## Quick Start

```bash
xsafeclaw start
```

Browser opens automatically at `http://127.0.0.1:6874`. The database is created at `~/.xsafeclaw/data.db` on first launch.

If OpenClaw is not yet installed, the web UI will guide you through an interactive setup wizard.

### CLI Reference

```
Usage: xsafeclaw [OPTIONS] COMMAND [ARGS]...

Commands:
  start    Start the XSafeClaw server
  version  Show XSafeClaw version

Options for `xsafeclaw start`:
  -p, --port INTEGER       Server port              [default: 6874]
  -h, --host TEXT          Bind address             [default: 127.0.0.1]
      --no-browser         Don't open browser automatically
      --reload             Enable auto-reload (dev mode)
```

Examples:

```bash
xsafeclaw start                          # default settings
xsafeclaw start --port 8080              # custom port
xsafeclaw start --host 0.0.0.0           # accessible from LAN
xsafeclaw start --no-browser --reload    # headless dev mode
```

---

## Architecture

```
                     Browser
                       │
               :6874 (production)
               :3000 (dev, proxied)
                       │
           ┌───────────┴───────────┐
           │     FastAPI Server    │
           │                       │
           │  /api/*   REST APIs   │
           │  /*       Static SPA  │
           ├───────────────────────┤
           │   Guard Service       │◄── AgentDoG model (trajectory + tool-call evaluation)
           │   File Watcher        │◄── Watches ~/.openclaw/ JSONL sessions in real time
           │   Asset Scanner       │◄── File/software/hardware scanning
           └───────────┬───────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
      SQLite DB           OpenClaw Sessions
    ~/.xsafeclaw/           ~/.openclaw/
      data.db            agents/main/sessions/

           OpenClaw Agent
               │
               │ before_tool_call hook
               ▼
       safeclaw-guard plugin ──► POST /api/guard/tool-check
       (long-polls until human resolves or timeout)
```

### Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy (async), uvicorn |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4 |
| Database | SQLite (via aiosqlite) |
| CLI | Typer + Rich |
| File Sync | Watchdog (real-time JSONL parsing) |
| Agent Office | PixiJS 2D rendering |
| Guard Model | AgentDoG (configurable base URL & model) |

---

## Project Structure

```
XSafeClaw/
├── src/xsafeclaw/                     # Python package
│   ├── cli.py                        # CLI entry (xsafeclaw start)
│   ├── config.py                     # Settings (pydantic-settings)
│   ├── database.py                   # SQLite async engine
│   ├── gateway_client.py             # OpenClaw gateway WebSocket client
│   ├── api/
│   │   ├── main.py                   # FastAPI app + static serving
│   │   └── routes/
│   │       ├── sessions.py           # Session CRUD
│   │       ├── events.py             # Event timeline & stats
│   │       ├── messages.py           # Message history
│   │       ├── stats.py              # Token & usage stats
│   │       ├── assets.py             # Hardware, file, software scanning
│   │       ├── redteam.py            # Red team attack generation
│   │       ├── chat.py               # Agent chat gateway
│   │       ├── guard.py              # Tool-call guard & pending approvals
│   │       ├── trace.py              # Aggregated trace for Agent Office
│   │       ├── skills.py             # Skill file scanning
│   │       ├── memory.py             # Memory file scanning
│   │       └── system.py             # OpenClaw install & onboard
│   ├── models/                       # ORM models
│   │   ├── session.py                # Session (conversation container)
│   │   ├── message.py                # Message (user/assistant/toolResult)
│   │   ├── event.py                  # Event (interaction round)
│   │   └── tool_call.py              # ToolCall (individual tool execution)
│   ├── services/
│   │   ├── guard_service.py          # AgentDoG guard logic & pending queue
│   │   ├── message_sync_service.py   # JSONL → DB synchronization
│   │   ├── event_sync_service.py     # Message → Event aggregation
│   │   ├── skill_scan_service.py     # SKILL.md safety scanning
│   │   └── memory_scan_service.py    # Memory file safety scanning
│   ├── asset_scanner/                # System asset scanner
│   └── static/                       # Built frontend (auto-generated)
├── frontend/                         # React SPA
│   ├── src/
│   │   ├── pages/                    # Monitor, Chat, Assets, RiskScanner, etc.
│   │   ├── components/               # Layout, shared UI
│   │   ├── features/world/           # Agent Office (PixiJS visualization)
│   │   ├── services/api.ts           # Axios API client
│   │   └── i18n/                     # English & Chinese translations
│   └── vite.config.ts
├── plugins/
│   └── safeclaw-guard/               # OpenClaw guard plugin
│       ├── index.ts                  # before_tool_call + before_prompt_build hooks
│       └── openclaw.plugin.json      # Plugin manifest
├── external/                         # External data (RedWork attack instructions)
├── pyproject.toml                    # Package metadata
├── run.py                            # Dev server script
└── .env.example                      # Configuration template
```

---

## Development Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (recommended) or pip

### 1. Clone & Install Backend

```bash
git clone https://github.com/dyf-2316/XSafeClaw.git
cd XSafeClaw

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

Backend runs at `http://localhost:6874` with auto-reload.

### 5. Start Frontend (Terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs at `http://localhost:3000` with HMR. API calls are proxied to the backend automatically.

### 6. Build Frontend

```bash
cd frontend
npm run build
```

Outputs to `src/xsafeclaw/static/`. After building, `xsafeclaw start` serves the embedded frontend directly.

---

## Configuration

XSafeClaw reads settings from environment variables or a `.env` file:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `~/.xsafeclaw/data.db` | SQLite database path (auto-created) |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw session JSONL directory |
| `API_HOST` | `0.0.0.0` | Server bind address |
| `API_PORT` | `6874` | Server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `ENABLE_FILE_WATCHER` | `true` | Auto-watch and sync session files |
| `WATCH_INTERVAL_SECONDS` | `1` | File watcher polling interval |
| `DATA_DIR` | `~/.xsafeclaw` | Data directory for DB and config |

### Guard Configuration

The guard model can be configured via environment variables or auto-detected from OpenClaw's config:

| Variable | Description |
|---|---|
| `GUARD_BASE_URL` | Guard model API base URL |
| `GUARD_BASE_MODEL` | Model ID for base guard evaluation |
| `GUARD_FG_URL` | Fine-grained guard model API base URL |
| `GUARD_FG_MODEL` | Model ID for fine-grained evaluation |
| `GUARD_API_KEY` | API key for the guard model |
| `GUARD_TIMEOUT` | Guard model request timeout (seconds) |

If not set, XSafeClaw reads model configuration from `~/.openclaw/openclaw.json` automatically.

---

## API Overview

All endpoints are prefixed with `/api`. Full OpenAPI docs available at `http://localhost:6874/docs`.

| Prefix | Description |
|---|---|
| `/api/sessions` | List, inspect, and delete agent sessions |
| `/api/events` | Query interaction events with timing and stats |
| `/api/messages` | Browse messages with content and token info |
| `/api/stats` | Aggregated stats by model, daily usage, overview |
| `/api/assets` | Hardware scan, file scan, software audit, safety check |
| `/api/redteam` | List instructions, generate decomposed attacks |
| `/api/chat` | Start sessions, send messages to OpenClaw agent |
| `/api/guard` | Guard evaluation, tool-check (long-poll), pending approvals |
| `/api/trace` | Aggregated agent/event data for Agent Office |
| `/api/skills` | Skill file listing and safety scanning |
| `/api/memory` | Memory file listing and safety scanning |
| `/api/system` | OpenClaw status, install, onboard |

---

## Internationalization

XSafeClaw supports English and Chinese (中文). Switch languages from the sidebar at any time.

---

## License

MIT
