# XSafeClaw

<div align="center">

[English](README.md)

**守护你的 Claw 安全。**

面向 OpenClaw AI 智能体的实时监控、路径防护、Guard 审批与风险测试平台。

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## XSafeClaw 是什么？

XSafeClaw 是 [OpenClaw](https://openclaw.ai) AI 智能体的安全监控与防护平台。它能够实时监控智能体活动、在不安全的工具调用执行前拦截、扫描系统资产评估风险、允许用户自定义路径防护，并提供内置风险测试工作台用于对抗式安全检查——只需一条 `xsafeclaw start` 命令即可启动全部功能。

### 核心模块

| 模块 | 说明 |
|---|---|
| **安全监控 (Claw Monitor)** | 实时会话时间线，包含事件追踪、Token 用量、工具调用检查、技能与记忆扫描 |
| **安全对话 (Safe Chat)** | 与 OpenClaw 智能体安全对话的网关，内置 Guard 防护 |
| **资产防护 (Asset Shield)** | 文件系统扫描与风险分级（L0–L3）、软件审计、硬件清单、安全检查，以及自定义路径防护 |
| **风险测试 (Risk Test)** | 内置对抗测试工作台，可把恶意意图包装成更真实的攻击话术，用来测试智能体是否保持安全 |
| **安全守卫 (Guard / AgentDoG)** | 轨迹级与工具调用级安全评估，支持人工审批工作流 |
| **智能体办公室 (Agent Office)** | 基于 PixiJS 的 2D 可视化界面，集中查看所有智能体状态与活动 |
| **引导安装 (Onboard Setup)** | 交互式向导，引导安装和配置 OpenClaw CLI |

### Guard：工作原理

XSafeClaw 的安全守卫通过双层防御保护用户：

1. **轨迹级评估** — 将完整对话历史发送至守卫模型（AgentDoG），评估整个交互序列中可能跨多轮涌现的风险。

2. **工具调用拦截** — 每次工具调用都经过 `before_tool_call` 钩子。如果守卫模型判定为不安全，该调用会被挂起，等待人工审批。

```
智能体请求执行工具
        │
        ▼
   守卫模型评估
        │
   ┌────┴────┐
   │         │
  安全      不安全
   │         │
   ▼         ▼
  执行     挂起等待人工审批
           ┌────┴────┐
           │         │
         批准       拒绝
           │         │
           ▼         ▼
         执行     阻止 + 通知智能体
                  "告知用户风险，
                   暂停后续操作"
```

当工具调用被拒绝（或超时 5 分钟未处理）时，智能体会收到指令要求：**立即停止后续操作**、**告知用户风险**、**等待用户明确确认后再继续**。

### 事件状态模型

每一轮交互（Event）遵循以下生命周期：

| 状态 | 含义 |
|---|---|
| `running` | 智能体正在处理中 |
| `pending` | 工具调用被守卫拦截，等待人工审批 |
| `completed` | 智能体正常完成该轮交互 |
| `fail` | 智能体在守卫拒绝后完成（工具调用被阻止） |
| `error` | 处理过程中发生错误 |

---

## 安装

### 方式 A：从 GitHub 安装（推荐）

```bash
pip install git+https://github.com/XSafeAI/XSafeClaw.git
```

### 方式 B：克隆后本地安装

```bash
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw
pip install .
```

### 方式 C：开发模式安装

```bash
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw
pip install -e ".[dev]"
```

> 需要 Python 3.11+。前端已预构建并打包，生产环境无需安装 Node.js。

### 安装 Guard 插件

如需启用实时工具调用拦截，需将 safeclaw-guard 插件安装到 OpenClaw 中：

```bash
cp -r plugins/safeclaw-guard ~/.openclaw/extensions/safeclaw-guard
```

然后在 OpenClaw 配置文件（`~/.openclaw/openclaw.json`）中添加：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["safeclaw-guard"],
    "entries": {
      "safeclaw-guard": {
        "enabled": true
      }
    }
  }
}
```

---

## 快速开始

```bash
xsafeclaw start
```

浏览器会自动打开 `http://127.0.0.1:6874`。首次启动时数据库会自动创建在 `~/.xsafeclaw/data.db`。

如果尚未安装 OpenClaw，Web 界面会引导你完成交互式安装向导。

### 关键工作流

- **资产防护 → 权限 → 路径防护**：把目录或文件加入保护列表后，Guard 会阻止智能体访问该路径及其子路径。移除后会立刻恢复正常访问。
- **风险测试**：可直接选择内置攻击案例，或输入自定义恶意意图。XSafeClaw 会把它包装成更真实的攻击话术，用来测试智能体是否会拒绝危险行为。

