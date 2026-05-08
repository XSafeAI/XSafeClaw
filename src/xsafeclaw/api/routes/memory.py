"""Memory file management and security scanning API."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from ...runtime import RuntimeInstance
from ...services import memory_scan_service
from ..runtime_helpers import get_default_instance, get_instance, unavailable_payload

router = APIRouter()

_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"

_WORKSPACE_CONFIG_FILES = (
    "AGENTS.md", "SOUL.md", "USER.md", "IDENTITY.md",
    "TOOLS.md", "BOOTSTRAP.md", "HEARTBEAT.md",
    "SAFETY.md", "PERMISSION.md",
)


def _resolve_openclaw_workspace_fallback() -> Path | None:
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


async def _resolve_memory_instance(instance_id: str | None) -> RuntimeInstance | None:
    if instance_id:
        return await get_instance(instance_id)
    try:
        return await get_default_instance()
    except HTTPException:
        return None


def _memory_root_for_instance(instance: RuntimeInstance | None) -> Path | None:
    if instance is None:
        return _resolve_openclaw_workspace_fallback()

    platform = str(instance.platform or "").strip().lower()
    workspace = Path(instance.workspace_path).expanduser() if instance.workspace_path else None

    if platform == "openclaw":
        if workspace and workspace.is_dir():
            return workspace
        return _resolve_openclaw_workspace_fallback()

    if platform == "hermes":
        # Hermes home is the runtime root. We resolve memory/workspace files under it.
        if not workspace or not workspace.is_dir():
            return None
        return workspace

    if platform == "nanobot":
        return workspace if workspace and workspace.is_dir() else None

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


def _collect_memory_files(instance: RuntimeInstance | None) -> tuple[list[dict], str]:
    root = _memory_root_for_instance(instance)
    if root is None:
        if instance and instance.platform in {"hermes", "nanobot"}:
            return [], "Memory workspace not found for the selected runtime."
        return [], ""

    files: list[dict] = []
    seen: set[str] = set()

    def _add_file(path: Path, *, key: str | None = None, category: str = "memory") -> None:
        if not path.is_file():
            return
        resolved = str(path.resolve())
        if resolved in seen:
            return
        seen.add(resolved)
        rel_key = key or str(path.relative_to(root))
        files.append(_file_info(path, rel_key, category))

    def _add_openclaw_shape_files(base_root: Path) -> None:
        # OpenClaw canonical scan shape: memory files + workspace config files.
        for name in ("MEMORY.md", "memory.md"):
            _add_file(base_root / name, key=name)

        memory_dir = base_root / "memory"
        if memory_dir.is_dir():
            for md in sorted(memory_dir.glob("*.md")):
                _add_file(md, key=str(md.relative_to(base_root)))

        for name in _WORKSPACE_CONFIG_FILES:
            _add_file(base_root / name, key=name, category="workspace")

    platform = str(instance.platform).strip().lower() if instance else "openclaw"

    if platform == "hermes":
        # Hermes persistent memory per docs: $HERMES_HOME/memories/{MEMORY.md,USER.md}
        memories_root = root / "memories"
        _add_file(memories_root / "MEMORY.md", key="MEMORY.md")
        _add_file(memories_root / "USER.md", key="USER.md")

        # Hermes personality is global ($HERMES_HOME/SOUL.md) and workspace context
        # files live under $HERMES_HOME/workspace/.
        _add_file(root / "SOUL.md", key="SOUL.md", category="workspace")
        workspace_root = root / "workspace"
        for name in _WORKSPACE_CONFIG_FILES:
            _add_file(workspace_root / name, key=name, category="workspace")
        return files, ""

    if platform == "nanobot":
        _add_openclaw_shape_files(root)
        return files, ""

    # OpenClaw (default + fallback)
    _add_openclaw_shape_files(root)
    return files, ""


def _scan_cache_key(instance: RuntimeInstance | None, file_key: str) -> str:
    instance_ns = str(instance.instance_id) if instance else "default"
    return f"{instance_ns}:{file_key}"


def _scan_record_for_file(
    *,
    cache: dict,
    instance: RuntimeInstance | None,
    file_key: str,
) -> dict | None:
    return cache.get(_scan_cache_key(instance, file_key)) or cache.get(file_key)


def _public_scan_result(scan: dict | None, *, file_key: str) -> dict:
    if not scan:
        return {}
    out = dict(scan)
    out["file_key"] = file_key
    return out


def _memory_file_map(instance: RuntimeInstance | None) -> tuple[dict[str, str], str]:
    files, reason = _collect_memory_files(instance)
    return {f["key"]: f["path"] for f in files}, reason


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/list")
async def list_memory_files(instance_id: str | None = None):
    instance = await _resolve_memory_instance(instance_id)
    files, unavailable_reason = _collect_memory_files(instance)
    if unavailable_reason:
        return unavailable_payload(instance=instance, reason=unavailable_reason, key="files")
    cached = memory_scan_service.get_all_cached()

    for f in files:
        scan = _scan_record_for_file(cache=cached, instance=instance, file_key=f["key"])
        if scan:
            current_hash = _file_sha256(Path(f["path"]))
            if scan.get("file_hash") and scan["file_hash"] != current_hash:
                scan = {**scan, "status": "outdated"}
            f["scan"] = _public_scan_result(scan, file_key=f["key"])

    return {"files": files, "unavailable": False}


@router.post("/scan-all")
async def scan_all(body: dict | None = None, instance_id: str | None = None):
    instance = await _resolve_memory_instance(instance_id)
    _, unavailable_reason = _collect_memory_files(instance)
    if unavailable_reason:
        return {"results": [], "total": 0, "unavailable": True, "reason": unavailable_reason}
    body = body or {}
    keys: list[str] | None = body.get("keys")
    force: bool = body.get("force", False)

    collected, _ = _collect_memory_files(instance)
    file_map: dict[str, str] = {}
    for f in collected:
        if keys is None or f["key"] in keys:
            file_map[_scan_cache_key(instance, f["key"])] = f["path"]

    if not file_map:
        return {"results": [], "total": 0}

    results = await memory_scan_service.scan_all_files(file_map, force=force)
    prefix = f"{instance.instance_id}:" if instance else "default:"
    public_results = []
    for r in results:
        data = r.to_dict()
        scan_key = data.get("file_key", "")
        public_key = scan_key[len(prefix):] if scan_key.startswith(prefix) else scan_key
        data["file_key"] = public_key
        public_results.append(data)
    return {
        "results": public_results,
        "total": len(public_results),
        "unavailable": False,
    }


@router.get("/scan-status")
async def scan_status(instance_id: str | None = None):
    instance = await _resolve_memory_instance(instance_id)
    file_map, unavailable_reason = _memory_file_map(instance)
    if unavailable_reason:
        return {"scans": {}, "unavailable": True, "reason": unavailable_reason}

    cached = memory_scan_service.get_all_cached()
    scans: dict[str, dict] = {}
    for file_key in file_map.keys():
        scan = _scan_record_for_file(cache=cached, instance=instance, file_key=file_key)
        if scan:
            scans[file_key] = _public_scan_result(scan, file_key=file_key)
    return {"scans": scans, "unavailable": False}


@router.get("/content/{file_key:path}")
async def get_content(file_key: str, instance_id: str | None = None):
    if ".." in file_key.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    instance = await _resolve_memory_instance(instance_id)
    file_map, unavailable_reason = _memory_file_map(instance)
    if unavailable_reason:
        raise HTTPException(status_code=404, detail=unavailable_reason)

    target_raw = file_map.get(file_key)
    if not target_raw:
        raise HTTPException(status_code=404, detail="File not found")
    target = Path(target_raw)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

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
async def scan_single(file_key: str, body: dict | None = None, instance_id: str | None = None):
    body = body or {}
    force: bool = body.get("force", False)

    if ".." in file_key.split("/"):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    instance = await _resolve_memory_instance(instance_id)
    file_map, unavailable_reason = _memory_file_map(instance)
    if unavailable_reason:
        raise HTTPException(status_code=404, detail=unavailable_reason)

    target_raw = file_map.get(file_key)
    if not target_raw:
        raise HTTPException(status_code=404, detail="File not found")
    target = Path(target_raw)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    scan_key = _scan_cache_key(instance, file_key)
    result = await memory_scan_service.scan_file(scan_key, str(target), force=force)
    data = result.to_dict()
    data["file_key"] = file_key
    return data
