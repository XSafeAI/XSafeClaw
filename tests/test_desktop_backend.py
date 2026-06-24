from xsafeclaw import desktop_backend


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
