"""API routes for Asset Scanning."""

import asyncio
import os
import stat
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

# Import from internal asset_scanner module
try:
    from xsafeclaw.asset_scanner import AssetScanner, SafetyGuard
    from xsafeclaw.asset_scanner.scanner import ScanCancelledError
except ImportError:
    AssetScanner = None
    SafetyGuard = None
    class ScanCancelledError(Exception):
        """Fallback cancellation error when asset scanner imports are unavailable."""

from xsafeclaw.config import settings
from xsafeclaw.path_protection import (
    PROTECTED_OPERATION_ORDER,
    build_block_reason,
    load_rules,
    match_protected_rule,
    normalize_rule_input,
    save_rules,
    serialize_rules,
)

# --------------- Software scan task store ---------------
# {scan_id: { status, result, error }}
_software_scan_tasks: dict[str, dict] = {}

# --------------- SafetyGuard singleton (loaded on demand) ---------------
_safety_guard: "SafetyGuard | None" = None
_DENYLIST_FILE = settings.data_dir / "denylist.json"
_DENYLIST_FILE.parent.mkdir(parents=True, exist_ok=True)

router = APIRouter()

# --------------- In-memory scan task store ---------------
# {scan_id: { status, scanner, error, result }}
_scan_tasks: dict[str, dict] = {}


# Pydantic schemas
class ScanRequest(BaseModel):
    """Request schema for asset scanning."""

    path: str | None = Field(None, description="Specific path to scan (default: full system scan)")
    max_depth: int | None = Field(None, ge=1, le=500, description="Maximum scan depth")
    scan_system_root: bool = Field(True, description="Whether to scan system root directory")


class StopScanRequest(BaseModel):
    """Request schema for stopping an in-flight scan."""

    scan_id: str = Field(..., min_length=1, description="Scan task ID")


class AssetDetail(BaseModel):
    """Detail info for a single scanned asset."""

    path: str
    file_type: str
    owner: str
    risk_level: int
    size: int | None = None
    direct_size: int | None = None
    permissions: str | None = None
    real_path: str | None = None
    resolved_risk: int | None = None
    metadata: dict | None = None


class RiskGroupDetail(BaseModel):
    """Assets grouped under a single risk level."""

    count: int
    percentage: float
    description: str
    assets: list[AssetDetail] = []          # first N items
    total_in_level: int = 0                 # total items for this level


class ScanResponse(BaseModel):
    """Response schema for scan results."""

    status: str
    total_scanned: int
    total_ignored: int
    total_assets: int
    risk_distribution: dict[str, RiskGroupDetail]
    message: str


class HardwareScanResponse(BaseModel):
    """Response schema for hardware scan."""

    status: str
    hardware_info: dict
    message: str


class RiskLevelStats(BaseModel):
    """Statistics for a specific risk level."""

    count: int
    percentage: float
    description: str


class AssetListResponse(BaseModel):
    """Response schema for asset listing."""

    assets: list[dict]
    total: int
    risk_level: int | None
    description: str


class DenyEntry(BaseModel):
    """User-defined path protection rule."""
    path: str
    operations: list[str] = Field(
        default_factory=lambda: list(PROTECTED_OPERATION_ORDER),
        description="Protected operations: read | modify | delete",
    )


class BrowseEntry(BaseModel):
    name: str
    path: str
    is_hidden: bool = False


class BrowseResponse(BaseModel):
    current_path: str
    parent_path: str | None = None
    root_path: str
    entries: list[BrowseEntry]


def _build_scan_response(scanner: "AssetScanner", assets: list, per_level_limit: int = 200) -> dict:
    """Build the ScanResponse dict from scanner + assets (reusable helper)."""
    summary = scanner.get_scan_summary()

    descriptions = {
        0: "Operating System Core and Applications",
        1: "Sensitive Credentials",
        2: "User Data",
        3: "Cleanable Content",
    }

    risk_stats: dict[str, dict] = {}
    for level in range(4):
        level_assets = [a for a in assets if a.risk_level == level]
        count = len(level_assets)
        percentage = (count / len(assets) * 100) if assets else 0

        detail_list = []
        for a in level_assets[:per_level_limit]:
            d = a.to_dict()
            detail_list.append({
                "path": d["path"],
                "file_type": d["file_type"],
                "owner": d["owner"],
                "risk_level": d["risk_level"],
                "size": d.get("size"),
                "direct_size": d.get("direct_size"),
                "permissions": d.get("permissions"),
                "real_path": d.get("real_path"),
                "resolved_risk": d.get("resolved_risk"),
                "metadata": d.get("metadata"),
            })

        risk_stats[f"LEVEL_{level}"] = {
            "count": count,
            "percentage": round(percentage, 2),
            "description": descriptions[level],
            "assets": detail_list,
            "total_in_level": count,
        }

    return {
        "status": "completed",
        "total_scanned": summary["scanned_count"],
        "total_ignored": summary["ignored_count"],
        "total_assets": len(assets),
        "risk_distribution": risk_stats,
        "message": f"Successfully scanned {summary['scanned_count']} items",
    }


