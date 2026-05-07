"""Agent skills / tools management API (OpenClaw + Hermes)."""

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

from ...config import settings
from ...runtime import RuntimeInstance
from ...services import skill_scan_service
from ..runtime_helpers import get_default_instance, get_instance

logger = logging.getLogger(__name__)

router = APIRouter()

_OPENCLAW_DIR = Path.home() / ".openclaw"
_HERMES_DIR = settings.hermes_home
_SKILL_SCAN_PLATFORMS = {"openclaw", "hermes", "nanobot"}
_NANOBOT_BUILTIN_SKILLS = [
    {
        "key": "deep-research",
        "name": "deep-research",
        "description": "Built-in Nanobot workflow for comprehensive multi-source research.",
    },
    {
        "key": "python-scripts",
        "name": "python-scripts",
        "description": "Built-in Nanobot workflow for Python script tasks.",
    },
    {
        "key": "workflows",
        "name": "workflows",
        "description": "Built-in Nanobot multi-step workflow guidance.",
    },
    {
        "key": "mcp-curl",
        "name": "mcp-curl",
        "description": "Built-in Nanobot skill for MCP/curl request patterns.",
    },
]


def _is_hermes(instance: RuntimeInstance | None) -> bool:
    """True when the resolved runtime instance is Hermes."""
    return bool(instance and instance.platform == "hermes")


def _is_nanobot(instance: RuntimeInstance | None) -> bool:
    return bool(instance and instance.platform == "nanobot")


def _supports_skill_scan(instance: RuntimeInstance | None) -> bool:
    return bool(instance and instance.platform in _SKILL_SCAN_PLATFORMS)


def _cache_namespace(instance: RuntimeInstance | None) -> str | None:
    if _supports_skill_scan(instance):
        return str(instance.instance_id)
    return None


def _legacy_cache_namespaces(instance: RuntimeInstance | None) -> list[str]:
    if not instance:
        return []
    return [str(instance.platform)]


async def _resolve_skills_instance(instance_id: str | None) -> RuntimeInstance | None:
    if instance_id:
        return await get_instance(instance_id)
    return await get_default_instance()


def _config_path_for(instance: RuntimeInstance | None) -> Path:
    """Resolve the runtime config file for a given instance.

    OpenClaw → ``~/.openclaw/openclaw.json``
    Hermes   → ``settings.hermes_config_path`` (or ``instance.config_path``
               if discovery filled it in).
    """
    if instance and instance.config_path:
        return Path(instance.config_path).expanduser()
    if _is_hermes(instance):
        return Path(settings.hermes_config_path).expanduser()
    return _OPENCLAW_DIR / "openclaw.json"


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


def _find_hermes() -> str | None:
    """Find the hermes binary."""
    return shutil.which("hermes")


def _find_agent_binary(instance: RuntimeInstance | None) -> str | None:
    """Find the binary that backs the given runtime instance."""
    if _is_hermes(instance):
        return _find_hermes()
    return _find_openclaw()


def _read_config(instance: RuntimeInstance | None) -> dict:
    """Read and parse the runtime's config file (per-instance dispatch)."""
    config_path = _config_path_for(instance)
    if not config_path.exists():
        return {}
    try:
        raw = config_path.read_text("utf-8")
        if _is_hermes(instance):
            import yaml
            return yaml.safe_load(raw) or {}
        return json.loads(raw)
    except Exception:
        return {}


def _write_config(instance: RuntimeInstance | None, config: dict) -> None:
    """Write config dict to the runtime's config file (per-instance dispatch)."""
    config_path = _config_path_for(instance)
    if _is_hermes(instance):
        import yaml
        _HERMES_DIR.mkdir(parents=True, exist_ok=True)
        tmp = config_path.with_suffix(".tmp")
        tmp.write_text(yaml.dump(config, allow_unicode=True, default_flow_style=False), encoding="utf-8")
        tmp.rename(config_path)
    else:
        _OPENCLAW_DIR.mkdir(parents=True, exist_ok=True)
        tmp = config_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.rename(config_path)


def _build_skill_paths(instance: RuntimeInstance | None) -> dict[str, str]:
    """Scan known directories to build a skill_name -> directory_path mapping."""
    skill_map: dict[str, str] = {}

    scan_bases: list[Path] = []

    if _is_nanobot(instance):
        config_path = Path(instance.config_path).expanduser() if instance and instance.config_path else None
        if config_path:
            skills_dir = config_path.parent / "skills"
            if skills_dir.is_dir():
                for skill_file in sorted(skills_dir.glob("*.md")):
                    skill_map[skill_file.stem] = str(skill_file)
        return skill_map
    if _is_hermes(instance):
        # Hermes: ~/.hermes/skills/
        scan_bases.append(_HERMES_DIR / "skills")
    else:
        # OpenClaw: ~/.openclaw/skills/ + extensions
        scan_bases.append(_OPENCLAW_DIR / "skills")
        ext_dir = _OPENCLAW_DIR / "extensions"
        if ext_dir.is_dir():
            for ext in ext_dir.iterdir():
                if ext.is_dir():
                    skills_sub = ext / "skills"
                    if skills_sub.is_dir():
                        scan_bases.append(skills_sub)

        openclaw_bin = _find_openclaw()
        if openclaw_bin:
            bin_path = Path(openclaw_bin).resolve()
            pkg_root = bin_path.parent
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


def _skill_markdown_path(skill_path: str) -> Path:
    base = Path(skill_path)
    if base.is_file():
        return base
    return base / "SKILL.md"


def _nanobot_skill_frontmatter(skill_md: Path) -> tuple[str, str]:
    skill_name = skill_md.stem
    skill_desc = ""
    try:
        raw = skill_md.read_text("utf-8")
        if raw.startswith("---"):
            parts = raw.split("---", 2)
            if len(parts) >= 3:
                import yaml

                frontmatter = yaml.safe_load(parts[1]) or {}
                if isinstance(frontmatter, dict):
                    skill_name = str(frontmatter.get("name") or skill_name)
                    skill_desc = str(frontmatter.get("description") or "")
    except Exception:
        pass
    return skill_name, skill_desc


def _build_nanobot_skills(skill_paths: dict[str, str]) -> list[dict]:
    skills: list[dict] = []
    for key, raw_path in sorted(skill_paths.items()):
        md_path = Path(raw_path)
        name, desc = _nanobot_skill_frontmatter(md_path)
        skills.append(
            {
                "key": key,
                "name": name,
                "description": desc,
                "emoji": "🧩",
                "eligible": True,
                "disabled": False,
                "source": "nanobot:user",
                "bundled": False,
            }
        )
    existing_keys = {str(item.get("key") or item.get("name") or "") for item in skills}
    for builtin in _NANOBOT_BUILTIN_SKILLS:
        if builtin["key"] in existing_keys:
            continue
        skills.append(
            {
                "key": builtin["key"],
                "name": builtin["name"],
                "description": builtin["description"],
                "emoji": "🧠",
                "eligible": True,
                "disabled": False,
                "source": "nanobot:built-in",
                "bundled": True,
            }
        )
    return skills


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
async def list_skills(instance_id: str | None = None):
    """List skills/tools via agent CLI and enrich with config / scan data."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    skill_paths = _build_skill_paths(instance)
    if _is_nanobot(instance):
        skills_list = _build_nanobot_skills(skill_paths)
    else:
        agent_bin = _find_agent_binary(instance)
        if not agent_bin:
            platform_name = "hermes" if _is_hermes(instance) else "openclaw"
            raise HTTPException(status_code=500, detail=f"{platform_name} binary not found")

        env = _build_env()

        # Hermes: ``hermes tools list --json`` / OpenClaw: ``openclaw skills list --json``
        if _is_hermes(instance):
            cmd = [agent_bin, "tools", "list", "--json"]
        else:
            cmd = [agent_bin, "skills", "list", "--json"]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Failed to run agent CLI: {exc}")

        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"skills list failed (exit {result.returncode}): {result.stderr}",
            )

        try:
            raw = result.stdout
            data = _extract_json(raw)
        except (json.JSONDecodeError, ValueError) as exc:
            raise HTTPException(status_code=500, detail=f"Invalid JSON from agent CLI: {exc}")
        skills_list = data.get("skills", []) if isinstance(data, dict) else data

    config = _read_config(instance)
    skills_config = config.get("skills", {})
    cached_scans = skill_scan_service.get_all_cached()

    namespace = _cache_namespace(instance)
    legacy_namespaces = _legacy_cache_namespaces(instance)
    for skill in skills_list:
        key = skill.get("key") or skill.get("name", "")
        skill_cfg = skills_config.get(key, {})

        skill["configEnabled"] = skill_cfg.get("enabled", True)
        skill["hasApiKey"] = bool(skill_cfg.get("apiKey"))
        skill["configEnv"] = skill_cfg.get("env", {})
        skill["path"] = skill_paths.get(key, "")

        scan_entry = None
        if namespace:
            scan_entry = cached_scans.get(f"{namespace}:{key}")
        if not scan_entry:
            for legacy in legacy_namespaces:
                scan_entry = cached_scans.get(f"{legacy}:{key}")
                if scan_entry:
                    break
        if not scan_entry:
            scan_entry = cached_scans.get(key)
        if scan_entry:
            skill_raw_path = skill_paths.get(key)
            if skill_raw_path:
                current_hash = _file_sha256(_skill_markdown_path(skill_raw_path))
                scanned_hash = scan_entry.get("fileHash", "") or scan_entry.get("file_hash", "")
                if current_hash and scanned_hash and current_hash != scanned_hash:
                    scan_entry = {**scan_entry, "status": "outdated"}
            skill["scanStatus"] = scan_entry

    return {"skills": skills_list, "unavailable": False}


@router.get("/check")
async def check_skills(instance_id: str | None = None):
    """Check skill/tool eligibility via agent CLI."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    if _is_nanobot(instance):
        return {
            "checks": [],
            "unavailable": False,
        }
    agent_bin = _find_agent_binary(instance)
    if not agent_bin:
        platform_name = "hermes" if _is_hermes(instance) else "openclaw"
        raise HTTPException(status_code=500, detail=f"{platform_name} binary not found")

    env = _build_env()

    if _is_hermes(instance):
        cmd = [agent_bin, "tools", "check", "--json"]
    else:
        cmd = [agent_bin, "skills", "check", "--json"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, env=env)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to run agent CLI: {exc}")

    try:
        raw = result.stdout
        return _extract_json(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f"Invalid JSON from agent CLI: {exc}")


