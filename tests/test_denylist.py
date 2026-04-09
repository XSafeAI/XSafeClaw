"""Regression tests for user-defined protected paths."""

import json

import pytest

from xsafeclaw.api.routes import assets
from xsafeclaw.services import guard_service


@pytest.mark.asyncio
async def test_path_protection_only_blocks_selected_operations(tmp_path, monkeypatch):
    """A protected path should only block the operations selected by the user."""
    denylist_file = tmp_path / "denylist.json"

    monkeypatch.setattr(assets, "_DENYLIST_FILE", denylist_file)
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    protected_dir = tmp_path / "protected"
    protected_dir.mkdir()
    protected_file = protected_dir / "demo.txt"
    protected_file.write_text("demo", encoding="utf-8")

    add_result = await assets.add_deny_path(
        assets.DenyEntry(path=str(protected_dir), operations=["read", "delete"]),
    )
    assert add_result["entries"] == [
        {
            "path": str(protected_dir.resolve()),
            "operations": ["read", "delete"],
        }
    ]

    assert guard_service._denylist_precheck("exec", {"command": f"cat {protected_file}"})
    assert guard_service._denylist_precheck("exec", {"command": f"rm {protected_file}"})
    assert guard_service._denylist_precheck("exec", {"command": f"touch {protected_file}"}) is None


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

    await assets.add_deny_path(
        assets.DenyEntry(path=str(protected_dir), operations=["read"]),
    )
    assert guard_service._denylist_precheck(
        "exec",
        {"command": f"cat {protected_file}"},
    )

    remove_result = await assets.remove_deny_path(str(protected_dir))
    assert remove_result["entries"] == []
    assert json.loads(denylist_file.read_text("utf-8")) == []
    assert guard_service._denylist_precheck(
        "exec",
        {"command": f"cat {protected_file}"},
    ) is None


def test_guard_service_reloads_denylist_file_every_time(tmp_path, monkeypatch):
    """Guard service should not keep stale path-protection state in memory."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": str(tmp_path / "one"),
                    "operations": ["read"],
                }
            ]
        ),
        encoding="utf-8",
    )
    assert guard_service._load_denylist() == {str((tmp_path / "one").resolve()): {"read"}}

    denylist_file.write_text(json.dumps([]), encoding="utf-8")
    assert guard_service._load_denylist() == {}


def test_old_string_only_schema_still_blocks_all_operations(tmp_path, monkeypatch):
    """Existing denylist files should keep working after the schema upgrade."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    protected_dir = tmp_path / "legacy"
    protected_dir.mkdir()
    protected_file = protected_dir / "demo.txt"
    protected_file.write_text("demo", encoding="utf-8")

    denylist_file.write_text(json.dumps([str(protected_dir)]), encoding="utf-8")

    rules = guard_service._load_denylist()
    assert rules == {
        str(protected_dir.resolve()): {"read", "modify", "delete"},
    }
    assert guard_service._denylist_precheck("exec", {"command": f"cat {protected_file}"})
    assert guard_service._denylist_precheck("exec", {"command": f"rm {protected_file}"})
    assert guard_service._denylist_precheck("exec", {"command": f"touch {protected_file}"})


def test_guard_service_blocks_parent_scope_reads_for_protected_child(tmp_path, monkeypatch):
    """Searching an ancestor directory should not bypass a protected child path."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    desktop_dir = tmp_path / "Desktop"
    protected_dir = desktop_dir / "protected"
    protected_dir.mkdir(parents=True)
    (protected_dir / "demo.txt").write_text("demo", encoding="utf-8")

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": str(protected_dir),
                    "operations": ["read"],
                }
            ]
        ),
        encoding="utf-8",
    )

    reason = guard_service._denylist_precheck(
        "exec",
        {"command": f'find "{desktop_dir}" -name "demo.txt" | head -5'},
    )
    assert reason
    assert str(desktop_dir.resolve()) in reason


def test_guard_service_blocks_osascript_delete_for_protected_path(tmp_path, monkeypatch):
    """AppleScript file deletes should be hard-blocked before approval flow."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    protected_dir = tmp_path / "protected"
    protected_dir.mkdir()
    protected_file = protected_dir / "demo.txt"
    protected_file.write_text("demo", encoding="utf-8")

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": str(protected_dir),
                    "operations": ["delete"],
                }
            ]
        ),
        encoding="utf-8",
    )

    reason = guard_service._denylist_precheck(
        "exec",
        {
            "command": (
                "osascript -e "
                f"'tell application \"Finder\" to delete POSIX file \"{protected_file}\"'"
            )
        },
    )
    assert reason
    assert str(protected_file.resolve()) in reason


def test_guard_service_blocks_parent_scope_deletes_for_protected_child(tmp_path, monkeypatch):
    """Deleting a parent directory should not bypass a protected child path."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    desktop_dir = tmp_path / "Desktop"
    protected_dir = desktop_dir / "protected"
    protected_dir.mkdir(parents=True)
    (protected_dir / "demo.txt").write_text("demo", encoding="utf-8")

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": str(protected_dir),
                    "operations": ["delete"],
                }
            ]
        ),
        encoding="utf-8",
    )

    reason = guard_service._denylist_precheck(
        "exec",
        {"command": f'rm -rf "{desktop_dir}"'},
    )
    assert reason
    assert str(desktop_dir.resolve()) in reason


def test_windows_style_commands_are_blocked_for_protected_paths(tmp_path, monkeypatch):
    """Windows commands should match persisted path-protection rules too."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": r"C:\Users\demo\Secret",
                    "operations": ["read", "delete"],
                }
            ]
        ),
        encoding="utf-8",
    )

    read_reason = guard_service._denylist_precheck(
        "exec",
        {"command": r'type C:\Users\demo\Secret\note.txt'},
    )
    delete_reason = guard_service._denylist_precheck(
        "exec",
        {"command": r'cmd /c del C:\Users\demo\Secret\note.txt'},
    )

    assert read_reason
    assert delete_reason
    assert r"C:\Users\demo\Secret\note.txt" in read_reason
    assert r"C:\Users\demo\Secret\note.txt" in delete_reason


def test_powershell_commands_respect_windows_path_protection(tmp_path, monkeypatch):
    """PowerShell wrappers should not bypass Windows path-protection rules."""
    denylist_file = tmp_path / "denylist.json"
    monkeypatch.setattr(guard_service, "_DENYLIST_FILE", denylist_file)

    denylist_file.write_text(
        json.dumps(
            [
                {
                    "path": r"C:\Users\demo\Secret",
                    "operations": ["read"],
                }
            ]
        ),
        encoding="utf-8",
    )

    reason = guard_service._denylist_precheck(
        "exec",
        {"command": r'powershell -Command Get-Content C:\Users\demo\Secret\note.txt'},
    )

    assert reason
    assert r"C:\Users\demo\Secret\note.txt" in reason
