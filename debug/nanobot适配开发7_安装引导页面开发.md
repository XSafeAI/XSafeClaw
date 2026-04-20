# Nanobot 适配开发 7：安装引导页面、配置文档与 WebSocket 回复修复

## 背景

本轮继续收尾 `Connect_nanobot` 分支的安装引导与默认 nanobot 运行时接入。重点不是新增一个孤立功能，而是把用户从“安装、配置、启动 gateway、进入 Chat / Agent Valley”这条链路补完整，并修复一个实际联调中暴露出的 WebSocket 流式协议解析问题。

用户复现路径如下：

1. 在 `/nanobot_configure` 保存默认运行时配置。
2. 启动 `nanobot gateway`，gateway 日志中已经能看到模型完成回复。
3. 在 `http://localhost:3003/chat` 新建 nanobot 会话并发送消息。
4. 前端只显示 `[No response]`。

这说明模型和 nanobot gateway 本身可用，问题发生在 XSafeClaw 对 nanobot WebSocket 出站事件的接收/解析环节。

---

## 本轮修复内容

### 1. Nanobot WebSocket `[No response]` 修复

**问题文件**：`src/xsafeclaw/nanobot_gateway_client.py`

nanobot 的 WebSocket channel 在启用 streaming 后，会用以下事件表达一轮回复：

- `delta`：文本增量。
- `stream_end`：当前流片段结束。
- `message`：非流式最终消息。
- `ready`：连接建立后的会话信息。

实际联调时发现，nanobot 在工具调用前也会发送一个空的 `stream_end`。这个事件只是“上一段空流结束，接下来进入工具调用/下一轮模型迭代”的边界，并不代表整轮用户请求已经结束。

旧逻辑把任意 `stream_end` 都当成最终回复，因此在尚未收到任何文本时就返回 final：

```python
if event == "stream_end":
    yield {
        "type": "final",
        "text": accumulated,
        "run_id": self.chat_id or "",
        "stop_reason": "stop",
    }
    return
```

此时 `accumulated == ""`，前端收到空 final 后使用兜底文案显示 `[No response]`，而真实回复稍后才从 nanobot gateway 发出。

修复后，空的 `stream_end` 只作为中间边界跳过，继续等待后续 `delta` 或 `message`：

```python
if event == "stream_end":
    if not accumulated:
        continue
    yield {
        "type": "final",
        "text": accumulated,
        "run_id": self.chat_id or "",
        "stop_reason": "stop",
    }
    return
```

### 2. 新增 WebSocket 协议回归测试

**新增文件**：`tests/test_nanobot_gateway_client.py`

测试覆盖协议序列：

```text
stream_end(empty boundary)
delta("final reply")
stream_end(final)
```

期望行为：

- 第一个空 `stream_end` 不结束响应。
- 收到 `delta` 后正常向 SSE 输出累计文本。
- 最后的 `stream_end` 才产出 final。

这样可以防止后续重构再次把 nanobot 的中间流边界误判成空最终回复。

### 3. README / README_zh 配置说明补充

本轮检查了：

- `pyproject.toml`
- `README.md`
- `README_zh.md`

结论：

- `pyproject.toml` 已包含 `websockets>=16.0`，也已有 `nanobot` optional extra，因此本轮无需调整依赖。
- README 中已有 nanobot 安装、`uv tool install nanobot-ai --with-editable . --force`、`nanobot gateway --port 18790 --verbose` 说明。
- README 缺少 Web UI 默认 nanobot 配置页的说明，因此补充了：配置页写入 `~/.nanobot/config.json`，包含 workspace、provider/model、API Key、gateway、WebSocket、token 和 Guard hook；修改 gateway/WebSocket/provider/token 后需要重启 `nanobot gateway`。

---

## 当前安装/配置链路总结

### Setup 页面

`frontend/src/pages/Setup.tsx` 现在支持 OpenClaw 与 Nanobot 双运行时安装引导：

- 使用快速接口 `/api/system/install-status` 做安装状态判断，避免慢接口超时导致误判。
- 两个运行时都未安装时进入 Setup。
- 任意一个运行时已安装时允许跳过。
- OpenClaw 安装完成后进入 `/openclaw_configure`。
- Nanobot 安装完成后进入 `/nanobot_configure`。

