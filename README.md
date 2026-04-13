
<div align="center">


<img src="assets/claw_logo.png" alt="XSafeClaw Logo" width="520" style="max-width: 100%; height: auto;">

[中文文档](README_zh.md)

**Build, Monitor, and Secure Your Agents**

[An Open-Source Agent Safety Platform](https://xsafeclaw.ai)

Real-time agent monitoring, security guardrails, and red-team testing for building reliable and safe AI agents.

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 🎬 Introducing XSafeClaw

<p align="center">
  <a href="https://youtu.be/HIqwFVeuiKs" title="XSafeClaw Introduction Video">
    <img src="assets/cover.png" alt="Introducing XSafeClaw: The Open-Source Agent Safety Platform from Fudan University">
  </a>
</p>


---

## 📰 News

<sub>Release notes and project milestones.</sub>

|      | Date       | Update                                                       |
| :--: | :--------- | :----------------------------------------------------------- |
|  🚀   | 2026-04-13 | **v 0.1.7 released** — First public release of XSafeClaw with Claw Monitor, Safe Chat, Asset Shield, Guard, Agent Office, and Onboard Setup. |

---

## 🔍 What is XSafeClaw?

XSafeClaw is a security-focused companion platform for [OpenClaw](https://openclaw.ai) AI agents. It monitors agent activity in real time, intercepts unsafe tool calls before they execute, scans system assets for risk, and provides automated red team testing — all from a single `xsafeclaw start` command.

| Module               | Description                                                  |
| :------------------- | :----------------------------------------------------------- |
| **Claw Monitor**     | Real-time session timeline with event tracking, token usage, tool call inspection, skills & memory scanning |
| **Safe Chat**        | Secure gateway to chat with your OpenClaw agent with built-in guard protection |
| **Asset Shield**     | File system scanning with risk classification (L0–L3), software audit, hardware inventory |
| **Guard (AgentDoG)** | Trajectory-level & tool-call-level safety evaluation with human-in-the-loop approval |
| **Agent Office**     | PixiJS-powered 2D visualization of all agents' status and activities |
| **Onboard Setup**    | Interactive wizard to install and configure OpenClaw CLI     |

---

## 🚀 Quick Start

```bash
pip install xsafeclaw
xsafeclaw start
```

Browser opens automatically at `http://127.0.0.1:6874`. If OpenClaw is not yet installed, the web UI will guide you through setup.

Common options:

```bash
xsafeclaw start --port 8080              # custom port
xsafeclaw start --host 0.0.0.0           # accessible from LAN
xsafeclaw start --no-browser --reload    # headless dev mode
```

---

## 🛡️ Guard: How It Works

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
```

When rejected (or timed out after 5 min), the agent is instructed to **stop all subsequent actions**, **inform the user about the risk**, and **wait for explicit confirmation**.

---

## 🏗️ Architecture

```
                     Browser (:6874)
                       │
           ┌───────────┴───────────┐
           │     FastAPI Server    │
           ├───────────────────────┤
           │   Guard Service       │◄── AgentDoG model
           │   File Watcher        │◄── ~/.openclaw/ JSONL sessions
           │   Asset Scanner       │◄── File/software/hardware scanning
           └───────────┬───────────┘
                       │
              ┌────────┴────────┐
              │                 │
         SQLite DB        OpenClaw Sessions
       ~/.xsafeclaw/       ~/.openclaw/

           OpenClaw Agent
               │ before_tool_call hook
               ▼
       safeclaw-guard plugin ──► POST /api/guard/tool-check
```

| Layer       | Technology                                        |
| :---------- | :------------------------------------------------ |
| Backend     | Python 3.11, FastAPI, SQLAlchemy (async), uvicorn |
| Frontend    | React 19, TypeScript, Vite, Tailwind CSS 4        |
| Database    | SQLite (via aiosqlite)                            |
| Guard Model | AgentDoG (configurable base URL & model)          |

Full API docs available at `http://localhost:6874/docs` when running.

---

## 📦 Installation

For detailed installation procedures, see the **[installation guide](docs/installation.pdf)**.

> [!TIP]
> Requires Python 3.11+. The frontend is pre-built and bundled — no Node.js needed for production.

```bash
# From PyPI (recommended)
pip install xsafeclaw

# From GitHub
pip install git+https://github.com/XSafeAI/XSafeClaw.git

# From source
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw && pip install .

# Development
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw && pip install -e ".[dev]"
```

### 🔌 Install the Guard Plugin

To enable real-time tool-call interception in OpenClaw:

```bash
cp -r plugins/safeclaw-guard ~/.openclaw/extensions/safeclaw-guard
```

Then add to `~/.openclaw/openclaw.json`:

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

## ⚙️ Configuration

XSafeClaw works out of the box with sensible defaults. Copy `.env.example` to `.env` to customize:

| Variable                | Default                            | Description                |
| :---------------------- | :--------------------------------- | :------------------------- |
| `API_PORT`              | `6874`                             | Server port                |
| `API_HOST`              | `0.0.0.0`                          | Bind address               |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw session directory |
| `GUARD_BASE_URL`        | *(auto-detected)*                  | Guard model API base URL   |
| `GUARD_BASE_MODEL`      | *(auto-detected)*                  | Guard model ID             |

If guard variables are not set, XSafeClaw reads model configuration from `~/.openclaw/openclaw.json` automatically. See `.env.example` for the full list.

---

## 🔧 Development

Prerequisites: Python 3.11+, Node.js 18+, [uv](https://docs.astral.sh/uv/) (recommended)

```bash
git clone https://github.com/XSafeAI/XSafeClaw.git && cd XSafeClaw

# Backend
uv venv && uv pip install -e ".[dev]"
python run.py                    # http://localhost:6874, auto-reload

# Frontend (separate terminal)
cd frontend && npm install && npm run dev   # http://localhost:3000, HMR

# Build frontend for production
cd frontend && npm run build     # outputs to src/xsafeclaw/static/
```

---

## ⭐ Star History

<a href="https://www.star-history.com/?repos=XSafeAI%2FXSafeClaw&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=XSafeAI/XSafeClaw&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=XSafeAI/XSafeClaw&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=XSafeAI/XSafeClaw&type=date&legend=top-left" />
 </picture>
</a>

---

## 🙏 Acknowledgements

- [**OpenClaw**](https://github.com/openclaw/openclaw) — The personal AI assistant platform that XSafeClaw is designed to protect. OpenClaw's open plugin architecture makes our guard integration possible.
- [**AgentDoG**](https://github.com/AI45Lab/AgentDoG) — The diagnostic guardrail framework for AI agent safety. XSafeClaw's guard module is powered by AgentDoG's trajectory-level risk assessment and fine-grained safety taxonomy.
- [**ISC-Bench**](https://github.com/wuyoscar/ISC-Bench) — Research on Internal Safety Collapse in frontier LLMs. ISC-Bench's insights into task-completion-driven safety failures have informed our red team testing design.
- [**AgentHazard**](https://github.com/Yunhao-Feng/AgentHazard) — A benchmark for evaluating harmful behavior in computer-use agents. AgentHazard's attack taxonomy and execution-level risk categories have shaped our threat modeling.

---

## ⚠️ Disclaimer

> [!CAUTION]
> XSafeClaw is a research tool intended for **improving the safety of AI agent systems**. The red team testing features are designed exclusively for defensive security research and evaluation purposes. **Do not use this tool to cause harm or engage in any malicious activities.**

---

## 💼 Commercial Use

XSafeClaw is open-sourced under the MIT License for academic research and personal use. For **commercial licensing, enterprise deployment, or collaboration**, please contact:

**Email:** xingjunma&#64;fudan.edu.cn


---

## 👥 Contributors

<a href="https://github.com/XSafeAI/XSafeClaw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=XSafeAI/XSafeClaw" />
</a>

We welcome contributions of all kinds — bug reports, feature requests, documentation, and code.

---

## 📄 License

[MIT](LICENSE)
