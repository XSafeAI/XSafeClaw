"""Map skin download API — streams assets from remote server to local public dir."""

from __future__ import annotations

import asyncio
import json
import os
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


def _public_dir() -> Path:
    """Return the directory that the active file-server reads Map PNGs from.

    Dev mode (source tree + Vite dev server): Vite serves from
        frontend/public/Map-opensorce/  →  downloads must land there so the
        browser (hitting Vite's port) can see them.
    Production (pip-installed, FastAPI serving built bundle): reads from
        src/xsafeclaw/static/Map-opensorce/  →  downloads land there.

    We pick by presence of ``frontend/public/`` — it only exists when the
    repository is checked out in source form, not in a pip install.
    """
    project_root = Path(__file__).parent.parent.parent.parent.parent
    dev_dir = project_root / "frontend" / "public" / "Map-opensorce"
    if dev_dir.is_dir():
        return dev_dir

    _STATIC_MAP_DIR.mkdir(parents=True, exist_ok=True)
    return _STATIC_MAP_DIR


class SkinStatus(BaseModel):
    id: str
    downloaded: bool
    files: list[str]


@router.get("/status")
async def list_skin_status() -> list[SkinStatus]:
    """Check which map skins are downloaded locally."""
    pub = _public_dir()
    result = []
    for mid, num in MAP_NUM.items():
        main_file = pub / f"Map{num}.png"
        downloaded = main_file.exists()
        files = []
        if main_file.exists():
            files.append(f"Map{num}.png")
        result.append(SkinStatus(id=mid, downloaded=downloaded, files=files))
    return result


@router.post("/download/{map_id}")
async def download_skin(map_id: str):
    """Download a map skin from OSS with SSE progress."""
    if map_id not in VALID_MAP_IDS:
        raise HTTPException(404, f"Unknown map: {map_id}")

    num = MAP_NUM[map_id]
    pub = _public_dir()
    pub.mkdir(parents=True, exist_ok=True)

    files_to_download = [
        (f"{ASSET_BASE}/Map{num}.png", pub / f"Map{num}.png"),
    ]

    async def stream():
        downloaded_bytes = 0

        async with httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
            total_bytes = 0
            for url, _ in files_to_download:
                try:
                    resp = await client.head(url)
                    cl = int(resp.headers.get("content-length", 0))
                    total_bytes += cl
                except Exception:
                    pass

            for url, dest in files_to_download:
                tmp = dest.with_suffix(".tmp")
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

                os.replace(tmp, dest)

        yield f"data: {json.dumps({'phase': 'done', 'mapId': map_id})}\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream")