### CLI 参考

```
用法: xsafeclaw [OPTIONS] COMMAND [ARGS]...

命令:
  start    启动 XSafeClaw 服务器
  version  显示版本号

`xsafeclaw start` 选项:
  -p, --port INTEGER       服务端口              [默认: 6874]
  -h, --host TEXT          绑定地址             [默认: 127.0.0.1]
      --no-browser         不自动打开浏览器
      --reload             启用热重载（开发模式）
```

示例：

```bash
xsafeclaw start                          # 默认设置
xsafeclaw start --port 8080              # 自定义端口
xsafeclaw start --host 0.0.0.0           # 局域网可访问
xsafeclaw start --no-browser --reload    # 无头开发模式
```

---

## 架构

```
                     浏览器
                       │
               :6874 (生产环境)
               :3000 (开发环境，代理转发)
                       │
           ┌───────────┴───────────┐
           │     FastAPI 服务器     │
           │                       │
           │  /api/*   REST APIs   │
           │  /*       静态 SPA    │
           ├───────────────────────┤
           │   Guard 服务          │◄── AgentDoG 模型（轨迹 + 工具调用评估）
           │   文件监听器           │◄── 实时监听 ~/.openclaw/ JSONL 会话
           │   资产扫描器           │◄── 文件/软件/硬件扫描
           └───────────┬───────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
      SQLite 数据库        OpenClaw 会话文件
    ~/.xsafeclaw/           ~/.openclaw/
      data.db            agents/main/sessions/

           OpenClaw 智能体
               │
               │ before_tool_call 钩子
               ▼
       safeclaw-guard 插件 ──► POST /api/guard/tool-check
       （长轮询，直到人工处理或超时）
```

### 技术栈

| 层级 | 技术 |
|---|---|
| 后端 | Python 3.11, FastAPI, SQLAlchemy (async), uvicorn |
| 前端 | React 19, TypeScript, Vite, Tailwind CSS 4 |
| 数据库 | SQLite (aiosqlite) |
| CLI | Typer + Rich |
| 文件同步 | Watchdog（实时 JSONL 解析） |
| 智能体办公室 | PixiJS 2D 渲染 |
| 守卫模型 | AgentDoG（可配置 Base URL 和模型） |

---

## 项目结构

```
XSafeClaw/
├── src/xsafeclaw/                     # Python 主包
│   ├── cli.py                        # CLI 入口 (xsafeclaw start)
│   ├── config.py                     # 配置 (pydantic-settings)
│   ├── database.py                   # SQLite 异步引擎
│   ├── gateway_client.py             # OpenClaw 网关 WebSocket 客户端
│   ├── api/
│   │   ├── main.py                   # FastAPI 应用 + 静态文件服务
│   │   └── routes/
│   │       ├── sessions.py           # 会话 CRUD
│   │       ├── events.py             # 事件时间线与统计
│   │       ├── messages.py           # 消息历史
│   │       ├── stats.py              # Token 用量统计
│   │       ├── assets.py             # 硬件、文件、软件扫描 + 路径防护
│   │       ├── redteam.py            # 红队攻击生成
│   │       ├── risk_test.py          # 内置风险测试接口
│   │       ├── chat.py               # 智能体对话网关
│   │       ├── guard.py              # 工具调用守卫与待审批队列
│   │       ├── trace.py              # 智能体办公室聚合数据
│   │       ├── skills.py             # 技能文件扫描
│   │       ├── memory.py             # 记忆文件扫描
│   │       └── system.py             # OpenClaw 安装与引导
│   ├── models/                       # ORM 模型
│   │   ├── session.py                # Session（会话容器）
│   │   ├── message.py                # Message（用户/助手/工具结果）
│   │   ├── event.py                  # Event（交互轮次）
│   │   └── tool_call.py              # ToolCall（单次工具执行）
│   ├── services/
│   │   ├── guard_service.py          # AgentDoG 守卫逻辑与待审批队列
│   │   ├── message_sync_service.py   # JSONL → 数据库同步
│   │   ├── event_sync_service.py     # 消息 → 事件聚合
│   │   ├── risk_test_service.py      # 多语言风险测试案例生成
│   │   ├── skill_scan_service.py     # SKILL.md 安全扫描
│   │   └── memory_scan_service.py    # 记忆文件安全扫描
│   ├── asset_scanner/                # 系统资产扫描器
│   └── static/                       # 构建后的前端（自动生成）
├── frontend/                         # React SPA
│   ├── src/
│   │   ├── pages/                    # Monitor, Chat, Assets, RiskTest, RiskScanner 等
│   │   ├── components/               # Layout 等共享组件
│   │   ├── features/world/           # 智能体办公室（PixiJS 可视化）
│   │   ├── services/api.ts           # Axios API 客户端
│   │   └── i18n/                     # 中英文翻译
│   └── vite.config.ts
├── plugins/
│   └── safeclaw-guard/               # OpenClaw 守卫插件
│       ├── index.ts                  # before_tool_call + before_prompt_build 钩子
│       └── openclaw.plugin.json      # 插件清单
├── external/                         # 外部数据（RedWork 攻击指令集）
├── pyproject.toml                    # 包元数据
├── run.py                            # 开发服务器脚本
└── .env.example                      # 配置模板
```

