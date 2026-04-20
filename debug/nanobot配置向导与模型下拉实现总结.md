# Nanobot 配置向导与模型下拉实现总结

日期：2026-04-20

## 背景

`/nanobot_configure` 原来是单页表单，模型 ID 需要手动输入，容易出现拼写错误。用户希望它和 `/openclaw_configure` 的引导体验对齐，并在模型 ID 处提供可搜索下拉，同时保留手动输入能力。

## 本次实现

1. 将 `frontend/src/pages/NanobotConfigure.tsx` 改为 OpenClaw 风格的 8 步向导：
   - 安全
   - 模式
   - 模型与密钥
   - 工作区
   - Gateway 与 WebSocket
   - XSafeClaw Guard
   - 完成
   - 预览

2. 新增快速开始 / 手动配置模式：
   - 快速开始只进入「模型与密钥」，其余工作区、Gateway/WebSocket、Guard 步骤在进度条中显示为跳过，并使用当前配置或默认值。
   - 手动配置会逐步进入全部 8 个步骤。

3. 模型 ID 改为可搜索下拉：
   - 模型候选优先读取 `systemAPI.onboardScan()` 返回的 OpenClaw `model_providers`。
   - 根据当前 Nanobot provider 过滤模型。
   - OpenClaw 模型目录不可用或没有匹配模型时，回退到 `GET /system/nanobot/config` 的 `provider_options.default_model`。
   - 保留“手动输入模型 ID / 返回模型列表”切换。

4. 模型写入做 Nanobot 格式归一化：
   - UI 可以展示 OpenClaw 目录里的完整模型 ID，例如 `minimax/MiniMax-M2.7`。
   - 写入 Nanobot 配置时会去掉当前 provider 前缀，例如最终写入 `agents.defaults.model = "MiniMax-M2.7"`，同时保留 `agents.defaults.provider = "minimax"`。

5. 强化完成配置校验：
   - 安全步骤必须勾选后才能继续。
   - 模型与密钥步骤必须选择 provider 和 model。
   - 如果当前 provider 没有已保存 API Key，则必须填写 API Key。
   - 如果当前 provider 已保存 API Key，API Key 可留空表示复用。
   - 如果勾选清除已保存 API Key，则不能继续完成配置，避免保存后变成不可用状态。

6. 预览与保存流程对齐 OpenClaw：
   - 保存按钮只出现在「预览」步骤。
   - 预览页展示 provider、显示模型、实际写入模型、API Key 状态、workspace、gateway、WebSocket、Guard 和配置文件路径。
   - 保存成功页提示修改 provider/model/gateway/WebSocket/token 后需要重启 `nanobot gateway`。

## 未改动内容

- 后端 `POST /system/nanobot/config` 请求结构未改变。
- 后端仍保留旧的宽松兼容逻辑；本次完整性约束主要在新向导前端执行。
- 没有新增 Nanobot 专用模型目录维护表，避免后续模型列表过期。

## 后续验证重点

1. `/nanobot_configure` 首次打开时不预填 provider、model 或 API Key。
2. 快速开始路径为：安全 -> 模式 -> 模型与密钥 -> 完成 -> 预览。
3. 手动配置路径会进入全部步骤。
4. OpenClaw 模型目录可用时，模型下拉能按 provider 过滤。
5. 选择 `minimax/MiniMax-M2.7` 后，预览页显示实际写入模型为 `MiniMax-M2.7`。
6. 当前 provider 无已保存密钥时，API Key 为空不能继续。
7. 当前 provider 有已保存密钥时，API Key 为空可以继续并显示复用已保存密钥。
