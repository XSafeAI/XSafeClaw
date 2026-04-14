"""Regression tests for asset scan cancellation."""

import asyncio
import time

from xsafeclaw.api.routes import assets
from xsafeclaw.asset_scanner.scanner import ScanCancelledError


class SlowCancelableScanner:
    """Deterministic fake scanner that can be cancelled mid-flight."""

    def __init__(self):
        self.scanned_count = 0
        self.ignored_count = 0
        self._stop_requested = False

    def request_stop(self) -> None:
        self._stop_requested = True

    @property
    def stop_requested(self) -> bool:
        return self._stop_requested

    def scan_assets(self, **_: object):
        while not self._stop_requested:
            self.scanned_count += 1
            time.sleep(0.01)
        raise ScanCancelledError("Scan cancelled by user")


def test_file_scan_stop_cancels_backend_work(monkeypatch):
    """Stopping a scan should cancel the worker, not just client polling."""
    monkeypatch.setattr(assets, "AssetScanner", SlowCancelableScanner)
    assets._scan_tasks.clear()

    started = asyncio.run(assets.scan_assets(
        assets.ScanRequest(path="E:/tmp", scan_system_root=False),
    ))
    scan_id = started["scan_id"]

    deadline = time.monotonic() + 1
    while assets._scan_tasks[scan_id]["scanner"].scanned_count == 0 and time.monotonic() < deadline:
        time.sleep(0.01)

    stop_resp = asyncio.run(assets.stop_scan(assets.StopScanRequest(scan_id=scan_id)))
    assert stop_resp["status"] == "cancel_requested"

    deadline = time.monotonic() + 1
    progress = None
    while time.monotonic() < deadline:
        progress = asyncio.run(assets.scan_progress(scan_id))
        if progress["status"] == "cancelled":
            break
        time.sleep(0.01)

    assert progress is not None
    assert progress["status"] == "cancelled"

    stopped_count = progress["scanned_count"]
    time.sleep(0.05)
    progress_after = asyncio.run(assets.scan_progress(scan_id))
    assert progress_after["status"] == "cancelled"
    assert progress_after["scanned_count"] == stopped_count

    assets._scan_tasks.clear()