def _run_scan_sync(scan_id: str, request_path: str | None, max_depth: int, scan_system_root: bool):
    """Run the scan in a background thread; updates _scan_tasks in-place."""
    task = _scan_tasks[scan_id]
    scanner: AssetScanner = task["scanner"]
    try:
        if request_path:
            assets = scanner.scan_assets(
                target_path=Path(request_path),
                max_depth=max_depth,
                scan_system_root=False,
            )
        else:
            assets = scanner.scan_assets(
                max_depth=max_depth,
                scan_system_root=scan_system_root,
            )
        task["result"] = _build_scan_response(scanner, assets)
        task["status"] = "completed"
    except ScanCancelledError as e:
        task["status"] = "cancelled"
        task["error"] = str(e)
    except Exception as e:
        task["status"] = "cancelled" if getattr(scanner, "stop_requested", False) else "failed"
        task["error"] = str(e)


@router.post("/scan")
async def scan_assets(request: ScanRequest) -> Any:
    """
    Start an async asset scan. Returns a scan_id immediately.
    Use GET /scan/progress?scan_id=xxx to poll progress.
    """
    if AssetScanner is None:
        raise HTTPException(
            status_code=500,
            detail="Asset Scanner module not available. Please check installation.",
        )

    scan_id = uuid.uuid4().hex[:12]
    scanner = AssetScanner()

    _scan_tasks[scan_id] = {
        "status": "running",
        "scanner": scanner,
        "result": None,
        "error": None,
    }

    # Launch scan in a background thread (non-blocking)
    thread = threading.Thread(
        target=_run_scan_sync,
        args=(scan_id, request.path, request.max_depth or 200, request.scan_system_root),
        daemon=True,
    )
    thread.start()

    return {"scan_id": scan_id, "status": "running", "message": "Scan started"}


