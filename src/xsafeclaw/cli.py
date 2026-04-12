"""XSafeClaw CLI — `xsafeclaw start` to launch the server."""

import json
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(
    name="xsafeclaw",
    help="XSafeClaw — Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()

DATA_DIR = Path.home() / ".xsafeclaw"


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def _open_browser_landing(host: str, port: int) -> None:
    """Open `/configure` when OpenClaw is missing or unconfigured; else home (→ Agent Valley)."""
    base = f"http://{host}:{port}"
    try:
        req = urllib.request.Request(
            f"{base}/api/system/status",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        if not data.get("openclaw_installed") or not data.get("config_exists"):
            webbrowser.open(f"{base}/configure")
        else:
            webbrowser.open(base)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        webbrowser.open(base)


@app.command()
def start(
    port: int = typer.Option(6874, "--port", "-p", help="Server port"),
    host: str = typer.Option("127.0.0.1", "--host", "-h", help="Bind address"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser automatically"),
    reload: bool = typer.Option(False, "--reload", help="Enable auto-reload (dev mode)"),
) -> None:
    """Start the XSafeClaw server."""
    import uvicorn

    _ensure_data_dir()

    url = f"http://{host}:{port}"
    console.print(f"[bold green]🐾 XSafeClaw[/bold green] starting at [link={url}]{url}[/link]")
    console.print(f"   Database: {DATA_DIR / 'data.db'}")

    if not no_browser:
        import threading

        threading.Timer(1.5, lambda: _open_browser_landing(host, port)).start()

    uvicorn.run(
        "xsafeclaw.api.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )


@app.command()
def version() -> None:
    """Show XSafeClaw version."""
    console.print("[bold]XSafeClaw[/bold] v0.1.0")


if __name__ == "__main__":
    app()