### 配置路由

配置入口已拆分为平台专属路由：

| 路由 | 说明 |
|------|------|
| `/openclaw_configure` | 原 OpenClaw 配置向导 |
| `/nanobot_configure` | 新增 Nanobot 默认运行时配置页 |
| `/configure_select` | 两个平台都需要配置时的选择页 |
| `/configure` | 兼容旧入口，重定向到 OpenClaw 配置 |

### Nanobot 配置 API

`src/xsafeclaw/api/routes/system.py` 提供：

```http
GET /api/system/nanobot/config
POST /api/system/nanobot/config
```

能力：

- 读写 `~/.nanobot/config.json`。
- 配置默认 workspace、provider、model。
- 写入 provider API Key / API Base。
- 配置 gateway host/port。
- 配置 WebSocket channel host/port/path/token。
- 配置 XSafeClaw Guard hook 的 `disabled` / `observe` / `blocking`。
- 返回值只暴露 `has_api_key` / `has_token`，不回传明文密钥。

### Chat 与 Agent Valley

- Chat 页面基于 runtime instance 创建会话。
- Nanobot 会话使用 `nanobot gateway` 的 WebSocket channel。
- Agent Valley / Agent Town 中的 Nanobot 智能体创建同样走 gateway WebSocket。
- 当 gateway 不可达时，后端返回明确提示，建议运行：

```powershell
nanobot gateway --port 18790 --verbose
```

---

## 标准流程检查

### pyproject.toml

已检查，无需修改：

- `websockets>=16.0` 已覆盖 XSafeClaw 连接 nanobot gateway 的 WebSocket 客户端依赖。
- `[project.optional-dependencies].nanobot = ["nanobot-ai"]` 已保留给希望把 nanobot 安装进当前项目环境的用户。
- 开发流程仍推荐 `uv tool install nanobot-ai --with-editable . --force`，因为这样更符合直接运行 `nanobot` CLI 的方式，也能让 nanobot 工具环境导入本仓库的 hook。

### README.md / README_zh.md

已补充：

- Web UI 的 nanobot 配置页会写入 `~/.nanobot/config.json`。
- 配置内容包含 workspace、provider/model、API Key、gateway、WebSocket、token 和 Guard hook。
- 修改 gateway/WebSocket/provider/token 后需要重启 `nanobot gateway`。

### 静态页面构建

当前分支包含前端页面和生产静态资源改动，因此推送前需要执行：

```powershell
npm run build
```

预期结果：

- Vite 构建成功。
- 更新 `src/xsafeclaw/static` 下的生产静态资源。
- 可能仍出现既有 chunk size warning，该警告不阻塞本轮功能。

---

## 验证命令

本轮新增/回归测试命令：

```powershell
uv run --no-sync pytest tests\test_nanobot_gateway_client.py tests\test_nanobot_runtime_guard.py -q --basetemp .xsafeclaw\tmp\pytest
```

当前结果：

```text
20 passed, 5 warnings
```

前端静态构建需要在推送前重新执行：

```powershell
npm run build
```

---

## 经验总结

1. **gateway 日志有回复，不代表 UI 一定能显示**
   这类问题应优先检查 XSafeClaw 客户端是否正确处理 runtime channel 的协议事件，而不是继续排查模型 API Key。

2. **stream_end 不一定等价于整轮 final**
   在 nanobot streaming 协议中，空 `stream_end` 可以只是工具调用前的中间片段边界。只有已经累计到文本时，才应该把 `stream_end` 转成前端 final。

3. **安装状态接口必须区分快路径和慢路径**
   Setup、路由守卫、创建会话前置检查应使用 `/api/system/install-status`，不能依赖完整 runtime discovery，否则很容易因 gateway health 或 OpenClaw status 慢检查导致前端误判。

4. **配置页修改后要提示重启 gateway**
   `nanobot gateway` 启动时读取 `~/.nanobot/config.json`。修改 WebSocket token、provider、model 或 gateway 配置后，正在运行的 gateway 不会自动加载新配置，文档和 UI 都应给出明确提示。
