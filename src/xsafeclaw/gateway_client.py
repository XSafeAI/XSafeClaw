"""
OpenClaw Gateway WebSocket client for Python.

Connects to the local OpenClaw gateway using device identity (Ed25519 signing)
so that the gateway grants the requested scopes (including operator.write).
"""

import asyncio
import base64
import hashlib
import json
import os
import re
import sys
import uuid
from pathlib import Path
from typing import Any


# ─── Helpers ────────────────────────────────────────────────────────────────

_XSAFECLAW_DEVICE_PATH = Path.home() / ".xsafeclaw" / "openclaw-device.json"

async def _load_gateway_config() -> dict:
    """Load gateway config from ~/.openclaw/openclaw.json."""
    p = Path.home() / ".openclaw" / "openclaw.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("gateway", {})


def _load_device_identity() -> dict | None:
    """Load XSafeClaw's OpenClaw pairing identity.

    Keep this separate from OpenClaw's own CLI identity. Reusing
    ~/.openclaw/identity/device.json lets XSafeClaw pin different client
    metadata to the same device id, which can make later gateway connects fail
    with a metadata-upgrade/pairing error.
    """
    p = _XSAFECLAW_DEVICE_PATH
    if p.exists():
        try:
            parsed = json.loads(p.read_text(encoding="utf-8"))
            identity = _normalize_device_identity(parsed)
            if identity:
                if (
                    parsed.get("version") != 1
                    or parsed.get("deviceId") != identity["deviceId"]
                    or parsed.get("publicKeyPem") != identity["publicKeyPem"]
                ):
                    p.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")
                return identity
            print("⚠️  Device identity file is incomplete; generating a new one")
        except Exception as e:
            print(f"⚠️  Failed to load device identity: {e}")

    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PrivateFormat, NoEncryption, PublicFormat,
        )
        key = Ed25519PrivateKey.generate()
        pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode()
        public_pem = key.public_key().public_bytes(
            Encoding.PEM,
            PublicFormat.SubjectPublicKeyInfo,
        ).decode()
        device_id = _fingerprint_public_key_pem(public_pem)
        identity = {
            "version": 1,
            "deviceId": device_id,
            "publicKeyPem": public_pem,
            "privateKeyPem": pem,
        }
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(identity, indent=2) + "\n", encoding="utf-8")
        print(f"🔑 Generated new device identity: {device_id[:12]}…")
        return identity
    except Exception as e:
        print(f"⚠️  Failed to generate device identity: {e}")
        return None


def _normalize_device_identity(parsed: dict[str, Any]) -> dict[str, Any] | None:
    """Return OpenClaw-compatible identity metadata.

    OpenClaw derives deviceId from the raw Ed25519 public key. Older
    XSafeClaw builds stored a random UUID, which OpenClaw rejects with
    "device identity mismatch" before granting operator scopes.
    """
    private_key_pem = parsed.get("privateKeyPem")
    if not isinstance(private_key_pem, str) or not private_key_pem.strip():
        return None

    public_key_pem = parsed.get("publicKeyPem")
    if not isinstance(public_key_pem, str) or not public_key_pem.strip():
        public_key_pem = _public_key_pem_from_private(private_key_pem)

    return {
        "version": 1,
        "deviceId": _fingerprint_public_key_pem(public_key_pem),
        "publicKeyPem": public_key_pem,
        "privateKeyPem": private_key_pem,
    }


def _public_key_pem_from_private(private_key_pem: str) -> str:
    """Derive OpenClaw's stored publicKeyPem from a PEM private key."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        PublicFormat,
        load_pem_private_key,
    )

    key = load_pem_private_key(private_key_pem.encode(), password=None)
    return key.public_key().public_bytes(  # type: ignore[attr-defined]
        Encoding.PEM,
        PublicFormat.SubjectPublicKeyInfo,
    ).decode()


def _client_platform() -> str:
    """Return OpenClaw/Node-style platform names for device metadata."""
    if sys.platform.startswith("win"):
        return "win32"
    if sys.platform == "darwin":
        return "darwin"
    if sys.platform.startswith("linux"):
        return "linux"
    return sys.platform or "unknown"


def _b64url_encode(data: bytes) -> str:
    """URL-safe base64 without padding (same as OpenClaw's base64UrlEncode)."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _public_key_raw_from_pem(public_key_pem: str) -> bytes:
    """Return raw Ed25519 public-key bytes from an SPKI PEM public key."""
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        PublicFormat,
        load_pem_public_key,
    )

    key = load_pem_public_key(public_key_pem.encode())
    return key.public_bytes(Encoding.Raw, PublicFormat.Raw)  # type: ignore[attr-defined]


