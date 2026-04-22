"""Runtime discovery for the fixed local OpenClaw/nanobot setup."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import settings
from .hermes import check_hermes_health, discover_hermes_instance, hermes_capabilities
from .models import RuntimeInstance
from .nanobot import check_nanobot_health, discover_nanobot_instances, nanobot_capabilities
from .openclaw import discover_openclaw_instance, openclaw_capabilities


class RuntimeRegistry:
    """Discover the single supported OpenClaw and nanobot local runtimes."""

    def __init__(self, registry_path: Path | None = None):
        self.registry_path = registry_path

    def save(self, _instances: list[RuntimeInstance]) -> None:
        """Compatibility no-op; runtime instances are no longer persisted."""

    async def discover(self) -> list[RuntimeInstance]:
        """Return deterministic local runtime instances."""
        instances: list[RuntimeInstance] = []

        openclaw = discover_openclaw_instance()
        if openclaw:
            instances.append(
                RuntimeInstance.model_validate(
                    {
                        **openclaw,
                        "discovery_mode": "auto",
                        "capabilities": openclaw_capabilities(),
                    }
                )
            )

        hermes = discover_hermes_instance()
        if hermes:
            instances.append(
                RuntimeInstance.model_validate(
                    {
                        **hermes,
                        "discovery_mode": "auto",
                        "capabilities": hermes_capabilities(),
                    }
                )
            )

        for payload in discover_nanobot_instances():
            guard_mode = str((payload.get("meta") or {}).get("guard_mode") or "disabled")
            instances.append(
                RuntimeInstance.model_validate(
                    {
                        **payload,
                        "discovery_mode": "auto",
                        "capabilities": nanobot_capabilities(
                            has_gateway_url=bool(payload.get("gateway_base_url")),
                            guard_mode=guard_mode,
                        ),
                    }
                )
            )

        instances = await self.refresh_status(instances)
        self._ensure_default(instances)
        return instances

    async def refresh_status(
        self,
        instances: list[RuntimeInstance],
    ) -> list[RuntimeInstance]:
        """Refresh dynamic health and attach-state fields."""
        refreshed: list[RuntimeInstance] = []
        for instance in instances:
            attach_state = "registered"
            health_status = "unknown"
            if not instance.enabled:
                attach_state = "discovered"
            elif instance.platform == "nanobot":
                health_status, healthy = await check_nanobot_health(
                    str(instance.meta.get("gateway_health_url") or "")
                )
                if instance.capabilities.get("guard_blocking") and healthy:
                    attach_state = "guard_blocking_ready"
                elif instance.capabilities.get("guard_observe") and healthy:
                    attach_state = "guard_observe_ready"
                elif instance.capabilities.get("chat") and healthy:
                    attach_state = "chat_ready"
                else:
                    attach_state = "readonly"
            elif instance.platform == "openclaw":
                attach_state = "guard_blocking_ready"
            elif instance.platform == "hermes":
                health_status, healthy = await check_hermes_health()
                attach_state = "chat_ready" if healthy else "readonly"
            refreshed.append(
                instance.model_copy(
                    update={
                        "attach_state": attach_state,
                        "health_status": health_status,
                    }
                )
            )
        return refreshed

    def register(self, _payload: dict[str, Any]) -> RuntimeInstance:
        """Manual runtime registration is intentionally disabled."""
        raise ValueError("Manual runtime instance management is disabled")

    async def set_default(self, _instance_id: str) -> list[RuntimeInstance]:
        """Manual default switching is intentionally disabled."""
        raise ValueError("Manual runtime instance management is disabled")

    def _ensure_default(self, instances: list[RuntimeInstance]) -> None:
        """Pick a stable default instance without forcing a single 'main' platform.

        Selection rule (in order):

        1. ``PLATFORM`` env var / ``settings.platform`` is explicitly pinned to
           ``openclaw`` / ``hermes`` / ``nanobot`` (i.e. **not** ``"auto"``):
           prefer the first enabled instance on that platform.
        2. Otherwise walk a fixed priority order ``openclaw -> hermes -> nanobot``
           and pick the first enabled instance.
        3. Fall back to the first enabled instance regardless of platform.

        Crucially, the explicit pin is **only a default-instance hint**: the
        user can still pick any other discovered runtime in Agent Town. This
        replaces the post-§38 behaviour where ``settings.is_hermes`` / ``auto``
        decided the default exclusively between OpenClaw and Hermes, leaving
        Nanobot out and effectively ignoring multi-runtime parity.
        """
        enabled = [instance for instance in instances if instance.enabled]
        if not enabled:
            return

        preferred: RuntimeInstance | None = None

        explicit_pin = settings.platform if settings.platform in {"openclaw", "hermes", "nanobot"} else None
        if explicit_pin is not None:
            preferred = next(
                (instance for instance in enabled if instance.platform == explicit_pin),
                None,
            )

        if preferred is None:
            for platform in ("openclaw", "hermes", "nanobot"):
                preferred = next(
                    (instance for instance in enabled if instance.platform == platform),
                    None,
                )
                if preferred is not None:
                    break

        if preferred is None:
            preferred = enabled[0]

        for index, instance in enumerate(instances):
            instances[index] = instance.model_copy(
                update={"is_default": instance.instance_id == preferred.instance_id}
            )

    async def get_default_instance(self) -> RuntimeInstance | None:
        """Return the fixed default instance."""
        instances = await self.discover()
        return next(
            (
                instance
                for instance in instances
                if instance.is_default and instance.enabled
            ),
            None,
        )

    async def get_instances(self) -> list[RuntimeInstance]:
        """Return all discovered fixed runtime instances."""
        return await self.discover()

    async def get_instance(self, instance_id: str) -> RuntimeInstance | None:
        """Lookup one instance by ID."""
        instances = await self.discover()
        return next(
            (instance for instance in instances if instance.instance_id == instance_id),
            None,
        )
