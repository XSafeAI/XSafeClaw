"""Entry point for ``python -m xsafeclaw`` — also the one ``start.sh`` uses.

Historically this file just called ``uvicorn.run`` directly. That short-
circuited the §38 CLI supervisor (``xsafeclaw start`` in ``cli.py``), so
``start.sh`` users could never see the framework picker even with both
OpenClaw and Hermes installed.

We now delegate to the shared ``_supervisor.run_server_with_supervisor``
helper, giving ``python -m xsafeclaw`` exactly the same picker behaviour as
``xsafeclaw start``. The pin/skip rules:

  * ``PLATFORM=openclaw|hermes`` in the environment / .env → skip picker.
  * ``PLATFORM=auto`` (or unset) + both frameworks installed → picker.
  * ``PLATFORM=auto`` + one framework installed → auto-detect, no picker.
"""

from ._supervisor import run_server_with_supervisor
from .config import settings


def _platform_override_from_settings() -> str | None:
    """Return the user's pinned platform, or None when 'auto'.

    ``settings.platform`` comes from pydantic-settings and may be ``"auto"``,
    ``"openclaw"`` or ``"hermes"``. The supervisor treats ``None`` as "run
    the picker if both frameworks are installed", which is precisely what
    ``"auto"`` should mean.
    """
    if settings.platform in ("openclaw", "hermes"):
        return settings.platform
    return None


if __name__ == "__main__":
    run_server_with_supervisor(
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_reload,
        platform_override=_platform_override_from_settings(),
    )