def _fingerprint_public_key_pem(public_key_pem: str) -> str:
    """Match OpenClaw's deriveDeviceIdFromPublicKey(): sha256(raw public key)."""
    return hashlib.sha256(_public_key_raw_from_pem(public_key_pem)).hexdigest()


def _normalize_device_metadata_for_auth(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower()


def _sign_payload(private_key_pem: str, payload: str) -> str:
    """Sign payload string with Ed25519 private key → base64url signature."""
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    key = load_pem_private_key(private_key_pem.encode(), password=None)
    sig = key.sign(payload.encode("utf-8"))  # type: ignore[arg-type]
    return _b64url_encode(sig)


def _public_key_raw_b64url(public_key_pem: str) -> str:
    """Encode raw Ed25519 public-key bytes as OpenClaw base64url."""
    return _b64url_encode(_public_key_raw_from_pem(public_key_pem))


def _build_device_auth_payload(
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    signed_at_ms: int,
    token: str | None,
    nonce: str | None,
) -> str:
    """
    Reproduces OpenClaw's buildDeviceAuthPayload().

    Format (v2 with nonce):
      v2|deviceId|clientId|clientMode|role|scope1,scope2|signedAtMs|token|nonce
    """
    version = "v2" if nonce else "v1"
    parts = [
        version,
        device_id,
        client_id,
        client_mode,
        role,
        ",".join(scopes),
        str(signed_at_ms),
        token or "",
    ]
    if version == "v2":
        parts.append(nonce or "")
    return "|".join(parts)


def _build_device_auth_payload_v3(
    device_id: str,
    client_id: str,
    client_mode: str,
    role: str,
    scopes: list[str],
    signed_at_ms: int,
    token: str | None,
    nonce: str,
    platform: str | None,
    device_family: str | None,
) -> str:
    """
    Reproduces OpenClaw's buildDeviceAuthPayloadV3().

    Format:
      v3|deviceId|clientId|clientMode|role|scope1,scope2|signedAtMs|token|nonce|platform|deviceFamily
    """
    return "|".join([
        "v3",
        device_id,
        client_id,
        client_mode,
        role,
        ",".join(scopes),
        str(signed_at_ms),
        token or "",
        nonce,
        _normalize_device_metadata_for_auth(platform),
        _normalize_device_metadata_for_auth(device_family),
    ])


def _extract_json_from_output(raw: str) -> Any:
    """Extract the first complete JSON object/array from CLI output that may
    contain non-JSON text before or after (e.g. plugin log lines)."""
    start = -1
    for i, ch in enumerate(raw):
        if ch in ("{", "["):
            start = i
            break
    if start == -1:
        return None
    bracket = raw[start]
    close = "}" if bracket == "{" else "]"
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(raw)):
        ch = raw[i]
        if escape:
            escape = False
            continue
        if ch == "\\":
            if in_str:
                escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if in_str:
            continue
        if ch == bracket:
            depth += 1
        elif ch == close:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(raw[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


_OPENCLAW_PENDING_JSON = Path.home() / ".openclaw" / "devices" / "pending.json"
# OpenClaw 4.25's CLI cold-start (config load + schema validate) can take ~20s
# on Windows before any subcommand does real work, so give the subprocess some
# headroom before we give up and mark the approval as failed.
_APPROVE_SUBPROCESS_TIMEOUT_S = 45


def _find_openclaw_binary() -> str | None:
    """Locate the ``openclaw`` CLI on the current machine.

    Preference order:

    1. ``shutil.which("openclaw")``
    2. nvm-sh and nvm-windows Node installs
    3. Python Scripts/ dir on Windows (uv/pipx installs symlink here)
    4. Common POSIX system + XSafeClaw-managed dirs
    """
    import shutil

    found = shutil.which("openclaw")
    if found:
        return found

    search_bases: list[Path] = []

    nvm_sh_base = Path.home() / ".nvm" / "versions" / "node"
    if nvm_sh_base.exists():
        search_bases.append(nvm_sh_base)

    nvm_home = os.environ.get("NVM_HOME") or os.environ.get("NVM_SYMLINK")
    if nvm_home:
        nvm_windows_base = Path(nvm_home).parent / "versions" / "node"
        if nvm_windows_base.exists():
            search_bases.append(nvm_windows_base)

    if os.name == "nt":
        for prefix in [Path(sys.prefix), Path(sys.executable).resolve().parent]:
            scripts = prefix / "Scripts"
            if scripts.exists():
                search_bases.append(scripts)
            search_bases.append(prefix)
    else:
        for p in [
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            Path.home() / ".local" / "bin",
            Path.home() / ".xsafeclaw" / "node" / "bin",
            Path.home() / ".xsafeclaw" / "node",
        ]:
            if p.exists():
                search_bases.append(p)

    for search_base in search_bases:
        if search_base.name == "node" and search_base.exists():
            for vdir in sorted(search_base.iterdir(), reverse=True):
                for suffix in ("", ".cmd", ".bat", ".exe"):
                    if (vdir / "bin").exists():
                        candidate = vdir / "bin" / f"openclaw{suffix}"
                    else:
                        candidate = vdir / f"openclaw{suffix}"
                    if candidate.is_file():
                        return str(candidate)
        else:
            if search_base.is_dir():
                suffixes = ("", ".cmd", ".bat", ".exe") if os.name == "nt" else ("",)
                for suffix in suffixes:
                    candidate = search_base / f"openclaw{suffix}"
                    if candidate.is_file():
                        return str(candidate)
    return None


def _read_local_pending_requests() -> list[dict[str, Any]]:
    """Read ``~/.openclaw/devices/pending.json`` directly.

    Under OpenClaw 4.25 the ``openclaw devices list --json`` subcommand is
    routed through the gateway WebSocket with a hard 10s internal timeout,
    so if the gateway is the very thing we're trying to repair (stuck on a
    metadata-upgrade pairing loop), invoking it just hangs. Reading the
    plain-text JSON is both much faster and immune to that deadlock.
    """
    try:
        if not _OPENCLAW_PENDING_JSON.exists():
            return []
        raw = _OPENCLAW_PENDING_JSON.read_text(encoding="utf-8")
    except Exception as exc:
        print(f"⚠️  Could not read {_OPENCLAW_PENDING_JSON}: {exc}")
        return []

    try:
        parsed = json.loads(raw)
    except Exception as exc:
        print(f"⚠️  Could not parse {_OPENCLAW_PENDING_JSON}: {exc}")
        return []

    # Observed shape in 4.25: a dict keyed by requestId. Legacy shape: list.
    if isinstance(parsed, dict):
        entries = []
        for key, value in parsed.items():
            if not isinstance(value, dict):
                continue
            if "requestId" not in value and isinstance(key, str):
                value = {**value, "requestId": key}
            entries.append(value)
        return entries
    if isinstance(parsed, list):
        return [entry for entry in parsed if isinstance(entry, dict)]
    return []


async def auto_approve_pending_devices(
    *,
    preferred_request_id: str | None = None,
) -> list[str]:
    """Approve the XSafeClaw device's pending pairing request.

    Strategy for OpenClaw 2026.4.25:

    1. Locate the ``openclaw`` CLI (needed only for the actual approve step).
    2. Read ``~/.openclaw/devices/pending.json`` directly — this replaces
       the legacy ``openclaw devices list --json`` call, which in 4.25
       requires an authenticated WebSocket to the gateway (and therefore
       deadlocks exactly when we most need it).
    3. Approve ``preferred_request_id`` first if supplied (this is how the
       WebSocket handshake can tell us *precisely* which request was
       blocking it, e.g. the PAIRING_REQUIRED/metadata-upgrade case).
    4. Then approve any pending request whose ``deviceId`` matches our local
       XSafeClaw identity or whose ``displayName`` mentions XSafeClaw.
    5. If nothing matched, fall back to ``openclaw approve --latest`` so a
       freshly generated (not yet file-logged) identity still has a path
       to self-heal.
    """
    import subprocess

    approved: list[str] = []

    local_identity = _load_device_identity()
    local_device_id = local_identity.get("deviceId", "") if local_identity else ""

    openclaw_bin = _find_openclaw_binary()
    if not openclaw_bin:
        print("⚠️  openclaw binary not found; cannot auto-approve devices")
        return approved

    def _approve_with_variants(*args: str) -> tuple[bool, str]:
        """Try modern + legacy approve command shapes."""
        variants = [
            [openclaw_bin, "approve", *args],            # OpenClaw newer shape
            [openclaw_bin, "devices", "approve", *args], # OpenClaw legacy shape
            [openclaw_bin, "pairing", "approve", *args], # Future shape (see `openclaw --help`)
        ]
        last_err = ""
        for cmd in variants:
            try:
                sub = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=_APPROVE_SUBPROCESS_TIMEOUT_S,
                )
            except Exception as exc:
                last_err = str(exc)
                continue
            out = (sub.stdout or "").strip()
            err = (sub.stderr or "").strip()
            if sub.returncode == 0:
                return True, out or err
            last_err = err or out or f"exit={sub.returncode}"
        return False, last_err

    def _try_approve(req_id: str, label: str) -> None:
        if not req_id or req_id in approved:
            return
        ok, detail = _approve_with_variants(req_id)
        if ok:
            approved.append(req_id)
            print(f"✅ Auto-approved {label}: {req_id}")
        else:
            print(f"⚠️  Failed to approve {label} {req_id}: {detail[:200]}")

    # (1) Priority path: if the caller already knows which request was
    # blocking them (parsed from the WS close reason), approve that first.
    if preferred_request_id:
        _try_approve(preferred_request_id, "preferred pairing")

    # (2) Walk the on-disk pending queue for XSafeClaw-owned entries.
    pending = _read_local_pending_requests()
    if pending:
        print(f"🔍 Found {len(pending)} pending pairing request(s) in {_OPENCLAW_PENDING_JSON}")
    for entry in pending:
        req_id = (
            entry.get("requestId")
            or entry.get("request_id")
            or entry.get("id")
            or ""
        )
        dev_id = entry.get("deviceId") or entry.get("device_id", "") or ""
        display_name = (
            entry.get("displayName")
            or entry.get("display_name")
            or entry.get("name", "")
            or ""
        )
        req_id = str(req_id).strip()
        dev_id_preview = (dev_id or "")[:16]
        print(f"   Pending: reqId={req_id} id={dev_id_preview}… name={display_name}")
        if not req_id or req_id in approved:
            continue
        is_ours = (
            (local_device_id and dev_id == local_device_id)
            or "safeclaw" in display_name.lower()
        )
        if not is_ours:
            print("   ↳ Skipping (not ours)")
            continue
        _try_approve(req_id, "XSafeClaw pairing")

    # (3) Fallback: approve --latest if we still have nothing. Covers the
    # bootstrap case where ``pending.json`` hasn't been written yet (the
    # gateway sometimes holds in-memory pending state before persisting).
    if not approved:
        print("⚠️  No matching pending request on disk; trying `openclaw approve --latest`…")
        ok, detail = _approve_with_variants("--latest")
        if ok:
            approved.append("latest")
            print("✅ Auto-approved latest pending device (fallback)")
        else:
            print(f"⚠️  approve --latest failed: {detail[:200]}")

    return approved


_PAIRING_REQUEST_ID_RE = re.compile(
    r"requestId[:=]\s*\"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\"?",
    re.IGNORECASE,
)


def _extract_pairing_request_id(message: str) -> str | None:
    """Pull the ``requestId`` out of a gateway ``PAIRING_REQUIRED`` error.

    OpenClaw 2026.4.25 formats the WebSocket close reason as e.g.::

        pairing required: device identity changed and must be re-approved
        (requestId: 8dd85120-00b8-41ea-a55f-119adfceb004)

    and may also embed it inside a JSON error payload. We accept either
    shape; any UUID immediately after a ``requestId`` token counts.
    """
    if not message:
        return None
    match = _PAIRING_REQUEST_ID_RE.search(message)
    if match:
        return match.group(1)
    return None


# ─── GatewayClient ──────────────────────────────────────────────────────────

class GatewayClient:
    """Async WebSocket client for the OpenClaw gateway with device identity auth."""

    def __init__(self, url: str | None = None, token: str | None = None):
        self._url = url
        self._token = token
        self._device: dict | None = None          # device.json contents
        self._ws: Any = None
        self._pending: dict[str, asyncio.Future] = {}
        self._event_handlers: list = []
        self._connected = asyncio.Event()
        self._reader_task: asyncio.Task | None = None

    async def connect(self) -> None:
        """Connect to the gateway and complete the HelloOk handshake.

        Strategy:
        1. Try connecting with device identity + token
        2. If pairing required, auto-approve and retry (OpenClaw 4.25 now
           surfaces an explicit ``PAIRING_REQUIRED`` code and, for stale
           platform pins, ``reason: metadata-upgrade`` + ``requestId`` — we
           parse those and approve the exact request instead of guessing.)
        3. If device metadata/pairing still fails, fall back to token-only auth
        """
        first_error: Exception | None = None
        try:
            await self._try_connect()
            return
        except Exception as e:
            first_error = e
            message = str(e).lower()
            retryable_device_error = any(
                marker in message
                for marker in (
                    "pairing",
                    "metadata",
                    "metadata-upgrade",
                    "pairing_required",
                    "connect failed",
                    "1008",
                    "policy",
                )
            )
            scope_error = "missing scope" in message
            if not retryable_device_error and not self._token:
                raise

            # Some gateway builds report scope errors before surfacing a pairing
            # prompt. Try one best-effort approval + reconnect using device auth.
            if scope_error:
                try:
                    approved = await auto_approve_pending_devices()
                    if approved:
                        print("🔑 Approved pending device(s) after scope rejection; retrying device auth...")
                        await self.disconnect()
                        await asyncio.sleep(1.5)
                        self._connected = asyncio.Event()
                        await self._try_connect()
                        return
                except Exception:
                    pass

            if "pairing" in message or "metadata-upgrade" in message:
                preferred_request_id = _extract_pairing_request_id(str(e))
                if preferred_request_id:
                    print(
                        "🔑 Device pairing required — auto-approving "
                        f"requestId={preferred_request_id}..."
                    )
                else:
                    print("🔑 Device pairing required — auto-approving...")
                await self.disconnect()
                approved = await auto_approve_pending_devices(
                    preferred_request_id=preferred_request_id,
                )
                if approved:
                    await asyncio.sleep(2)
                    self._connected = asyncio.Event()
                    try:
                        await self._try_connect()
                        return
                    except Exception as retry_error:
                        first_error = retry_error

        # Token-only auth rarely carries operator.read/operator.write scopes.
        # If the gateway already rejected scopes, fail fast with a targeted hint
        # instead of doing a second token-only attempt that will likely fail too.
        if "missing scope" in str(first_error).lower():
            raise Exception(
                "Gateway denied required operator scopes "
                "(missing scope: operator.read/operator.write). "
                "Run `openclaw approve --latest`, ensure XSafeClaw and OpenClaw "
                "use the same OS user, then retry."
            ) from first_error

        print("⚠️  Device auth failed, falling back to token-only auth...")
        await self.disconnect()
        self._connected = asyncio.Event()
        try:
            await self._try_connect(skip_device=True)
            print("✅ Connected with token-only auth (no device identity)")
        except Exception as e2:
            raise Exception(
                "Failed to connect to OpenClaw gateway. "
                "Is the gateway running? Check with 'openclaw status'. "
                f"device_auth_error={first_error}; token_auth_error={e2}"
            ) from e2

    async def _try_connect(self, skip_device: bool = False) -> None:
        """Single connection attempt to the gateway."""
        import websockets

        if not self._url or not self._token:
            cfg = await _load_gateway_config()
            if not self._url:
                port = cfg.get("port", 18789)
                self._url = f"ws://127.0.0.1:{port}"
            if not self._token:
                self._token = cfg.get("auth", {}).get("token")

        if skip_device:
            self._device = None
        else:
            self._device = _load_device_identity()

        self._ws = await websockets.connect(
            self._url, max_size=25 * 1024 * 1024, close_timeout=5,
        )
        self._reader_task = asyncio.create_task(self._read_loop())

        try:
            await asyncio.wait_for(self._connected.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            await self._send_connect(nonce=None)
            await asyncio.wait_for(self._connected.wait(), timeout=5.0)

    async def disconnect(self) -> None:
        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except (asyncio.CancelledError, Exception):
                pass
        if self._ws:
            await self._ws.close()
            self._ws = None

    # ── Internal ────────────────────────────────────────────────────────────

    async def _send_connect(self, nonce: str | None) -> None:
        """Build and send the 'connect' frame with device signature."""
        client_id   = "gateway-client"
        client_mode = "ui"
        role        = "operator"
        scopes      = ["operator.admin", "operator.write", "operator.read"]
        signed_at   = int(__import__("time").time() * 1000)
        platform    = _client_platform()
        device_family: str | None = None

        params: dict[str, Any] = {
            "minProtocol": 3,
            "maxProtocol": 3,
            "client": {
                "id":          client_id,
                "displayName": "XSafeClaw",
                "version":     "1.0.0",
                "platform":    platform,
                "mode":        client_mode,
                "instanceId":  str(uuid.uuid4()),
            },
            "caps":   [],
            "role":   role,
            "scopes": scopes,
        }

        # Token auth
        if self._token:
            params["auth"] = {"token": self._token}

        # Device identity auth (provides signed scopes the gateway will trust)
        if self._device and nonce:
            try:
                device_id      = self._device["deviceId"]
                private_key_pem = self._device["privateKeyPem"]
                public_key_pem = self._device.get("publicKeyPem") or _public_key_pem_from_private(private_key_pem)

                payload = _build_device_auth_payload_v3(
                    device_id=device_id,
                    client_id=client_id,
                    client_mode=client_mode,
                    role=role,
                    scopes=scopes,
                    signed_at_ms=signed_at,
                    token=self._token,
                    nonce=nonce,
                    platform=platform,
                    device_family=device_family,
                )
                signature  = _sign_payload(private_key_pem, payload)
                public_key = _public_key_raw_b64url(public_key_pem)

                params["device"] = {
                    "id":        device_id,
                    "publicKey": public_key,
                    "signature": signature,
                    "signedAt":  signed_at,
                    **({"nonce": nonce} if nonce else {}),
                }
            except Exception as e:
                # If signing fails, fall back to token-only (may have limited scopes)
                print(f"⚠️  Device signing failed: {e}; falling back to token-only")

        await self._request("connect", params, is_connect=True)

    async def _request(self, method: str, params: Any = None, is_connect: bool = False) -> Any:
        req_id = str(uuid.uuid4())
        frame  = {"type": "req", "id": req_id, "method": method, "params": params or {}}
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[req_id] = future
        await self._ws.send(json.dumps(frame))
        result = await asyncio.wait_for(future, timeout=30.0)
        if is_connect:
            self._connected.set()
        return result

    async def _read_loop(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                msg_type = msg.get("type")

                if msg_type == "event":
                    event_name = msg.get("event", "")
                    if event_name == "connect.challenge":
                        nonce = msg.get("payload", {}).get("nonce")
                        asyncio.create_task(self._send_connect(nonce=nonce))
                        continue
                    for handler in list(self._event_handlers):
                        try:
                            handler(msg)
                        except Exception:
                            pass
                    continue

                if msg_type == "res":
                    req_id = msg.get("id")
                    future = self._pending.get(req_id)
                    if future and not future.done():
                        self._pending.pop(req_id, None)
                        if msg.get("ok"):
                            future.set_result(msg.get("payload"))
                        else:
                            err = msg.get("error", {}).get("message", "unknown error")
                            future.set_exception(Exception(err))
                    continue

        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    # ── Chat ────────────────────────────────────────────────────────────────

    async def stream_chat(
        self,
        session_key: str,
        message: str,
        thinking: str | None = None,
        timeout_ms: int | None = None,
        attachments: list[dict] | None = None,
    ):
        """
        Async generator that streams chat response as delta chunks.

        Yields dicts:
          {"type": "delta",   "text": "<cumulative text so far>"}
          {"type": "final",   "text": "<final text>", "stop_reason": ...}
          {"type": "aborted", "text": ""}
          {"type": "error",   "text": "<error message>"}
          {"type": "timeout", "text": "<partial text>"}

        NOTE: OpenClaw delta events are CUMULATIVE — each delta contains the
        full response text accumulated so far (not just the new chunk).
        """
        run_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()

        def _extract_text(msg_data: Any) -> str:
            if not isinstance(msg_data, dict):
                return ""
            content = msg_data.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "".join(parts)
            text = msg_data.get("text")
            return text if isinstance(text, str) else ""

        def on_event(evt: dict) -> None:
            event_name = evt.get("event", "")
            payload    = evt.get("payload", {})

            # ── Chat events (text streaming) ──────────────────────────────
            if event_name == "chat":
                if payload.get("runId") != run_id:
                    return
                state = payload.get("state")
                if state == "delta":
                    text = _extract_text(payload.get("message"))
                    queue.put_nowait({"type": "delta", "text": text, "payload": payload})
                elif state in ("final", "aborted", "error"):
                    queue.put_nowait({"type": state, "payload": payload})
                return

            # ── Agent events (tool calls) ─────────────────────────────────
            # agent events are keyed by runId; filter to our run.
            if event_name == "agent":
                if payload.get("runId") != run_id:
                    return
                stream = payload.get("stream", "")
                data   = payload.get("data") or {}
                if stream == "tool":
                    phase       = data.get("phase", "")
                    tool_id     = data.get("toolCallId", "")
                    tool_name   = data.get("name", "tool")
                    if phase == "start":
                        queue.put_nowait({
                            "type":       "tool_start",
                            "tool_id":    tool_id,
                            "tool_name":  tool_name,
                            "args":       data.get("args"),
                        })
                    elif phase == "result":
                        queue.put_nowait({
                            "type":       "tool_result",
                            "tool_id":    tool_id,
                            "tool_name":  tool_name,
                            "result":     data.get("result"),
                            "is_error":   bool(data.get("isError")),
                        })
                return

        self._event_handlers.append(on_event)
        last_text = ""

        try:
            params: dict[str, Any] = {
                "sessionKey":     session_key,
                "message":        message,
                "idempotencyKey": run_id,
            }
            if thinking:
                params["thinking"] = thinking
            if timeout_ms:
                params["timeoutMs"] = timeout_ms
            if attachments:
                params["attachments"] = attachments

            await self._request("chat.send", params)

            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=120.0)
                except asyncio.TimeoutError:
                    yield {"type": "timeout", "text": last_text}
                    return

                event_type = item["type"]
                payload    = item.get("payload", {})

                if event_type == "delta":
                    text = item["text"]
                    if text and len(text) >= len(last_text):
                        last_text = text
                        yield {"type": "delta", "text": text}

                elif event_type == "tool_start":
                    yield item   # {type, tool_id, tool_name, args}

                elif event_type == "tool_result":
                    yield item   # {type, tool_id, tool_name, result, is_error}

                elif event_type == "final":
                    final_text = _extract_text(payload.get("message")) or last_text
                    yield {
                        "type":        "final",
                        "text":        final_text,
                        "stop_reason": payload.get("stopReason"),
                        "usage":       payload.get("usage"),
                    }
                    return

                elif event_type == "aborted":
                    yield {"type": "aborted", "text": last_text}
                    return

                elif event_type == "error":
                    yield {"type": "error", "text": payload.get("errorMessage", "Unknown error")}
                    return

        except Exception as e:
            yield {"type": "error", "text": str(e)}

        finally:
            if on_event in self._event_handlers:
                self._event_handlers.remove(on_event)

    async def send_chat(
        self,
        session_key: str,
        message: str,
        thinking: str | None = None,
        timeout_ms: int | None = None,
    ) -> dict:
        """Send a message and wait for the complete response (non-streaming)."""
        last_delta = ""
        final_event: dict | None = None
        done = asyncio.Event()

        def _extract_text(msg_data: Any) -> str:
            if not isinstance(msg_data, dict):
                return ""
            content = msg_data.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                parts = [
                    block.get("text", "")
                    for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                return "".join(parts)
            return msg_data.get("text") or ""

        run_id = str(uuid.uuid4())

        def on_event(evt: dict) -> None:
            nonlocal final_event, last_delta
            if evt.get("event") != "chat":
                return
            payload = evt.get("payload", {})
            if payload.get("runId") != run_id:
                return
            state = payload.get("state")
            if state == "delta":
                text = _extract_text(payload.get("message"))
                if text and len(text) >= len(last_delta):
                    last_delta = text
            elif state in ("final", "aborted", "error"):
                final_event = payload
                done.set()

        self._event_handlers.append(on_event)
        try:
            params: dict[str, Any] = {
                "sessionKey":     session_key,
                "message":        message,
                "idempotencyKey": run_id,
            }
            if thinking:
                params["thinking"] = thinking
            if timeout_ms:
                params["timeoutMs"] = timeout_ms

            await self._request("chat.send", params)
            await asyncio.wait_for(done.wait(), timeout=120.0)

            response_text = ""
            if final_event:
                response_text = _extract_text(final_event.get("message"))
            if not response_text and last_delta:
                response_text = last_delta

            return {
                "run_id":       run_id,
                "state":        final_event.get("state", "unknown") if final_event else "timeout",
                "response_text": response_text,
                "usage":        final_event.get("usage") if final_event else None,
                "stop_reason":  final_event.get("stopReason") if final_event else None,
            }

        except asyncio.TimeoutError:
            return {
                "run_id":        run_id,
                "state":         "timeout",
                "response_text": last_delta or "[Timeout] Agent did not respond within 120 seconds.",
                "usage":         None,
                "stop_reason":   None,
            }

        finally:
            if on_event in self._event_handlers:
                self._event_handlers.remove(on_event)

    async def enable_verbose(self, session_key: str) -> None:
        """Enable verbose mode (verboseLevel=on) so tool-call agent events are broadcast."""
        try:
            await self._request("sessions.patch", {
                "key":          session_key,
                "verboseLevel": "on",
            })
        except Exception:
            pass  # non-fatal; tool events just won't show

    async def patch_session(
        self,
        session_key: str,
        *,
        label: str | None = None,
        model_override: str | None = None,
        provider_override: str | None = None,
        verbose_level: str | None = None,
        model: str | None = None,
        thinking_level: str | None = None,
    ) -> dict | None:
        """Patch session metadata such as model selection and thinking level.

        Newer gateway builds accept the combined ``model="provider/model"``
        shape, while some older call sites still pass ``model_override`` /
        ``provider_override``. Normalize to ``model`` whenever possible so the
        client stays compatible with both code paths.
        """
        params: dict[str, Any] = {"key": session_key}
        if label:
            params["label"] = label
        combined_model = model
        if not combined_model and model_override:
            combined_model = model_override
            if provider_override and "/" not in model_override:
                combined_model = f"{provider_override.rstrip('/')}/{model_override.lstrip('/')}"
        if combined_model:
            params["model"] = combined_model
        elif provider_override:
            # Keep a narrow fallback for legacy provider-only overrides.
            params["providerOverride"] = provider_override
        if verbose_level:
            params["verboseLevel"] = verbose_level
        if thinking_level is not None:
            params["thinkingLevel"] = thinking_level

        if len(params) == 1:
            return None

        return await self._request("sessions.patch", params)

    async def list_models(self) -> dict | list:
        """Return the gateway's current runtime-allowed model catalog."""
        return await self._request("models.list", {})

    async def load_history(self, session_key: str, limit: int = 50) -> list:
        """Load chat history via chat.history WebSocket API."""
        result = await self._request("chat.history", {
            "sessionKey": session_key,
            "limit":      limit,
        })
        if isinstance(result, dict):
            return result.get("messages", [])
        return []