---

## 开发环境搭建

### 前提条件

- Python 3.11+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/)（推荐）或 pip

### 1. 克隆并安装后端

```bash
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw

uv venv
uv pip install -e ".[dev]"
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
cd ..
```

### 3. 配置环境变量（可选）

```bash
cp .env.example .env
```

默认配置开箱即用，仅在需要修改端口或路径时编辑 `.env`。

### 4. 启动后端（终端 1）

```bash
source .venv/bin/activate
python run.py
```

后端运行在 `http://localhost:6874`，支持热重载。

### 5. 启动前端（终端 2）

```bash
cd frontend
npm run dev
```

前端运行在 `http://localhost:3000`，支持 HMR。API 请求会自动代理到后端。

### 6. 构建前端

```bash
cd frontend
npm run build
```

输出到 `src/xsafeclaw/static/`。构建后，`xsafeclaw start` 会直接提供内嵌的前端。

---

## 配置说明

XSafeClaw 从环境变量或 `.env` 文件读取配置：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_URL` | `~/.xsafeclaw/data.db` | SQLite 数据库路径（自动创建） |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw 会话 JSONL 目录 |
| `API_HOST` | `0.0.0.0` | 服务器绑定地址 |
| `API_PORT` | `6874` | 服务器端口 |
| `LOG_LEVEL` | `INFO` | 日志级别 |
| `ENABLE_FILE_WATCHER` | `true` | 自动监听并同步会话文件 |
| `WATCH_INTERVAL_SECONDS` | `1` | 文件监听轮询间隔 |
| `DATA_DIR` | `~/.xsafeclaw` | 数据库和配置的存储目录 |

### Guard 配置

守卫模型可通过环境变量配置，也可从 OpenClaw 配置文件自动检测：

| 变量 | 说明 |
|---|---|
| `GUARD_BASE_URL` | 守卫模型 API 基础 URL |
| `GUARD_BASE_MODEL` | 基础守卫评估的模型 ID |
| `GUARD_FG_URL` | 细粒度守卫模型 API 基础 URL |
| `GUARD_FG_MODEL` | 细粒度评估的模型 ID |
| `GUARD_API_KEY` | 守卫模型的 API Key |
| `GUARD_TIMEOUT` | 守卫模型请求超时时间（秒） |

如未配置，XSafeClaw 会自动从 `~/.openclaw/openclaw.json` 读取模型配置。

---

## API 概览

所有接口以 `/api` 为前缀。运行时可访问 `http://localhost:6874/docs` 查看完整的 OpenAPI 文档。

| 前缀 | 说明 |
|---|---|
| `/api/sessions` | 会话的列表、查看和删除 |
| `/api/events` | 查询交互事件，含时间和统计信息 |
| `/api/messages` | 浏览消息内容和 Token 信息 |
| `/api/stats` | 按模型、按日的汇总统计 |
| `/api/assets` | 硬件扫描、文件扫描、软件审计、安全检查、基于 denylist 的路径防护 |
| `/api/redteam` | 红队攻击指令列表与分解攻击生成 |
| `/api/risk-test` | 内置风险测试、多语言示例与安全测试案例 |
| `/api/chat` | 创建会话、向 OpenClaw 智能体发送消息 |
| `/api/guard` | 守卫评估、工具检查（长轮询）、待审批管理 |
| `/api/trace` | 智能体办公室的聚合数据 |
| `/api/skills` | 技能文件列表与安全扫描 |
| `/api/memory` | 记忆文件列表与安全扫描 |
| `/api/system` | OpenClaw 状态、安装、引导 |

---

## 国际化

XSafeClaw 支持中文和英文（English）。可随时在侧边栏切换语言。

---

## 许可证

MIT
