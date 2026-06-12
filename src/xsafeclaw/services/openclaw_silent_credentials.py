"""Private OpenClaw model credentials for XSafeClaw silent calls."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from ..config import settings

DEFAULT_PROVIDER_URLS = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "moonshot": "https://api.moonshot.cn/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "minimax": "https://api.minimax.io/v1",
    "dashscope": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "alibaba": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "groq": "https://api.groq.com/openai/v1",
    "mistral": "https://api.mistral.ai/v1",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "ollama": "http://127.0.0.1:11434/v1",
}
DEFAULT_PROVIDER_API_TYPES = {
    "anthropic": "anthropic-messages",
}

_CREDENTIALS_DIRNAME = "credentials"
_OPENCLAW_SILENT_MODEL_FILENAME = "openclaw-silent-model.json"


def openclaw_silent_credentials_dir() -> Path:
    return Path(settings.data_dir).expanduser() / _CREDENTIALS_DIRNAME


def openclaw_silent_model_credentials_path() -> Path:
    return openclaw_silent_credentials_dir() / _OPENCLAW_SILENT_MODEL_FILENAME


def _chmod_private(path: Path, mode: int) -> None:
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def _ensure_private_credentials_dir() -> Path:
    directory = openclaw_silent_credentials_dir()
    directory.mkdir(parents=True, exist_ok=True)
    _chmod_private(directory, 0o700)
    return directory


def _primary_model(config: dict[str, Any]) -> tuple[str, str]:
    primary = str(
        config.get("agents", {})
        .get("defaults", {})
        .get("model", {})
        .get("primary", "")
    ).strip()
    if "/" in primary:
        provider, model = primary.split("/", 1)
    else:
        provider, model = "", primary
    return provider.strip(), model.strip()


def _provider_config(config: dict[str, Any], provider: str) -> dict[str, Any]:
    providers = config.get("models", {}).get("providers", {})
    value = providers.get(provider, {}) if isinstance(providers, dict) else {}
    return value if isinstance(value, dict) else {}


def resolve_openclaw_model_from_config(
    config: dict[str, Any],
    *,
    api_key: str = "",
    source: str = "",
) -> dict[str, str] | None:
    """Resolve the active OpenClaw provider/model into a direct-call shape."""
    provider, model = _primary_model(config)
    if not provider:
        return None

    provider_cfg = _provider_config(config, provider)
    if not model:
        models = provider_cfg.get("models", [])
        if isinstance(models, list) and models and isinstance(models[0], dict):
            model = str(models[0].get("id") or "").strip()
    if not model:
        return None

    base_url = str(provider_cfg.get("baseUrl") or "").strip()
    if not base_url:
        base_url = DEFAULT_PROVIDER_URLS.get(provider, "")
    if not base_url:
        return None

    api_type = str(provider_cfg.get("api") or "").strip()
    if not api_type:
        api_type = DEFAULT_PROVIDER_API_TYPES.get(provider, "openai-completions")

    key = str(api_key or provider_cfg.get("apiKey") or "").strip()
    if not key:
        return None

    payload = {
        "provider": provider,
        "model": model,
        "base_url": base_url,
        "api_type": api_type,
        "api_key": key,
    }
    if source:
        payload["source"] = source
    return payload


def save_openclaw_silent_model_credentials(
    config: dict[str, Any],
    *,
    api_key: str,
    source: str,
) -> dict[str, str] | None:
    """Persist direct-call credentials captured during OpenClaw configure."""
    resolved = resolve_openclaw_model_from_config(
        config,
        api_key=api_key,
        source=source,
    )
    if not resolved:
        return None

    _ensure_private_credentials_dir()
    path = openclaw_silent_model_credentials_path()
    payload = {
        **resolved,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    _chmod_private(tmp_path, 0o600)
    tmp_path.replace(path)
    _chmod_private(path, 0o600)
    return resolved


def delete_openclaw_silent_model_credentials() -> bool:
    path = openclaw_silent_model_credentials_path()
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def _clean_credential_payload(payload: Any) -> dict[str, str] | None:
    if not isinstance(payload, dict):
        return None
    cleaned = {
        "provider": str(payload.get("provider") or "").strip(),
        "model": str(payload.get("model") or "").strip(),
        "base_url": str(payload.get("base_url") or "").strip(),
        "api_type": str(payload.get("api_type") or "").strip() or "openai-completions",
        "api_key": str(payload.get("api_key") or "").strip(),
    }
    if not all(cleaned.values()):
        return None
    source = str(payload.get("source") or "").strip()
    if source:
        cleaned["source"] = source
    return cleaned


def read_openclaw_silent_model_credentials() -> dict[str, str] | None:
    path = openclaw_silent_model_credentials_path()
    try:
        payload = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return _clean_credential_payload(payload)


def _matches_active_config(credential: dict[str, str], config: dict[str, Any]) -> bool:
    active = resolve_openclaw_model_from_config(
        config,
        api_key=credential.get("api_key", ""),
    )
    if not active:
        return False
    return (
        active.get("provider") == credential.get("provider")
        and active.get("model") == credential.get("model")
    )


def read_openclaw_silent_model_credentials_for_config(
    config: dict[str, Any],
) -> dict[str, str] | None:
    credential = read_openclaw_silent_model_credentials()
    if not credential:
        return None
    if not _matches_active_config(credential, config):
        return None
    return credential


def openclaw_silent_credentials_match_provider(provider: str) -> bool:
    credential = read_openclaw_silent_model_credentials()
    if not credential:
        return False
    requested = str(provider or "").strip().lower()
    stored = credential.get("provider", "").strip().lower()
    if not requested or not stored:
        return False
    if requested == stored:
        return True
    if requested.endswith("-api-key") and requested.removesuffix("-api-key") == stored:
        return True
    return False
