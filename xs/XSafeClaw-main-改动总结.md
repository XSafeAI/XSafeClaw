# XSafeClaw-main 改动总结

本文档汇总在本工作区（Cursor Workspace）内对 **XSafeClaw-main** 项目已完成的修改与相关说明，便于同步到云服务器或 Code Review。

---

## 1. 启动与一次性环境（`start.sh` / `setup.sh`）

### `start.sh`

- **前置检查**（避免 silent failure）：
  - 若不存在可执行的 `.venv/bin/python`，提示运行 `bash setup.sh` 或手动创建 venv 并 `pip install -e .`，然后 `exit 1`。
  - 若不存在 `frontend/node_modules`，提示先 `cd frontend && npm install`，然后 `exit 1`。
- **端口**：后端 `6874`，前端 Vite 默认 `**FRONTEND_PORT=3022`**（若你本地脚本仍为 3003，属于未同步的旧副本）。
- **启动方式**：后端 `CHOKIDAR_USEPOLLING=true` + `.venv/bin/python -m xsafeclaw`；前端 `npx vite --host 0.0.0.0`。

### `setup.sh`（新增）

- 一次性引导：校验 Python ≥ 3.11 → 创建 `.venv` → `pip install -e .` → 若无 `.env` 则从 `.env.example` 复制 → `frontend` 下 `npm install`。
- 便于「上传新项目后一条命令装好依赖」。

---

## 2. Setup 页面：双框架可选安装（`frontend/src/pages/Setup.tsx`）

### 行为

- 未检测到 OpenClaw / Hermes 时：展示 **两张卡片**（OpenClaw / Hermes），文案见 i18n。
- **OpenClaw**：仍通过 `POST /api/system/install` SSE 流（含可选 Node 下载、`npm install -g openclaw@latest`）。
- **Hermes**：通过 `POST /api/system/install-hermes` SSE 流，由后端执行 `**pip install hermes-agent`**，前端用与 OpenClaw 类似的 SSE 解析逻辑展示终端输出。
- 新增阶段：`installing_hermes`、`install_hermes_failed`；失败页提供手动命令与重试，与 OpenClaw 失败分支风格一致。
- **安装成功后的偏好**（供 Configure 在未重启后端时识别）：
  - OpenClaw 成功：`localStorage.setItem('xsafeclaw_setup_platform', 'openclaw')`
  - Hermes 成功：`localStorage.setItem('xsafeclaw_setup_platform', 'hermes')`
- 仍保留 **Hermes 手动安装向导**（`hermes_guide` / `hermes_verifying`）代码路径，供验证安装等场景使用。

### 国际化

- `frontend/src/i18n/locales/en.ts`、`zh.ts` 中 `setup` 段补充 Hermes 自动安装相关文案（如 `hermesInstalling`、`hermesInstallingDesc`、`hermesInstallComplete` 等）。

---

## 3. 后端：Hermes 安装与状态字段（`src/xsafeclaw/api/routes/system.py`）

### `POST /api/system/install-hermes`（新增）

- SSE 流式响应，与 `/install` 风格一致。
- 使用 `_find_pip(env)` 查找 `pip`/`pip3`，执行 `pip install hermes-agent`，逐行输出到前端。
- 成功后调用 `trigger_onboard_scan_preload()`（与 OpenClaw 安装成功一致）。

### `GET /api/system/status` 扩展

- **OpenClaw 分支**各返回体中增加 `**hermes_installed`**（`_find_hermes()` 是否非空），供前端判断「刚装完 Hermes 但 `platform` 尚未切到 hermes」等场景。
- **Hermes 分支**（含未找到 `hermes` 可执行文件时）增加：
  - `hermes_api_port`
  - `hermes_config_path`
  - `hermes_home`  
  便于 Configure 展示环境信息。

---

## 4. Configure 页面：按平台分支（`frontend/src/pages/Configure.tsx`）

### 路由逻辑（与原先 OpenClaw-only 的差异）

- 进入页后 **先请求** `systemAPI.status()`：
  - 若 `**platform === 'hermes'`**，或 `**localStorage['xsafeclaw_setup_platform'] === 'hermes'` 且 `hermes_installed === true**` → 走 **Hermes 专用短向导**（读完后清除该 localStorage 键）。
  - 否则 → **保持原有 OpenClaw 流程**：`onboardScan()` 拉模型/频道等，14 步向导与 `onboardConfig` 提交不变。

