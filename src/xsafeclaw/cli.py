"""XSafeClaw CLI — ``xsafeclaw start`` launches the server.

§38 supervisor model
--------------------
The heavy lifting lives in ``_supervisor.py`` so that both entry points
(``xsafeclaw start`` here and ``python -m xsafeclaw`` in ``__main__.py``)
get identical behaviour:

  * Both frameworks installed and no platform pin → spawn picker subprocess,
    wait for user's choice, then spawn the real server with ``PLATFORM``
    fixed.
  * Otherwise → directly run the main server (preserves pre-§38 behaviour).

This file adds CLI ergonomics on top: ``--platform`` flag, ``--no-browser``,
Rich console messages, and auto-opening of the right URL (picker vs landing).
"""

import json
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import typer
from rich.console import Console

from ._supervisor import (
    DATA_DIR,
    detect_installed_platforms,
    run_server_with_supervisor,
)

app = typer.Typer(
    name="xsafeclaw",
    help="XSafeClaw — Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()


def _open_browser_landing(host: str, port: int) -> None:
    """Open ``/setup`` / ``/configure`` / home based on backend status."""
    base = f"http://{host}:{port}"
    try:
        req = urllib.request.Request(
            f"{base}/api/system/status",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        if not data.get("openclaw_installed"):
            webbrowser.open(f"{base}/setup")
        elif not data.get("config_exists"):
            webbrowser.open(f"{base}/configure")
        else:
            webbrowser.open(base)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        webbrowser.open(base)


def _open_picker_browser(host: str, port: int) -> None:
    """Open the SelectFramework page directly — bypasses /api/system/status.

    The status endpoint is blocked by the picker-mode middleware, so the
    normal landing heuristic can't work here.
    """
    webbrowser.open(f"http://{host}:{port}/select-framework")


@app.command()
def start(
    port: int = typer.Option(6874, "--port", "-p", help="Server port"),
    host: str = typer.Option("127.0.0.1", "--host", "-h", help="Bind address"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser automatically"),
    reload: bool = typer.Option(False, "--reload", help="Enable auto-reload (dev mode)"),
    platform: str = typer.Option(
        None,
        "--platform",
        help="Pin platform to 'openclaw' or 'hermes' and skip the framework picker.",
    ),
) -> None:
    """Start the XSafeClaw server."""
    url = f"http://{host}:{port}"
    console.print(f"[bold green]🐾 XSafeClaw[/bold green] starting at [link={url}]{url}[/link]")
    console.print(f"   Database: {DATA_DIR / 'data.db'}")

    # Pre-check both-frameworks detection so the console hint is accurate
    # before we hand control to the shared supervisor. The supervisor does
    # the same check internally; we just want a Rich-formatted heads-up.
    installed = detect_installed_platforms()
    if platform is None and len(installed) >= 2:
        console.print(
            "[bold cyan]🧭 Both OpenClaw and Hermes detected — launching framework picker[/bold cyan]"
        )
        console.print(
            f"   Picker URL: [link={url}/select-framework]{url}/select-framework[/link]"
        )

    def _on_picker_start() -> None:
        if not no_browser:
            import threading

            threading.Timer(1.5, lambda: _open_picker_browser(host, port)).start()

    def _on_server_start() -> None:
        if not no_browser:
            import threading

            threading.Timer(1.5, lambda: _open_browser_landing(host, port)).start()

    try:
        run_server_with_supervisor(
            host=host,
            port=port,
            reload=reload,
            platform_override=platform,
            on_picker_start=_on_picker_start,
            on_server_start=_on_server_start,
        )
    except ValueError as exc:
        console.print(f"[red]{exc}[/red]")
        raise typer.Exit(code=2) from exc


@app.command()
def version() -> None:
    """Show XSafeClaw version."""
    console.print("[bold]XSafeClaw[/bold] v0.1.0")


if __name__ == "__main__":
    app()
