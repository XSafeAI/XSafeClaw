"""XSafeClaw Guard plugin entry point for nanobot."""

from __future__ import annotations

from xsafeclaw.integrations.nanobot_guard_hook import XSafeClawHook


class XSafeClawNanobotHook(XSafeClawHook):
    """nanobot plugin wrapper around XSafeClaw's shared Guard hook."""

