"""Config-driven hook autoloading for the upstream nanobot runtime."""

from __future__ import annotations

import inspect
import importlib
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_PATCH_ATTR = "_xsafeclaw_hook_autoload_installed"
_CONFIG_PATCH_ATTR = "_xsafeclaw_config_hooks_compat_installed"
_ORIGINAL_INIT_ATTR = "_xsafeclaw_original_init"
_ORIGINAL_RUN_ATTR = "_xsafeclaw_original_run_agent_loop"
_ORIGINAL_LOAD_CONFIG_ATTR = "_xsafeclaw_original_load_config"
_XSAFECLAW_CHANNEL_EXTENSION_NAME = "xsafeclaw"


def _default_config_path() -> Path:
    try:
        from nanobot.config.loader import get_config_path

        return Path(get_config_path()).expanduser()
    except Exception:
        return Path.home() / ".nanobot" / "config.json"


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return payload if isinstance(payload, dict) else {}


def _read_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _import_hook_class(class_path: str) -> type[Any]:
    module_name, sep, attr_path = class_path.partition(":")
    if not sep:
        module_name, _, attr_path = class_path.rpartition(".")
    if not module_name or not attr_path:
        raise ValueError(f"Invalid nanobot hook class_path: {class_path}")

    module = importlib.import_module(module_name)
    target: Any = module
    for part in attr_path.split("."):
        target = getattr(target, part)
    if not isinstance(target, type):
        raise TypeError(f"Nanobot hook target is not a class: {class_path}")
    return target


def _read_hook_entries(data: dict[str, Any]) -> dict[str, Any]:
    channels = _read_mapping(data.get("channels"))
    extension = _read_mapping(channels.get(_XSAFECLAW_CHANNEL_EXTENSION_NAME))
    extension_hooks = _read_mapping(extension.get("hooks"))
    extension_entries = _read_mapping(extension_hooks.get("entries"))
    if extension_entries:
        return extension_entries

    legacy_hooks = _read_mapping(data.get("hooks"))
    return _read_mapping(legacy_hooks.get("entries"))


def load_configured_nanobot_hooks(config_path: str | Path | None = None) -> list[Any]:
    """Instantiate nanobot hooks from raw config JSON.

    Upstream nanobot currently rejects unknown top-level keys when loading its
    Pydantic config model, so XSafeClaw stores current hook configuration under
    ``channels.xsafeclaw.hooks.entries`` and still reads legacy ``hooks.entries``
    for older configs.
    """
    path = Path(config_path).expanduser() if config_path else _default_config_path()
    entries = _read_hook_entries(_read_json(path))
    hooks: list[Any] = []

    for name, entry in entries.items():
        if not isinstance(entry, dict) or not bool(entry.get("enabled", False)):
            continue

        class_path = str(entry.get("class_path") or entry.get("classPath") or "").strip()
        if not class_path:
            logger.warning("Skipping nanobot hook %s because class_path is missing", name)
            continue

        hook_config = _read_mapping(entry.get("config"))
        try:
            hook_class = _import_hook_class(class_path)
            hooks.append(hook_class(hook_config))
        except Exception:
            logger.exception("Failed to load nanobot hook %s from %s", name, class_path)

    return hooks


def _hook_identity(hook: Any) -> tuple[str, str]:
    hook_class = hook.__class__
    return hook_class.__module__, hook_class.__qualname__


def merge_configured_hooks(existing_hooks: list[Any] | None) -> list[Any]:
    """Append configured hooks without duplicating already provided hook classes."""
    merged = list(existing_hooks or [])
    seen = {_hook_identity(hook) for hook in merged}

    for hook in load_configured_nanobot_hooks():
        identity = _hook_identity(hook)
        if identity in seen:
            continue
        merged.append(hook)
        seen.add(identity)

    return merged


def _strip_xsafeclaw_config_extensions(data: Any) -> Any:
    if not isinstance(data, dict) or "hooks" not in data:
        return data
    sanitized = dict(data)
    sanitized.pop("hooks", None)
    return sanitized


