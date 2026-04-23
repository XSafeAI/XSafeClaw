"""Slim server runner shared by ``cli.py`` and ``__main__.py``.

History
-------
This module used to host the §38 framework picker — a subprocess supervisor
that, when both OpenClaw and Hermes were installed, span up a restricted
"picker mode" backend, waited for the user to pick a framework, then re-spawned
the real server with ``PLATFORM`` pinned.

§42 (the *Hermes-as-a-first-class-citizen* refactor) made that picker
obsolete: XSafeClaw now monitors OpenClaw, Hermes and Nanobot simultaneously
through the multi-runtime registry, and the user picks per-session which
runtime to talk to from the Agent Town UI. There is no longer a
"single active platform" the supervisor needs to negotiate.

We keep this module as the canonical "start the server" entry point for two
reasons:

  * the ``--platform`` CLI flag (and ``PLATFORM`` env var) are still useful
    as a *default-instance hint* for the registry — see
    ``runtime/registry.py::_ensure_default``. We propagate that hint here
    so both entry points behave identically;
  * ``cli.py`` wants to open a browser at the right URL after start; keeping
    a single ``run_server`` helper means the CLI / module entry point stay
    in lock-step.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


DATA_DIR = Path.home() / ".xsafeclaw"


def _ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


def run_server(
    *,
    host: str,
    port: int,
    reload: bool = False,
    platform_override: Optional[str] = None,
    on_server_start: Optional[callable] = None,
) -> None:
    """Run the main uvicorn server.

    Parameters
    ----------
    host, port, reload:
        Forwarded to ``uvicorn.run``.
    platform_override:
        Optional default-instance hint. When set to one of
        ``"openclaw" / "hermes" / "nanobot"`` we propagate it to
        ``settings.platform`` (and ``PLATFORM`` env var) so the runtime
        registry picks the matching instance as the *default*. Users can
        still switch to any other discovered runtime in Agent Town. Any
        other value raises ``ValueError``.
    on_server_start:
        Optional zero-arg callable used by ``cli.py`` to open the browser
        once uvicorn has bound the port. Kept as a callback so this module
        has no ``webbrowser`` dependency.
    """
    import uvicorn

    _ensure_data_dir()

    if platform_override is not None:
        platform_override = platform_override.strip().lower()
        if platform_override not in ("openclaw", "hermes", "nanobot"):
            raise ValueError(
                f"Invalid platform override {platform_override!r}; "
                "expected 'openclaw', 'hermes' or 'nanobot'."
            )
        os.environ["PLATFORM"] = platform_override

        # ``config.py`` creates a module-level ``settings`` singleton at
        # first import, snapshotting ``PLATFORM`` at that moment. Both
        # entry points import ``settings`` BEFORE calling us, so the
        # singleton already has ``platform="auto"`` cached. The rest of
        # the app does ``from .config import settings`` (binding by name),
        # so replacing the module attribute wouldn't reach them either —
        # we mutate the existing instance in place. Pydantic v2
        # ``BaseSettings`` fields are mutable by default, and the
        # ``RuntimeRegistry._ensure_default`` reads ``self.platform`` on
        # every refresh, so this is sufficient.
        try:
            from . import config as _cfg

            existing = getattr(_cfg, "settings", None)
            if existing is not None:
                existing.platform = platform_override
        except Exception:
            # If the import failed somehow, ``PLATFORM`` is still set in
            # the environment so a fresh ``Settings()`` constructed later
            # will pick it up. Nothing to do.
            pass

    if on_server_start is not None:
        try:
            on_server_start()
        except Exception:  # noqa: BLE001 — browser failures are cosmetic
            pass

    uvicorn.run(
        "xsafeclaw.api.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )
