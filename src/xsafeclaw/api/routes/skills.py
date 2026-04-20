"""OpenClaw skills management API."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ...services import skill_scan_service
from ..runtime_helpers import get_default_instance

logger = logging.getLogger(__name__)

router = APIRouter()

_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def _build_env() -> dict:
    """Build env dict with nvm Node paths (cross-platform)."""
    env = {**os.environ}
    path_sep = os.pathsep

    # nvm-sh (Linux/macOS/WSL): ~/.nvm/versions/node/v22.x.x/bin
    nvm_versions = Path.home() / ".nvm" / "versions" / "node"
    if nvm_versions.exists():
        version_dirs = sorted(
            [d for d in nvm_versions.iterdir() if d.is_dir()],
        )
        if version_dirs:
            latest_bin = str(version_dirs[-1] / "bin")
            current_path = env.get("PATH", "")
            if latest_bin not in current_path:
                env["PATH"] = latest_bin + path_sep + current_path

    # nvm-windows: %NVM_HOME% symlinks to current Node, versions under %NVM_HOME%\..\versions\node
    nvm_home = os.environ.get("NVM_HOME") or os.environ.get("NVM_SYMLINK")
    if nvm_home:
        nvm_home_path = Path(nvm_home)
        # nvm-windows stores versions under the parent of NVM_HOME: e.g. C:\ProgramData\nvm
        nvm_windows_versions = nvm_home_path.parent / "versions" / "node"
        if nvm_windows_versions.exists():
            v22_dirs = sorted(
                [d for d in nvm_windows_versions.iterdir() if d.is_dir() and d.name.startswith("v22")],
                reverse=True,
            )
            if v22_dirs:
                # On Windows nvm-windows, Node.exe lives directly in the version dir (no /bin subfolder)
                v22_bin = str(v22_dirs[0])
                current_path = env.get("PATH", "")
                if v22_bin not in current_path:
                    env["PATH"] = v22_bin + path_sep + current_path

    return env


def _find_openclaw() -> str | None:
    """Find the openclaw binary (cross-platform)."""
    found = shutil.which("openclaw")
    if found:
        return found

    # nvm-sh (Linux/macOS/WSL)
    nvm_versions = Path.home() / ".nvm" / "versions" / "node"
    if nvm_versions.exists():
        for vdir in sorted(nvm_versions.iterdir(), reverse=True):
            candidate = vdir / "bin" / "openclaw"
            if candidate.is_file():
                if os.name != "nt" and not os.access(candidate, os.X_OK):
                    continue
                return str(candidate)

    # nvm-windows: %NVM_HOME% symlinks to current Node, versions under %NVM_HOME%\..\versions\node
    nvm_home = os.environ.get("NVM_HOME") or os.environ.get("NVM_SYMLINK")
    if nvm_home:
        nvm_home_path = Path(nvm_home)
        nvm_windows_versions = nvm_home_path.parent / "versions" / "node"
        if nvm_windows_versions.exists():
            for vdir in sorted(nvm_windows_versions.iterdir(), reverse=True):
                # On Windows nvm-windows, openclaw lives directly in the version dir (no /bin subfolder)
                for suffix in ("", ".cmd", ".bat", ".exe"):
                    candidate = vdir / f"openclaw{suffix}"
                    if candidate.is_file():
                        return str(candidate)

    # Also search in Python env Scripts/bin dirs
    import sys as _sys
    prefixes = [Path(_sys.prefix), Path(_sys.executable).resolve().parent]
    for prefix in prefixes:
        if os.name == "nt":
            candidates = [prefix / "Scripts", prefix]
        else:
            candidates = [prefix / "bin", prefix]
        for base in candidates:
            for suffix in (".cmd", ".bat", ".exe", "") if os.name == "nt" else ("",):
                candidate = base / f"openclaw{suffix}"
                if candidate.is_file():
                    return str(candidate)

    return None


def _read_config() -> dict:
    """Read and parse openclaw.json."""
    if not _CONFIG_PATH.exists():
        return {}
    try:
        return json.loads(_CONFIG_PATH.read_text("utf-8"))
    except Exception:
        return {}


def _write_config(config: dict) -> None:
    """Write config dict to openclaw.json."""
    _OPENCLAW_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.rename(_CONFIG_PATH)


def _build_skill_paths() -> dict[str, str]:
    """Scan known directories to build a skill_name → directory_path mapping."""
    skill_map: dict[str, str] = {}

    scan_bases: list[Path] = [
        _OPENCLAW_DIR / "skills",
    ]

    # ~/.openclaw/extensions/*/skills/
    ext_dir = _OPENCLAW_DIR / "extensions"
    if ext_dir.is_dir():
        for ext in ext_dir.iterdir():
            if ext.is_dir():
                skills_sub = ext / "skills"
                if skills_sub.is_dir():
                    scan_bases.append(skills_sub)

    # Paths relative to the openclaw binary
    openclaw_bin = _find_openclaw()
    if openclaw_bin:
        bin_path = Path(openclaw_bin).resolve()
        pkg_root = bin_path.parent
        # If resolved into the package itself (symlink case), use directly
        # Otherwise climb from bin/ to the package dir
        pkg_candidates = [
            pkg_root,
            pkg_root.parent,
            pkg_root / ".." / "lib" / "node_modules" / "openclaw",
        ]
        for pkg in pkg_candidates:
            pkg = pkg.resolve()
            skills_dir = pkg / "skills"
            if skills_dir.is_dir():
                scan_bases.append(skills_dir)
            ext_dir2 = pkg / "extensions"
            if ext_dir2.is_dir():
                for ext in ext_dir2.iterdir():
                    if ext.is_dir():
                        skills_sub = ext / "skills"
                        if skills_sub.is_dir():
                            scan_bases.append(skills_sub)

    for base in scan_bases:
        if not base.is_dir():
            continue
        for subdir in base.iterdir():
            if subdir.is_dir() and (subdir / "SKILL.md").exists():
                skill_map[subdir.name] = str(subdir)

    return skill_map


def _extract_json(raw: str) -> dict | list:
    """Extract the first complete JSON object/array from a string that may
    contain non-JSON text before or after (e.g. plugin log lines)."""
    start = -1
    for i, ch in enumerate(raw):
        if ch in ("{", "["):
            start = i
            break
    if start == -1:
        raise ValueError("No JSON object/array found in output")

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
                return json.loads(raw[start:i + 1])
    raise ValueError("Incomplete JSON in output")


def _file_sha256(path: Path) -> str:
    """SHA-256 hex digest of a file, empty string if not exists."""
    if not path.exists():
        return ""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class SkillUpdateRequest(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    env: dict | None = None


class ScanAllRequest(BaseModel):
    keys: list[str] | None = None
    force: bool = False


class ScanOneRequest(BaseModel):
    force: bool = False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/list")
async def list_skills():
    """List skills via openclaw CLI and enrich with config / scan data."""
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "skills": [],
            "unavailable": True,
            "reason": "Skill management is currently only available for OpenClaw runtimes.",
        }
    openclaw_bin = _find_openclaw()
    if not openclaw_bin:
        raise HTTPException(status_code=500, detail="openclaw binary not found")

    env = _build_env()
    try:
        result = subprocess.run(
            [openclaw_bin, "skills", "list", "--json"],
            capture_output=True, text=True, timeout=30, env=env,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run openclaw: {exc}")

    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail=f"openclaw skills list failed (exit {result.returncode}): {result.stderr}",
        )

    try:
        raw = result.stdout
        data = _extract_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from openclaw: {exc}")

    config = _read_config()
    skills_config = config.get("skills", {})
    skill_paths = _build_skill_paths()
    cached_scans = skill_scan_service.get_all_cached()

    skills_list = data.get("skills", []) if isinstance(data, dict) else data
    for skill in skills_list:
        key = skill.get("key") or skill.get("name", "")
        skill_cfg = skills_config.get(key, {})

        skill["configEnabled"] = skill_cfg.get("enabled", True)
        skill["hasApiKey"] = bool(skill_cfg.get("apiKey"))
        skill["configEnv"] = skill_cfg.get("env", {})
        skill["path"] = skill_paths.get(key, "")

        scan_entry = cached_scans.get(key)
        if scan_entry:
            skill_dir = skill_paths.get(key)
            if skill_dir:
                current_hash = _file_sha256(Path(skill_dir) / "SKILL.md")
                scanned_hash = scan_entry.get("fileHash", "")
                if current_hash and scanned_hash and current_hash != scanned_hash:
                    scan_entry = {**scan_entry, "status": "outdated"}
            skill["scanStatus"] = scan_entry

    return {"skills": skills_list, "unavailable": False}


@router.get("/check")
async def check_skills():
    """Check skill eligibility via openclaw CLI."""
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "checks": [],
            "unavailable": True,
            "reason": "Skill checks are currently only available for OpenClaw runtimes.",
        }
    openclaw_bin = _find_openclaw()
    if not openclaw_bin:
        raise HTTPException(status_code=500, detail="openclaw binary not found")

    env = _build_env()
    try:
        result = subprocess.run(
            [openclaw_bin, "skills", "check", "--json"],
            capture_output=True, text=True, timeout=30, env=env,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run openclaw: {exc}")

    try:
        raw = result.stdout
        return _extract_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from openclaw: {exc}")


@router.post("/scan-all")
async def scan_all_skills(body: ScanAllRequest):
    """Trigger security scan on all (or selected) skills."""
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "results": [],
            "unavailable": True,
            "reason": "Skill scanning is currently only available for OpenClaw runtimes.",
        }
    skill_paths = _build_skill_paths()
    if body.keys:
        skill_paths = {k: v for k, v in skill_paths.items() if k in body.keys}
    if not skill_paths:
        return {"results": [], "error": "No matching skills found"}
    try:
        results = await skill_scan_service.scan_all_skills(
            skill_paths=skill_paths,
            force=body.force,
        )
        return {"results": [r.to_dict() for r in results]}
    except Exception as exc:
        logger.exception("scan_all_skills failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/scan-status")
async def scan_status():
    """Return cached scan status for all skills."""
    try:
        instance = await get_default_instance()
    except HTTPException:
        instance = None
    if instance and instance.platform != "openclaw":
        return {
            "results": {},
            "unavailable": True,
            "reason": "Skill scanning is currently only available for OpenClaw runtimes.",
        }
    return {"results": skill_scan_service.get_all_cached(), "unavailable": False}


@router.post("/{skill_key}/update")
async def update_skill(skill_key: str, body: SkillUpdateRequest):
    """Update skill configuration in openclaw.json."""
    config = _read_config()
    skills = config.setdefault("skills", {})
    entry = skills.setdefault(skill_key, {})

    if body.enabled is not None:
        entry["enabled"] = body.enabled
    if body.api_key is not None:
        entry["apiKey"] = body.api_key
    if body.env is not None:
        entry["env"] = body.env

    _write_config(config)
    return {"success": True, "skill": skill_key, "config": entry}


@router.get("/{skill_key}/content")
async def get_skill_content(skill_key: str):
    """Read and return SKILL.md content for a skill."""
    skill_paths = _build_skill_paths()
    skill_dir = skill_paths.get(skill_key)
    if not skill_dir:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_key}' not found")

    skill_md = Path(skill_dir) / "SKILL.md"
    if not skill_md.exists():
        raise HTTPException(status_code=404, detail=f"SKILL.md not found for '{skill_key}'")

    try:
        content = skill_md.read_text("utf-8")
        stat = skill_md.stat()
        return {
            "key": skill_key,
            "content": content,
            "path": str(skill_md),
            "sizeBytes": stat.st_size,
            "modifiedAt": stat.st_mtime,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read SKILL.md: {exc}")


@router.post("/{skill_key}/scan")
async def scan_skill(skill_key: str, body: ScanOneRequest):
    """Scan a single skill."""
    skill_paths = _build_skill_paths()
    skill_dir = skill_paths.get(skill_key)
    if not skill_dir:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_key}' not found")

    try:
        md_path = str(Path(skill_dir) / "SKILL.md")
        result = await skill_scan_service.scan_skill(skill_key, md_path, force=body.force)
        return result.to_dict()
    except Exception as exc:
        logger.exception("scan_skill failed for %s", skill_key)
        raise HTTPException(status_code=500, detail=str(exc))
