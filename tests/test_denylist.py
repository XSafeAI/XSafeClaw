"""Regression tests for user-defined protected paths."""

import json
from pathlib import Path

import pytest

from xsafeclaw.api.routes import assets
from xsafeclaw.services import guard_service


@pytest.mark.asyncio
async def test_denylist_remove_restores_access(tmp_path, monkeypatch):
    """Removing a protected path should stop blocking later tool calls."""
    denylist_file = tmp_path / "denylist.json"

    monkeypatch.setattr(assets, "_DENYLIST_FILE", denylist_file)
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    protected_dir = tmp_path / "protected"
    protected_dir.mkdir()
    protected_file = protected_dir / "demo.txt"
    protected_file.write_text("demo", encoding="utf-8")

    add_result = await assets.add_deny_path(assets.DenyEntry(path=str(protected_dir)))
    assert add_result["paths"] == [str(protected_dir.resolve())]
    assert guard_service._denylist_precheck(
        "exec",
        {"command": f"cat {protected_file}"},
    )

    remove_result = await assets.remove_deny_path(str(protected_dir))
    assert remove_result["paths"] == []
    assert json.loads(denylist_file.read_text("utf-8")) == []
    assert guard_service._denylist_precheck(
        "exec",
        {"command": f"cat {protected_file}"},
    ) is None


def test_guard_service_reloads_denylist_file_every_time(tmp_path, monkeypatch):
    """Guard service should not keep stale denylist state in memory."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    denylist_file.write_text(json.dumps([str(tmp_path / "one")]), encoding="utf-8")
    assert guard_service._load_denylist() == {str((tmp_path / "one").resolve())}

    denylist_file.write_text(json.dumps([]), encoding="utf-8")
    assert guard_service._load_denylist() == set()
