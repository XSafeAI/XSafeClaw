"""XSafeClaw process-local startup hooks."""

from __future__ import annotations

import sys
from pathlib import Path


def _looks_like_nanobot_process() -> bool:
    try:
        executable_name = Path(sys.argv[0]).name.lower()
    except Exception:
        return False
    return executable_name.startswith("nanobot")


if _looks_like_nanobot_process():
    try:
        from xsafeclaw.integrations.nanobot_hook_loader import (
            install_nanobot_config_compat,
            install_nanobot_hook_autoload,
        )

        install_nanobot_config_compat()
        install_nanobot_hook_autoload()
    except Exception:
        pass
