"""Memory file management and security scanning API."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
import time

from fastapi import APIRouter, HTTPException

from ...services import memory_scan_service
from ..runtime_helpers import get_default_instance, unavailable_payload

logger = logging.getLogger(__name__)

router = APIRouter()

_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"

_WORKSPACE_CONFIG_FILES = (
    "AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md",
    "TOOLS.md", "BOOTSTRAP.md", "HEARTBEAT.md",
    "SAFETY.md", "PERMISSION.md",
)


def _resolve_workspace() -> Path | None:
    if _CONFIG_PATH.exists():
        try:
            config = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            ws = config.get("workspace")
            if ws:
                p = Path(ws).expanduser()
                if p.is_dir():
                    return p
        except (json.JSONDecodeError, OSError):
            pass

    common = [
        _OPENCLAW_DIR / "workspace",
        Path.home() / "openclaw-workspace",
        Path.home() / ".openclaw-workspace",
    ]
    for p in common:
        if p.is_dir():
            return p
    return None


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def _file_info(path: Path, key: str, category: str) -> dict:
    stat = path.stat()
    try:
        preview = path.read_text(encoding="utf-8")[:500]
    except (OSError, UnicodeDecodeError):
        preview = ""
    try:
        lines = path.read_text(encoding="utf-8").count("\n")
    except (OSError, UnicodeDecodeError):
        lines = 0

    return {
        "key": key,
        "name": path.name,
        "path": str(path),
        "relPath": key,
        "sizeBytes": stat.st_size,
        "modifiedAt": stat.st_mtime,
        "preview": preview,
        "lines": lines,
        "category": category,
    }


def _collect_memory_files() -> list[dict]:
    ws = _resolve_workspace()
    if ws is None:
        return []

    files: list[dict] = []
    seen: set[str] = set()

    for name in ("MEMORY.md", "memory.md"):
        p = ws / name
        if p.is_file() and str(p) not in seen:
            seen.add(str(p))
            key = name
            files.append(_file_info(p, key, "memory"))

    memory_dir = ws / "memory"
    if memory_dir.is_dir():
        for md in sorted(memory_dir.glob("*.md")):
            if md.is_file() and str(md) not in seen:
                seen.add(str(md))
                key = str(md.relative_to(ws))
                files.append(_file_info(md, key, "memory"))

    for name in _WORKSPACE_CONFIG_FILES:
        p = ws / name
        if p.is_file() and str(p) not in seen:
            seen.add(str(p))
            files.append(_file_info(p, name, "workspace"))

    return files


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/list")
async def list_memory_files():
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return unavailable_payload(
            instance=instance,
            reason="Memory file management is currently only available for OpenClaw workspaces.",
            key="files",
        )
    files = _collect_memory_files()
    cached = memory_scan_service.get_all_cached()

    for f in files:
        scan = cached.get(f["key"])
        if scan:
            current_hash = _file_sha256(Path(f["path"]))
            if scan.get("file_hash") and scan["file_hash"] != current_hash:
                scan = {**scan, "status": "outdated"}
            f["scan"] = scan

    return {"files": files, "unavailable": False}


@router.post("/scan-all")
async def scan_all(body: dict | None = None):
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "results": [],
            "total": 0,
            "unavailable": True,
            "reason": "Memory file scanning is currently only available for OpenClaw workspaces.",
        }
    body = body or {}
    keys: list[str] | None = body.get("keys")
    force: bool = body.get("force", False)

    collected = _collect_memory_files()
    file_map: dict[str, str] = {}
    for f in collected:
        if keys is None or f["key"] in keys:
            file_map[f["key"]] = f["path"]

    if not file_map:
        return {"results": [], "total": 0}

    results = await memory_scan_service.scan_all_files(file_map, force=force)
    return {
        "results": [r.to_dict() for r in results],
        "total": len(results),
    }


@router.get("/scan-status")
async def scan_status():
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "scans": {},
            "unavailable": True,
            "reason": "Memory file scanning is currently only available for OpenClaw workspaces.",
        }
    return {"scans": memory_scan_service.get_all_cached(), "unavailable": False}


@router.get("/content/{file_key:path}")
async def get_content(file_key: str):
    if ".." in file_key.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    ws = _resolve_workspace()
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    target = ws / file_key
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        resolved = target.resolve()
        if not str(resolved).startswith(str(ws.resolve())):
            raise HTTPException(status_code=400, detail="Path traversal not allowed")
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid path")

    try:
        content = target.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}")

    stat = target.stat()
    return {
        "key": file_key,
        "content": content,
        "sizeBytes": stat.st_size,
        "modifiedAt": stat.st_mtime,
    }


@router.post("/{file_key:path}/scan")
async def scan_single(file_key: str, body: dict | None = None):
    body = body or {}
    force: bool = body.get("force", False)

    if ".." in file_key.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    ws = _resolve_workspace()
    if ws is None:
        raise HTTPException(status_code=404, detail="Workspace not found")

    target = ws / file_key
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        resolved = target.resolve()
        if not str(resolved).startswith(str(ws.resolve())):
            raise HTTPException(status_code=400, detail="Path traversal not allowed")
    except (OSError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid path")

    result = await memory_scan_service.scan_file(file_key, str(target), force=force)
    return result.to_dict()
