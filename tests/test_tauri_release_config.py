import json
from pathlib import Path


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def test_tauri_release_config_builds_nsis_installer_with_webview_bootstrapper():
    config_path = _project_root() / "frontend" / "src-tauri" / "tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))

    bundle = config["bundle"]
    windows = bundle["windows"]

    assert bundle["active"] is True
    assert bundle["targets"] == ["nsis"]
    assert bundle["publisher"] == "XSafeClaw"
    assert bundle["shortDescription"] == "XSafeClaw desktop app"
    assert bundle["category"] == "Productivity"
    assert windows["webviewInstallMode"]["type"] == "downloadBootstrapper"
    assert "icons/icon.ico" in bundle["icon"]


def test_tauri_release_config_bundles_backend_sidecar_and_uses_manual_window():
    config_path = _project_root() / "frontend" / "src-tauri" / "tauri.conf.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))

    assert "binaries/xsafeclaw-backend" in config["bundle"]["externalBin"]
    assert config["app"].get("windows", []) == []


def test_tauri_rust_shell_starts_backend_sidecar_before_main_window():
    tauri_root = _project_root() / "frontend" / "src-tauri"
    cargo_toml = (tauri_root / "Cargo.toml").read_text(encoding="utf-8")
    lib_rs = (tauri_root / "src" / "lib.rs").read_text(encoding="utf-8")

    assert "tauri-plugin-shell" in cargo_toml
    assert "tauri_plugin_shell" in lib_rs
    assert "ShellExt" in lib_rs
    assert 'sidecar("xsafeclaw-backend")' in lib_rs
    assert '"--host"' in lib_rs
    assert '"--port"' in lib_rs
    assert '"127.0.0.1"' in lib_rs
    assert "/api/system/install-status" in lib_rs
    assert "find_available_port" in lib_rs
    assert "wait_for_backend" in lib_rs
    assert "WebviewWindowBuilder::new" in lib_rs
    assert "WebviewUrl::External" in lib_rs
    assert "kill_backend_sidecar" in lib_rs


def test_frontend_package_exposes_separate_dev_and_release_desktop_scripts():
    package_path = _project_root() / "frontend" / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))

    scripts = package["scripts"]

    assert scripts["tauri"] == "tauri"
    assert scripts["desktop:dev"] == "tauri dev"
    assert scripts["desktop:build"] == "tauri build --bundles nsis"


def test_tauri_icon_assets_exist_for_windows_bundling():
    icons_dir = _project_root() / "frontend" / "src-tauri" / "icons"

    assert (icons_dir / "icon.ico").is_file()
    assert (icons_dir / "32x32.png").is_file()
    assert (icons_dir / "128x128.png").is_file()
