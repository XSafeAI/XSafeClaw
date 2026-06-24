"""Desktop sidecar entrypoint for the bundled FastAPI backend."""

from __future__ import annotations

import argparse
from collections.abc import Sequence

import uvicorn


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the XSafeClaw desktop backend.")
    parser.add_argument("--host", default="127.0.0.1", help="Host address to bind.")
    parser.add_argument("--port", default=6874, type=int, help="Port to bind.")
    parser.add_argument("--log-level", default="info", help="Uvicorn log level.")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = _build_parser().parse_args(argv)
    uvicorn.run(
        "xsafeclaw.api.main:app",
        host=args.host,
        port=args.port,
        reload=False,
        log_level=args.log_level,
    )


if __name__ == "__main__":
    main()
