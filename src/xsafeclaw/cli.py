"""XSafeClaw CLI — ``xsafeclaw start`` launches the server.

Since §42 (Hermes-as-a-first-class-citizen) the §38 framework picker is gone.
XSafeClaw monitors OpenClaw, Hermes and Nanobot simultaneously through the
multi-runtime registry, and the user picks per-session which runtime to
talk to from Agent Town.

The shared ``_supervisor.run_server`` helper now just wraps ``uvicorn.run``
with the small bit of platform-pin propagation we need; both this command
and ``python -m xsafeclaw`` (``__main__.py``) call into it so behaviour
stays in lock-step.

The ``--platform`` flag is preserved as a *default-instance hint* for the
registry — it picks which runtime is shown first in Agent Town but does not
hide the others. ``--no-browser`` and ``--reload`` keep their old meanings.
"""

import json
import urllib.error
import urllib.request
import webbrowser

import typer
from rich.console import Console

from ._supervisor import DATA_DIR, run_server

app = typer.Typer(
    name="xsafeclaw",
    help="XSafeClaw — Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()


def _open_browser_landing(host: str, port: int) -> None:
    """Open setup, configure or home based on backend status."""
    base = f"http://{host}:{port}"
    try:
        req = urllib.request.Request(
            f"{base}/api/system/install-status",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())

        # Nothing installed at all → setup wizard.
        if data.get("requires_setup") or not (
            data.get("openclaw_installed")
            or data.get("nanobot_installed")
            or data.get("hermes_installed")
        ):
            webbrowser.open(f"{base}/setup")
            return

        # Multiple installed runtimes still need their first-time configure
        # step → drop the user on the multi-card selector. Single-runtime
        # cases land directly on that runtime's configure page.
        unconfigured = [
            ("openclaw", data.get("requires_configure")),
            ("hermes", data.get("requires_hermes_configure")),
            ("nanobot", data.get("requires_nanobot_configure")),
        ]
        unconfigured = [name for name, flag in unconfigured if flag]

        if len(unconfigured) >= 2:
            webbrowser.open(f"{base}/configure_select")
        elif unconfigured == ["nanobot"]:
            webbrowser.open(f"{base}/nanobot_configure")
        elif unconfigured == ["hermes"]:
            webbrowser.open(f"{base}/configure")
        elif unconfigured == ["openclaw"]:
            webbrowser.open(f"{base}/openclaw_configure")
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
    platform: str = typer.Option(
        None,
        "--platform",
        help=(
            "Default-instance hint for Agent Town: one of "
            "'openclaw' / 'hermes' / 'nanobot'. All discovered runtimes "
            "remain selectable; this only sets which one is shown first."
        ),
    ),
) -> None:
    """Start the XSafeClaw server."""
    url = f"http://{host}:{port}"
    console.print(f"[bold green]🐾 XSafeClaw[/bold green] starting at [link={url}]{url}[/link]")
    console.print(f"   Database: {DATA_DIR / 'data.db'}")

    def _on_server_start() -> None:
        if not no_browser:
            import threading

            threading.Timer(1.5, lambda: _open_browser_landing(host, port)).start()

    try:
        run_server(
            host=host,
            port=port,
            reload=reload,
            platform_override=platform,
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