### Hermes 短向导（`HermesConfigureFlow`）

- 三步：**安全须知 → 环境/健康状态（可刷新）→ 完成并进入 Agent Valley**。
- **不调用** `onboardScan` / `onboardConfig`（后端亦无 Hermes 版 onboard 管线）。
- UI 使用紫色主按钮等与 OpenClaw 向导区分，但布局仍为同一套壳（Logo、卡片、底部导航）。

### 国际化

- `configure.hermes` 整段（中英）：页面标题、步骤名、安全文案、状态标签、`.env` 中 `PLATFORM` 说明等。

---

## 5. API 类型定义（`frontend/src/services/api.ts`）

- `systemAPI.status()` 的 TypeScript 返回类型补充：`hermes_api_port`、`hermes_config_path`、`hermes_home` 等。
- 增加 `**installHermesUrl`**（`/api/system/install-hermes`），便于与 `installUrl` 对称引用（当前 Setup 内仍直接使用 `fetch` 路径亦可）。

---

## 6. 与「原先逻辑」的一致性说明（简要）


| 区域                 | 与原先一致性                                                                  |
| ------------------ | ----------------------------------------------------------------------- |
| OpenClaw Configure | **未改业务路径**：仍为原 14 步 + `onboardScan` / `onboardConfig`。                  |
| OpenClaw Setup 安装  | **一致**：仍 SSE + npm 全局安装。                                                |
| Hermes Setup       | **新增**：与 OpenClaw 对称的自动安装入口。                                            |
| Hermes Configure   | **体验有差别**：无 OpenClaw 级全量表单向导，因 Hermes 配置形态与仓库内后端集成深度不同；当前为兼容入口 + 状态与指引。 |


---

## 7. 部署 / 云服务器侧建议 checklist

1. 项目根目录：`bash setup.sh` 或手动 `python3 -m venv .venv` + `pip install -e .` + `frontend/npm install`。
2. 复制 `.env.example` → `.env`，按需设置 `PLATFORM`（`auto` / `openclaw` / `hermes`）。
3. `bash start.sh`；若端口与脚本不一致，以仓库内 `start.sh` 的 `FRONTEND_PORT` 为准或自行统一。
4. 更新前端后建议 **硬刷新** 或清缓存，避免旧 bundle 仍显示单框架 Setup。

---

## 8. 文件清单（便于 `git diff` 对照）


| 路径                                                  | 说明                             |
| --------------------------------------------------- | ------------------------------ |
| `XSafeClaw-main/start.sh`                           | 前置检查 + 启动                      |
| `XSafeClaw-main/setup.sh`                           | 一次性环境安装（新增）                    |
| `XSafeClaw-main/frontend/src/pages/Setup.tsx`       | 双框架、Hermes SSE 安装、localStorage |
| `XSafeClaw-main/frontend/src/pages/Configure.tsx`   | 平台分支 + HermesConfigureFlow     |
| `XSafeClaw-main/frontend/src/services/api.ts`       | status 类型、installHermesUrl     |
| `XSafeClaw-main/frontend/src/i18n/locales/en.ts`    | setup / configure.hermes 等     |
| `XSafeClaw-main/frontend/src/i18n/locales/zh.ts`    | 同上                             |
| `XSafeClaw-main/src/xsafeclaw/api/routes/system.py` | install-hermes、status 字段扩展     |


---

## 9. Hermes 模型就绪检查修复（`chat.py` + `system.py`）

### 问题

创建 Agent 时报 **"Model is still being prepared by the gateway. Try again in a few seconds."**，实际原因并非网关冷启动，而是：

1. **JSON 结构不匹配**：Hermes `/v1/models` 返回 OpenAI 格式 `{"data": [...]}`，而后端只解析 `raw.get("models", [])` — 拿到空列表，匹配永远失败。
2. **模型 ID 不匹配**：Hermes 运行时仅暴露 `hermes-agent`，而用户在 UI 选的可能是 `anthropic/claude-3.5-sonnet` 等 config.yaml 中配置的名称。

### 改动


