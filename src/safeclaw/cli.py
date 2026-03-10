"""SafeClaw CLI — `safeclaw start` to launch the server."""

import webbrowser
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(
    name="safeclaw",
    help="SafeClaw — Keeping Your Claw Safe.",
    add_completion=False,
)
console = Console()

DATA_DIR = Path.home() / ".safeclaw"


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


@app.command()
def start(
    port: int = typer.Option(6874, "--port", "-p", help="Server port"),
    host: str = typer.Option("127.0.0.1", "--host", "-h", help="Bind address"),
    no_browser: bool = typer.Option(False, "--no-browser", help="Don't open browser automatically"),
    reload: bool = typer.Option(False, "--reload", help="Enable auto-reload (dev mode)"),
) -> None:
    """Start the SafeClaw server."""
    import uvicorn

    _ensure_data_dir()

    url = f"http://{host}:{port}"
    console.print(f"[bold green]🐾 SafeClaw[/bold green] starting at [link={url}]{url}[/link]")
    console.print(f"   Database: {DATA_DIR / 'data.db'}")

    if not no_browser:
        import threading
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    uvicorn.run(
        "safeclaw.api.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )


@app.command()
def version() -> None:
    """Show SafeClaw version."""
    console.print("[bold]SafeClaw[/bold] v1.0.0")


if __name__ == "__main__":
    app()
