[English](README.md) · [中文文档](README_zh.md)

# XSafeClaw

<div align="center">

<img src="assets/logo.png" alt="XSafeClaw Logo" width="520" style="max-width: 100%; height: auto;">

[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.109+-green.svg)](https://fastapi.tiangolo.com/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**构建、监控并保护你的智能体**

</div>

> AI 智能体不只是新软件，它们是可以被「说服」去做危险事情的软件。随着智能体从聊天机器人演变为能够浏览网页、执行代码、接入真实工作流的主动系统，我们在还没想好如何「上锁」之前，就已经把基础设施的钥匙交给了语言模型。
>
> 这从根本上打破了传统安全假设。在常规系统中，行为由代码定义；在智能体中，行为在运行时由指令、检索内容、记忆和长链路决策循环动态涌现。攻击者不再需要利用漏洞，他们可以操纵智能体的推理、重定向其执行轨迹，或将小权限逐步扩大。提示注入、工具滥用、静默权限提升不是边缘情况，而是执行模型的结构性属性。大多数团队只在事后读日志时才发现问题——那是取证，不是安全。
>
> **XSafeClaw** 正是为此而生。它是一个开源智能体防御平台，将智能体安全视为实时控制问题，而非事后复盘。在智能体时代，没有防御的能力不是进步，而是未受管理的暴露风险。

🚀 <a href="#-快速开始">快速开始</a> &nbsp;·&nbsp;
📖 <a href="docs/installation.md">安装文档</a> &nbsp;·&nbsp;
🌐 <a href="https://xsafeclaw.ai">项目官网</a> &nbsp;·&nbsp;
▶️ <a href="https://youtu.be/HIqwFVeuiKs">演示视频</a>

---

## 🎬 XSafeClaw 介绍

<p align="center">
  <a href="https://youtu.be/HIqwFVeuiKs" title="XSafeClaw 介绍视频">
    <img src="assets/cover.png" alt="XSafeClaw：来自复旦大学的开源智能体安全平台">
  </a>
</p>

---

## 📰 最新动态

<sub>版本发布与项目里程碑。</sub>

|    | 日期       | 更新                                                                                                                                                                                       |
| :-: | :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔗 | 2026-04-29 | **v1.0.7 发布** — Nanobot 连接功能正式集成：XSafeClaw 现可主动连接运行中的 Nanobot 实例，建立受 Guard 保护的对话会话，并将 Nanobot 活动与 OpenClaw、Hermes 统一呈现在同一视图中。 |
| 🛠️ | 2026-04-26 | **v1.0.5 发布** — nanobot 引导安装现在遵循官方跨平台安装流程，未配置 API key 时 Setup 不会误判失败，Agent Valley 独立页面也补上了 React Query Provider。 |
| 🎉 | 2026-04-25 | **v1.0.4 发布** — XSafeClaw 公开支持 OpenClaw、nanobot、Hermes 同时并列运行，并修复了若干已知问题。 |
| 🧩 | 2026-04-23 | **支持 Hermes 与运行时自动启动** — XSafeClaw 现在可以并列发现 OpenClaw、Hermes 与 nanobot，并在服务启动时 best-effort 自动拉起已安装运行时的 gateway。 |
| 🐈 | 2026-04-18 | **支持本机 nanobot 运行时** — XSafeClaw 现在可以发现本机 nanobot 实例，通过 `nanobot gateway` 创建受 Guard 保护的聊天会话，并在 Agent Valley 中同时展示混合运行时会话。 |
| 🚀 | 2026-04-13 | **v1.0.0 发布** — XSafeClaw 首个公开版本，包含安全监控、安全对话、资产防护、Guard 守卫、智能体办公室与引导安装全部模块。                                                            |

---

## 🔍 XSafeClaw 是什么？

XSafeClaw 是 AI 智能体的安全监控与防护平台。它能够实时监控智能体活动、在不安全的工具调用执行前拦截、扫描系统资产评估风险、并提供自动化红队测试——只需一条 `xsafeclaw start` 命令即可启动全部功能。当前运行时注册表会并列发现宿主机上的 OpenClaw、Hermes Agent 与 nanobot，并允许在 Agent Town 中为每个会话选择运行时。

| 模块                                  | 说明                                                                                             |
| :------------------------------------ | :----------------------------------------------------------------------------------------------- |
| **安全监控 (Claw Monitor)**     | 实时会话时间线，覆盖 OpenClaw、Hermes 与 nanobot 会话的事件追踪、Token 用量、工具调用检查、技能与记忆扫描 |
| **安全对话 (Safe Chat)**        | 通过各运行时 gateway/API 与 OpenClaw、Hermes 或 nanobot 智能体安全对话                           |
| **资产防护 (Asset Shield)**     | 文件系统扫描与风险分级（L0–L3）、软件审计、硬件清单                                             |
| **安全守卫 (Guard / AgentDoG)** | 轨迹级与工具调用级安全评估，支持人工审批工作流                                                   |
| **智能体办公室 (Agent Office)** | 基于 PixiJS 的 2D 可视化界面，集中查看所有智能体状态与活动                                       |
| **引导安装 (Onboard Setup)**    | 交互式安装与配置 OpenClaw、Hermes、nanobot，并写入对应的模型、gateway 与 Guard 集成               |

---

## 🚀 快速开始

```bash
pip install xsafeclaw
xsafeclaw start
```

浏览器会自动打开 `http://127.0.0.1:6874`。如果尚未安装任何支持的运行时，Web 界面会引导你安装 OpenClaw、Hermes 或 nanobot。

常用选项：

```bash
xsafeclaw start --port 8080              # 自定义端口
xsafeclaw start --host 0.0.0.0           # 局域网可访问
xsafeclaw start --no-browser --reload    # 无头开发模式
```

---

## 🛡️ Guard：工作原理

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
```

当工具调用被拒绝（或超时 5 分钟未处理）时，智能体会被要求：**立即停止后续操作**、**告知用户风险**、**等待用户明确确认后再继续**。

---

## 🏗️ 架构

```
                         浏览器 (:6874)
                              │
                  ┌───────────┴───────────┐
                  │     FastAPI 服务器     │
                  ├───────────────────────┤
                  │   运行时注册表         │◄── OpenClaw / Hermes / nanobot 发现
                  │   运行时自动启动       │◄── best-effort gateway 启动
                  │   Guard 服务          │◄── AgentDoG 模型
                  │   文件监听器           │◄── 各运行时 JSONL 会话
                  │   资产扫描器           │◄── 文件/软件/硬件扫描
                  └───────────┬───────────┘
                              │
                    SQLite DB │ ~/.xsafeclaw/
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
    OpenClaw 智能体      Hermes 智能体        nanobot 智能体
    safeclaw 插件        Hermes 插件          XSafeClaw hook
    ws://:18789          http://:8642         gateway + websocket
          └───────────────────┴───────────────────┘
                              │
                   POST /api/guard/tool-check
```

| 层级     | 技术                                                     |
| :------- | :------------------------------------------------------- |
| 后端     | Python 3.11, FastAPI, SQLAlchemy (async), uvicorn        |
| 前端     | React 19, TypeScript, Vite, Tailwind CSS 4               |
| 数据库   | SQLite (aiosqlite)                                       |
| 守卫模型 | AgentDoG（可配置 Base URL 和模型）                       |
| 运行时   | 本机 OpenClaw、Hermes Agent 与 nanobot，支持按会话选择 |

运行时可访问 `http://localhost:6874/docs` 查看完整 API 文档。

---

## 📦 安装

详细安装流程请参阅 **[安装指南](docs/installation.md)**。

> [!TIP]
> 需要 Python 3.11+。已发布的包会包含前端 bundle；源码仓库需要运行 `cd frontend && npm run build` 才能让后端直接提供嵌入式 UI，也可以使用 Vite 开发服务器。

```bash
# 从 PyPI 安装（推荐）
pip install xsafeclaw

# 从 GitHub 安装
pip install git+https://github.com/XSafeAI/XSafeClaw.git

# 从源码安装
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw && pip install .

# 开发模式
git clone https://github.com/XSafeAI/XSafeClaw.git
cd XSafeClaw && pip install -e ".[dev]"
```

### 🔌 安装 Guard 插件

Setup 和 Configure 流程会自动安装对应运行时的 Guard 集成。手动接入时，按运行时使用下面的方式。

OpenClaw 使用 TypeScript 插件：

```bash
cp -r plugins/safeclaw-guard ~/.openclaw/extensions/safeclaw-guard
```

然后在 `~/.openclaw/openclaw.json` 中添加：

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

Hermes 使用 Python 插件：

```bash
mkdir -p ~/.hermes/plugins/safeclaw-guard
cp -r plugins/safeclaw-guard-hermes/* ~/.hermes/plugins/safeclaw-guard/
```

nanobot 使用单独的 Python 插件目录，并需要让 nanobot 的 uv tool 环境能导入 XSafeClaw：

```bash
mkdir -p ~/.nanobot/plugins/safeclaw-guard
cp -r plugins/safeclaw-guard-nanobot/* ~/.nanobot/plugins/safeclaw-guard/
uv tool install nanobot-ai --with-editable . --force
```

Nanobot 配置页会在点击保存后自动完成这些操作：复制插件、把 hook 写入 `~/.nanobot/config.json`，并把 `SAFETY.md` / `PERMISSION.md` 部署到 nanobot workspace。该插件会在每轮 nanobot agent 对话中注入这些安全模板，并通过 XSafeClaw Guard 检查工具调用。

首次进入时不会预填 provider、model 或 API Key。

兼容旧流程时，初始化接口仍然保留，但它只会创建不含 provider/model 默认值的 skeleton 配置：

```bash
curl -X POST http://127.0.0.1:6874/api/system/nanobot/init-default
```

### 运行时 Gateway

XSafeClaw 会在服务启动时和安装/初始化后 best-effort 自动启动已安装运行时：

- OpenClaw：`openclaw gateway start --json`，默认 `ws://127.0.0.1:18789`。
- Hermes：启用 HTTP API 后启动/重启 `hermes gateway`，默认 `http://127.0.0.1:8642`。
- nanobot：后台启动 `nanobot gateway --port <配置端口>`，默认 health 端口 `18790`，WebSocket channel 为 `ws://127.0.0.1:8765/`。

手动命令主要用于排障：

```bash
openclaw gateway start
hermes gateway
nanobot gateway --port 18790 --verbose
```

如果手动修改运行时配置文件，需要重启对应 gateway 才能加载新设置。当前 nanobot 集成不需要启动 `nanobot serve`。

---

## ⚙️ 配置说明

XSafeClaw 默认配置开箱即用。如需自定义，将 `.env.example` 复制为 `.env` 进行修改：

| 变量 | 默认值 | 说明 |
| :--- | :----- | :--- |
| `API_PORT` | `6874` | XSafeClaw API 端口 |
| `API_HOST` | `0.0.0.0` | 绑定地址 |
| `DATA_DIR` | `~/.xsafeclaw` | SQLite 数据库与本地状态目录 |
| `PLATFORM` | `auto` | 默认实例提示：`auto`、`openclaw`、`hermes` 或 `nanobot`；所有已发现运行时仍可选择 |
| `AUTO_START_RUNTIMES` | `true` | 自动尝试启动已安装的 OpenClaw、Hermes 与 nanobot gateway |
| `OPENCLAW_SESSIONS_DIR` | `~/.openclaw/agents/main/sessions` | OpenClaw 会话目录 |
| `HERMES_HOME` | `~/.hermes` | Hermes 主目录 |
| `HERMES_API_PORT` | `8642` | Hermes HTTP API 端口 |
| `HERMES_API_KEY` | *空* | 需与 `~/.hermes/.env` 中的 `API_SERVER_KEY` 一致 |
| `~/.nanobot/config.json` | *在 Nanobot 配置页保存时生成* | nanobot 配置、gateway、workspace、WebSocket 与 XSafeClaw hook 设置 |
| `GUARD_BASE_URL` / `GUARD_BASE_MODEL` | AgentDoG 默认值 | 守卫模型 endpoint 与模型 ID |

OpenClaw 配置存放在 `~/.openclaw/openclaw.json`，Hermes 配置存放在 `~/.hermes/.env` 与 `~/.hermes/config.yaml`，nanobot 配置存放在 `~/.nanobot/config.json`。完整变量列表请参见 `.env.example`。

---

## 🔧 开发

前提条件：Python 3.11+、Node.js 18+、[uv](https://docs.astral.sh/uv/)（推荐）

```bash
# 安装 uv（如尚未安装）
curl -LsSf https://astral.sh/uv/install.sh | sh   # macOS / Linux
# winget install --id=astral-sh.uv -e              # Windows
```

```bash
git clone https://github.com/XSafeAI/XSafeClaw.git && cd XSafeClaw

# 后端
uv venv && uv pip install -e ".[dev]"
python run.py                    # http://localhost:6874，支持热重载

# 可选：本机运行时测试
uv tool install nanobot-ai --with-editable . --force
openclaw gateway start
hermes gateway
nanobot gateway --port 18790 --verbose

# 前端（另开终端）
cd frontend && npm install && npm run dev   # http://localhost:3003，支持 HMR

# 构建前端用于生产
cd frontend && npm run build     # 输出被 git 忽略的 Vite 产物到 src/xsafeclaw/static/
```

在 Linux/macOS 的仓库开发流程中，可以先运行 `bash setup.sh` 安装依赖，再运行 `bash start.sh`。该脚本会把 Vite 前端运行在 `:6874`，FastAPI 后端运行在 `:3022` 并由 Vite 代理 `/api`。

---

## ⭐ Star History

<a href="https://app.repohistory.com/star-history?repo=XSafeAI/XSafeClaw">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://app.repohistory.com/api/svg?repo=XSafeAI/XSafeClaw&type=Date&background=0D1117&color=f86262"
    />
    <source
      media="(prefers-color-scheme: light)"
      srcset="https://app.repohistory.com/api/svg?repo=XSafeAI/XSafeClaw&type=Date&background=FFFFFF&color=f86262"
    />
    <img
      alt="Star History Chart"
      src="https://app.repohistory.com/api/svg?repo=XSafeAI/XSafeClaw&type=Date&background=FFFFFF&color=f86262"
    />
  </picture>
</a>

---

## 🙏 致谢

- [**OpenClaw**](https://github.com/openclaw/openclaw) — XSafeClaw 所守护的个人 AI 助手平台。OpenClaw 开放的插件架构使我们的安全守卫集成成为可能。
- [**Hermes Agent**](https://github.com/NousResearch/hermes-agent) — XSafeClaw 现在作为一等运行时支持的本机 Python 智能体与多平台 gateway。
- [**nanobot**](https://github.com/HKUDS/nanobot) — 通过 gateway、WebSocket 与 Python hook 接入 XSafeClaw 的轻量级本机智能体运行时。
- [**AgentDoG**](https://github.com/AI45Lab/AgentDoG) — AI 智能体安全诊断守卫框架。XSafeClaw 的 Guard 模块基于 AgentDoG 的轨迹级风险评估和细粒度安全分类体系构建。
- [**ISC-Bench**](https://github.com/wuyoscar/ISC-Bench) — 前沿大语言模型内部安全崩溃研究。ISC-Bench 对任务完成驱动型安全失败的深入洞察，为我们的红队测试设计提供了重要参考。
- [**AgentHazard**](https://github.com/Yunhao-Feng/AgentHazard) — 计算机使用智能体有害行为评估基准。AgentHazard 的攻击分类体系和执行级风险类别为我们的威胁建模提供了借鉴。

---

## ⚠️ 免责声明

> [!CAUTION]
> XSafeClaw 是一款用于**提升 AI 智能体系统安全性**的研究工具。红队测试功能仅用于防御性安全研究和评估目的。**请勿将本工具用于造成伤害或从事任何恶意活动。**

---

## 💼 商用联系

XSafeClaw 基于 MIT 许可证开源，可用于学术研究和个人使用。如您有**商业授权、企业部署或合作**需求，请联系：

**邮箱：** xingjunma&#64;fudan.edu.cn

---

## 📋 待办事项

- [ ] 红队测试模块，支持自动化攻击模拟
- [ ] 多智能体守卫协同与跨会话风险关联
- [ ] 守卫模型微调流水线，支持自定义安全策略
- [ ] 插件市场，支持社区贡献的守卫扩展
- [ ] 导出安全报告（PDF / JSON）
- [ ] Docker 一键部署
- [ ] API 认证与限流
- [ ] 高风险事件 Webhook 通知

---

## 👥 贡献者

<a href="https://github.com/XSafeAI/XSafeClaw/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=XSafeAI/XSafeClaw" />
</a>

我们欢迎各种形式的贡献——Bug 报告、功能建议、文档完善和代码贡献。

---

## 📄 许可证

[MIT](LICENSE)
