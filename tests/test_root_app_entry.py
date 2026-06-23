from pathlib import Path


def test_root_open_app_batch_entry_exists_and_targets_tauri_desktop_app():
    project_root = Path(__file__).resolve().parents[1]
    launcher = project_root / "OpenApp.bat"

    assert launcher.is_file()

    contents = launcher.read_text(encoding="utf-8")
    lowered = contents.lower()

    assert "xsafeclaw.exe" in lowered
    assert "%localappdata%\\programs\\xsafeclaw" in lowered
    assert "%programfiles%\\xsafeclaw" in lowered
    assert "%programfiles(x86)%\\xsafeclaw" in lowered
    assert "xsafeclaw setup.exe" in lowered

    assert "npm.cmd" not in lowered
    assert "cargo" not in lowered
    assert "tauri dev" not in lowered
    assert "localhost" not in lowered
    assert "http://" not in lowered
    assert 'start "" "http' not in lowered
