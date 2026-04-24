"""Nanobot runtime helpers."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from .models import empty_capabilities
from .parsing import (
    ParsedMessage,
    ParsedSessionBatch,
    ParsedSessionInfo,
    ParsedToolCall,
    ParsedToolResult,
)

NANOBOT_DEFAULT_CONFIG = Path.home() / ".nanobot" / "config.json"
_UNSAFE_ID_CHARS = re.compile(r"[^a-z0-9]+")
XSAFECLAW_HOOK_NAME = "xsafeclaw"
XSAFECLAW_HOOK_CLASS_PATH = "safeclaw_guard_nanobot:XSafeClawNanobotHook"
XSAFECLAW_LEGACY_HOOK_CLASS_PATH = "xsafeclaw.integrations.nanobot_guard_hook:XSafeClawHook"
XSAFECLAW_CHANNEL_EXTENSION_NAME = "xsafeclaw"
XSAFECLAW_NANOBOT_PLUGIN_PATH = Path.home() / ".nanobot" / "plugins" / "safeclaw-guard"
DEFAULT_XSAFECLAW_GUARD_BASE_URL = "http://127.0.0.1:6874"
DEFAULT_XSAFECLAW_GUARD_TIMEOUT_S = 305.0
DEFAULT_NANOBOT_GATEWAY_HOST = "127.0.0.1"
DEFAULT_NANOBOT_GATEWAY_PORT = 18790
DEFAULT_NANOBOT_GATEWAY_HEARTBEAT_INTERVAL_S = 30
DEFAULT_NANOBOT_GATEWAY_HEARTBEAT_KEEP_RECENT_MESSAGES = 8
DEFAULT_NANOBOT_WEBSOCKET_HOST = "127.0.0.1"
DEFAULT_NANOBOT_WEBSOCKET_PORT = 8765
DEFAULT_NANOBOT_WEBSOCKET_PATH = "/"
DEFAULT_NANOBOT_WEBSOCKET_CLIENT_ID = "xsafeclaw"


def _slug(value: str) -> str:
    normalized = _UNSAFE_ID_CHARS.sub("-", value.lower()).strip("-")
    return normalized or "nanobot"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _read_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _parse_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _read_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


def _read_xsafeclaw_hook_entries(config: dict[str, Any]) -> dict[str, Any]:
    """Read hook entries from the schema-safe extension, falling back to legacy."""
    channels = _read_mapping(config.get("channels"))
    extension = _read_mapping(channels.get(XSAFECLAW_CHANNEL_EXTENSION_NAME))
    extension_hooks = _read_mapping(extension.get("hooks"))
    extension_entries = _read_mapping(extension_hooks.get("entries"))
    if extension_entries:
        return extension_entries

    legacy_hooks = _read_mapping(config.get("hooks"))
    return _read_mapping(legacy_hooks.get("entries"))


def _ensure_xsafeclaw_hook_entries(config: dict[str, Any]) -> dict[str, Any]:
    """Return schema-safe storage for XSafeClaw hook entries.

    nanobot 0.1.5 rejects unknown top-level config fields, so XSafeClaw stores
    its extension data under ``channels.xsafeclaw`` because channel config
    explicitly permits plugin/extra sections.
    """
    channels = config.setdefault("channels", {})
    if not isinstance(channels, dict):
        channels = {}
        config["channels"] = channels
    extension = channels.setdefault(XSAFECLAW_CHANNEL_EXTENSION_NAME, {})
    if not isinstance(extension, dict):
        extension = {}
        channels[XSAFECLAW_CHANNEL_EXTENSION_NAME] = extension
    hooks = extension.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        hooks = {}
        extension["hooks"] = hooks
    entries = hooks.setdefault("entries", {})
    if not isinstance(entries, dict):
        entries = {}
        hooks["entries"] = entries
    return entries


def _join_websocket_url(host: str, port: int, path: str) -> str:
    normalized_path = path.strip() or DEFAULT_NANOBOT_WEBSOCKET_PATH
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"
    return f"ws://{host}:{port}{normalized_path}"


def parse_nanobot_guard_state(config: dict[str, Any]) -> dict[str, Any]:
    """Extract XSafeClaw guard-hook state from a nanobot config payload."""
    entries = _read_xsafeclaw_hook_entries(config)
    entry = _read_mapping(entries.get(XSAFECLAW_HOOK_NAME))
    hook_config = _read_mapping(entry.get("config"))
    class_path = str(entry.get("class_path") or entry.get("classPath") or "").strip()
    plugin_path = str(
        entry.get("plugin_path")
        or entry.get("pluginPath")
        or entry.get("path")
        or XSAFECLAW_NANOBOT_PLUGIN_PATH
    ).strip()
    hook_present = bool(entry)
    enabled = bool(entry.get("enabled", False))
    hook_valid = class_path in {XSAFECLAW_HOOK_CLASS_PATH, XSAFECLAW_LEGACY_HOOK_CLASS_PATH}
    raw_mode = str(hook_config.get("mode") or "disabled").strip().lower()
    if raw_mode not in {"observe", "blocking"}:
        raw_mode = "disabled"
    mode = raw_mode if (hook_present and enabled and hook_valid) else "disabled"
    base_url = str(
        hook_config.get("base_url")
        or hook_config.get("baseUrl")
        or DEFAULT_XSAFECLAW_GUARD_BASE_URL
    ).strip() or DEFAULT_XSAFECLAW_GUARD_BASE_URL
    configured_instance_id = str(
        hook_config.get("instance_id")
        or hook_config.get("instanceId")
        or ""
    ).strip() or None
    timeout_s = _parse_float(
        hook_config.get("timeout_s")
        or hook_config.get("timeoutSeconds")
        or hook_config.get("timeout"),
        DEFAULT_XSAFECLAW_GUARD_TIMEOUT_S,
    )
    return {
        "hook_present": hook_present,
        "enabled": enabled,
        "hook_valid": hook_valid,
        "class_path": class_path or None,
        "plugin_path": plugin_path,
        "mode": mode,
        "base_url": base_url,
        "configured_instance_id": configured_instance_id,
        "timeout_s": timeout_s,
    }


def read_nanobot_guard_state(config_path: str | Path | None) -> dict[str, Any]:
    """Read XSafeClaw guard-hook state from a nanobot config file."""
    if not config_path:
        return parse_nanobot_guard_state({})
    path = Path(config_path).expanduser()
    if not path.exists():
        return parse_nanobot_guard_state({})
    return parse_nanobot_guard_state(_read_json(path))


def update_nanobot_guard_state(
    config_path: str | Path,
    *,
    instance_id: str,
    mode: str,
    base_url: str | None = None,
    timeout_s: float | None = None,
    plugin_path: str | Path | None = None,
) -> dict[str, Any]:
    """Write XSafeClaw guard-hook config into a nanobot config file."""
    path = Path(config_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _read_json(path) if path.exists() else {}
    if not isinstance(data, dict):
        data = {}

    normalized_mode = str(mode or "disabled").strip().lower()
    if normalized_mode not in {"disabled", "observe", "blocking"}:
        raise ValueError(f"Unsupported nanobot guard mode: {mode}")

    # Remove the legacy extension field so upstream nanobot can validate config.
    data.pop("hooks", None)
    entries = _ensure_xsafeclaw_hook_entries(data)

    if normalized_mode == "disabled":
        entries.pop(XSAFECLAW_HOOK_NAME, None)
    else:
        entries[XSAFECLAW_HOOK_NAME] = {
            "enabled": True,
            "plugin_path": str(plugin_path or XSAFECLAW_NANOBOT_PLUGIN_PATH),
            "class_path": XSAFECLAW_HOOK_CLASS_PATH,
            "config": {
                "mode": normalized_mode,
                "base_url": str(base_url or DEFAULT_XSAFECLAW_GUARD_BASE_URL).strip()
                or DEFAULT_XSAFECLAW_GUARD_BASE_URL,
                "instance_id": instance_id,
                "timeout_s": _parse_float(timeout_s, DEFAULT_XSAFECLAW_GUARD_TIMEOUT_S),
            },
        }

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return read_nanobot_guard_state(path)


def normalize_host(host: str | None) -> str:
    """Normalize a bind host into a client-usable hostname."""
    if not host or host in {"0.0.0.0", "::", "localhost"}:
        return "127.0.0.1"
    return host


def default_nanobot_gateway_heartbeat_config() -> dict[str, Any]:
    """Return the schema-valid Nanobot gateway heartbeat configuration."""
    return {
        "enabled": True,
        "intervalS": DEFAULT_NANOBOT_GATEWAY_HEARTBEAT_INTERVAL_S,
        "keepRecentMessages": DEFAULT_NANOBOT_GATEWAY_HEARTBEAT_KEEP_RECENT_MESSAGES,
    }


def ensure_nanobot_gateway_heartbeat_config(gateway: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy heartbeat values into Nanobot's HeartbeatConfig object."""
    raw = gateway.get("heartbeat")
    default = default_nanobot_gateway_heartbeat_config()

    if isinstance(raw, dict):
        enabled = raw.get("enabled", default["enabled"])
        interval = raw.get("intervalS", raw.get("interval_s", default["intervalS"]))
        keep_recent = raw.get(
            "keepRecentMessages",
            raw.get("keep_recent_messages", default["keepRecentMessages"]),
        )
    elif isinstance(raw, (int, float)) and raw > 0:
        enabled = True
        interval = int(raw)
        keep_recent = default["keepRecentMessages"]
    else:
        enabled = default["enabled"]
        interval = default["intervalS"]
        keep_recent = default["keepRecentMessages"]

    try:
        interval_value = max(int(interval), 1)
    except (TypeError, ValueError):
        interval_value = default["intervalS"]
    try:
        keep_recent_value = max(int(keep_recent), 0)
    except (TypeError, ValueError):
        keep_recent_value = default["keepRecentMessages"]

    heartbeat = {
        "enabled": bool(enabled),
        "intervalS": interval_value,
        "keepRecentMessages": keep_recent_value,
    }
    gateway["heartbeat"] = heartbeat
    return heartbeat


