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
from importlib import metadata as importlib_metadata

import typer
from rich.console import Console

from ._supervisor import DATA_DIR, run_server

app = typer.Typer(
    name="xsafeclaw",
    help="XSafeClaw — Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()


def _package_version() -> str:
    try:
        return importlib_metadata.version("xsafeclaw")
    except importlib_metadata.PackageNotFoundError:
        return "1.0.5"


def _open_browser_landing(host: str, port: int) -> None:
    """Always land the user on the Setup wizard.

    Per product spec (§57): ``xsafeclaw start`` must always open ``/setup``
    regardless of whether OpenClaw / Hermes / Nanobot are already installed
    or configured.  The Setup screen itself now surfaces the "enter town"
    / "enter backend" shortcuts for already-installed runtimes, so we no
    longer need to branch on ``install-status`` here.

    We still keep a guarded ``urlopen`` probe to wait until the backend is
    reachable; on any error we still fall back to opening ``/setup``.
    """
    base = f"http://{host}:{port}"
    try:
        req = urllib.request.Request(
            f"{base}/api/system/install-status",
            headers={"Accept": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=8):
            pass
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        pass
    webbrowser.open(f"{base}/setup")


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
    console.print(f"[bold]XSafeClaw[/bold] v{_package_version()}")


if __name__ == "__main__":
    app()