@router.post("/scan/stop")
async def stop_scan(request: StopScanRequest) -> Any:
    """Request cancellation of an in-flight asset scan."""
    task = _scan_tasks.get(request.scan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Scan task not found")

    status = task["status"]
    if status in ("completed", "failed", "cancelled"):
        return {
            "scan_id": request.scan_id,
            "status": status,
            "message": f"Scan already {status}",
        }

    scanner: AssetScanner = task["scanner"]
    scanner.request_stop()
    task["status"] = "cancel_requested"
    return {
        "scan_id": request.scan_id,
        "status": "cancel_requested",
        "message": "Stop requested",
    }


@router.get("/scan/progress")
async def scan_progress(scan_id: str = Query(..., description="Scan task ID")) -> Any:
    """
    Poll the progress of a running scan.

    Returns:
    - status: running | completed | failed
    - scanned_count / ignored_count: live counters
    - result: full ScanResponse when completed
    """
    task = _scan_tasks.get(scan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Scan task not found")

    scanner: AssetScanner = task["scanner"]

    resp: dict[str, Any] = {
        "scan_id": scan_id,
        "status": task["status"],
        "scanned_count": scanner.scanned_count,
        "ignored_count": scanner.ignored_count,
    }

    if task["status"] == "completed":
        resp["result"] = task["result"]
        # Clean up old tasks to avoid memory leak (keep last 5)
        _cleanup_old_tasks(scan_id)
    elif task["status"] == "cancel_requested":
        resp["message"] = "Stop requested"
    elif task["status"] == "cancelled":
        resp["message"] = task["error"] or "Scan cancelled"
        _cleanup_old_tasks(scan_id)
    elif task["status"] == "failed":
        resp["error"] = task["error"]
        _cleanup_old_tasks(scan_id)

    return resp


def _cleanup_old_tasks(keep_id: str):
    """Remove old completed/failed tasks, keep at most 5."""
    finished = [
        k for k, v in _scan_tasks.items()
        if v["status"] in ("completed", "failed", "cancelled") and k != keep_id
    ]
    for old_id in finished[:-4]:  # keep the 4 most recent + current
        _scan_tasks.pop(old_id, None)


# ----------------------- Denylist helpers ----------------------- #
def _load_denylist() -> dict[str, set[str]]:
    return load_rules(_DENYLIST_FILE)


def _save_denylist(paths: dict[str, set[str]]) -> None:
    save_rules(_DENYLIST_FILE, paths)


def _resolve_browse_path(raw_path: str | None) -> Path:
    if raw_path and raw_path.strip():
        candidate = Path(raw_path).expanduser()
    else:
        candidate = Path.home()

    resolved = candidate.resolve(strict=False)
    if resolved.exists() and resolved.is_file():
        resolved = resolved.parent

    if not resolved.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {candidate}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {candidate}")
    return resolved


def _is_hidden_directory(path: Path) -> bool:
    if path.name.startswith("."):
        return True

    if os.name == "nt":
        try:
            attributes = path.stat().st_file_attributes
        except (AttributeError, OSError):
            return False
        return bool(attributes & stat.FILE_ATTRIBUTE_HIDDEN)

    return False


def _root_path_for_directory(path: Path) -> str:
    anchor = path.anchor
    if anchor:
        return anchor
    return str(path)


@router.get("/browse", response_model=BrowseResponse)
async def browse_directories(path: str | None = Query(None, description="Directory to browse")) -> Any:
    """List child directories for the shared folder picker used across asset forms."""
    current = _resolve_browse_path(path)

    try:
        children = []
        for child in current.iterdir():
            if not child.is_dir():
                continue
            children.append(
                {
                    "name": child.name or str(child),
                    "path": str(child.resolve()),
                    "is_hidden": _is_hidden_directory(child),
                }
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=f"Permission denied: {current}") from exc

    children.sort(key=lambda item: (item["is_hidden"], item["name"].lower()))
    parent = current.parent if current.parent != current else None
    return {
        "current_path": str(current),
        "parent_path": str(parent) if parent else None,
        "root_path": _root_path_for_directory(current),
        "entries": children,
    }


@router.get("/hardware", response_model=HardwareScanResponse)
async def scan_hardware() -> Any:
    """
    Scan system hardware information.
    
    Collects comprehensive hardware information including:
    - CPU (model, cores, usage)
    - Memory (total, used, free)
    - Disk (all partitions)
    - GPU (if available)
    - System info (OS, architecture, hostname)
    """
    if AssetScanner is None:
        raise HTTPException(
            status_code=500,
            detail="Asset Scanner module not available."
        )
    
    try:
        scanner = AssetScanner()
        hardware_asset = scanner.scan_hardware_info()
        
        if hardware_asset is None:
            raise HTTPException(
                status_code=500,
                detail="Hardware scan returned no data."
            )
        
        return HardwareScanResponse(
            status="completed",
            hardware_info=hardware_asset.to_dict(),
            message="Hardware scan completed successfully"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Hardware scan failed: {str(e)}")


@router.get("/risk-level/{level}", response_model=AssetListResponse)
async def get_assets_by_risk_level(
    level: int,
    limit: int = Query(100, ge=1, le=1000, description="Maximum number of assets to return"),
) -> Any:
    """
    Get assets by risk level.
    
    Returns a list of assets for a specific risk level.
    Note: This requires a recent scan to have been performed.
    """
    if AssetScanner is None:
        raise HTTPException(status_code=500, detail="Asset Scanner module not available.")
    
    descriptions = {
        0: "Operating System Core and Applications (Red)",
        1: "Sensitive Credentials (Orange)",
        2: "User Data (Yellow)",
        3: "Cleanable Content (Green)"
    }
    
    # Check if scan results exist
    level_file = Path(f"level_{level}.json")
    if not level_file.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No scan results found. Please run /scan first."
        )
    
    try:
        import json
        with open(level_file, 'r', encoding='utf-8') as f:
            assets = json.load(f)
        
        # Limit results
        limited_assets = assets[:limit]
        
        return AssetListResponse(
            assets=limited_assets,
            total=len(assets),
            risk_level=level,
            description=descriptions[level]
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load assets: {str(e)}")


@router.get("/assess-path")
async def assess_path_risk(
    path: str = Query(..., description="File or directory path to assess")
) -> dict:
    """
    Assess the risk level of a specific path.
    
    Quick risk assessment without performing a full scan.
    Useful for checking if an Agent can safely access/modify a path.
    """
    if AssetScanner is None:
        raise HTTPException(status_code=500, detail="Asset Scanner module not available.")
    
    try:
        scanner = AssetScanner()
        file_path = Path(path)
        
        if not file_path.exists():
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")
        
        risk_level = scanner.assess_risk_level(file_path)
        
        risk_descriptions = {
            0: {
                "level": "LEVEL_0",
                "color": "red",
                "label": "Critical System File",
                "recommendation": "DO NOT modify or delete",
                "safety": "dangerous"
            },
            1: {
                "level": "LEVEL_1",
                "color": "orange",
                "label": "Sensitive Credential",
                "recommendation": "DO NOT access or share",
                "safety": "dangerous"
            },
            2: {
                "level": "LEVEL_2",
                "color": "yellow",
                "label": "User Data",
                "recommendation": "Use caution when modifying",
                "safety": "caution"
            },
            3: {
                "level": "LEVEL_3",
                "color": "green",
                "label": "Cleanable Content",
                "recommendation": "Safe to delete or modify",
                "safety": "safe"
            }
        }
        
        result = risk_descriptions[int(risk_level)]
        result["path"] = str(file_path)
        result["risk_level"] = int(risk_level)
        result["is_file"] = file_path.is_file()
        result["is_directory"] = file_path.is_dir()
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Assessment failed: {str(e)}")


@router.get("/stats/overview")
async def get_scan_overview() -> dict:
    """
    Get overview of the most recent scan.
    
    Returns statistics from the last full scan including:
    - Total items scanned
    - Risk level distribution
    - System information
    """
    full_scan_file = Path("full_scan.json")
    
    if not full_scan_file.exists():
        raise HTTPException(
            status_code=404,
            detail="No scan results found. Please run /scan first."
        )
    
    try:
        import json
        with open(full_scan_file, 'r', encoding='utf-8') as f:
            report = json.load(f)
        
        return {
            "status": "available",
            "report_metadata": report.get("report_metadata", {}),
            "scan_summary": report.get("scan_summary", {}),
            "risk_statistics": report.get("risk_statistics", {}),
            "hardware_available": "hardware_assets" in report
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load overview: {str(e)}")


# =====================================================================
# Software Scan endpoints
# =====================================================================

class SoftwareScanResponse(BaseModel):
    scan_id: str
    status: str
    message: str


def _run_software_scan_sync(scan_id: str):
    """Run installed-software scan in a background thread."""
    task = _software_scan_tasks[scan_id]
    try:
        scanner = AssetScanner()
        software_list = scanner.scan_installed_software()
        task["result"] = {
            "total": len(software_list),
            "software_list": [s.to_dict() for s in software_list],
        }
        task["status"] = "completed"
    except Exception as e:
        task["status"] = "failed"
        task["error"] = str(e)


@router.post("/software/scan", response_model=SoftwareScanResponse)
async def scan_software() -> Any:
    """
    Start an async scan of all installed software on the system.

    Returns a scan_id immediately. Poll GET /software/scan/progress?scan_id=xxx
    until status is 'completed', then retrieve the full software list.

    The scan discovers installed applications on Windows (Registry),
    macOS (App Bundles + pkgutil), and Linux (dpkg/rpm/flatpak).
    """
    if AssetScanner is None:
        raise HTTPException(status_code=500, detail="Asset Scanner module not available.")

    scan_id = uuid.uuid4().hex[:12]
    _software_scan_tasks[scan_id] = {"status": "running", "result": None, "error": None}

    thread = threading.Thread(
        target=_run_software_scan_sync,
        args=(scan_id,),
        daemon=True,
    )
    thread.start()

    return SoftwareScanResponse(
        scan_id=scan_id,
        status="running",
        message="Software scan started",
    )


@router.get("/software/scan/progress")
async def software_scan_progress(
    scan_id: str = Query(..., description="Software scan task ID"),
) -> Any:
    """
    Poll the progress of a running software scan.

    Returns status (running | completed | failed) and, when completed,
    the full software list.
    """
    task = _software_scan_tasks.get(scan_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Software scan task not found")

    resp: dict[str, Any] = {"scan_id": scan_id, "status": task["status"]}

    if task["status"] == "completed":
        resp["result"] = task["result"]
    elif task["status"] == "failed":
        resp["error"] = task.get("error", "Unknown error")

    return resp


# =====================================================================
# Safety Check endpoint  (SafetyGuard)
# =====================================================================

class SafetyCheckRequest(BaseModel):
    path: str = Field(..., description="Absolute path to the target file or directory")
    operation: str = Field(
        ...,
        description="Operation type: read | write | delete | modify | create",
    )


class SafetyCheckResponse(BaseModel):
    status: str          # ALLOWED | DENIED | CONFIRM
    risk_level: int      # 0-3  (-1 for invalid path)
    reason: str


@router.post("/check-safety", response_model=SafetyCheckResponse)
async def check_safety(request: SafetyCheckRequest) -> Any:
    """
    Check whether a file operation is safe before executing it.

    Uses a five-priority logic:
    1. User-defined path protection rules → DENIED
    2. Software asset protection (install_location + related_paths) → DENIED
    3. System / credential paths (LEVEL 0 / 1) → DENIED
    4. User data (LEVEL 2) + destructive operation → CONFIRM
    5. Safe / temp zone (LEVEL 3) → ALLOWED

    **Note**: The software whitelist (`software.json`) is loaded from the
    current working directory on first call. Run `POST /software/scan` and
    export results first to enable software-level protection; without it the
    check still works via the rule-based LEVEL 0-3 logic.
    """
    if SafetyGuard is None:
        raise HTTPException(status_code=500, detail="SafetyGuard module not available.")

    global _safety_guard
    if _safety_guard is None:
        # Load SafetyGuard once; software.json is optional
        software_json = Path("software.json")
        _safety_guard = SafetyGuard(str(software_json) if software_json.exists() else "software.json")

    try:
        protected_root = match_protected_rule(
            request.path,
            request.operation,
            _load_denylist(),
        )
        if protected_root:
            return SafetyCheckResponse(
                status="DENIED",
                risk_level=0,
                reason=build_block_reason(request.path, request.operation, protected_root),
            )

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            lambda: _safety_guard.check_safety(request.path, request.operation),
        )
        return SafetyCheckResponse(
            status=result["status"],
            risk_level=result["risk_level"],
            reason=result["reason"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Safety check failed: {str(e)}")


@router.post("/check-safety/reload-software")
async def reload_software_whitelist() -> dict:
    """
    Reload the software whitelist (software.json) into SafetyGuard.

    Call this after running a new software scan and exporting software.json,
    so the guard picks up newly installed or removed applications.
    """
    if SafetyGuard is None:
        raise HTTPException(status_code=500, detail="SafetyGuard module not available.")

    global _safety_guard
    software_json = Path("software.json")
    if not software_json.exists():
        raise HTTPException(
            status_code=404,
            detail="software.json not found. Run POST /software/scan first.",
        )

    _safety_guard = SafetyGuard(str(software_json))
    return {
        "status": "reloaded",
        "protected_paths_count": len(_safety_guard.protected_paths),
        "message": "Software whitelist reloaded successfully",
    }


# ----------------------- Denylist CRUD ----------------------- #

@router.get("/denylist")
async def list_denylist() -> dict:
    """Return all user-defined path protection rules."""
    rules = _load_denylist()
    entries = serialize_rules(rules)
    return {
        "entries": entries,
        "paths": [entry["path"] for entry in entries],
    }


@router.post("/denylist")
async def add_deny_path(body: DenyEntry) -> dict:
    """Add or update a path protection rule."""
    try:
        resolved, operations = normalize_rule_input(body.path, body.operations)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    rules = _load_denylist()
    rules[resolved] = set(operations)
    _save_denylist(rules)
    entries = serialize_rules(rules)
    return {
        "entries": entries,
        "paths": [entry["path"] for entry in entries],
    }


@router.delete("/denylist")
async def remove_deny_path(path: str = Query(..., description="Path to remove from denylist")) -> dict:
    resolved = str(Path(path).expanduser().resolve())
    rules = _load_denylist()
    if resolved in rules:
        del rules[resolved]
        _save_denylist(rules)
    entries = serialize_rules(rules)
    return {
        "entries": entries,
        "paths": [entry["path"] for entry in entries],
    }