| 文件                                                          | 改动                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.py` — `_extract_runtime_model_list()`                 | **新增**通用提取函数：先尝试 `models`（OpenClaw），再尝试 `data`（Hermes/OpenAI 格式）。                                                                                 |
| `chat.py` — `_runtime_model_ref_candidates()`               | 增加 `**elif model_id:`** 分支，使无 `provider` 且无 `/` 的裸 ID（如 `hermes-agent`）也能被纳入候选。OpenClaw 条目因已有 `key` / `provider` 不走此分支。                           |
| `chat.py` — `model_readiness()`                             | 使用 `_extract_runtime_model_list` 替代 `raw.get("models", [])`；**Hermes 模式下**，只要 API 可达且有模型即返回 `ready=True`（Hermes 内部管理模型路由，运行时目录仅报 `hermes-agent`）。 |
| `chat.py` — `_build_available_models_payload_from_config()` | 支持 Hermes config.yaml 中 **不含 `/` 的模型名**（如 `hermes-agent`），`provider` 默认 `"hermes"`。                                                               |
| `chat.py` — `_build_available_models_from_hermes_api()`     | **新增**：当 config 返回空时，直接查询 Hermes 实时 `/v1/models` 作为 fallback 构建可用模型列表。                                                                            |
| `chat.py` — `available_models()`                            | Hermes 模式下用 live API 替代 OpenClaw CLI 获取模型列表。                                                                                                      |
| `system.py` — `save-model-quick` readiness 循环               | 将 `raw.get("models", [])` 替换为 `_extract_runtime_model_list(raw)`。                                                                                 |


### 对 OpenClaw 的影响


| 检查点                             | 结论                                                             |
| ------------------------------- | -------------------------------------------------------------- |
| `_extract_runtime_model_list`   | OpenClaw `{"models": [...]}` 走 `models` 分支，行为不变                |
| `_runtime_model_ref_candidates` | 新 `elif` 仅在无 `key`/`provider` 且无 `/` 时触发；OpenClaw 条目不会走到       |
| `model_readiness`               | Hermes 快速路径被 `settings.is_hermes` 守卫；OpenClaw 走原匹配逻辑           |
| `available_models`              | Hermes live API 分支被 `settings.is_hermes` 守卫；OpenClaw 走原 CLI 路径 |


---

## 10. Hermes API Key 鉴权支持

### 问题

与 Agent 对话时返回 **HTTP 403**：  
`Session continuation requires API key authentication. Configure API_SERVER_KEY to enable this feature.`

原因：Hermes API 服务配置了 `API_SERVER_KEY` 做鉴权，而 XSafeClaw 的 `HermesClient` 没有传递 Bearer token。

### 改动


| 文件                                                      | 改动                                                                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `config.py`                                             | 新增 `**hermes_api_key`** 字段（环境变量 `HERMES_API_KEY`），默认为空字符串。                                                                       |
| `chat.py` — `_connect_gateway_with_retries()`           | Hermes 分支创建 `HermesClient(api_key=settings.hermes_api_key)`                                                                      |
| `chat.py` — `_build_available_models_from_hermes_api()` | 同上，查询 live 模型列表时也传 key                                                                                                           |
| `system.py` — `_hermes_status()`                        | 返回中增加 `**hermes_api_key_configured**` 布尔字段                                                                                       |
| `system.py` — `GET /hermes-api-key-status`              | **新增**：返回密钥是否已配置（不暴露值）                                                                                                           |
| `system.py` — `POST /hermes-api-key`                    | **新增**：将密钥写入 XSafeClaw 的 `.env` 文件并热更新 `settings`                                                                                |
| `Configure.tsx` — `HermesConfigureFlow`                 | 向导从 3 步扩展为 **4 步**（安全 → 状态 → **API Key** → 完成）；新步骤包含引导说明、密码输入框、保存按钮与结果提示                                                         |
| `api.ts` — `systemAPI`                                  | 新增 `hermesApiKeyStatus()` 和 `saveHermesApiKey()`                                                                                 |
| `en.ts` / `zh.ts`                                       | `configure.hermes.steps` 增加 `apiKey`；新增 `apiKeyTitle`、`apiKeyDesc`、`apiKeyGuideTitle`、`apiKeyGuideSteps`、`apiKeyLabel` 等 12 个文案键 |
| `.env.example`                                          | 增加 `PLATFORM` 和 `HERMES_API_KEY` 注释示例                                                                                            |


### 对 OpenClaw 的影响

**无**。所有改动均在 `settings.is_hermes` / Hermes Configure 分支内；`hermes_api_key` 为空时 `HermesClient` 不发送 Authorization 头。

---

## 11. 文件清单（便于 `git diff` 对照）


| 路径                                                  | 说明                                                        |
| --------------------------------------------------- | --------------------------------------------------------- |
| `XSafeClaw-main/start.sh`                           | 前置检查 + 启动                                                 |
| `XSafeClaw-main/setup.sh`                           | 一次性环境安装（新增）                                               |
| `XSafeClaw-main/.env.example`                       | 增加 PLATFORM、HERMES_API_KEY 示例                             |
| `XSafeClaw-main/frontend/src/pages/Setup.tsx`       | 双框架、Hermes SSE 安装、localStorage                            |
| `XSafeClaw-main/frontend/src/pages/Configure.tsx`   | 平台分支 + HermesConfigureFlow（含 API Key 步骤）                  |
| `XSafeClaw-main/frontend/src/services/api.ts`       | status 类型、installHermesUrl、hermesApiKey 端点                |
| `XSafeClaw-main/frontend/src/i18n/locales/en.ts`    | setup / configure.hermes（含 API Key 文案）                    |
| `XSafeClaw-main/frontend/src/i18n/locales/zh.ts`    | 同上                                                        |
| `XSafeClaw-main/src/xsafeclaw/config.py`            | hermes_api_key 配置字段                                       |
| `XSafeClaw-main/src/xsafeclaw/api/routes/system.py` | install-hermes、status 字段扩展、readiness 修复、hermes-api-key 端点 |
| `XSafeClaw-main/src/xsafeclaw/api/routes/chat.py`   | Hermes 模型就绪检查 + 可用模型列表修复 + api_key 传递                     |


---

## 12. Hermes Agent Town 同步修复

### 问题

在 OpenClaw 中，通过 CMD 面板创建 Agent 并对话后，Agent 会立即出现在小镇（Agent Town）中并显示完整信息。但在 Hermes 中，同样操作后关闭 CMD 面板，Agent 完全不出现在小镇中。

### 根因分析

Agent Town 通过 `GET /api/trace/` 从 SQLite 数据库（Session + Event 表）获取 agent 列表。数据流为：

```
平台 → .jsonl 文件 → FileWatcher → MessageSyncService → DB(Session+Message) → EventSyncService → DB(Event) → /api/trace → Agent Town
```

存在三个代码级问题：

1. `**trace.py` 硬编码 OpenClaw 的 `sessions.json` 路径**：`_SESSIONS_JSON` 固定指向 `~/.openclaw/.../sessions.json`，Hermes 环境下该文件不存在，导致所有 agent 元数据（`session_key`、`provider`、`model`、`channel`）为空。
2. `**session_key` 在数据库同步时从未填充**：`MessageSyncService._ensure_session()` 创建 Session 记录时只设置了 `session_id`、`first_seen_at`、`cwd`，从不读取 `sessions.json` 来填充 `session_key`、`channel`、模型信息。
3. **Hermes 无直接 DB 持久化路径**：整个流水线依赖 Hermes API Server 向 `~/.hermes/sessions/` 写入 `.jsonl` 文件。如果 Hermes 不写这些文件（或延迟写入），FileWatcher 无内容可同步，Agent 永远不会进入数据库。OpenClaw 不存在此问题，因为其 Gateway 在对话过程中可靠地写入 `.jsonl` 文件。
4. **（次要）`risk_test_service.py` 也硬编码了 OpenClaw 路径**。

### 改动


| 文件                                                          | 改动                                                                                                                                 |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `hermes_client.py` — `last_session_id` property             | **新增**只读属性，暴露 Hermes 从 `X-Hermes-Session-Id` 响应头捕获的 session ID，供 chat 路由用作 DB 主键。                                                  |
| `chat.py` — `_persist_hermes_session()`                     | **新增**：确保 Hermes 聊天的 Session 行存在于 DB，包含 `session_key`、`channel="webchat"`、模型信息。在 `start_session` 中即刻调用，使 Agent 立即出现在 Agent Town。   |
| `chat.py` — `_persist_hermes_chat_turn()`                   | **新增**：将 user + assistant 消息直接写入 DB 的 Message 表，并立即触发 `EventSyncService.sync_session_events()` 创建 Event 行。使用 `message_id` 唯一约束防重复。 |
| `chat.py` — `start_session`                                 | Hermes 分支：立即创建 Session 行并缓存模型信息到 `_hermes_session_model_info`。                                                                     |
| `chat.py` — `send_message`                                  | Hermes 分支：成功响应后调用 `_persist_hermes_chat_turn()` 持久化本轮对话。                                                                           |
| `chat.py` — `send_message_stream`                           | Hermes 分支：流式响应完成后调用 `_persist_hermes_chat_turn()` 持久化本轮对话。                                                                         |
| `trace.py` — `_SESSIONS_JSON`                               | 改为平台条件选择：Hermes 时读 `settings.hermes_sessions_dir / "sessions.json"`，OpenClaw 时保持原路径不变。                                             |
| `message_sync_service.py` — `_load_sessions_index()`        | **新增**：读取并缓存 `sessions.json` 反向索引（`session_id → {session_key, model, provider, channel}`），基于 mtime 变化自动刷新。                         |
| `message_sync_service.py` — `_enrich_session_from_index()`  | **新增**：从索引中补全 Session 记录上为空的 `session_key`、`channel`、`current_model_provider`、`current_model_name` 字段（只补不覆盖）。                      |
| `message_sync_service.py` — `_ensure_session()`             | 在创建和更新 Session 时均调用 `_enrich_session_from_index()` 补全元数据。                                                                          |
| `risk_test_service.py` — `_SESSIONS_DIR` / `_SESSIONS_JSON` | 改为平台条件选择：Hermes 时用 `settings.hermes_sessions_dir`，OpenClaw 时保持原路径不变。                                                               |


### 对 OpenClaw 的影响


| 检查点                                                                  | 结论                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hermes_client.py` — `last_session_id`                               | OpenClaw 使用 `GatewayClient`，不涉及此类；调用点均先做 `isinstance(client, HermesClient)` 检查                                                                                                                   |
| `chat.py` — imports / 模块对象                                           | import 加载但新函数不被调用；`EventSyncService()` 构造不做 I/O                                                                                                                                                  |
| `chat.py` — `start_session` / `send_message` / `send_message_stream` | 所有 Hermes 专属逻辑被 `if settings.is_hermes` 守卫，OpenClaw 下跳过                                                                                                                                          |
| `trace.py` — `_SESSIONS_JSON`                                        | `else` 分支值与修改前一字不差：`Path.home() / ".openclaw" / "agents" / "main" / "sessions" / "sessions.json"`                                                                                                |
| `risk_test_service.py` — `_SESSIONS_DIR`                             | `else` 分支值与修改前一致                                                                                                                                                                                 |
| `message_sync_service.py` — enrich                                   | 读取 `self.sessions_dir / "sessions.json"`（= `settings.active_sessions_dir`），OpenClaw 下指向 OpenClaw 的 sessions.json；若文件不存在则跳过；仅补全空字段不覆盖，对 OpenClaw **无负面影响**（实际还带来正面改善：之前也不填 `session_key`，现在能自动补全） |


**结论：对 OpenClaw 分支无任何负面影响。**

---

## 13. 文件清单（便于 `git diff` 对照）


| 路径                                               | 说明                                                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/xsafeclaw/hermes_client.py`                 | 新增 `last_session_id` 只读属性                                                                                                              |
| `src/xsafeclaw/api/routes/chat.py`               | Hermes 直接 DB 持久化（`_persist_hermes_session` / `_persist_hermes_chat_turn`），集成到 `start_session` / `send_message` / `send_message_stream` |
| `src/xsafeclaw/api/routes/trace.py`              | `_SESSIONS_JSON` 平台条件选择                                                                                                                |
| `src/xsafeclaw/services/message_sync_service.py` | `sessions.json` 索引加载 + Session 元数据补全                                                                                                   |
| `src/xsafeclaw/services/risk_test_service.py`    | `_SESSIONS_DIR` / `_SESSIONS_JSON` 平台条件选择                                                                                              |


---

*文档生成位置：`XSafeClaw-main-改动总结.md`（项目根目录）。*