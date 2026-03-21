"""System management API – OpenClaw install / onboard / status."""

from __future__ import annotations

import asyncio
import fcntl
import json
import os
import re
import select as _select
import shutil
import struct
import termios
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

router = APIRouter()

# ---------------------------------------------------------------------------
# PTY-based process registry for interactive (onboard) steps
# { proc_id: {"proc": Process, "master_fd": int, "queue": Queue, "done": bool} }
# ---------------------------------------------------------------------------
_procs: dict[str, dict] = {}

# ── ANSI helpers ─────────────────────────────────────────────────────────────
_ANSI_RE = re.compile(
    r'\x1b(?:'
    r'[@-Z\\-_]'                       # Fe sequences (ESC @, ESC [, etc.)
    r'|\[[\x20-\x3f]*[\x40-\x7e]'      # CSI sequences  – handles ?25l, >0h …
    r'|\][^\x07\x1b]*(?:\x07|\x1b\\)'  # OSC sequences
    r'|\([AB012]'                       # Charset selection
    r')'
)

def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub('', text)

def _is_text_prompt(text: str) -> bool:
    """True when the line (inside a prompt box) looks like a text-input cursor."""
    lower = text.lower()
    text_kw = ['token', 'api key', 'api-key', 'paste', 'email',
               'username', 'password', 'enter your']
    return '›' in text or (
        any(k in lower for k in text_kw) and (
            text.endswith('?') or text.endswith(':')
        )
    )

def _is_text_input_question(text: str) -> bool:
    """
    True when a ◆/◇ question header is asking for text input.
    Catches patterns like "Enter Moonshot API key (.cn)", "Enter token", etc.
    – no ending punctuation required.
    """
    lower = text.lower()
    # "Enter <something>" pattern is always a text input request
    if lower.startswith('enter '):
        return True
    # Keyword anywhere in the question (no ending char needed)
    text_kw = ['api key', 'api-key', 'token', 'password',
               'secret', 'email', 'username', 'access key']
    return any(k in lower for k in text_kw)

# ── nvm / node helpers ────────────────────────────────────────────────────────
_NVM_SCRIPT = Path.home() / ".nvm" / "nvm.sh"

def _build_env() -> dict:
    """Build an env dict that includes nvm Node 22 bin directory if available."""
    env = {**os.environ, "CI": "true", "NO_COLOR": "1"}
    nvm_node22 = Path.home() / ".nvm" / "versions" / "node"
    if nvm_node22.exists():
        v22_dirs = sorted(
            [d for d in nvm_node22.iterdir() if d.name.startswith("v22")],
            reverse=True,
        )
        if v22_dirs:
            v22_bin = str(v22_dirs[0] / "bin")
            current_path = env.get("PATH", "")
            if v22_bin not in current_path:
                env["PATH"] = v22_bin + ":" + current_path
    return env

def _find_openclaw() -> Optional[str]:
    """Locate the openclaw binary, checking nvm Node 22 paths first."""
    env = _build_env()
    for d in env.get("PATH", "").split(":"):
        candidate = Path(d) / "openclaw"
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which("openclaw")

def _find_node_version() -> str:
    """Return the currently accessible Node.js version string."""
    import subprocess
    env = _build_env()
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True, text=True, timeout=5, env=env,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


# ──────────────────────────────────────────────
# Status
# ──────────────────────────────────────────────

