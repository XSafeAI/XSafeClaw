from __future__ import annotations

from pathlib import Path


def test_openclaw_configure_submit_pins_platform_to_openclaw():
    configure_tsx = Path("frontend/src/pages/Configure.tsx").read_text(encoding="utf-8")

    marker = "await systemAPI.onboardConfig({"
    start = configure_tsx.index(marker)
    end = configure_tsx.index("      });", start)
    payload = configure_tsx[start:end]

    assert "platform: 'openclaw'" in payload
