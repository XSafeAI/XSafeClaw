"""XSafeClaw CLI: ``xsafeclaw start`` launches the server."""

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
    help="XSafeClaw - Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()


def _package_version() -> str:
    try:
        return importlib_metadata.version("xsafeclaw")
    except importlib_metadata.PackageNotFoundError:
        return "1.0.5"


def _open_browser_landing(host: str, port: int) -> None:
    """Open the minimal app shell.

    The new shell starts as a two-action placeholder for Monitor and Store.
    The older setup/configuration screens remain in the codebase, but they
    are no longer the default browser destination.

    We still keep a guarded ``urlopen`` probe to wait until the backend is
    reachable; on any error we still fall back to opening the app root.
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
    console.print(f"[bold green]XSafeClaw[/bold green] starting at [link={url}]{url}[/link]")
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
