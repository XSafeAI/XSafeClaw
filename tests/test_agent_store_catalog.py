from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from xsafeclaw.api.main import app
from xsafeclaw.api.routes import system as system_routes
from xsafeclaw.services import agent_store_catalog


def _npm_openclaw_payload() -> dict:
    return {
        "dist-tags": {"latest": "2026.6.9"},
        "versions": {
            "2026.6.9": {
                "dist": {"unpackedSize": 86608026},
            },
        },
    }


def _pypi_payload(version: str, wheel_size: int, sdist_size: int = 99) -> dict:
    return {
        "info": {"version": version},
        "releases": {
            version: [
                {"packagetype": "sdist", "size": sdist_size},
                {"packagetype": "bdist_wheel", "size": wheel_size},
            ],
        },
    }


def _npm_codex_payload() -> dict:
    return {
        "dist-tags": {"latest": "0.142.0"},
        "versions": {
            "0.142.0": {
                "optionalDependencies": {
                    "@openai/codex-win32-x64": "npm:@openai/codex@0.142.0-win32-x64",
                    "@openai/codex-win32-arm64": "npm:@openai/codex@0.142.0-win32-arm64",
                },
                "dist": {"unpackedSize": 9718},
            },
            "0.142.0-win32-x64": {
                "dist": {"unpackedSize": 337700703},
            },
            "0.142.0-win32-arm64": {
                "dist": {"unpackedSize": 292442468},
            },
        },
    }


@pytest.fixture(autouse=True)
def _clear_catalog_cache():
    agent_store_catalog.clear_agent_store_catalog_cache()
    yield
    agent_store_catalog.clear_agent_store_catalog_cache()


@pytest.mark.asyncio
async def test_agent_store_catalog_reads_npm_pypi_and_codex_platform_metadata(monkeypatch):
    async def fake_fetch_json(_client, url: str) -> dict:
        if url.endswith("/openclaw"):
            return _npm_openclaw_payload()
        if url.endswith("/nanobot-ai/json"):
            return _pypi_payload("0.2.2", 2630152)
        if url.endswith("/hermes-agent/json"):
            return _pypi_payload("0.17.0", 8642279)
        if url.endswith("/@openai%2Fcodex"):
            return _npm_codex_payload()
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(agent_store_catalog, "_fetch_json", fake_fetch_json)
    monkeypatch.setattr(agent_store_catalog, "_codex_platform_dependency_name", lambda: "@openai/codex-win32-x64")

    payload = await agent_store_catalog.get_agent_store_catalog()
    agents = {agent["id"]: agent for agent in payload["agents"]}

    assert payload["stale"] is False
    assert agents["openclaw"] == {
        "id": "openclaw",
        "version": "2026.6.9",
        "sizeBytes": 86608026,
        "sizeLabel": "86.6 MB",
        "source": "npm",
        "status": "ready",
        "error": None,
    }
    assert agents["nanobot"]["version"] == "0.2.2"
    assert agents["nanobot"]["sizeBytes"] == 2630152
    assert agents["nanobot"]["sizeLabel"] == "2.6 MB"
    assert agents["hermes"]["version"] == "0.17.0"
    assert agents["hermes"]["sizeBytes"] == 8642279
    assert agents["codex"]["version"] == "0.142.0"
    assert agents["codex"]["sizeBytes"] == 337700703
    assert agents["codex"]["sizeLabel"] == "337.7 MB"


@pytest.mark.asyncio
async def test_agent_store_catalog_keeps_other_agents_when_one_source_fails(monkeypatch):
    async def fake_fetch_json(_client, url: str) -> dict:
        if url.endswith("/openclaw"):
            return _npm_openclaw_payload()
        if url.endswith("/nanobot-ai/json"):
            raise RuntimeError("nanobot registry offline")
        if url.endswith("/hermes-agent/json"):
            return _pypi_payload("0.17.0", 8642279)
        if url.endswith("/@openai%2Fcodex"):
            return _npm_codex_payload()
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(agent_store_catalog, "_fetch_json", fake_fetch_json)
    monkeypatch.setattr(agent_store_catalog, "_codex_platform_dependency_name", lambda: "@openai/codex-win32-x64")

    payload = await agent_store_catalog.get_agent_store_catalog()
    agents = {agent["id"]: agent for agent in payload["agents"]}

    assert agents["openclaw"]["status"] == "ready"
    assert agents["hermes"]["status"] == "ready"
    assert agents["codex"]["status"] == "ready"
    assert agents["nanobot"]["status"] == "unknown"
    assert agents["nanobot"]["version"] is None
    assert agents["nanobot"]["sizeBytes"] is None
    assert agents["nanobot"]["sizeLabel"] is None
    assert "nanobot registry offline" in agents["nanobot"]["error"]


