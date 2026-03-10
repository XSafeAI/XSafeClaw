# SafeClaw

<div align="center">

**Keeping Your Claw Safe.**

Real-time monitoring, security scanning, and red team testing for OpenClaw AI agents.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## Quick Start (Production)

### 1. Install

```bash
pip install safeclaw
```

### 2. Run

```bash
safeclaw start
```

Browser opens automatically at `http://127.0.0.1:6874`.

That's it. Database (`~/.safeclaw/data.db`) is created automatically.

### CLI Options

```bash
safeclaw start                     # default: 127.0.0.1:6874
safeclaw start --port 8080         # custom port
safeclaw start --host 0.0.0.0      # bind to all interfaces
safeclaw start --no-browser        # don't open browser
safeclaw version                   # show version
```

---

## Development Setup

For contributing or local development, you need to run the backend and frontend separately.

### Prerequisites

- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/) (Python package manager)

### 1. Clone & Install Backend

```bash
git clone https://github.com/your-org/safeclaw.git
cd safeclaw

# Create virtual environment and install dependencies
uv venv
uv pip install -e ".[dev]"
```

### 2. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env if needed (defaults work out of the box)
```

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

Frontend runs at `http://localhost:3000` with hot module replacement. API requests are proxied to the backend automatically.

### 6. Build Frontend for Production

When you want to bundle the frontend into the Python package:

```bash
cd frontend
npm run build
```

This outputs static files to `src/safeclaw/static/`. After building, `safeclaw start` will serve the embedded frontend directly — no separate frontend server needed.

---

## Features

- **Claw Monitor** — Real-time agent session monitoring with timeline visualization
- **Safe Chat** — Secure gateway to chat with your OpenClaw agent
- **Asset Shield** — Hardware info, file scanning, and security assessment
- **Red Teaming** — Automated multi-turn attack simulation against AI agents
- **Onboard Setup** — Interactive OpenClaw installation and configuration wizard

---

## Project Structure

```
safeclaw/
├── src/safeclaw/              # Python package
│   ├── cli.py                 # CLI entry point (safeclaw start)
│   ├── config.py              # Configuration (pydantic-settings)
│   ├── database.py            # SQLite/SQLAlchemy async setup
│   ├── api/                   # FastAPI app and routes
│   │   ├── main.py            # App factory + static file serving
│   │   └── routes/            # API endpoints
│   ├── models/                # SQLAlchemy ORM models
│   ├── services/              # Background sync services
│   ├── asset_scanner/         # System asset scanning
│   └── static/                # Built frontend (auto-generated)
├── frontend/                  # React + Vite + Tailwind
│   ├── src/
│   │   ├── pages/             # Page components
│   │   ├── components/        # Shared components
│   │   └── services/          # API client
│   └── vite.config.ts
├── pyproject.toml             # Package metadata & dependencies
├── run.py                     # Dev server launcher
└── .env                       # Local configuration
```

---

## Configuration

SafeClaw uses environment variables (or `.env` file) for configuration:

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `~/.safeclaw/data.db` | SQLite database path |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw session files |
| `API_HOST` | `0.0.0.0` | Server bind address |
| `API_PORT` | `6874` | Server port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `ENABLE_FILE_WATCHER` | `true` | Auto-watch session files |

---

## License

MIT
