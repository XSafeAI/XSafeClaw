import pytest

from xsafeclaw import gateway_client


def _make_identity() -> dict[str, str]:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding,
        NoEncryption,
        PrivateFormat,
        PublicFormat,
    )

    key = Ed25519PrivateKey.generate()
    private_key_pem = key.private_bytes(
        Encoding.PEM,
        PrivateFormat.PKCS8,
        NoEncryption(),
    ).decode()
    public_key_pem = key.public_key().public_bytes(
        Encoding.PEM,
        PublicFormat.SubjectPublicKeyInfo,
    ).decode()
    return {
        "deviceId": gateway_client._fingerprint_public_key_pem(public_key_pem),
        "publicKeyPem": public_key_pem,
        "privateKeyPem": private_key_pem,
    }


def test_client_platform_uses_openclaw_node_names(monkeypatch):
    monkeypatch.setattr(gateway_client.sys, "platform", "win32")
    assert gateway_client._client_platform() == "win32"

    monkeypatch.setattr(gateway_client.sys, "platform", "darwin")
    assert gateway_client._client_platform() == "darwin"

    monkeypatch.setattr(gateway_client.sys, "platform", "linux")
    assert gateway_client._client_platform() == "linux"


def test_load_device_identity_uses_xsafeclaw_specific_path(monkeypatch, tmp_path):
    generated = _make_identity()
    identity_path = tmp_path / ".xsafeclaw" / "openclaw-device.json"
    identity_path.parent.mkdir(parents=True)
    identity_path.write_text(
        gateway_client.json.dumps({"version": 1, **generated}),
        encoding="utf-8",
    )

    legacy_path = tmp_path / ".openclaw" / "identity" / "device.json"
    legacy_path.parent.mkdir(parents=True)
    legacy_path.write_text(
        '{"deviceId": "openclaw-cli-device", "privateKeyPem": "legacy"}',
        encoding="utf-8",
    )

    monkeypatch.setattr(gateway_client, "_XSAFECLAW_DEVICE_PATH", identity_path)

    identity = gateway_client._load_device_identity()

    assert identity == {"version": 1, **generated}


def test_load_device_identity_migrates_legacy_uuid_to_public_key_fingerprint(
    monkeypatch,
    tmp_path,
):
    generated = _make_identity()
    identity_path = tmp_path / ".xsafeclaw" / "openclaw-device.json"
    identity_path.parent.mkdir(parents=True)
    identity_path.write_text(
        gateway_client.json.dumps({
            "deviceId": "legacy-random-uuid",
            "privateKeyPem": generated["privateKeyPem"],
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(gateway_client, "_XSAFECLAW_DEVICE_PATH", identity_path)

    identity = gateway_client._load_device_identity()

    assert identity == {"version": 1, **generated}
    stored = gateway_client.json.loads(identity_path.read_text(encoding="utf-8"))
    assert stored["deviceId"] == generated["deviceId"]
    assert stored["publicKeyPem"] == generated["publicKeyPem"]


def test_build_device_auth_payload_v3_matches_openclaw_format():
    payload = gateway_client._build_device_auth_payload_v3(
        device_id="dev",
        client_id="gateway-client",
        client_mode="ui",
        role="operator",
        scopes=["operator.admin", "operator.write", "operator.read"],
        signed_at_ms=123,
        token="tok",
        nonce="nonce",
        platform="Win32",
        device_family=None,
    )

    assert payload == (
        "v3|dev|gateway-client|ui|operator|"
        "operator.admin,operator.write,operator.read|123|tok|nonce|win32|"
    )


@pytest.mark.asyncio
async def test_gateway_connect_falls_back_to_token_only_on_device_connect_failure():
    attempts: list[bool] = []

    class FakeGatewayClient(gateway_client.GatewayClient):
        async def _try_connect(self, skip_device: bool = False) -> None:
            attempts.append(skip_device)
            self._token = "test-token"
            if not skip_device:
                raise Exception("connect failed")

        async def disconnect(self) -> None:
            return None

    client = FakeGatewayClient()

    await client.connect()

    assert attempts == [False, True]