@pytest.mark.asyncio
async def test_agent_store_catalog_returns_stale_cache_when_refresh_fails(monkeypatch):
    calls = 0

    async def fake_fetch_json(_client, url: str) -> dict:
        nonlocal calls
        calls += 1
        if calls > 4:
            raise RuntimeError("registry offline")
        if url.endswith("/openclaw"):
            return _npm_openclaw_payload()
        if url.endswith("/nanobot-ai/json"):
            return _pypi_payload("0.2.2", 2630152)
        if url.endswith("/hermes-agent/json"):
            return _pypi_payload("0.17.0", 8642279)
        if url.endswith("/@openai%2Fcodex"):
            return _npm_codex_payload()
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(agent_store_catalog, "_fetch_json", fake_fetch_json)
    monkeypatch.setattr(agent_store_catalog, "_codex_platform_dependency_name", lambda: "@openai/codex-win32-x64")
    monkeypatch.setattr(agent_store_catalog, "_CATALOG_FRESH_TTL_S", 0.0)
    monkeypatch.setattr(agent_store_catalog, "_CATALOG_STALE_TTL_S", 60.0)

    fresh = await agent_store_catalog.get_agent_store_catalog()
    stale = await agent_store_catalog.get_agent_store_catalog()

    assert fresh["stale"] is False
    assert stale["stale"] is True
    assert stale["agents"] == fresh["agents"]


@pytest.mark.asyncio
async def test_agent_store_catalog_force_refresh_bypasses_fresh_cache(monkeypatch):
    openclaw_versions = ["2026.6.9", "2026.6.10"]
    openclaw_calls = 0

    async def fake_fetch_json(_client, url: str) -> dict:
        nonlocal openclaw_calls
        if url.endswith("/openclaw"):
            version = openclaw_versions[min(openclaw_calls, len(openclaw_versions) - 1)]
            openclaw_calls += 1
            return {
                "dist-tags": {"latest": version},
                "versions": {
                    version: {
                        "dist": {"unpackedSize": 86608026},
                    },
                },
            }
        if url.endswith("/nanobot-ai/json"):
            return _pypi_payload("0.2.2", 2630152)
        if url.endswith("/hermes-agent/json"):
            return _pypi_payload("0.17.0", 8642279)
        if url.endswith("/@openai%2Fcodex"):
            return _npm_codex_payload()
        raise AssertionError(f"unexpected URL: {url}")

    monkeypatch.setattr(agent_store_catalog, "_fetch_json", fake_fetch_json)
    monkeypatch.setattr(agent_store_catalog, "_codex_platform_dependency_name", lambda: "@openai/codex-win32-x64")

    first = await agent_store_catalog.get_agent_store_catalog()
    refreshed = await agent_store_catalog.get_agent_store_catalog(force_refresh=True)

    first_openclaw = next(agent for agent in first["agents"] if agent["id"] == "openclaw")
    refreshed_openclaw = next(agent for agent in refreshed["agents"] if agent["id"] == "openclaw")
    assert first_openclaw["version"] == "2026.6.9"
    assert refreshed_openclaw["version"] == "2026.6.10"


def test_agent_store_catalog_route_returns_catalog_payload(monkeypatch):
    async def fake_get_agent_store_catalog(*, force_refresh: bool = False) -> dict:
        assert force_refresh is True
        return {
            "agents": [
                {
                    "id": "openclaw",
                    "version": "2026.6.9",
                    "sizeBytes": 86608026,
                    "sizeLabel": "86.6 MB",
                    "source": "npm",
                    "status": "ready",
                    "error": None,
                }
            ],
            "generatedAt": "2026-06-23T00:00:00Z",
            "stale": False,
        }

    monkeypatch.setattr(system_routes.agent_store_catalog, "get_agent_store_catalog", fake_get_agent_store_catalog)

    client = TestClient(app)
    response = client.get("/api/system/agent-store/catalog", params={"refresh": "true"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["agents"][0]["id"] == "openclaw"
    assert payload["agents"][0]["version"] == "2026.6.9"
    assert payload["agents"][0]["sizeLabel"] == "86.6 MB"