@router.post("/scan-all")
async def scan_all_skills(body: ScanAllRequest, instance_id: str | None = None):
    """Trigger security scan on all (or selected) skills."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    if not _supports_skill_scan(instance):
        return {
            "results": [],
            "unavailable": True,
            "reason": "Skill scanning is currently only available for discovered runtime instances.",
        }
    skill_paths = _build_skill_paths(instance)
    if body.keys:
        skill_paths = {k: v for k, v in skill_paths.items() if k in body.keys}
    if not skill_paths:
        return {"results": [], "error": "No matching skills found"}
    try:
        results = await skill_scan_service.scan_all_skills(
            skill_paths=skill_paths,
            force=body.force,
            cache_namespace=_cache_namespace(instance),
            legacy_cache_namespaces=_legacy_cache_namespaces(instance),
        )
        return {"results": [r.to_dict() for r in results]}
    except Exception as exc:
        logger.exception("scan_all_skills failed")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/scan-status")
async def scan_status(instance_id: str | None = None):
    """Return cached scan status for all skills."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    if not _supports_skill_scan(instance):
        return {
            "results": {},
            "unavailable": True,
            "reason": "Skill scanning is currently only available for discovered runtime instances.",
        }
    return {"results": skill_scan_service.get_all_cached(), "unavailable": False}


@router.post("/{skill_key}/update")
async def update_skill(skill_key: str, body: SkillUpdateRequest, instance_id: str | None = None):
    """Update skill configuration in platform config file."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    if _is_nanobot(instance):
        raise HTTPException(
            status_code=501,
            detail="Nanobot skill config update is not supported yet in XSafeClaw.",
        )
    config = _read_config(instance)
    skills = config.setdefault("skills", {})
    entry = skills.setdefault(skill_key, {})

    if body.enabled is not None:
        entry["enabled"] = body.enabled
    if body.api_key is not None:
        entry["apiKey"] = body.api_key
    if body.env is not None:
        entry["env"] = body.env

    _write_config(instance, config)
    return {"success": True, "skill": skill_key, "config": entry}


@router.get("/{skill_key}/content")
async def get_skill_content(skill_key: str, instance_id: str | None = None):
    """Read and return SKILL.md content for a skill."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    skill_paths = _build_skill_paths(instance)
    skill_path = skill_paths.get(skill_key)
    if not skill_path:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_key}' not found")

    skill_md = _skill_markdown_path(skill_path)
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
async def scan_skill(skill_key: str, body: ScanOneRequest, instance_id: str | None = None):
    """Scan a single skill."""
    try:
        instance = await _resolve_skills_instance(instance_id)
    except HTTPException:
        instance = None
    skill_paths = _build_skill_paths(instance)
    skill_path = skill_paths.get(skill_key)
    if not skill_path:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_key}' not found")

    try:
        md_path = str(_skill_markdown_path(skill_path))
        result = await skill_scan_service.scan_skill(
            skill_key,
            md_path,
            force=body.force,
            cache_namespace=_cache_namespace(instance),
            legacy_cache_namespaces=_legacy_cache_namespaces(instance),
        )
        return result.to_dict()
    except Exception as exc:
        logger.exception("scan_skill failed for %s", skill_key)
        raise HTTPException(status_code=500, detail=str(exc))
