from xsafeclaw.cli import _open_browser_landing


class _FakeResponse:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def test_start_opens_minimal_app_root(monkeypatch):
    opened: list[str] = []

    monkeypatch.setattr("urllib.request.urlopen", lambda *args, **kwargs: _FakeResponse())
    monkeypatch.setattr("webbrowser.open", opened.append)

    _open_browser_landing("127.0.0.1", 6874)

    assert opened == ["http://127.0.0.1:6874"]