def install_nanobot_config_compat() -> bool:
    """Allow upstream nanobot config loading to coexist with XSafeClaw extensions.

    nanobot 0.1.5 forbids unknown top-level fields in its Pydantic config. Older
    XSafeClaw configs used ``hooks.entries`` in the same JSON file for a
    plugin-like UX, so nanobot must ignore that legacy extension while loading
    its own config.
    """
    try:
        import pydantic
        import nanobot.config.loader as loader
        from nanobot.config.schema import Config
    except Exception:
        logger.debug("nanobot config loader is unavailable; skipping compat patch", exc_info=True)
        return False

    if getattr(loader, _CONFIG_PATCH_ATTR, False):
        return False

    original_load_config = loader.load_config

    def patched_load_config(config_path: Path | None = None) -> Any:
        path = config_path or loader.get_config_path()

        config = Config()
        if path.exists():
            try:
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
                data = loader._migrate_config(data)
                data = _strip_xsafeclaw_config_extensions(data)
                config = Config.model_validate(data)
            except (json.JSONDecodeError, ValueError, pydantic.ValidationError) as exc:
                loader.logger.warning(f"Failed to load config from {path}: {exc}")
                loader.logger.warning("Using default configuration.")

        loader._apply_ssrf_whitelist(config)
        return config

    loader.load_config = patched_load_config
    setattr(loader, _CONFIG_PATCH_ATTR, True)
    setattr(loader, _ORIGINAL_LOAD_CONFIG_ATTR, original_load_config)
    return True


def _set_hook_runtime_context(
    hooks: list[Any] | None,
    *,
    session_key: str,
    channel: str,
    chat_id: str,
    message_id: str | None,
) -> None:
    for hook in hooks or []:
        setter = getattr(hook, "set_runtime_context", None)
        if not callable(setter):
            continue
        try:
            setter(
                session_key=session_key,
                channel=channel,
                chat_id=chat_id,
                message_id=message_id,
            )
        except Exception:
            logger.exception("Failed to update runtime context for nanobot hook %r", hook)


def install_nanobot_hook_autoload() -> bool:
    """Patch nanobot AgentLoop so original nanobot commands load configured hooks."""
    install_nanobot_config_compat()

    try:
        from nanobot.agent.loop import AgentLoop
    except Exception:
        logger.debug("nanobot is unavailable; skipping hook autoload patch", exc_info=True)
        return False

    if getattr(AgentLoop, _PATCH_ATTR, False):
        return False

    original_init = AgentLoop.__init__
    original_run_agent_loop = AgentLoop._run_agent_loop

    signature = inspect.signature(original_init)
    parameter_names = [name for name in signature.parameters if name != "self"]
    hooks_position = parameter_names.index("hooks") if "hooks" in parameter_names else None

    def patched_init(self: Any, *args: Any, **kwargs: Any) -> None:
        if hooks_position is None:
            original_init(self, *args, **kwargs)
            return

        if "hooks" in kwargs:
            kwargs["hooks"] = merge_configured_hooks(kwargs.get("hooks"))
        elif len(args) > hooks_position:
            mutable_args = list(args)
            mutable_args[hooks_position] = merge_configured_hooks(mutable_args[hooks_position])
            args = tuple(mutable_args)
        else:
            kwargs["hooks"] = merge_configured_hooks(None)

        original_init(self, *args, **kwargs)

    async def patched_run_agent_loop(
        self: Any,
        initial_messages: list[dict[str, Any]],
        *args: Any,
        **kwargs: Any,
    ) -> tuple[Any, ...]:
        session = kwargs.get("session")
        _set_hook_runtime_context(
            getattr(self, "_extra_hooks", None),
            session_key=str(getattr(session, "key", "") or ""),
            channel=str(kwargs.get("channel") or "cli"),
            chat_id=str(kwargs.get("chat_id") or "direct"),
            message_id=kwargs.get("message_id"),
        )
        return await original_run_agent_loop(self, initial_messages, *args, **kwargs)

    AgentLoop.__init__ = patched_init
    AgentLoop._run_agent_loop = patched_run_agent_loop
    setattr(AgentLoop, _PATCH_ATTR, True)
    setattr(AgentLoop, _ORIGINAL_INIT_ATTR, original_init)
    setattr(AgentLoop, _ORIGINAL_RUN_ATTR, original_run_agent_loop)
    return True
