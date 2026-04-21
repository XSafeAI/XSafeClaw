"""Tests for §42 — Hermes-as-a-first-class-citizen registry behaviour.

Covers the parts of the multi-runtime refactor that are platform-agnostic
and don't need a live OpenClaw / Hermes / Nanobot install:

  * ``runtime/registry.py::_ensure_default`` picks the right default
    instance under the new selection rule (PLATFORM pin → fixed priority
    order ``openclaw → hermes → nanobot`` → first enabled);
  * ``runtime/ids.py::decode_chat_session_key`` round-trips the
    ``platform::instance_id::local`` encoding for **all three** platforms
    and falls back to the original string for legacy bare keys;
  * ``runtime/registry.py::RuntimeRegistry.discover`` surfaces all three
    instances simultaneously (no longer one-of-two), so per-instance
    routing in ``api/routes/chat.py`` and friends has something to dispatch
    against.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from xsafeclaw.config import settings
from xsafeclaw.runtime.ids import decode_chat_session_key, encode_chat_session_key
from xsafeclaw.runtime.models import RuntimeInstance, empty_capabilities
from xsafeclaw.runtime.registry import RuntimeRegistry


# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_instance(
    platform: str,
    *,
    instance_id: str | None = None,
    enabled: bool = True,
) -> RuntimeInstance:
    """Build a minimally-valid RuntimeInstance for default-selection tests."""
    caps = empty_capabilities()
    caps["chat"] = True
    return RuntimeInstance(
        instance_id=instance_id or f"{platform}-default",
        platform=platform,  # type: ignore[arg-type]
        display_name=platform.capitalize(),
        enabled=enabled,
        capabilities=caps,
    )


# ── _ensure_default ──────────────────────────────────────────────────────────


class TestEnsureDefault:
    """Default-instance selection across mixed runtime sets."""

    def setup_method(self) -> None:
        # Snapshot the setting so PLATFORM-pin tests don't leak across cases.
        self._original_platform = settings.platform

    def teardown_method(self) -> None:
        settings.platform = self._original_platform

    def test_priority_order_picks_openclaw_first(self) -> None:
        instances = [
            _make_instance("nanobot"),
            _make_instance("hermes"),
            _make_instance("openclaw"),
        ]
        settings.platform = "auto"

        RuntimeRegistry()._ensure_default(instances)

        defaults = [inst for inst in instances if inst.is_default]
        assert len(defaults) == 1
        assert defaults[0].platform == "openclaw"

    def test_falls_back_to_hermes_when_openclaw_missing(self) -> None:
        instances = [
            _make_instance("nanobot"),
            _make_instance("hermes"),
        ]
        settings.platform = "auto"

        RuntimeRegistry()._ensure_default(instances)

        defaults = [inst for inst in instances if inst.is_default]
        assert len(defaults) == 1
        assert defaults[0].platform == "hermes"

    def test_falls_back_to_nanobot_when_only_runtime(self) -> None:
        instances = [_make_instance("nanobot")]
        settings.platform = "auto"

        RuntimeRegistry()._ensure_default(instances)

        assert instances[0].is_default is True

    @pytest.mark.parametrize("pin", ["openclaw", "hermes", "nanobot"])
    def test_explicit_pin_overrides_priority_order(self, pin: str) -> None:
        instances = [
            _make_instance("openclaw"),
            _make_instance("hermes"),
            _make_instance("nanobot"),
        ]
        settings.platform = pin  # type: ignore[assignment]

        RuntimeRegistry()._ensure_default(instances)

        defaults = [inst for inst in instances if inst.is_default]
        assert len(defaults) == 1
        assert defaults[0].platform == pin

    def test_pin_for_missing_platform_falls_back_to_priority_order(self) -> None:
        # ``settings.platform="hermes"`` but only OpenClaw + Nanobot are
        # discovered → fall through to the fixed priority order, which
        # picks OpenClaw first.
        instances = [
            _make_instance("openclaw"),
            _make_instance("nanobot"),
        ]
        settings.platform = "hermes"

        RuntimeRegistry()._ensure_default(instances)

        defaults = [inst for inst in instances if inst.is_default]
        assert len(defaults) == 1
        assert defaults[0].platform == "openclaw"

    def test_disabled_instances_are_ignored(self) -> None:
        instances = [
            _make_instance("openclaw", enabled=False),
            _make_instance("hermes"),
        ]
        settings.platform = "auto"

        RuntimeRegistry()._ensure_default(instances)

        defaults = [inst for inst in instances if inst.is_default]
        assert len(defaults) == 1
        assert defaults[0].platform == "hermes"

    def test_no_enabled_instances_is_a_no_op(self) -> None:
        instances = [_make_instance("openclaw", enabled=False)]
        RuntimeRegistry()._ensure_default(instances)
        assert all(inst.is_default is False for inst in instances)


# ── Session key encoding ────────────────────────────────────────────────────


class TestSessionKeyEncoding:
    """Encoded session keys must round-trip for all three platforms."""

    @pytest.mark.parametrize(
        "platform,instance_id,local",
        [
            ("openclaw", "openclaw-default", "abc-123"),
            ("hermes", "hermes-default", "session_42"),
            ("nanobot", "nanobot-main", "ws-7c1a"),
        ],
    )
    def test_round_trip(self, platform: str, instance_id: str, local: str) -> None:
        instance = _make_instance(platform, instance_id=instance_id)
        encoded = encode_chat_session_key(instance, local)
        assert encoded == f"{platform}::{instance_id}::{local}"

        got_platform, got_instance, got_local = decode_chat_session_key(encoded)
        assert got_platform == platform
        assert got_instance == instance_id
        assert got_local == local

    def test_legacy_bare_key_falls_back_to_default_routing(self) -> None:
        # Older Hermes / OpenClaw sessions persisted before §42 didn't carry
        # a ``platform::instance_id::`` prefix. The decoder must return None
        # for the platform/instance fields so the chat layer can fall back
        # to the default instance instead of mis-routing.
        platform, instance_id, local = decode_chat_session_key("legacy-session-id")
        assert platform is None
        assert instance_id is None
        assert local == "legacy-session-id"

    def test_unknown_prefix_is_treated_as_legacy(self) -> None:
        # A key with two ``::`` but an unknown leading platform must NOT be
        # accepted — otherwise we'd silently route to a non-existent runtime.
        platform, instance_id, local = decode_chat_session_key("kimi::main::xyz")
        assert platform is None
        assert instance_id is None
        assert local == "kimi::main::xyz"


# ── End-to-end discover() under simultaneous monitoring ──────────────────────


@pytest.mark.asyncio
async def test_discover_surfaces_all_three_runtimes_simultaneously() -> None:
    """All three runtimes show up in one ``discover()`` call.

    Pre-§42 the picker forced an either/or between OpenClaw and Hermes,
    so even with all three installed the registry would only return two
    instances. The refactor must surface all three so the per-instance
    chat / trace / skills routes have a target to dispatch against.
    """

    openclaw_payload = {
        "instance_id": "openclaw-default",
        "platform": "openclaw",
        "display_name": "OpenClaw",
        "config_path": "/tmp/openclaw.json",
        "workspace_path": "/tmp/openclaw",
    }
    hermes_payload = {
        "instance_id": "hermes-default",
        "platform": "hermes",
        "display_name": "Hermes Agent",
        "config_path": "/tmp/hermes/config.yaml",
        "workspace_path": "/tmp/hermes",
        "sessions_path": "/tmp/hermes/sessions",
        "gateway_base_url": "http://127.0.0.1:8642",
        "meta": {"binary_path": None, "api_port": 8642, "api_key_configured": False},
    }
    nanobot_payload: dict[str, Any] = {
        "instance_id": "nanobot-main",
        "platform": "nanobot",
        "display_name": "Nanobot",
        "config_path": "/tmp/nanobot/config.json",
        "workspace_path": "/tmp/nanobot",
        "gateway_base_url": "http://127.0.0.1:18790",
        "meta": {"gateway_health_url": "http://127.0.0.1:18790/healthz", "guard_mode": "disabled"},
    }

    # Stub every discovery + health probe so the test runs offline.
    with (
        patch("xsafeclaw.runtime.registry.discover_openclaw_instance", return_value=openclaw_payload),
        patch("xsafeclaw.runtime.registry.discover_hermes_instance", return_value=hermes_payload),
        patch("xsafeclaw.runtime.registry.discover_nanobot_instances", return_value=[nanobot_payload]),
        patch(
            "xsafeclaw.runtime.registry.check_hermes_health",
            return_value=("healthy", True),
        ),
        patch(
            "xsafeclaw.runtime.registry.check_nanobot_health",
            return_value=("healthy", True),
        ),
    ):
        instances = await RuntimeRegistry().discover()

    by_platform = {inst.platform: inst for inst in instances}
    assert set(by_platform) == {"openclaw", "hermes", "nanobot"}

    # _ensure_default must have run during discover() and picked exactly one.
    defaults = [inst for inst in instances if inst.is_default]
    assert len(defaults) == 1, "expected exactly one default instance"
