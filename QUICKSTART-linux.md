# SafeClaw Quick Start (Linux)

## 1) Prerequisites

- Linux (Ubuntu 22.04+ recommended)
- Python 3.11+
- Node.js 18+ (only needed for frontend development)
- OpenClaw installed or install through SafeClaw Setup page

## 2) Backend (Terminal 1)

```bash
cd /path/to/SafeClaw
python run.py
```

Backend default URL: `http://localhost:6874`

## 3) Frontend Dev (Terminal 2)

```bash
cd /path/to/SafeClaw/frontend
npm install
npm run dev
```

Frontend dev URL: `http://localhost:3000` (proxied to backend `:6874`).

## 4) OpenClaw/Gateway

If Chat cannot connect, ensure OpenClaw is available:

```bash
openclaw dashboard
# or
openclaw gateway
```

## 5) Optional platform override for gateway device-auth

SafeClaw auto-detects platform by default. To force a platform value:

```bash
export SAFECLAW_CLIENT_PLATFORM=linux
```

(Use only when you explicitly need to match a target environment.)
