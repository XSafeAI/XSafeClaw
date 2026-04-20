"""Map skin download API — streams assets from remote server to local public dir."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import time
import uuid
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

ASSET_BASE = "http://xsafeclaw.ai/assets/Map-opensorce"

VALID_MAP_IDS = {"map2", "map3", "map4", "map5"}
MAP_NUM = {"map2": "2", "map3": "3", "map4": "4", "map5": "5"}

_STATIC_DIR = Path(__file__).parent.parent.parent / "static"
_STATIC_MAP_DIR = _STATIC_DIR / "Map-opensorce"
_DOWNLOAD_LOCKS: dict[str, asyncio.Lock] = {}


def _map_dirs() -> list[Path]:
    """Return all local directories that may serve Map PNGs.

    Production (built frontend in static/): FastAPI spa_fallback reads from
        static/Map-opensorce/  →  downloads MUST land there.
    Dev mode (no build, Vite dev server):   Vite reads from
        frontend/public/Map-opensorce/  →  downloads land there.

    In a source checkout both directories can exist at the same time. Keeping
    them mirrored avoids a successful backend download that the Vite page cannot
    display.
    """
    project_root = Path(__file__).parent.parent.parent.parent.parent
    dev_dir = project_root / "frontend" / "public" / "Map-opensorce"

    dirs: list[Path] = []
    if dev_dir.is_dir():
        dirs.append(dev_dir)
    _STATIC_MAP_DIR.mkdir(parents=True, exist_ok=True)
    dirs.append(_STATIC_MAP_DIR)
    return list(dict.fromkeys(dirs))


def _replace_with_retries(src: Path, dest: Path, *, attempts: int = 12) -> None:
    """Atomically replace a file, tolerating short Windows file locks."""
    last_error: PermissionError | None = None
    for attempt in range(attempts):
        try:
            os.replace(src, dest)
            return
        except PermissionError as exc:
            last_error = exc
            time.sleep(0.1 * (attempt + 1))
    if last_error is not None:
        raise last_error


def _copy_atomic(src: Path, dest: Path) -> None:
    if src.resolve() == dest.resolve():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{uuid.uuid4().hex}.tmp")
    try:
        shutil.copyfile(src, tmp)
        _replace_with_retries(tmp, dest)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass


def _sync_existing_file(file_name: str) -> None:
    """Mirror an already-downloaded file into every map-serving directory."""
    dirs = _map_dirs()
    source = next((directory / file_name for directory in dirs if (directory / file_name).exists()), None)
    if source is None:
        return
    for directory in dirs:
        dest = directory / file_name
        if not dest.exists():
            try:
                _copy_atomic(source, dest)
            except OSError:
                pass


def _download_lock(map_id: str) -> asyncio.Lock:
    lock = _DOWNLOAD_LOCKS.get(map_id)
    if lock is None:
        lock = asyncio.Lock()
        _DOWNLOAD_LOCKS[map_id] = lock
    return lock


class SkinStatus(BaseModel):
    id: str
    downloaded: bool
    files: list[str]


@router.get("/status")
async def list_skin_status() -> list[SkinStatus]:
    """Check which map skins are downloaded locally."""
    result = []
    dirs = _map_dirs()
    for mid, num in MAP_NUM.items():
        file_name = f"Map{num}.png"
        _sync_existing_file(file_name)
        downloaded = all((directory / file_name).exists() for directory in dirs)
        files = []
        if downloaded:
            files.append(file_name)
        result.append(SkinStatus(id=mid, downloaded=downloaded, files=files))
    return result


@router.post("/download/{map_id}")
async def download_skin(map_id: str):
    """Download a map skin from OSS with SSE progress."""
    if map_id not in VALID_MAP_IDS:
        raise HTTPException(404, f"Unknown map: {map_id}")

    num = MAP_NUM[map_id]
    public_dirs = _map_dirs()
    for directory in public_dirs:
        directory.mkdir(parents=True, exist_ok=True)

    files_to_download = [
        (f"{ASSET_BASE}/Map{num}.png", f"Map{num}.png"),
    ]

    async def stream():
        downloaded_bytes = 0
        lock = _download_lock(map_id)
        if lock.locked():
            yield f"data: {json.dumps({'phase': 'waiting', 'mapId': map_id})}\n\n"

        async with lock:
            try:
                for _, file_name in files_to_download:
                    _sync_existing_file(file_name)
                if all(
                    (directory / file_name).exists()
                    for _, file_name in files_to_download
                    for directory in public_dirs
                ):
                    yield f"data: {json.dumps({'phase': 'done', 'mapId': map_id})}\n\n"
                    return

                async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                    total_bytes = 0
                    for url, _ in files_to_download:
                        try:
                            resp = await client.head(url)
                            cl = int(resp.headers.get("content-length", 0))
                            total_bytes += cl
                        except Exception:
                            pass

                    for url, file_name in files_to_download:
                        primary = public_dirs[0] / file_name
                        tmp = primary.with_name(f"{primary.name}.{uuid.uuid4().hex}.tmp")
                        try:
                            async with client.stream("GET", url) as resp:
                                if resp.status_code != 200:
                                    yield f"data: {json.dumps({'phase': 'error', 'message': f'HTTP {resp.status_code} for {url}'})}\n\n"
                                    return

                                if total_bytes == 0:
                                    total_bytes = int(resp.headers.get("content-length", 0))

                                yield f"data: {json.dumps({'phase': 'start', 'totalBytes': total_bytes})}\n\n"

                                with open(tmp, "wb") as f:
                                    async for chunk in resp.aiter_bytes(chunk_size=256 * 1024):
                                        f.write(chunk)
                                        downloaded_bytes += len(chunk)
                                        pct = round(downloaded_bytes / total_bytes * 100, 1) if total_bytes else 0
                                        yield f"data: {json.dumps({'phase': 'downloading', 'downloadedBytes': downloaded_bytes, 'totalBytes': total_bytes, 'percent': pct})}\n\n"
                                        await asyncio.sleep(0)

                            await asyncio.to_thread(_replace_with_retries, tmp, primary)
                            for directory in public_dirs[1:]:
                                await asyncio.to_thread(_copy_atomic, primary, directory / file_name)
                        finally:
                            try:
                                tmp.unlink(missing_ok=True)
                            except OSError:
                                pass
            except Exception as exc:
                yield f"data: {json.dumps({'phase': 'error', 'message': str(exc)})}\n\n"
                return

            yield f"data: {json.dumps({'phase': 'done', 'mapId': map_id})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
