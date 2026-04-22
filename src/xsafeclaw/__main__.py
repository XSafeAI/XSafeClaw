"""Entry point for ``python -m xsafeclaw`` — also the one ``start.sh`` uses.

Since §42 (Hermes-as-a-first-class-citizen) the §38 framework picker is gone:
XSafeClaw now monitors OpenClaw, Hermes and Nanobot simultaneously and the
user picks per-session which runtime to talk to from Agent Town. We just
delegate to the shared ``_supervisor.run_server`` helper so this entry point
and ``xsafeclaw start`` (``cli.py``) stay in lock-step.

``PLATFORM=openclaw|hermes|nanobot`` (in the environment / .env) is still
honoured — but only as a *default-instance hint* for the registry. ``auto``
(or unset) means "let the registry's fixed priority order
(openclaw → hermes → nanobot) pick the default".
"""

from ._supervisor import run_server
from .config import settings


def _platform_override_from_settings() -> str | None:
    """Return the user's pinned default-instance hint, or None when 'auto'."""
    if settings.platform in ("openclaw", "hermes", "nanobot"):
        return settings.platform
    return None


if __name__ == "__main__":
    run_server(
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
        platform_override=_platform_override_from_settings(),
    )