def parse_nanobot_gateway_state(config: dict[str, Any]) -> dict[str, Any]:
    """Extract gateway and websocket channel settings from nanobot config."""
    gateway = _read_mapping(config.get("gateway"))
    channels = _read_mapping(config.get("channels"))
    websocket = _read_mapping(channels.get("websocket"))

    gateway_host = normalize_host(
        str(gateway.get("host") or DEFAULT_NANOBOT_GATEWAY_HOST).strip()
    )
    gateway_port = _parse_int(gateway.get("port"), DEFAULT_NANOBOT_GATEWAY_PORT)
    websocket_enabled = _read_bool(websocket.get("enabled"), False)
    websocket_host = normalize_host(
        str(websocket.get("host") or DEFAULT_NANOBOT_WEBSOCKET_HOST).strip()
    )
    websocket_port = _parse_int(
        websocket.get("port"),
        DEFAULT_NANOBOT_WEBSOCKET_PORT,
    )
    websocket_path = str(
        websocket.get("path") or DEFAULT_NANOBOT_WEBSOCKET_PATH
    ).strip() or DEFAULT_NANOBOT_WEBSOCKET_PATH
    websocket_url = _join_websocket_url(websocket_host, websocket_port, websocket_path)
    token = str(websocket.get("token") or "").strip()

    return {
        "gateway_host": gateway_host,
        "gateway_port": gateway_port,
        "gateway_health_url": f"http://{gateway_host}:{gateway_port}/health",
        "websocket_enabled": websocket_enabled,
        "websocket_host": websocket_host,
        "websocket_port": websocket_port,
        "websocket_path": websocket_path,
        "websocket_url": websocket_url,
        "websocket_client_id": DEFAULT_NANOBOT_WEBSOCKET_CLIENT_ID,
        "websocket_token": token,
    }


def update_nanobot_gateway_state(config_path: str | Path) -> dict[str, Any]:
    """Ensure nanobot gateway + websocket channel config exists."""
    path = Path(config_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    data = _read_json(path) if path.exists() else {}
    if not isinstance(data, dict):
        data = {}

    gateway = data.setdefault("gateway", {})
    if not isinstance(gateway, dict):
        gateway = {}
        data["gateway"] = gateway
    gateway.setdefault("host", DEFAULT_NANOBOT_GATEWAY_HOST)
    gateway.setdefault("port", DEFAULT_NANOBOT_GATEWAY_PORT)
    ensure_nanobot_gateway_heartbeat_config(gateway)

    channels = data.setdefault("channels", {})
    if not isinstance(channels, dict):
        channels = {}
        data["channels"] = channels
    channels.setdefault("sendProgress", True)
    channels.setdefault("sendToolHints", False)
    channels.setdefault("sendMaxRetries", 3)
    channels.setdefault("transcriptionProvider", "groq")

    websocket = channels.setdefault("websocket", {})
    if not isinstance(websocket, dict):
        websocket = {}
        channels["websocket"] = websocket
    websocket["enabled"] = True
    websocket.setdefault("host", DEFAULT_NANOBOT_WEBSOCKET_HOST)
    websocket.setdefault("port", DEFAULT_NANOBOT_WEBSOCKET_PORT)
    websocket.setdefault("path", DEFAULT_NANOBOT_WEBSOCKET_PATH)
    websocket.setdefault("websocketRequiresToken", False)
    websocket.setdefault("allowFrom", [DEFAULT_NANOBOT_WEBSOCKET_CLIENT_ID])
    websocket.setdefault("streaming", True)

    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return parse_nanobot_gateway_state(data)


def build_nanobot_instance_payload(
    config_path: str | Path,
    *,
    instance_id: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any] | None:
    """Build a runtime instance payload from an arbitrary nanobot config file."""
    path = Path(config_path).expanduser()
    if not path.exists():
        return None

    config = _read_json(path)
    agents = config.get("agents", {}).get("defaults", {}) if isinstance(config, dict) else {}
    guard_state = parse_nanobot_guard_state(config)
    gateway_state = parse_nanobot_gateway_state(config)
    providers_cfg = _read_mapping(config.get("providers"))
    single_provider = next(iter(providers_cfg), None) if len(providers_cfg) == 1 else None
    workspace = agents.get("workspace") or "~/.nanobot/workspace"
    workspace_path = str(Path(workspace).expanduser())
    sessions_path = str(Path(workspace_path) / "sessions")
    derived_instance_id = (
        "nanobot-default"
        if path.resolve() == NANOBOT_DEFAULT_CONFIG.resolve()
        else f"nanobot-{_slug(path.parent.name)}"
    )
    model = str(agents.get("model") or "nanobot")
    provider = str(
        agents.get("provider")
        or single_provider
        or (model.split("/", 1)[0] if "/" in model else "nanobot")
    )
    derived_display_name = (
        "nanobot"
        if derived_instance_id == "nanobot-default"
        else f"nanobot ({path.parent.name})"
    )
    return {
        "instance_id": instance_id or derived_instance_id,
        "platform": "nanobot",
        "display_name": display_name or derived_display_name,
        "config_path": str(path),
        "workspace_path": workspace_path,
        "sessions_path": sessions_path,
        "serve_base_url": None,
        "gateway_base_url": (
            gateway_state["websocket_url"] if gateway_state["websocket_enabled"] else None
        ),
        "meta": {
            "model": model,
            "provider": provider,
            "workspace": workspace_path,
            "gateway_health_url": gateway_state["gateway_health_url"],
            "gateway_port": gateway_state["gateway_port"],
            "websocket_enabled": gateway_state["websocket_enabled"],
            "websocket_url": gateway_state["websocket_url"],
            "websocket_client_id": gateway_state["websocket_client_id"],
            "websocket_token": gateway_state["websocket_token"],
            "guard_mode": guard_state["mode"],
            "guard_base_url": guard_state["base_url"],
            "guard_hook_enabled": guard_state["enabled"],
            "guard_hook_present": guard_state["hook_present"],
            "guard_hook_valid": guard_state["hook_valid"],
            "guard_hook_class_path": guard_state["class_path"],
            "guard_hook_plugin_path": guard_state["plugin_path"],
            "guard_timeout_s": guard_state["timeout_s"],
        },
    }


def discover_nanobot_instances() -> list[dict[str, Any]]:
    """Discover the single supported local nanobot config."""
    payload = build_nanobot_instance_payload(NANOBOT_DEFAULT_CONFIG)
    return [payload] if payload else []


def nanobot_capabilities(*, has_gateway_url: bool, guard_mode: str = "disabled") -> dict[str, bool]:
    """Return nanobot's static capability map."""
    capabilities = empty_capabilities()
    capabilities.update(
        {
            "monitoring": True,
            "history": True,
            "chat": has_gateway_url,
            "model_list": has_gateway_url,
            "health_check": True,
            "guard_observe": guard_mode in {"observe", "blocking"},
            "guard_blocking": guard_mode == "blocking",
            "onboard": False,
            "multi_instance": False,
        }
    )
    return capabilities


def _parse_timestamp(value: Any) -> datetime:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _normalize_nanobot_tool_call(
    tool_call: dict[str, Any],
) -> tuple[str | None, str, dict[str, Any] | None, dict[str, Any]]:
    source_id = str(tool_call.get("id") or "") or None
    function = (
        tool_call.get("function")
        if isinstance(tool_call.get("function"), dict)
        else {}
    )
    tool_name = str(function.get("name") or tool_call.get("name") or "unknown")
    arguments = function.get("arguments") if function else tool_call.get("arguments")
    parsed_arguments: dict[str, Any] | None = None
    if isinstance(arguments, dict):
        parsed_arguments = arguments
    elif isinstance(arguments, str):
        try:
            parsed_arguments = json.loads(arguments)
        except Exception:
            parsed_arguments = {"raw": arguments}
    normalized = {
        "type": "toolCall",
        "id": source_id,
        "name": tool_name,
        "arguments": parsed_arguments,
    }
    return source_id, tool_name, parsed_arguments, normalized


def _normalize_content_blocks(
    message: dict[str, Any],
) -> tuple[str, list[dict[str, Any]] | None, list[ParsedToolCall]]:
    content = message.get("content")
    text = ""
    blocks: list[dict[str, Any]] = []
    tool_calls: list[ParsedToolCall] = []

    if isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            blocks.append(item)
            if item.get("type") == "text" and item.get("text"):
                text += str(item["text"])
    elif isinstance(content, str):
        text = content
        if content:
            blocks.append({"type": "text", "text": content})
    elif content is not None:
        rendered = json.dumps(content, ensure_ascii=False)
        text = rendered
        blocks.append({"type": "text", "text": rendered})

    for tool_call in message.get("tool_calls") or []:
        if not isinstance(tool_call, dict):
            continue
        tool_call_id, tool_name, arguments, normalized = _normalize_nanobot_tool_call(tool_call)
        if not tool_call_id:
            continue
        blocks.append(normalized)
        tool_calls.append(
            ParsedToolCall(
                source_tool_call_id=tool_call_id,
                tool_name=tool_name,
                arguments=arguments,
            )
        )

    return text.strip(), blocks or None, tool_calls


async def parse_nanobot_session_file(
    file_path: Path,
    *,
    start_line: int = 0,
) -> ParsedSessionBatch:
    """Parse one nanobot session JSONL file."""
    messages: list[ParsedMessage] = []
    metadata: dict[str, Any] = {}

    with open(file_path, encoding="utf-8", errors="replace") as handle:
        lines = handle.readlines()

    total_lines = len(lines)
    for line_index, raw_line in enumerate(lines):
        line = raw_line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if line_index == 0 and data.get("_type") == "metadata":
            metadata = data
            continue
        if line_index < start_line:
            continue

        role = str(data.get("role") or "unknown")
        source_message_id = f"line-{line_index + 1}"
        timestamp = _parse_timestamp(data.get("timestamp"))
        text, blocks, tool_calls = _normalize_content_blocks(data)
        tool_result = None
        normalized_role = role
        if role == "tool":
            normalized_role = "toolResult"
            content = data.get("content")
            result_json = content if isinstance(content, (dict, list)) else None
            result_text = text or (
                json.dumps(content, ensure_ascii=False)
                if isinstance(content, (dict, list))
                else str(content or "")
            )
            tool_result = ParsedToolResult(
                source_tool_call_id=str(data.get("tool_call_id") or ""),
                result_text=result_text,
                result_json=result_json,
                is_error=str(result_text).startswith("Error"),
            )
            blocks = [{"type": "text", "text": result_text}] if result_text else None
            text = result_text

        raw_entry = data if isinstance(data, dict) else {"value": data}
        messages.append(
            ParsedMessage(
                source_message_id=source_message_id,
                source_parent_message_id=None,
                role=normalized_role,
                timestamp=timestamp,
                content_text=text,
                content_json=blocks,
                raw_entry=raw_entry,
                tool_calls=tool_calls,
                tool_result=tool_result,
            )
        )

    source_session_id = str(metadata.get("key") or file_path.stem)
    first_seen = _parse_timestamp(metadata.get("created_at"))
    last_seen = (
        _parse_timestamp(metadata.get("updated_at"))
        if metadata.get("updated_at")
        else None
    )
    session = ParsedSessionInfo(
        source_session_id=source_session_id,
        session_key=source_session_id,
        first_seen_at=first_seen,
        last_activity_at=last_seen or (messages[-1].timestamp if messages else first_seen),
        jsonl_file_path=str(file_path),
    )
    return ParsedSessionBatch(session=session, messages=messages, total_lines=total_lines)


async def check_nanobot_health(base_url: str | None) -> tuple[str, bool]:
    """Probe nanobot's health endpoint."""
    if not base_url:
        return "unknown", False
    url = base_url.rstrip("/")
    if not url.endswith("/health"):
        url = f"{url}/health"
    try:
        async with httpx.AsyncClient(timeout=2.5, trust_env=False) as client:
            response = await client.get(url)
        if response.status_code == 200:
            return "healthy", True
    except Exception:
        pass
    return "unreachable", False
