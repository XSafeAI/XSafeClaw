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
from pydantic import BaseModel

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
    }


# ──────────────────────────────────────────────
# Install  (npm install -g openclaw@latest)
# ──────────────────────────────────────────────

@router.post("/install")
async def install_openclaw():
    """Stream npm install output as Server-Sent Events."""
    env = _build_env()

    async def generate():
        try:
            proc = await asyncio.create_subprocess_exec(
                "npm", "install", "-g", "openclaw@latest",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
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
