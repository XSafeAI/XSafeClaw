from contextlib import redirect_stdout
import io
from pathlib import Path

import pytest

from xsafeclaw import desktop_backend
from xsafeclaw.api import main as api_main
from xsafeclaw.api.routes import system as system_routes


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_desktop_backend_defaults_to_loopback_host(monkeypatch):
    calls: list[tuple[tuple, dict]] = []

    def fake_run(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(desktop_backend.uvicorn, "run", fake_run)

    desktop_backend.main([])

    assert calls == [
        (
            ("xsafeclaw.api.main:app",),
            {
                "host": "127.0.0.1",
                "port": 6874,
                "reload": False,
                "log_level": "info",
            },
        )
    ]


def test_desktop_backend_accepts_host_port_and_log_level(monkeypatch):
    calls: list[tuple[tuple, dict]] = []

    def fake_run(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setattr(desktop_backend.uvicorn, "run", fake_run)

    desktop_backend.main(["--host", "127.0.0.1", "--port", "49876", "--log-level", "warning"])

    assert calls[0][1]["host"] == "127.0.0.1"
    assert calls[0][1]["port"] == 49876
    assert calls[0][1]["log_level"] == "warning"


@pytest.mark.asyncio
async def test_api_lifespan_startup_logs_are_safe_for_windows_gbk_stdout(monkeypatch):
    async def fake_init_db():
        return None

    async def fake_close_db():
        return None

    monkeypatch.setattr(api_main, "init_db", fake_init_db)
    monkeypatch.setattr(api_main, "close_db", fake_close_db)
    monkeypatch.setattr(api_main.settings, "enable_file_watcher", False)
    monkeypatch.setattr(api_main.settings, "auto_start_runtimes", False)
    monkeypatch.setattr(system_routes, "sanitize_legacy_openclaw_config", lambda: False)
    monkeypatch.setattr(system_routes, "_ensure_hermes_api_key_synced", lambda **_kwargs: None)
    monkeypatch.setattr(system_routes, "trigger_onboard_scan_preload", lambda: None)

    gbk_stdout = io.TextIOWrapper(io.BytesIO(), encoding="gbk", errors="strict")

    with redirect_stdout(gbk_stdout):
        async with api_main.lifespan(api_main.app):
            pass


def test_desktop_startup_log_sources_do_not_use_non_gbk_status_glyphs():
    checked_files = [
        PROJECT_ROOT / "src" / "xsafeclaw" / "api" / "main.py",
        PROJECT_ROOT / "src" / "xsafeclaw" / "services" / "message_sync_service.py",
        PROJECT_ROOT / "src" / "xsafeclaw" / "watchers" / "file_watcher.py",
    ]
    disallowed = [
        "\U0001f680",
        "\U0001f9f9",
        "\u2705",
        "\u26a0",
        "\U0001f9e9",
        "\u21b3",
        "\U0001f6d1",
        "\u274c",
        "\U0001f4c1",
    ]

    offenders: list[str] = []
    for path in checked_files:
        text = path.read_text(encoding="utf-8")
        for glyph in disallowed:
            if glyph in text:
                offenders.append(f"{path.relative_to(PROJECT_ROOT)} contains U+{ord(glyph[0]):04X}")

    assert offenders == []
