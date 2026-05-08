from __future__ import annotations

from pathlib import Path

from xsafeclaw.api.routes.memory import _collect_memory_files
from xsafeclaw.runtime.models import RuntimeInstance


def _instance(platform: str, workspace: Path) -> RuntimeInstance:
    return RuntimeInstance.model_validate(
        {
            "instance_id": f"{platform}-test",
            "platform": platform,
            "display_name": f"{platform} test",
            "workspace_path": str(workspace),
            "enabled": True,
        }
    )


def _index_by_key(files: list[dict]) -> dict[str, dict]:
    indexed: dict[str, dict] = {}
    for item in files:
        normalized = str(item["key"]).replace("\\", "/")
        indexed[normalized] = item
    return indexed


def test_openclaw_collection_shape_unchanged(tmp_path: Path) -> None:
    workspace = tmp_path / "openclaw-workspace"
    (workspace / "memory").mkdir(parents=True)
    (workspace / "MEMORY.md").write_text("root memory", encoding="utf-8")
    (workspace / "memory.md").write_text("legacy memory", encoding="utf-8")
    (workspace / "memory" / "custom.md").write_text("custom", encoding="utf-8")
    (workspace / "AGENTS.md").write_text("# agents", encoding="utf-8")

    files, reason = _collect_memory_files(_instance("openclaw", workspace))
    assert reason == ""

    indexed = _index_by_key(files)
    assert {"memory/custom.md", "AGENTS.md"} <= set(indexed.keys())
    assert "MEMORY.md" in indexed or "memory.md" in indexed
    assert indexed["MEMORY.md"]["category"] == "memory"
    assert indexed["memory/custom.md"]["category"] == "memory"
    assert indexed["AGENTS.md"]["category"] == "workspace"


def test_hermes_collects_memory_and_workspace_types(tmp_path: Path) -> None:
    hermes_home = tmp_path / ".hermes"
    (hermes_home / "memories").mkdir(parents=True)
    (hermes_home / "workspace").mkdir(parents=True)
    (hermes_home / "memories" / "MEMORY.md").write_text("hermes memory", encoding="utf-8")
    (hermes_home / "memories" / "USER.md").write_text("hermes user", encoding="utf-8")
    (hermes_home / "SOUL.md").write_text("hermes soul", encoding="utf-8")
    (hermes_home / "workspace" / "SAFETY.md").write_text("policy", encoding="utf-8")
    (hermes_home / "workspace" / "PERMISSION.md").write_text("boundary", encoding="utf-8")

    files, reason = _collect_memory_files(_instance("hermes", hermes_home))
    assert reason == ""

    indexed = _index_by_key(files)
    assert {"MEMORY.md", "USER.md", "SOUL.md", "SAFETY.md", "PERMISSION.md"} <= set(indexed.keys())
    assert indexed["MEMORY.md"]["category"] == "memory"
    assert indexed["USER.md"]["category"] == "memory"
    assert indexed["SOUL.md"]["category"] == "workspace"
    assert indexed["SAFETY.md"]["category"] == "workspace"
    assert indexed["PERMISSION.md"]["category"] == "workspace"


def test_nanobot_reuses_openclaw_shape_for_memory_and_workspace(tmp_path: Path) -> None:
    workspace = tmp_path / "nanobot-workspace"
    (workspace / "memory").mkdir(parents=True)
    (workspace / "SOUL.md").write_text("nanobot soul", encoding="utf-8")
    (workspace / "USER.md").write_text("nanobot user", encoding="utf-8")
    (workspace / "memory" / "MEMORY.md").write_text("nanobot memory", encoding="utf-8")
    (workspace / "AGENTS.md").write_text("# agents", encoding="utf-8")
    (workspace / "TOOLS.md").write_text("# tools", encoding="utf-8")

    files, reason = _collect_memory_files(_instance("nanobot", workspace))
    assert reason == ""

    indexed = _index_by_key(files)
    assert {"SOUL.md", "USER.md", "memory/MEMORY.md", "AGENTS.md", "TOOLS.md"} <= set(indexed.keys())
    assert indexed["memory/MEMORY.md"]["category"] == "memory"
    assert indexed["SOUL.md"]["category"] == "workspace"
    assert indexed["USER.md"]["category"] == "workspace"
    assert indexed["AGENTS.md"]["category"] == "workspace"

