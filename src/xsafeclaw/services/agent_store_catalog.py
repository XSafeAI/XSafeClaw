"""Fetch and normalize Agent Store package metadata."""

from __future__ import annotations

import asyncio
import platform
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx

_CATALOG_FRESH_TTL_S = 60 * 60
_CATALOG_STALE_TTL_S = 24 * 60 * 60
_HTTP_TIMEOUT_S = 12.0

_catalog_cache: dict[str, Any] | None = None
_catalog_cache_fresh_until = 0.0
_catalog_cache_stale_until = 0.0
_catalog_cache_lock = asyncio.Lock()


def clear_agent_store_catalog_cache() -> None:
    """Clear the in-memory Store catalog cache."""
    global _catalog_cache, _catalog_cache_fresh_until, _catalog_cache_stale_until
    _catalog_cache = None
    _catalog_cache_fresh_until = 0.0
    _catalog_cache_stale_until = 0.0


async def get_agent_store_catalog(*, force_refresh: bool = False) -> dict[str, Any]:
    """Return Store metadata with stale-on-error behavior."""
    now = time.monotonic()
    if not force_refresh and _catalog_cache is not None and now < _catalog_cache_fresh_until:
        return _with_stale_flag(_catalog_cache, stale=False)

    try:
        return await _refresh_agent_store_catalog(force_refresh=force_refresh)
    except Exception:
        now = time.monotonic()
        if _catalog_cache is not None and now < _catalog_cache_stale_until:
            return _with_stale_flag(_catalog_cache, stale=True)
        return _unknown_catalog()


async def _refresh_agent_store_catalog(*, force_refresh: bool = False) -> dict[str, Any]:
    async with _catalog_cache_lock:
        now = time.monotonic()
        if not force_refresh and _catalog_cache is not None and now < _catalog_cache_fresh_until:
            return _with_stale_flag(_catalog_cache, stale=False)

        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT_S, follow_redirects=True) as client:
            catalog = await _build_catalog(client)

        if _catalog_cache is not None and all(agent.get("status") == "unknown" for agent in catalog["agents"]):
            raise RuntimeError("all catalog sources failed")

        return _store_catalog_cache(catalog)


async def _build_catalog(client: httpx.AsyncClient) -> dict[str, Any]:
    agents = [
        await _entry_from_npm(client, agent_id="openclaw", package_name="openclaw"),
        await _entry_from_pypi(client, agent_id="hermes", project_name="hermes-agent"),
        await _entry_from_pypi(client, agent_id="nanobot", project_name="nanobot-ai"),
        await _entry_from_codex_npm(client),
    ]
    return {
        "agents": agents,
        "generatedAt": _utc_now_iso(),
        "stale": False,
    }


def _store_catalog_cache(catalog: dict[str, Any]) -> dict[str, Any]:
    global _catalog_cache, _catalog_cache_fresh_until, _catalog_cache_stale_until
    now = time.monotonic()
    _catalog_cache = _without_stale_flag(catalog)
    _catalog_cache_fresh_until = now + _CATALOG_FRESH_TTL_S
    _catalog_cache_stale_until = now + _CATALOG_STALE_TTL_S
    return _with_stale_flag(_catalog_cache, stale=False)


async def _entry_from_npm(client: httpx.AsyncClient, *, agent_id: str, package_name: str) -> dict[str, Any]:
    try:
        metadata = await _fetch_json(client, _npm_registry_url(package_name))
        latest = _string_at(metadata, "dist-tags", "latest")
        version_metadata = _dict_at(metadata, "versions", latest)
        size_bytes = _int_at(version_metadata, "dist", "unpackedSize")
        return _ready_entry(
            agent_id=agent_id,
            version=latest,
            size_bytes=size_bytes,
            source="npm",
        )
    except Exception as exc:
        return _unknown_entry(agent_id=agent_id, source="npm", error=exc)


async def _entry_from_pypi(client: httpx.AsyncClient, *, agent_id: str, project_name: str) -> dict[str, Any]:
    try:
        metadata = await _fetch_json(client, f"https://pypi.org/pypi/{project_name}/json")
        version = _string_at(metadata, "info", "version")
        files = _list_at(metadata, "releases", version)
        selected_file = _select_pypi_file(files)
        size_bytes = _int_value(selected_file.get("size"), "size")
        return _ready_entry(
            agent_id=agent_id,
            version=version,
            size_bytes=size_bytes,
            source="pypi",
        )
    except Exception as exc:
        return _unknown_entry(agent_id=agent_id, source="pypi", error=exc)


async def _entry_from_codex_npm(client: httpx.AsyncClient) -> dict[str, Any]:
    try:
        metadata = await _fetch_json(client, _npm_registry_url("@openai/codex"))
        latest = _string_at(metadata, "dist-tags", "latest")
        root_version = _dict_at(metadata, "versions", latest)
        dependency_name = _codex_platform_dependency_name()
        if dependency_name is None:
            raise ValueError("current platform is not supported by @openai/codex")
        dependency_spec = _string_at(root_version, "optionalDependencies", dependency_name)
        platform_version = _codex_platform_version_from_dependency_spec(dependency_spec)
        platform_metadata = _dict_at(metadata, "versions", platform_version)
        size_bytes = _int_at(platform_metadata, "dist", "unpackedSize")
        return _ready_entry(
            agent_id="codex",
            version=latest,
            size_bytes=size_bytes,
            source="npm",
        )
    except Exception as exc:
        return _unknown_entry(agent_id="codex", source="npm", error=exc)


