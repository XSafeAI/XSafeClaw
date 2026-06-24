from pathlib import Path


def test_windows_release_workflow_builds_and_uploads_nsis_installer():
    project_root = Path(__file__).resolve().parents[1]
    workflow = project_root / ".github" / "workflows" / "build-windows.yml"

    assert workflow.is_file()

    contents = workflow.read_text(encoding="utf-8")

    assert "workflow_dispatch:" in contents
    assert '"src/**"' in contents
    assert '"pyproject.toml"' in contents
    assert "windows-latest" in contents
    assert "dtolnay/rust-toolchain@stable" in contents
    assert "actions/setup-python@v5" in contents
    assert "pip install pyinstaller" in contents
    assert "python -m PyInstaller" in contents
    assert "src/xsafeclaw/desktop_backend.py" in contents
    assert "rustc --print host-tuple" in contents
    assert "xsafeclaw-backend-${TARGET_TRIPLE}.exe" in contents
    assert "npm ci" in contents
    assert "npm run test -- App.test.tsx --run" in contents
    assert "npm run build" in contents
    assert "npm run desktop:build" in contents
    assert "actions/upload-artifact" in contents
    assert "XSafeClaw-windows-nsis" in contents
    assert "src-tauri/target/release/bundle/nsis/*.exe" in contents
    assert "XSafeClaw-windows-release-exe" in contents
    assert "src-tauri/target/release/*.exe" in contents