@router.get("/status")
async def get_system_status():
    """Check whether openclaw CLI is installed and whether its daemon is running."""
    env = _build_env()
    openclaw_path = _find_openclaw()

    if not openclaw_path:
        return {
            "openclaw_installed": False,
            "openclaw_version": None,
            "daemon_running": False,
            "openclaw_path": None,
            "node_version": _find_node_version(),
            "config_exists": _CONFIG_PATH.exists(),
        }

    # Get version
    version: Optional[str] = None
    try:
        proc = await asyncio.create_subprocess_exec(
            openclaw_path, "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
        raw = (stdout or stderr).decode().strip()
        version = raw.splitlines()[0] if raw else "unknown"
        if "requires Node" in version or "Upgrade Node" in version:
            return {
                "openclaw_installed": False,
                "openclaw_version": None,
                "daemon_running": False,
                "openclaw_path": None,
                "node_version": _find_node_version(),
                "config_exists": _CONFIG_PATH.exists(),
                "error": "node_version_too_low",
            }
    except Exception:
        version = "unknown"

    # Check daemon
    daemon_running = False
    try:
        proc2 = await asyncio.create_subprocess_exec(
            openclaw_path, "status",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        await asyncio.wait_for(proc2.communicate(), timeout=5)
        daemon_running = proc2.returncode == 0
    except Exception:
        pass

    return {
        "openclaw_installed": True,
        "openclaw_version": version,
        "daemon_running": daemon_running,
        "openclaw_path": openclaw_path,
        "node_version": _find_node_version(),
        "config_exists": _CONFIG_PATH.exists(),
    }


# ──────────────────────────────────────────────
# Install  (npm install -g openclaw@latest)
# ──────────────────────────────────────────────

import platform as _platform
import tempfile

_NODE_INSTALL_DIR = Path.home() / ".xsafeclaw" / "node"
_NODE_DIST_INDEX = "https://nodejs.org/dist/index.json"


def _find_npm(env: dict) -> Optional[str]:
    """Locate npm binary using the given environment."""
    sep = ";" if os.name == "nt" else ":"
    for d in env.get("PATH", "").split(sep):
        candidate = Path(d) / ("npm.cmd" if os.name == "nt" else "npm")
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return shutil.which("npm")


def _node_platform_arch() -> tuple[str, str]:
    """Return (node_platform, node_arch) for download URL."""
    system = _platform.system().lower()
    machine = _platform.machine().lower()
    if system == "darwin":
        plat = "darwin"
    elif system == "windows":
        plat = "win"
    else:
        plat = "linux"
    arch_map = {
        "x86_64": "x64", "amd64": "x64",
        "aarch64": "arm64", "arm64": "arm64",
        "armv7l": "armv7l",
    }
    arch = arch_map.get(machine, "x64")
    return plat, arch


async def _resolve_node_lts_version() -> str:
    """Fetch latest LTS version string from nodejs.org (e.g. 'v22.22.0')."""
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(_NODE_DIST_INDEX)
        resp.raise_for_status()
        for entry in resp.json():
            if entry.get("lts"):
                return entry["version"]
    raise RuntimeError("Could not resolve Node.js LTS version")


async def _download_with_progress(url: str, dest: Path):
    """Download a file and yield (downloaded_bytes, total_bytes) tuples."""
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    f.write(chunk)
                    downloaded += len(chunk)
                    yield downloaded, total


async def _install_node(env: dict):
    """Download and extract Node.js to ~/.xsafeclaw/node/. Yields SSE data lines."""
    plat, arch = _node_platform_arch()

    yield f"data: {json.dumps({'type': 'node_status', 'step': 'resolving'})}\n\n"
    try:
        version = await _resolve_node_lts_version()
    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to resolve Node.js version: {exc}'})}\n\n"
        return
    yield f"data: {json.dumps({'type': 'output', 'text': f'Latest Node.js LTS: {version}'})}\n\n"

    if plat == "win":
        ext = "zip"
        archive_name = f"node-{version}-{plat}-{arch}.{ext}"
    else:
        ext = "tar.xz"
        archive_name = f"node-{version}-{plat}-{arch}.{ext}"

    url = f"https://nodejs.org/dist/{version}/{archive_name}"
    yield f"data: {json.dumps({'type': 'node_status', 'step': 'downloading', 'url': url, 'version': version})}\n\n"

    tmp_dir = Path(tempfile.mkdtemp(prefix="xsafeclaw-node-"))
    archive_path = tmp_dir / archive_name

    try:
        last_pct = -1
        async for downloaded, total in _download_with_progress(url, archive_path):
            if total > 0:
                pct = int(downloaded * 100 / total)
                if pct != last_pct and (pct % 5 == 0 or pct == 100):
                    mb_down = downloaded / 1048576
                    mb_total = total / 1048576
                    yield f"data: {json.dumps({'type': 'node_progress', 'downloaded': downloaded, 'total': total, 'percent': pct, 'text': f'Downloading Node.js {version}... {mb_down:.1f} / {mb_total:.1f} MB ({pct}%)'})}\n\n"
                    last_pct = pct

        yield f"data: {json.dumps({'type': 'output', 'text': 'Download complete. Extracting...'})}\n\n"
        yield f"data: {json.dumps({'type': 'node_status', 'step': 'extracting'})}\n\n"

        _NODE_INSTALL_DIR.parent.mkdir(parents=True, exist_ok=True)
        if _NODE_INSTALL_DIR.exists():
            shutil.rmtree(str(_NODE_INSTALL_DIR))

        if plat == "win":
            import zipfile
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(tmp_dir)
            extracted = tmp_dir / archive_name.replace(".zip", "")
            extracted.rename(_NODE_INSTALL_DIR)
        else:
            import tarfile
            with tarfile.open(archive_path) as tf:
                tf.extractall(tmp_dir)
            extracted = tmp_dir / archive_name.replace(".tar.xz", "")
            extracted.rename(_NODE_INSTALL_DIR)

        if plat == "win":
            node_bin = str(_NODE_INSTALL_DIR)
        else:
            node_bin = str(_NODE_INSTALL_DIR / "bin")

        env["PATH"] = node_bin + (";" if os.name == "nt" else ":") + env.get("PATH", "")

        yield f"data: {json.dumps({'type': 'output', 'text': f'Node.js {version} installed to {_NODE_INSTALL_DIR}'})}\n\n"
        yield f"data: {json.dumps({'type': 'node_status', 'step': 'done', 'version': version})}\n\n"

    except Exception as exc:
        yield f"data: {json.dumps({'type': 'error', 'message': f'Failed to install Node.js: {exc}'})}\n\n"
    finally:
        shutil.rmtree(str(tmp_dir), ignore_errors=True)


@router.post("/install")
async def install_openclaw():
    """Auto-install Node.js if npm is missing, then install openclaw via npm. Streams SSE."""
    env = _build_env()

    # Pre-check: if we previously installed Node.js, add it to PATH
    if _NODE_INSTALL_DIR.exists():
        plat, _ = _node_platform_arch()
        node_bin = str(_NODE_INSTALL_DIR) if plat == "win" else str(_NODE_INSTALL_DIR / "bin")
        env["PATH"] = node_bin + (";" if os.name == "nt" else ":") + env.get("PATH", "")

    async def generate():
        npm_path = _find_npm(env)

        if not npm_path:
            yield f"data: {json.dumps({'type': 'output', 'text': 'npm not found. Installing Node.js automatically...'})}\n\n"
            async for line in _install_node(env):
                yield line
                if '"type": "error"' in line:
                    return

            npm_path = _find_npm(env)
            if not npm_path:
                yield f"data: {json.dumps({'type': 'error', 'message': 'npm still not found after Node.js install. Please install Node.js manually.'})}\n\n"
                return

        # Force git to use HTTPS instead of SSH/git:// (avoids protocol blocks)
        env["GIT_CONFIG_COUNT"] = "2"
        env["GIT_CONFIG_KEY_0"] = "url.https://github.com/.insteadOf"
        env["GIT_CONFIG_VALUE_0"] = "git@github.com:"
        env["GIT_CONFIG_KEY_1"] = "url.https://.insteadOf"
        env["GIT_CONFIG_VALUE_1"] = "git://"

        yield f"data: {json.dumps({'type': 'output', 'text': 'Running: npm install -g openclaw@latest'})}\n\n"
        yield f"data: {json.dumps({'type': 'npm_install_start'})}\n\n"

        try:
            proc = await asyncio.create_subprocess_exec(
                npm_path, "install", "-g", "openclaw@latest",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                stdin=asyncio.subprocess.DEVNULL,
                env=env,
            )
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                yield f"data: {json.dumps({'type': 'output', 'text': text})}\n\n"
            await proc.wait()
            if proc.returncode == 0:
                yield f"data: {json.dumps({'type': 'done', 'success': True})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'done', 'success': False, 'exit_code': proc.returncode})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────
# Config reset
# ──────────────────────────────────────────────

class ConfigResetRequest(BaseModel):
    scope: str = "config"
    workspace: str = "~/.openclaw/workspace"


@router.post("/config-reset")
async def config_reset(body: ConfigResetRequest):
    """Reset OpenClaw configuration. Mirrors the source's handleReset logic."""
    deleted: list[str] = []

    if _CONFIG_PATH.exists():
        _CONFIG_PATH.unlink()
        deleted.append(str(_CONFIG_PATH))

    if body.scope in ("config+creds+sessions", "full"):
        for p in [
            _OPENCLAW_DIR / "credentials",
            _OPENCLAW_DIR / "agents" / "main" / "sessions",
        ]:
            if p.exists():
                shutil.rmtree(str(p))
                deleted.append(str(p))
        auth_p = _OPENCLAW_DIR / "agents" / "main" / "agent" / "auth-profiles.json"
        if auth_p.exists():
            auth_p.unlink()
            deleted.append(str(auth_p))

    if body.scope == "full":
        wp = Path(body.workspace).expanduser()
        if wp.exists():
            shutil.rmtree(str(wp))
            deleted.append(str(wp))

    return {"success": True, "deleted": deleted}


# ──────────────────────────────────────────────
# Onboard  (openclaw onboard --install-daemon)
# Uses a PTY so @clack/prompts gets a real TTY
# ──────────────────────────────────────────────

class OnboardStartResponse(BaseModel):
    proc_id: str


@router.post("/onboard/start", response_model=OnboardStartResponse)
async def onboard_start():
    """
    Launch  `openclaw onboard --install-daemon`  via a PTY so that interactive
    TUI prompts (e.g. @clack/prompts) work properly.

    Returns a proc_id.
      GET /onboard/{proc_id}/stream  → SSE stream of output
      POST /onboard/{proc_id}/input  → send a keystroke / text to the process
    """
    proc_id = str(uuid.uuid4())
    env = _build_env()
    openclaw_path = _find_openclaw() or "openclaw"

    # ── Create PTY pair ───────────────────────────────────────────────────
    master_fd, slave_fd = os.openpty()
    # Give the terminal a generous size so clack doesn't wrap strangely
    fcntl.ioctl(slave_fd, termios.TIOCSWINSZ,
                struct.pack("HHHH", 50, 220, 0, 0))

    proc = await asyncio.create_subprocess_exec(
        openclaw_path, "onboard", "--install-daemon",
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=env,
        close_fds=True,
    )
    os.close(slave_fd)  # parent no longer needs the slave end

    queue: asyncio.Queue = asyncio.Queue()
    _procs[proc_id] = {
        "proc":      proc,
        "master_fd": master_fd,
        "queue":     queue,
        "done":      False,
    }

    # ── Background reader: state-machine that classifies @clack/prompts output ──
    #
    # @clack/prompts renders ALL interactive prompts with the same box-drawing
    # pattern, so one generic state machine handles every prompt type:
    #
    #  ◆/◇  Question text           → save question, emit output
    #  │   ○ Yes / ● No             → prompt_confirm  (Yes/No on same line)
    #  │   ● Option A               → accumulate option (select prompt)
    #  │   ○ Option B               → accumulate option
    #  │   ›  _                     → prompt_text      (free-text input)
    #  └                            → flush pending select → prompt_select
    #
    # The frontend only needs to handle three event types:
    #   prompt_confirm  → Yes / No buttons
    #   prompt_select   → radio-button list
    #   prompt_text     → text input box
    #
    async def _reader():
        loop = asyncio.get_event_loop()
        buf            = ""
        last_question  = ""          # ◆/◇ question text
        last_confirm_q = ""          # last confirm prompt sent, to avoid duplicates
        pending_opts: list[dict] = []  # accumulated options for select/multiselect
        pending_type   = "prompt_select"    # "prompt_select" | "prompt_multiselect"
        saw_multiselect = False      # True if any ◻/□ option was seen for current question

        def _flush_select():
            nonlocal pending_opts, pending_type, saw_multiselect
            if pending_opts:
                actual_type = "prompt_multiselect" if saw_multiselect else pending_type
                queue.put_nowait(json.dumps({
                    "type":    actual_type,
                    "text":    last_question,
                    "options": pending_opts,
                }))
                pending_opts = []
                saw_multiselect = False

        def _process_line(raw_line: str):
            nonlocal last_question, last_confirm_q, pending_opts, saw_multiselect
            line = raw_line.strip()
            if not line:
                return
            lower = line.lower()

            # ── Split merged lines (clack sometimes outputs "│  ● Yes / ○ No◇  Question") ──
            # If a ◆/◇ appears mid-line, split and process each part separately.
            split_match = re.search(r'(?<=\S)[◆◇]', line)
            if split_match:
                _process_line(line[:split_match.start()])
                _process_line(line[split_match.start():])
                return

            lower = line.lower()

            # ── ◆/◇  prompt question header ──────────────────────────────
            if line[0] in "◆◇":
                _flush_select()
                saw_multiselect = False
                q = re.sub(r"^[◆◇\s│]+", "", line).strip()
                if q:
                    last_question = q
                # Always emit the line as output (shows in terminal log)
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                # If the question itself is asking for text input
                # (e.g. "Enter Moonshot API key (.cn)"), emit prompt_text now
                # so the frontend shows the input box immediately.
                if q and _is_text_input_question(q):
                    queue.put_nowait(json.dumps({
                        "type": "prompt_text",
                        "text": q,
                    }))
                return
            if line.startswith("└"):
                _flush_select()
                # Don't emit the box-drawing character
                return

            # ── "? question" — clack NO_COLOR fallback rendering ────────
            # When NO_COLOR=1, clack renders "? Question text" without ◆
            # 注意：不要在这里调 _flush_select()，避免打断正在积累的选项
            if re.match(r"^\?\s+\S", line):
                q = re.sub(r"^\?\s*", "", line).strip()
                if q:
                    last_question = q
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                if q and _is_text_input_question(q):
                    queue.put_nowait(json.dumps({"type": "prompt_text", "text": q}))
                # 不在这里发 prompt_confirm，confirm 由 "○ Yes / ● No" 模式处理
                return

            # ── Lines inside the prompt box (start with │ or ├) ─────────
            content = re.sub(r"^[│├]\s*", "", line).strip()

            # confirm: "○ Yes / ● No"  (both options on ONE line with " / ")
            if (
                ("○" in content or "●" in content)
                and "yes" in lower and "no" in lower
                and "/" in content
            ):
                _flush_select()
                # Detect which option is currently highlighted (●)
                # Pattern: "● Yes / ○ No" → yes_selected=True
                #          "○ Yes / ● No" → yes_selected=False
                yes_selected = bool(re.search(r"●\s*yes", content, re.IGNORECASE))
                confirm_text = last_question or content
                if confirm_text != last_confirm_q:
                    last_confirm_q = confirm_text
                    queue.put_nowait(json.dumps({
                        "type": "prompt_confirm",
                        "text": confirm_text,
                        "yes_default": yes_selected,
                    }))
                return

            # single-select option: ○ or ● (not the Yes/No pair on one line)
            if re.match(r"^[○●]\s+\S", content):
                is_selected = content.startswith("●")
                label = re.sub(r"^[○●]\s+", "", content).strip()
                if label:
                    pending_type = "prompt_select"
                    pending_opts.append({"label": label, "selected": is_selected})
                return

            # multi-select option: □/☐/◻ (unselected) or ■/◼/▪/☑ (selected)
            if content and content[0] not in "○●" and re.match(r"^[□■▪▸☐◻◼☑☒▢▣⬜⬛]\s*\S", content):
                is_checked = content[0] in "■▪◼☑"
                label = re.sub(r"^[□■▪▸☐◻◼☑☒▢▣⬜⬛]\s*", "", content).strip()
                if label:
                    pending_type = "prompt_multiselect"
                    saw_multiselect = True
                    pending_opts.append({"label": label, "selected": is_checked})
                return

            # text-input prompt: clack uses "›" as the cursor
            if content.startswith("›") or _is_text_prompt(content):
                _flush_select()
                queue.put_nowait(json.dumps({
                    "type": "prompt_text",
                    "text": last_question or content,
                }))
                return

            # fallback: bare lines (no box chars) that ask for text input
            # e.g. clack outputs "Enter Moonshot API key (.cn)" without ◆ prefix
            if _is_text_input_question(content or line):
                _flush_select()
                if content or line != last_question:  # avoid duplicate prompt
                    last_question = content or line
                queue.put_nowait(json.dumps({"type": "output", "text": line}))
                queue.put_nowait(json.dumps({
                    "type": "prompt_text",
                    "text": content or line,
                }))
                return

            # everything else inside box → regular output
            if content:
                queue.put_nowait(json.dumps({"type": "output", "text": line}))

        # ── Dedicated reader thread ───────────────────────────────────────
        # Runs blocking os.read() in its own daemon thread (not the asyncio
        # thread pool), uses select() with a 0.5 s timeout so it never hangs,
        # and forwards raw bytes to the asyncio coroutine via call_soon_threadsafe.
        loop      = asyncio.get_event_loop()
        raw_queue: asyncio.Queue = asyncio.Queue()
        stop_evt  = threading.Event()

        def _pty_reader_thread():
            try:
                while not stop_evt.is_set():
                    try:
                        r, _, _ = _select.select([master_fd], [], [master_fd], 0.5)
                    except (OSError, ValueError):
                        break
                    if r:
                        try:
                            data = os.read(master_fd, 4096)
                            loop.call_soon_threadsafe(raw_queue.put_nowait, data)
                        except OSError:
                            break
                    elif proc.returncode is not None:
                        break
            finally:
                loop.call_soon_threadsafe(raw_queue.put_nowait, None)  # sentinel

        threading.Thread(target=_pty_reader_thread, daemon=True).start()

        try:
            while True:
                try:
                    data = await asyncio.wait_for(raw_queue.get(), timeout=2.0)
                except asyncio.TimeoutError:
                    # 2秒没新数据，选项肯定到齐了，flush
                    if pending_opts:
                        _flush_select()
                    continue
                if data is None:
                    break

                text = _strip_ansi(data.decode("utf-8", errors="replace"))
                buf += text

                # 处理完整行
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    _process_line(line)

                # 处理没有换行符的 partial line（选项行、└）
                s = buf.strip()
                if s and (
                    s.startswith("└")
                    or re.match(r"^[│├]?\s*[□■▪◻◼☐☑]", s)
                ):
                    _process_line(s)
                    buf = ""

        except Exception as exc:
            queue.put_nowait(json.dumps({"type": "error", "message": str(exc)}))
        finally:
            stop_evt.set()
            if buf.strip():
                _process_line(buf.strip())
            _flush_select()
            await proc.wait()
            try:
                os.close(master_fd)
            except OSError:
                pass
            _procs[proc_id]["done"] = True
            queue.put_nowait(json.dumps({
                "type":      "done",
                "success":   proc.returncode == 0,
                "exit_code": proc.returncode,
            }))

    asyncio.create_task(_reader())
    return OnboardStartResponse(proc_id=proc_id)


@router.get("/onboard/{proc_id}/stream")
async def onboard_stream(proc_id: str):
    """SSE stream of classified onboard process output."""
    if proc_id not in _procs:
        raise HTTPException(status_code=404, detail="Process not found")

    entry = _procs[proc_id]

    async def generate():
        while True:
            try:
                msg = await asyncio.wait_for(entry["queue"].get(), timeout=1.0)
                yield f"data: {msg}\n\n"
                parsed = json.loads(msg)
                if parsed.get("type") in ("done", "error"):
                    _procs.pop(proc_id, None)
                    break
            except asyncio.TimeoutError:
                if entry.get("done"):
                    break
                yield ": keep-alive\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class OnboardInputRequest(BaseModel):
    """
    Generic PTY input request.

    Special keyword values (case-insensitive):
      YES          → b"y\\r"         confirm yes
      NO           → b"n\\r"         confirm no
      ENTER        → b"\\r"          press Enter (accept current selection)
      DOWN:N       → N×↓ + Enter     move down N options, then confirm
      UP:N         → N×↑ + Enter     move up N options, then confirm
    Anything else  → text + "\\r"    free-text input
    """
    text: str


_ARROW_DOWN = b"\x1b[B"
_ARROW_UP   = b"\x1b[A"


@router.post("/onboard/{proc_id}/input")
async def onboard_input(proc_id: str, body: OnboardInputRequest):
    if proc_id not in _procs:
        raise HTTPException(status_code=404, detail="Process not found")

    mfd = _procs[proc_id].get("master_fd")
    if mfd is None:
        raise HTTPException(status_code=400, detail="PTY not available")

    t     = body.text.strip()
    upper = t.upper()

    if upper == "YES":
        payload = b"y\r"
    elif upper == "NO":
        payload = b"n\r"
    elif upper == "ENTER":
        payload = b"\r"
    elif upper.startswith("DOWN:"):
        n = max(1, int(upper.split(":")[1]))
        payload = _ARROW_DOWN * n + b"\r"
    elif upper.startswith("UP:"):
        n = max(1, int(upper.split(":")[1]))
        payload = _ARROW_UP * n + b"\r"
    elif upper.startswith("MULTISELECT:"):
        # MULTISELECT:0,2,4  – navigate top-to-bottom, space-toggle selected indices
        raw_indices = upper[len("MULTISELECT:"):]
        selected = set(int(x) for x in raw_indices.split(",") if x.strip().isdigit()) if raw_indices.strip() else set()
        # Build sequence: for each row walk down from previous cursor pos, toggle if selected
        seq = b""
        prev = 0
        for idx in sorted(selected):
            downs = idx - prev
            if downs > 0:
                seq += _ARROW_DOWN * downs
            seq += b" "   # Space toggles current item
            prev = idx
        seq += b"\r"      # Enter to confirm
        payload = seq
    else:
        payload = (t + "\r").encode()

    try:
        os.write(mfd, payload)
        return {"ok": True, "sent": repr(payload)}
    except OSError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ──────────────────────────────────────────────
# Provider / Model registry
# ──────────────────────────────────────────────

PROVIDERS: list[dict] = [
    {
        "id": "moonshot",
        "name": "Moonshot AI (Kimi)",
        "baseUrl": "https://api.moonshot.cn/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.moonshot.cn/console/api-keys",
        "models": [
            {"id": "kimi-k2.5", "name": "Kimi K2.5", "reasoning": False},
            {"id": "moonshot-v1-auto", "name": "Moonshot V1 Auto", "reasoning": False},
        ],
    },
    {
        "id": "openai",
        "name": "OpenAI",
        "baseUrl": "https://api.openai.com/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.openai.com/api-keys",
        "models": [
            {"id": "gpt-4o", "name": "GPT-4o", "reasoning": False},
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini", "reasoning": False},
            {"id": "o3-mini", "name": "o3-mini", "reasoning": True},
        ],
    },
    {
        "id": "anthropic",
        "name": "Anthropic",
        "baseUrl": "https://api.anthropic.com",
        "api": "anthropic-messages",
        "keyUrl": "https://console.anthropic.com/settings/keys",
        "models": [
            {"id": "claude-sonnet-4-5-20250514", "name": "Claude Sonnet 4.5", "reasoning": False},
            {"id": "claude-opus-4-20250514", "name": "Claude Opus 4", "reasoning": False},
        ],
    },
    {
        "id": "google",
        "name": "Google AI",
        "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
        "api": "google-generative-ai",
        "keyUrl": "https://aistudio.google.com/apikey",
        "models": [
            {"id": "gemini-2.5-flash-preview-05-20", "name": "Gemini 2.5 Flash", "reasoning": False},
            {"id": "gemini-2.5-pro-preview-05-06", "name": "Gemini 2.5 Pro", "reasoning": True},
        ],
    },
    {
        "id": "minimax",
        "name": "MiniMax",
        "baseUrl": "https://api.minimax.chat/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
        "models": [
            {"id": "MiniMax-M1", "name": "MiniMax M1", "reasoning": True},
        ],
    },
    {
        "id": "qwen-portal",
        "name": "Qwen (Tongyi)",
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "keyUrl": "https://bailian.console.aliyun.com/?apiKey=1",
        "models": [
            {"id": "qwen-max", "name": "Qwen Max", "reasoning": False},
            {"id": "qwen-plus", "name": "Qwen Plus", "reasoning": False},
        ],
    },
    {
        "id": "deepseek",
        "name": "DeepSeek",
        "baseUrl": "https://api.deepseek.com/v1",
        "api": "openai-completions",
        "keyUrl": "https://platform.deepseek.com/api_keys",
        "models": [
            {"id": "deepseek-chat", "name": "DeepSeek V3", "reasoning": False},
            {"id": "deepseek-reasoner", "name": "DeepSeek R1", "reasoning": True},
        ],
    },
    {
        "id": "ollama",
        "name": "Ollama (Local)",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "keyUrl": "",
        "models": [
            {"id": "llama3.1", "name": "Llama 3.1", "reasoning": False},
            {"id": "qwen2.5", "name": "Qwen 2.5", "reasoning": False},
        ],
    },
    {
        "id": "openrouter",
        "name": "OpenRouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "api": "openai-completions",
        "keyUrl": "https://openrouter.ai/keys",
        "models": [
            {"id": "openai/gpt-4o", "name": "GPT-4o (via OpenRouter)", "reasoning": False},
            {"id": "anthropic/claude-sonnet-4-5", "name": "Claude Sonnet 4.5 (via OpenRouter)", "reasoning": False},
        ],
    },
]

AVAILABLE_HOOKS = [
    {"id": "session-memory", "name": "Session Memory", "description": "Save session context to memory on /new or /reset"},
    {"id": "boot-md", "name": "Boot MD", "description": "Execute BOOT.md on gateway startup"},
    {"id": "command-logger", "name": "Command Logger", "description": "Log all commands to ~/.openclaw/logs/commands.log"},
    {"id": "bootstrap-extra-files", "name": "Bootstrap Extra Files", "description": "Include extra files during agent bootstrap"},
]

AVAILABLE_CHANNELS = [
    {"id": "feishu", "name": "Feishu/Lark"},
    {"id": "telegram", "name": "Telegram (Bot API)"},
    {"id": "whatsapp", "name": "WhatsApp (QR link)"},
    {"id": "discord", "name": "Discord (Bot API)"},
    {"id": "slack", "name": "Slack (Socket Mode)"},
    {"id": "signal", "name": "Signal (signal-cli)"},
    {"id": "googlechat", "name": "Google Chat (Chat API)"},
    {"id": "imessage", "name": "iMessage (imsg)"},
    {"id": "irc", "name": "IRC (Server + Nick)"},
    {"id": "line", "name": "LINE (Messaging API)"},
    {"id": "nostr", "name": "Nostr (NIP-04 DMs)"},
    {"id": "msteams", "name": "Microsoft Teams (Bot Framework)"},
    {"id": "mattermost", "name": "Mattermost"},
    {"id": "nextcloud", "name": "Nextcloud Talk (self-hosted)"},
    {"id": "matrix", "name": "Matrix"},
    {"id": "bluebubbles", "name": "BlueBubbles (macOS app)"},
    {"id": "zalo-bot", "name": "Zalo (Bot API)"},
    {"id": "zalo-personal", "name": "Zalo (Personal Account)"},
    {"id": "synology", "name": "Synology Chat (Webhook)"},
    {"id": "tlon", "name": "Tlon (Urbit)"},
]

_OPENCLAW_DIR = Path.home() / ".openclaw"
_CONFIG_PATH = _OPENCLAW_DIR / "openclaw.json"

# Auth provider groups — 1:1 from OpenClaw auth-choice-options.ts AUTH_CHOICE_GROUP_DEFS.
# Only methods that have non-interactive CLI flags are included (OAuth-only excluded).
AUTH_PROVIDERS: list[dict] = [
    {"id": "anthropic", "name": "Anthropic", "hint": "API key", "supported": True, "methods": [
        {"id": "apiKey", "label": "Anthropic API key"},
    ]},
    {"id": "openai", "name": "OpenAI", "hint": "API key", "supported": True, "methods": [
        {"id": "openai-api-key", "label": "OpenAI API key"},
    ]},
    {"id": "moonshot", "name": "Moonshot AI (Kimi K2.5)", "hint": "Kimi K2.5 + Kimi Coding", "supported": True, "methods": [
        {"id": "moonshot-api-key", "label": "Kimi API key (.ai)", "hint": "International endpoint", "modelProviders": ["moonshot"]},
        {"id": "moonshot-api-key-cn", "label": "Kimi API key (.cn)", "hint": "China endpoint (中国区)", "modelProviders": ["moonshot"]},
        {"id": "kimi-code-api-key", "label": "Kimi Code API key (subscription)", "hint": "Code-optimized models", "modelProviders": ["kimi-coding"]},
    ]},
    {"id": "minimax", "name": "MiniMax", "hint": "M2.5 (recommended)", "supported": True, "methods": [
        {"id": "minimax-api", "label": "MiniMax M2.5 API key", "hint": "Global (api.minimax.io)", "modelProviders": ["minimax"]},
        {"id": "minimax-api-key-cn", "label": "MiniMax API key (China)", "hint": "China endpoint (api.minimaxi.com)", "modelProviders": ["minimax-cn"]},
        {"id": "minimax-api-lightning", "label": "MiniMax M2.5 Highspeed", "hint": "Low-latency variant", "modelProviders": ["minimax"]},
    ]},
    {"id": "google", "name": "Google", "hint": "Gemini API key", "supported": True, "methods": [
        {"id": "gemini-api-key", "label": "Gemini API key"},
    ]},
    {"id": "xai", "name": "xAI (Grok)", "hint": "API key", "supported": True, "methods": [
        {"id": "xai-api-key", "label": "xAI API key"},
    ]},
    {"id": "mistral", "name": "Mistral AI", "hint": "API key", "supported": True, "methods": [
        {"id": "mistral-api-key", "label": "Mistral API key"},
    ]},
    {"id": "volcengine", "name": "Volcano Engine", "hint": "API key", "supported": True, "methods": [
        {"id": "volcengine-api-key", "label": "Volcano Engine API key"},
    ]},
    {"id": "byteplus", "name": "BytePlus", "hint": "API key", "supported": True, "methods": [
        {"id": "byteplus-api-key", "label": "BytePlus API key"},
    ]},
    {"id": "openrouter", "name": "OpenRouter", "hint": "API key", "supported": True, "methods": [
        {"id": "openrouter-api-key", "label": "OpenRouter API key"},
    ]},
    {"id": "kilocode", "name": "Kilo Gateway", "hint": "API key (OpenRouter-compatible)", "supported": True, "methods": [
        {"id": "kilocode-api-key", "label": "Kilo Gateway API key"},
    ]},
    {"id": "zai", "name": "Z.AI", "hint": "GLM Coding Plan / Global / CN", "supported": True, "methods": [
        {"id": "zai-coding-global", "label": "Z.AI Coding (Global)", "hint": "api.z.ai coding endpoint"},
        {"id": "zai-coding-cn", "label": "Z.AI Coding (China)", "hint": "open.bigmodel.cn coding endpoint"},
        {"id": "zai-global", "label": "Z.AI (Global)", "hint": "api.z.ai standard endpoint"},
        {"id": "zai-cn", "label": "Z.AI (China)", "hint": "open.bigmodel.cn standard endpoint"},
    ]},
    {"id": "qianfan", "name": "Qianfan", "hint": "API key", "supported": True, "methods": [
        {"id": "qianfan-api-key", "label": "Qianfan API key"},
    ]},
    {"id": "modelstudio", "name": "Alibaba Cloud Model Studio", "hint": "Coding Plan API key (CN / Global)", "supported": True, "methods": [
        {"id": "modelstudio-api-key-cn", "label": "Coding Plan API key (China)", "hint": "Endpoint: coding.dashscope.aliyuncs.com", "modelProviders": ["modelstudio"]},
        {"id": "modelstudio-api-key", "label": "Coding Plan API key (Global)", "hint": "Endpoint: coding-intl.dashscope.aliyuncs.com", "modelProviders": ["modelstudio"]},
    ]},
    {"id": "ai-gateway", "name": "Vercel AI Gateway", "hint": "API key", "supported": True, "methods": [
        {"id": "ai-gateway-api-key", "label": "Vercel AI Gateway API key"},
    ]},
    {"id": "opencode", "name": "OpenCode", "hint": "Shared API key for Zen + Go catalogs", "supported": True, "methods": [
        {"id": "opencode-zen", "label": "OpenCode Zen catalog", "hint": "Claude, GPT, Gemini via opencode.ai/zen"},
        {"id": "opencode-go", "label": "OpenCode Go catalog", "hint": "Kimi/GLM/MiniMax Go catalog"},
    ]},
    {"id": "xiaomi", "name": "Xiaomi", "hint": "API key", "supported": True, "methods": [
        {"id": "xiaomi-api-key", "label": "Xiaomi API key"},
    ]},
    {"id": "synthetic", "name": "Synthetic", "hint": "Anthropic-compatible (multi-model)", "supported": True, "methods": [
        {"id": "synthetic-api-key", "label": "Synthetic API key"},
    ]},
    {"id": "together", "name": "Together AI", "hint": "API key", "supported": True, "methods": [
        {"id": "together-api-key", "label": "Together AI API key"},
    ]},
    {"id": "huggingface", "name": "Hugging Face", "hint": "Inference API (HF token)", "supported": True, "methods": [
        {"id": "huggingface-api-key", "label": "Hugging Face API key"},
    ]},
    {"id": "venice", "name": "Venice AI", "hint": "Privacy-focused (uncensored models)", "supported": True, "methods": [
        {"id": "venice-api-key", "label": "Venice API key"},
    ]},
    {"id": "litellm", "name": "LiteLLM", "hint": "Unified LLM gateway (100+ providers)", "supported": True, "methods": [
        {"id": "litellm-api-key", "label": "LiteLLM API key"},
    ]},
    {"id": "cloudflare-ai-gateway", "name": "Cloudflare AI Gateway", "hint": "Account ID + Gateway ID + API key", "supported": True, "methods": [
        {"id": "cloudflare-ai-gateway-api-key", "label": "Cloudflare AI Gateway API key"},
    ]},
    {"id": "vllm", "name": "vLLM", "hint": "Local / self-hosted OpenAI-compatible", "supported": True, "methods": [
        {"id": "vllm", "label": "vLLM (local server)"},
    ]},
    {"id": "custom", "name": "Custom Provider", "hint": "Any OpenAI/Anthropic-compatible endpoint", "supported": True, "methods": [
        {"id": "custom-api-key", "label": "Custom provider"},
    ]},
    {"id": "chutes", "name": "Chutes", "hint": "OAuth (not available in web UI)", "supported": False},
    {"id": "qwen", "name": "Qwen", "hint": "OAuth (not available in web UI)", "supported": False},
    {"id": "copilot", "name": "Copilot", "hint": "GitHub device flow (requires CLI)", "supported": False},
    {"id": "skip", "name": "Skip for now", "hint": "", "supported": True},
]

PROVIDER_KEY_URLS: dict[str, str] = {
    "openai": "https://platform.openai.com/api-keys",
    "anthropic": "https://console.anthropic.com/settings/keys",
    "google": "https://aistudio.google.com/apikey",
    "google-vertex": "https://console.cloud.google.com/apis/credentials",
    "google-gemini-cli": "https://aistudio.google.com/apikey",
    "moonshot": "https://platform.moonshot.cn/console/api-keys",
    "kimi-coding": "https://www.kimi.com/code/en",
    "minimax": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "minimax-cn": "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    "mistral": "https://console.mistral.ai/api-keys",
    "xai": "https://console.x.ai/",
    "deepseek": "https://platform.deepseek.com/api_keys",
    "openrouter": "https://openrouter.ai/keys",
    "together": "https://api.together.xyz/settings/api-keys",
    "huggingface": "https://huggingface.co/settings/tokens",
    "groq": "https://console.groq.com/keys",
    "cerebras": "https://cloud.cerebras.ai/",
    "venice": "https://venice.ai/settings/api",
    "qwen-portal": "https://dashscope.console.aliyun.com/apiKey",
    "modelstudio": "https://bailian.console.aliyun.com/",
    "qianfan": "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
    "opencode": "https://opencode.ai/auth",
    "volcengine": "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    "zai": "https://open.bigmodel.cn/usercenter/apikeys",
    "xiaomi": "https://developers.xiaomi.com/mimo",
    "litellm": "https://litellm.ai",
    "cloudflare-ai-gateway": "https://dash.cloudflare.com/",
    "amazon-bedrock": "https://console.aws.amazon.com/bedrock/",
}

SEARCH_PROVIDERS = [
    {"id": "brave", "name": "Brave Search", "hint": "Structured results with country/language/time filters", "placeholder": "BSA..."},
    {"id": "gemini", "name": "Gemini (Google Search)", "hint": "Google Search grounding, AI-synthesized", "placeholder": "AIza..."},
    {"id": "grok", "name": "Grok (xAI)", "hint": "xAI web-grounded responses", "placeholder": "xai-..."},
    {"id": "kimi", "name": "Kimi (Moonshot)", "hint": "Moonshot web search", "placeholder": "sk-..."},
    {"id": "perplexity", "name": "Perplexity Search", "hint": "Structured results with domain/country filters", "placeholder": "pplx-..."},
]


def _extract_json_obj(raw: str) -> dict | list:
    """Extract the first complete JSON object/array from a string that may
    contain non-JSON text before or after (e.g. plugin log lines).

    Tries '{' first (most CLI outputs are objects), then falls back to '['.
    This avoids false matches on log lines like ``[plugins] ...``."""
    for bracket_char in ("{", "["):
        close = "}" if bracket_char == "{" else "]"
        start = raw.find(bracket_char)
        if start == -1:
            continue
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
            if ch == bracket_char:
                depth += 1
            elif ch == close:
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(raw[start:i + 1])
                    except json.JSONDecodeError:
                        break
        continue
    raise ValueError("No valid JSON found in output")


async def _run_openclaw_json(args: list[str], timeout: int = 30) -> dict | list | None:
    """Run an openclaw CLI command with --json and return parsed output."""
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        return None
    env = _build_env()
    try:
        proc = await asyncio.create_subprocess_exec(
            openclaw_path, *args, "--json",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        if proc.returncode != 0:
            return None
        raw = stdout.decode("utf-8", errors="replace")
        return _extract_json_obj(raw)
    except Exception:
        return None


@router.get("/onboard-scan")
async def onboard_scan():
    """Scan the local environment for available providers, channels, skills, hooks via openclaw CLI."""

    # Run all scans in parallel
    models_task = _run_openclaw_json(["models", "list", "--all"])
    status_task = _run_openclaw_json(["models", "status"])
    channels_task = _run_openclaw_json(["channels", "list"])
    skills_task = _run_openclaw_json(["skills", "list"])
    hooks_task = _run_openclaw_json(["hooks", "list"])

    models_raw, status_raw, channels_raw, skills_raw, hooks_raw = await asyncio.gather(
        models_task, status_task, channels_task, skills_task, hooks_task,
    )

    # Parse models → group by provider
    providers: dict[str, dict] = {}
    if models_raw and isinstance(models_raw, dict):
        for m in models_raw.get("models", []):
            key = m.get("key", "")
            if "/" not in key:
                continue
            prov_id = key.split("/")[0]
            if prov_id not in providers:
                providers[prov_id] = {
                    "id": prov_id, "name": prov_id, "models": [],
                    "keyUrl": PROVIDER_KEY_URLS.get(prov_id, ""),
                }
            providers[prov_id]["models"].append({
                "id": key,
                "name": m.get("name", key),
                "contextWindow": m.get("contextWindow", 0),
                "reasoning": "reasoning" in (m.get("tags") or []),
                "available": m.get("available", False),
                "input": m.get("input", "text"),
            })

    # Parse status → get auth info and default model
    default_model = ""
    auth_profiles: list[dict] = []
    if status_raw and isinstance(status_raw, dict):
        default_model = status_raw.get("defaultModel", "")
        auth_profiles = status_raw.get("auth", [])

    # Parse channels — use static list + merge configured status from CLI
    configured_channels: set[str] = set()
    if channels_raw and isinstance(channels_raw, dict):
        chat = channels_raw.get("chat", {})
        if isinstance(chat, dict):
            configured_channels = {ch_id for ch_id, ch_data in chat.items() if ch_data}
    channels: list[dict] = [
        {**ch, "configured": ch["id"] in configured_channels}
        for ch in AVAILABLE_CHANNELS
    ]

    # Parse skills
    skills: list[dict] = []
    if skills_raw and isinstance(skills_raw, dict):
        for s in skills_raw.get("skills", []):
            skills.append({
                "name": s.get("name", ""),
                "description": s.get("description", ""),
                "emoji": s.get("emoji", ""),
                "eligible": s.get("eligible", False),
                "disabled": s.get("disabled", False),
                "missing": s.get("missing", []) if isinstance(s.get("missing"), list) else [],
                "source": s.get("source", ""),
                "bundled": s.get("bundled", False),
            })

    # Parse hooks — fall back to static list if CLI returns nothing
    hooks: list[dict] = []
    if hooks_raw and isinstance(hooks_raw, dict):
        for h in hooks_raw.get("hooks", []):
            hooks.append({
                "name": h.get("name", ""),
                "description": h.get("description", ""),
                "emoji": h.get("emoji", ""),
                "enabled": h.get("enabled", False),
            })
    if not hooks:
        hooks = [
            {"name": h["name"], "description": h["description"], "emoji": h.get("emoji", "⚙️"), "enabled": False}
            for h in AVAILABLE_HOOKS
        ]

    # Read current config for defaults
    current_config: dict = {}
    if _CONFIG_PATH.exists():
        try:
            current_config = json.loads(_CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass

    gw = current_config.get("gateway", {})
    agents = current_config.get("agents", {}).get("defaults", {})
    hooks_cfg = current_config.get("hooks", {}).get("internal", {}).get("entries", {})
    search_cfg = current_config.get("tools", {}).get("web", {}).get("search", {})

    # Build config summary lines (mirrors summarizeExistingConfig in source)
    config_summary: list[str] = []
    ws_val = agents.get("workspace")
    if ws_val:
        config_summary.append(f"workspace: {ws_val}")
    primary_model = agents.get("model", {}).get("primary", "")
    if primary_model:
        config_summary.append(f"model: {primary_model}")
    gw_mode = gw.get("mode")
    if gw_mode:
        config_summary.append(f"gateway.mode: {gw_mode}")
    if gw.get("port"):
        config_summary.append(f"gateway.port: {gw['port']}")
    if gw.get("bind"):
        config_summary.append(f"gateway.bind: {gw['bind']}")
    remote_url = gw.get("remote", {}).get("url")
    if remote_url:
        config_summary.append(f"gateway.remote.url: {remote_url}")

    return {
        "auth_providers": AUTH_PROVIDERS,
        "model_providers": list(providers.values()),
        "auth_profiles": auth_profiles,
        "default_model": default_model,
        "channels": channels,
        "skills": skills,
        "hooks": hooks,
        "search_providers": SEARCH_PROVIDERS,
        "config_exists": _CONFIG_PATH.exists(),
        "config_summary": config_summary,
        "defaults": {
            "gateway_port": gw.get("port", 18789),
            "gateway_bind": gw.get("bind", "loopback"),
            "gateway_auth_mode": gw.get("auth", {}).get("mode", "token"),
            "gateway_token": gw.get("auth", {}).get("token", ""),
            "tailscale_mode": gw.get("tailscale", {}).get("mode", "off"),
            "workspace": agents.get("workspace", str(_OPENCLAW_DIR / "workspace")),
            "enabled_hooks": [k for k, v in hooks_cfg.items() if v.get("enabled")],
            "search_provider": search_cfg.get("provider", ""),
            "search_api_key": search_cfg.get("apiKey", ""),
        },
    }


# ──────────────────────────────────────────────
# Onboard Form — defaults & config write
# ──────────────────────────────────────────────

@router.get("/onboard-defaults")
async def onboard_defaults():
    """Return provider/model list and current config as form defaults."""
    current: dict = {}
    if _CONFIG_PATH.exists():
        try:
            current = json.loads(_CONFIG_PATH.read_text("utf-8"))
        except Exception:
            pass

    # Extract current values for pre-filling form
    gw = current.get("gateway", {})
    agents = current.get("agents", {}).get("defaults", {})
    hooks_cfg = current.get("hooks", {}).get("internal", {}).get("entries", {})
    models_cfg = current.get("models", {}).get("providers", {})

    # Detect current provider
    current_provider = ""
    current_api_key = ""
    current_model = ""
    primary_model = agents.get("model", {}).get("primary", "")
    if "/" in primary_model:
        current_provider = primary_model.split("/")[0]
        current_model = primary_model.split("/", 1)[1]
    if current_provider and current_provider in models_cfg:
        prov_cfg = models_cfg[current_provider]
        current_api_key = prov_cfg.get("apiKey", "")

    enabled_hooks = [k for k, v in hooks_cfg.items() if v.get("enabled")]

    defaults = {
        "provider": current_provider,
        "api_key": current_api_key,
        "model_id": current_model,
        "gateway_port": gw.get("port", 18789),
        "gateway_bind": gw.get("bind", "loopback"),
        "gateway_auth_mode": gw.get("auth", {}).get("mode", "token"),
        "gateway_token": gw.get("auth", {}).get("token", ""),
        "channels": [],
        "hooks": enabled_hooks,
        "workspace": agents.get("workspace", str(_OPENCLAW_DIR / "workspace")),
        "install_daemon": True,
        "tailscale_mode": gw.get("tailscale", {}).get("mode", "off"),
    }

    return {
        "providers": PROVIDERS,
        "hooks": AVAILABLE_HOOKS,
        "channels": AVAILABLE_CHANNELS,
        "defaults": defaults,
        "config_exists": _CONFIG_PATH.exists(),
    }


class OnboardConfigRequest(BaseModel):
    mode: str = "local"
    provider: str = ""
    api_key: str = ""
    model_id: str = ""
    gateway_port: int = Field(default=18789, ge=1, le=65535)
    gateway_bind: str = "loopback"
    gateway_auth_mode: str = "token"
    gateway_token: str = ""
    channels: list[str] = Field(default_factory=list)
    hooks: list[str] = Field(default_factory=list)
    workspace: str = "~/.openclaw/workspace"
    install_daemon: bool = True
    tailscale_mode: str = "off"
    search_provider: str = ""
    search_api_key: str = ""
    remote_url: str = ""
    remote_token: str = ""
    selected_skills: list[str] = Field(default_factory=list)
    feishu_app_id: str = ""
    feishu_app_secret: str = ""
    feishu_connection_mode: str = "websocket"
    feishu_domain: str = "feishu"
    feishu_group_policy: str = "open"
    feishu_group_allow_from: list[str] = Field(default_factory=list)
    feishu_verification_token: str = ""
    feishu_webhook_path: str = "/feishu/events"
    cf_account_id: str = ""
    cf_gateway_id: str = ""
    litellm_base_url: str = ""
    vllm_base_url: str = "http://127.0.0.1:8000/v1"
    vllm_model_id: str = ""
    custom_base_url: str = ""
    custom_model_id: str = ""
    custom_provider_id: str = ""
    custom_compatibility: str = "openai"


# Auth-method ID (authChoice) → openclaw CLI flag (from onboard-provider-auth-flags.ts).
# Keyed by the *method* id the frontend sends, not the provider group id.
_METHOD_CLI_FLAGS: dict[str, str] = {
    "apiKey": "--anthropic-api-key",
    "openai-api-key": "--openai-api-key",
    "mistral-api-key": "--mistral-api-key",
    "openrouter-api-key": "--openrouter-api-key",
    "kilocode-api-key": "--kilocode-api-key",
    "ai-gateway-api-key": "--ai-gateway-api-key",
    "cloudflare-ai-gateway-api-key": "--cloudflare-ai-gateway-api-key",
    "moonshot-api-key": "--moonshot-api-key",
    "moonshot-api-key-cn": "--moonshot-api-key",
    "kimi-code-api-key": "--kimi-code-api-key",
    "gemini-api-key": "--gemini-api-key",
    "zai-coding-global": "--zai-api-key",
    "zai-coding-cn": "--zai-api-key",
    "zai-global": "--zai-api-key",
    "zai-cn": "--zai-api-key",
    "xiaomi-api-key": "--xiaomi-api-key",
    "minimax-api": "--minimax-api-key",
    "minimax-api-key-cn": "--minimax-api-key",
    "minimax-api-lightning": "--minimax-api-key",
    "synthetic-api-key": "--synthetic-api-key",
    "venice-api-key": "--venice-api-key",
    "together-api-key": "--together-api-key",
    "huggingface-api-key": "--huggingface-api-key",
    "opencode-zen": "--opencode-zen-api-key",
    "opencode-go": "--opencode-go-api-key",
    "xai-api-key": "--xai-api-key",
    "litellm-api-key": "--litellm-api-key",
    "qianfan-api-key": "--qianfan-api-key",
    "modelstudio-api-key-cn": "--modelstudio-api-key-cn",
    "modelstudio-api-key": "--modelstudio-api-key",
    "volcengine-api-key": "--volcengine-api-key",
    "byteplus-api-key": "--byteplus-api-key",
}


def _patch_config_extras(body: OnboardConfigRequest) -> None:
    """Merge fields not supported by --non-interactive into openclaw.json."""
    if not _CONFIG_PATH.exists():
        return
    try:
        config = json.loads(_CONFIG_PATH.read_text("utf-8"))
    except Exception:
        return

    changed = False

    # Auth-method → (config provider key, baseUrl)
    _BASE_URL_OVERRIDES: dict[str, tuple[str, str]] = {
        # Moonshot
        "moonshot-api-key":          ("moonshot",     "https://api.moonshot.ai/v1"),
        "moonshot-api-key-cn":       ("moonshot",     "https://api.moonshot.cn/v1"),
        "kimi-code-api-key":         ("kimi-coding",  "https://api.kimi.com/coding/"),
        # Z.AI
        "zai-coding-global":         ("zai",          "https://api.z.ai/api/coding/paas/v4"),
        "zai-coding-cn":             ("zai",          "https://open.bigmodel.cn/api/coding/paas/v4"),
        "zai-global":                ("zai",          "https://api.z.ai/api/paas/v4"),
        "zai-cn":                    ("zai",          "https://open.bigmodel.cn/api/paas/v4"),
        # MiniMax
        "minimax-api":               ("minimax",      "https://api.minimax.io/anthropic"),
        "minimax-api-key-cn":        ("minimax-cn",   "https://api.minimaxi.com/anthropic"),
        "minimax-api-lightning":     ("minimax",      "https://api.minimax.io/anthropic"),
        # Model Studio
        "modelstudio-api-key-cn":    ("modelstudio",  "https://coding.dashscope.aliyuncs.com/v1"),
        "modelstudio-api-key":       ("modelstudio",  "https://coding-intl.dashscope.aliyuncs.com/v1"),
        # Other providers with fixed baseUrls
        "mistral-api-key":           ("mistral",      "https://api.mistral.ai/v1"),
        "xai-api-key":               ("xai",          "https://api.x.ai/v1"),
        "synthetic-api-key":         ("synthetic",    "https://api.synthetic.new/anthropic"),
        "venice-api-key":            ("venice",       "https://api.venice.ai/api/v1"),
        "together-api-key":          ("together",     "https://api.together.xyz/v1"),
        "huggingface-api-key":       ("huggingface",  "https://router.huggingface.co/v1"),
        "kilocode-api-key":          ("kilocode",     "https://api.kilo.ai/api/gateway/"),
        "qianfan-api-key":           ("qianfan",      "https://qianfan.baidubce.com/v2"),
        "ai-gateway-api-key":        ("vercel-ai-gateway", "https://ai-gateway.vercel.sh"),
        "opencode-zen":              ("opencode",     "https://opencode.ai/zen/v1"),
    }
    if body.provider in _BASE_URL_OVERRIDES:
        provider_key, base_url = _BASE_URL_OVERRIDES[body.provider]
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault(provider_key, {})
        prov["baseUrl"] = base_url
        changed = True

    # Cloudflare AI Gateway — dynamic baseUrl from account/gateway IDs
    if body.provider == "cloudflare-ai-gateway-api-key" and body.cf_account_id and body.cf_gateway_id:
        cf_url = f"https://gateway.ai.cloudflare.com/v1/accounts/{body.cf_account_id}/gateways/{body.cf_gateway_id}"
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault("cloudflare-ai-gateway", {})
        prov["baseUrl"] = cf_url
        changed = True

    # LiteLLM — custom baseUrl (default: http://localhost:4000)
    if body.provider == "litellm-api-key" and body.litellm_base_url:
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        prov = providers.setdefault("litellm", {})
        prov["baseUrl"] = body.litellm_base_url
        changed = True

    # vLLM — full config (interactive-only in CLI, so we write directly)
    if body.provider == "vllm" and body.vllm_base_url:
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        vllm_cfg = providers.setdefault("vllm", {})
        vllm_cfg["baseUrl"] = body.vllm_base_url.rstrip("/")
        vllm_cfg["api"] = "openai-completions"
        if body.api_key:
            vllm_cfg["apiKey"] = body.api_key
        if body.vllm_model_id:
            vllm_cfg["models"] = [{
                "id": body.vllm_model_id,
                "name": f"{body.vllm_model_id} (vLLM)",
                "contextWindow": 128000,
                "maxTokens": 8192,
                "input": ["text"],
                "reasoning": False,
                "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            }]
            if not body.model_id:
                body.model_id = f"vllm/{body.vllm_model_id}"
        changed = True

    # Custom provider — full config (needs URL + model + compatibility)
    if body.provider == "custom-api-key" and body.custom_base_url and body.custom_model_id:
        prov_id = body.custom_provider_id.strip()
        if not prov_id:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(body.custom_base_url)
                host = re.sub(r"[^a-z0-9]+", "-", parsed.hostname or "custom").strip("-")
                port = f"-{parsed.port}" if parsed.port else ""
                prov_id = f"custom-{host}{port}" or "custom"
            except Exception:
                prov_id = "custom"
        api_type = "anthropic-messages" if body.custom_compatibility == "anthropic" else "openai-completions"
        models_cfg = config.setdefault("models", {})
        providers = models_cfg.setdefault("providers", {})
        custom_cfg = providers.setdefault(prov_id, {})
        custom_cfg["baseUrl"] = body.custom_base_url.rstrip("/")
        custom_cfg["api"] = api_type
        if body.api_key:
            custom_cfg["apiKey"] = body.api_key
        custom_cfg["models"] = [{
            "id": body.custom_model_id,
            "name": f"{body.custom_model_id} (Custom Provider)",
            "contextWindow": 8192,
            "maxTokens": 4096,
            "input": ["text"],
            "reasoning": False,
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
        }]
        if not body.model_id:
            body.model_id = f"{prov_id}/{body.custom_model_id}"
        changed = True

    # Model ID override (CLI picks the provider default; user may want a specific model)
    if body.model_id:
        agents = config.setdefault("agents", {})
        defaults = agents.setdefault("defaults", {})
        defaults.setdefault("model", {})["primary"] = body.model_id
        changed = True

    # Channels — Feishu (full config mirroring source onboarding adapter)
    if "feishu" in body.channels and body.feishu_app_id and body.feishu_app_secret:
        channels = config.setdefault("channels", {})
        feishu_cfg: dict = {**channels.get("feishu", {})}
        feishu_cfg["enabled"] = True
        feishu_cfg["appId"] = body.feishu_app_id
        feishu_cfg["appSecret"] = body.feishu_app_secret
        feishu_cfg["connectionMode"] = body.feishu_connection_mode or "websocket"
        feishu_cfg["domain"] = body.feishu_domain or "feishu"
        feishu_cfg["groupPolicy"] = body.feishu_group_policy or "open"
        if body.feishu_group_policy == "allowlist" and body.feishu_group_allow_from:
            feishu_cfg["groupAllowFrom"] = body.feishu_group_allow_from
        if body.feishu_connection_mode == "webhook":
            if body.feishu_verification_token:
                feishu_cfg["verificationToken"] = body.feishu_verification_token
            feishu_cfg["webhookPath"] = body.feishu_webhook_path or "/feishu/events"
        channels["feishu"] = feishu_cfg
        changed = True

    # Hooks
    if body.hooks:
        config["hooks"] = {
            "internal": {
                "enabled": True,
                "entries": {h: {"enabled": True} for h in body.hooks},
            },
        }
        changed = True

    # Search provider — each provider stores its API key at a different path
    if body.search_provider:
        tools = config.setdefault("tools", {})
        web = tools.setdefault("web", {})
        search: dict = {**web.get("search", {}), "provider": body.search_provider, "enabled": True}
        if body.search_api_key:
            if body.search_provider == "brave":
                search["apiKey"] = body.search_api_key
            else:
                nested = search.setdefault(body.search_provider, {})
                nested["apiKey"] = body.search_api_key
        web["search"] = search
        changed = True

    # XSafeClaw Guard plugin — always register
    plugins = config.setdefault("plugins", {})
    entries = plugins.setdefault("entries", {})
    if "safeclaw-guard" not in entries or not isinstance(entries.get("safeclaw-guard"), dict):
        entries["safeclaw-guard"] = {
            "enabled": True,
            "config": {"safeclawUrl": "http://localhost:6874"},
        }
        changed = True
    elif not entries["safeclaw-guard"].get("enabled"):
        entries["safeclaw-guard"]["enabled"] = True
        changed = True

    if changed:
        tmp = _CONFIG_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.rename(_CONFIG_PATH)


async def _auto_approve_devices() -> None:
    """Auto-approve any pending OpenClaw device pairing requests."""
    from ...gateway_client import auto_approve_pending_devices
    try:
        approved = await auto_approve_pending_devices()
        if approved:
            print(f"🔑 Auto-approved {len(approved)} device(s) during configuration")
    except Exception as e:
        print(f"⚠️  Device auto-approve skipped: {e}")


def _install_safeclaw_guard_plugin() -> None:
    """Copy safeclaw-guard plugin files to ~/.openclaw/extensions/ so OpenClaw loads them."""
    src_dir = Path(__file__).resolve().parent.parent.parent.parent.parent / "plugins" / "safeclaw-guard"
    if not src_dir.is_dir():
        return
    dst_dir = _OPENCLAW_DIR / "extensions" / "safeclaw-guard"
    dst_dir.mkdir(parents=True, exist_ok=True)
    for fname in ("index.ts", "openclaw.plugin.json", "package.json"):
        src_file = src_dir / fname
        if src_file.exists():
            shutil.copy2(src_file, dst_dir / fname)


def _deploy_safety_files(workspace: str) -> None:
    """Deploy SAFETY.md and PERMISSION.md into the OpenClaw workspace.

    Only writes files that don't already exist so user customizations are preserved.
    """
    templates_dir = Path(__file__).resolve().parent.parent.parent / "data" / "templates"
    ws = Path(workspace).expanduser()
    if not ws.is_dir():
        ws.mkdir(parents=True, exist_ok=True)

    for fname in ("SAFETY.md", "PERMISSION.md"):
        dst = ws / fname
        if dst.exists():
            continue
        src = templates_dir / fname
        if src.exists():
            shutil.copy2(src, dst)


class FeishuTestRequest(BaseModel):
    app_id: str
    app_secret: str
    domain: str = "feishu"


@router.post("/feishu-test")
async def feishu_test(body: FeishuTestRequest):
    """Test Feishu/Lark credentials by calling /open-apis/bot/v3/info."""
    import httpx as _httpx

    base_urls = {
        "feishu": "https://open.feishu.cn",
        "lark": "https://open.larksuite.com",
    }
    base = base_urls.get(body.domain, body.domain)
    token_url = f"{base}/open-apis/auth/v3/tenant_access_token/internal"
    bot_url = f"{base}/open-apis/bot/v3/info"

    try:
        async with _httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                token_url,
                json={"app_id": body.app_id, "app_secret": body.app_secret},
            )
            data = resp.json()
            if data.get("code") != 0:
                return {
                    "ok": False,
                    "error": data.get("msg", f"token error code {data.get('code')}"),
                }
            token = data["tenant_access_token"]

            resp = await client.get(
                bot_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            info = resp.json()
            if info.get("code") != 0:
                return {
                    "ok": False,
                    "error": info.get("msg", f"bot info error code {info.get('code')}"),
                }
            bot = info.get("bot") or (info.get("data") or {}).get("bot") or {}
            return {
                "ok": True,
                "bot_name": bot.get("bot_name"),
                "bot_open_id": bot.get("open_id"),
            }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@router.post("/onboard-config")
async def onboard_config(body: OnboardConfigRequest):
    """Run `openclaw onboard --non-interactive` to configure OpenClaw.

    Core settings (provider, gateway, workspace, daemon) are handled by
    the CLI itself — with full validation, migration, and atomic writes.
    Extra settings (model, channels, hooks, search) that have no CLI flags
    are merge-patched into the resulting openclaw.json afterwards.
    """
    openclaw_path = _find_openclaw()
    if not openclaw_path:
        raise HTTPException(
            status_code=500,
            detail="openclaw binary not found. Run Setup first.",
        )

    env = _build_env()

    # ── Build CLI argument list ──────────────────────────────────────────
    args: list[str] = [
        openclaw_path, "onboard",
        "--non-interactive", "--accept-risk",
    ]

    # Mode
    if body.mode:
        args += ["--mode", body.mode]

    # Workspace
    if body.workspace:
        args += ["--workspace", body.workspace]

    # Provider API key (provider field now carries the method ID, e.g. "openai-api-key")
    # vLLM and custom are handled entirely by _patch_config_extras (vLLM rejects non-interactive)
    _PATCH_ONLY_PROVIDERS = {"vllm", "custom-api-key"}
    if body.provider and body.provider != "skip" and body.provider not in _PATCH_ONLY_PROVIDERS and body.api_key:
        cli_flag = _METHOD_CLI_FLAGS.get(body.provider)
        if cli_flag:
            args += [cli_flag, body.api_key]

    # Gateway
    args += ["--gateway-port", str(body.gateway_port)]
    if body.gateway_bind:
        args += ["--gateway-bind", body.gateway_bind]
    if body.gateway_auth_mode:
        args += ["--gateway-auth", body.gateway_auth_mode]
    if body.gateway_token:
        args += ["--gateway-token", body.gateway_token]

    # Remote gateway
    if body.mode == "remote":
        if body.remote_url:
            args += ["--remote-url", body.remote_url]
        if body.remote_token:
            args += ["--remote-token", body.remote_token]

    # Tailscale
    if body.tailscale_mode and body.tailscale_mode != "off":
        args += ["--tailscale", body.tailscale_mode]

    # Daemon
    if body.install_daemon and body.mode == "local":
        args += ["--install-daemon"]
    else:
        args += ["--no-install-daemon"]

    # Skip features handled by _patch_config_extras
    args += [
        "--skip-channels", "--skip-skills",
        "--skip-search", "--skip-health", "--skip-ui",
    ]

    # ── Execute ──────────────────────────────────────────────────────────
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=asyncio.subprocess.DEVNULL,
            env=env,
        )
        stdout_bytes, _ = await asyncio.wait_for(proc.communicate(), timeout=120)
        output = stdout_bytes.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"openclaw onboard failed (exit {proc.returncode}):\n{output}",
            )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=500,
            detail="openclaw onboard timed out after 120 seconds",
        )

    # ── Post-patch extras not supported by CLI flags ─────────────────────
    _patch_config_extras(body)

    # ── Install XSafeClaw Guard plugin into OpenClaw extensions ─────────
    _install_safeclaw_guard_plugin()

    # ── Deploy SAFETY.md & PERMISSION.md into workspace ──────────────
    _deploy_safety_files(body.workspace)

    # ── Auto-approve pending device pairing requests ─────────────────
    await _auto_approve_devices()

    workspace = str(Path(body.workspace).expanduser())
    return {
        "success": True,
        "config_path": str(_CONFIG_PATH),
        "workspace": workspace,
        "output": output,
    }