async def _fetch_json(client: httpx.AsyncClient, url: str) -> dict[str, Any]:
    response = await client.get(url)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError(f"expected object payload from {url}")
    return payload


def _npm_registry_url(package_name: str) -> str:
    return f"https://registry.npmjs.org/{quote(package_name, safe='@')}"


def _codex_platform_dependency_name() -> str | None:
    system_name = platform.system().lower()
    machine = platform.machine().lower()

    os_key = {
        "windows": "win32",
        "darwin": "darwin",
        "linux": "linux",
    }.get(system_name)
    arch_key = {
        "amd64": "x64",
        "x86_64": "x64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }.get(machine)

    if os_key is None or arch_key is None:
        return None
    return f"@openai/codex-{os_key}-{arch_key}"


def _codex_platform_version_from_dependency_spec(spec: str) -> str:
    marker = "npm:@openai/codex@"
    if not spec.startswith(marker):
        raise ValueError(f"unsupported Codex dependency spec: {spec}")
    version = spec[len(marker) :].strip()
    if not version:
        raise ValueError("empty Codex platform version")
    return version


def _select_pypi_file(files: list[Any]) -> dict[str, Any]:
    dict_files = [item for item in files if isinstance(item, dict)]
    wheel = next((item for item in dict_files if item.get("packagetype") == "bdist_wheel"), None)
    selected = wheel or next(iter(dict_files), None)
    if selected is None:
        raise ValueError("latest release has no downloadable files")
    return selected


def _ready_entry(*, agent_id: str, version: str, size_bytes: int, source: str) -> dict[str, Any]:
    return {
        "id": agent_id,
        "version": version,
        "sizeBytes": size_bytes,
        "sizeLabel": _format_size(size_bytes),
        "source": source,
        "status": "ready",
        "error": None,
    }


def _unknown_entry(*, agent_id: str, source: str, error: Exception | None = None) -> dict[str, Any]:
    return {
        "id": agent_id,
        "version": None,
        "sizeBytes": None,
        "sizeLabel": None,
        "source": source,
        "status": "unknown",
        "error": _error_message(error) if error is not None else None,
    }


def _unknown_catalog() -> dict[str, Any]:
    return {
        "agents": [
            _unknown_entry(agent_id="openclaw", source="npm"),
            _unknown_entry(agent_id="hermes", source="pypi"),
            _unknown_entry(agent_id="nanobot", source="pypi"),
            _unknown_entry(agent_id="codex", source="npm"),
        ],
        "generatedAt": _utc_now_iso(),
        "stale": False,
    }


def _without_stale_flag(catalog: dict[str, Any]) -> dict[str, Any]:
    return {
        "agents": catalog.get("agents", []),
        "generatedAt": catalog.get("generatedAt") or _utc_now_iso(),
    }


def _with_stale_flag(catalog: dict[str, Any], *, stale: bool) -> dict[str, Any]:
    return {
        "agents": catalog.get("agents", []),
        "generatedAt": catalog.get("generatedAt") or _utc_now_iso(),
        "stale": stale,
    }


def _format_size(size_bytes: int) -> str:
    if size_bytes >= 1_000_000:
        return f"{size_bytes / 1_000_000:.1f} MB"
    if size_bytes >= 1_000:
        return f"{size_bytes / 1_000:.1f} KB"
    return f"{size_bytes} B"


def _string_at(payload: dict[str, Any], *path: str) -> str:
    value: Any = payload
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f"missing field: {'.'.join(path)}")
        value = value[key]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"invalid string field: {'.'.join(path)}")
    return value.strip()


def _dict_at(payload: dict[str, Any], *path: str) -> dict[str, Any]:
    value: Any = payload
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f"missing field: {'.'.join(path)}")
        value = value[key]
    if not isinstance(value, dict):
        raise ValueError(f"invalid object field: {'.'.join(path)}")
    return value


def _list_at(payload: dict[str, Any], *path: str) -> list[Any]:
    value: Any = payload
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f"missing field: {'.'.join(path)}")
        value = value[key]
    if not isinstance(value, list):
        raise ValueError(f"invalid list field: {'.'.join(path)}")
    return value


def _int_at(payload: dict[str, Any], *path: str) -> int:
    value: Any = payload
    for key in path:
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f"missing field: {'.'.join(path)}")
        value = value[key]
    return _int_value(value, ".".join(path))


def _int_value(value: Any, field_name: str) -> int:
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"invalid integer field: {field_name}")
    return value


def _error_message(error: Exception) -> str:
    return f"{type(error).__name__}: {error}"[:240]


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
