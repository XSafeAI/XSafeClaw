"""Standalone desktop floating Sidebar for XSafeClaw.

This module intentionally does not depend on the browser frontend.  It is
launched as a separate local process by the backend, so the floating Sidebar
keeps running after the browser tab/window is closed.  When launched by the
backend, it receives the backend PID and exits when that parent process exits.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import threading
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

AgentStatus = Literal["ready", "working", "blocked", "offline"]
ActivePanel = Literal["agents", "riskApproval", "settings"]
SetupPlatform = Literal["openclaw", "hermes", "nanobot"]
AgentPetState = Literal["typing", "sleeping"]
RiskState = Literal["safe", "pending", "blocked"]
IconType = Literal["openclaw", "hermes", "nanobot", "document", "cleaner"]
SessionRuntime = Literal["running", "waiting", "idle"]
RiskLevel = Literal["high", "medium", "low"]
ApprovalAction = Literal["allow_once", "always_allow_session", "block"]
RiskSortMode = Literal["risk", "time"]
ApprovalMode = Literal["all", "smart"]
SetupInstallState = Literal["idle", "checking", "installed", "missing", "installing", "failed"]

DEFAULT_API_BASE = "http://127.0.0.1:6874/api"


@dataclass(frozen=True)
class AgentItem:
    id: Literal["openclaw", "hermes", "nanobot"]
    name: Literal["OpenClaw", "Hermes", "Nanobot"]
    status: AgentStatus
    pending_risk_count: int


@dataclass(frozen=True)
class AgentAppStatus:
    id: str
    app_name: Literal["OpenClaw", "Hermes", "Nanobot"]
    icon_type: IconType
    running_agent_count: int
    pending_risk_count: int
    risk_state: RiskState
    status_text: str


@dataclass(frozen=True)
class CurrentActiveMock:
    app_name: str
    session_display_id: str
    activity: str
    latest_message: str


@dataclass(frozen=True)
class RiskSummaryMock:
    pending_risk_count: int
    text: str
    hint: str


@dataclass(frozen=True)
class RiskApprovalCard:
    id: str
    app_name: Literal["OpenClaw", "Hermes", "Nanobot"]
    agent_name: str
    action_verb: str
    target_name: str
    title: str
    description: str
    risk_level: RiskLevel
    risk_label: str
    operation_type: str
    occurred_text: str
    icon_type: IconType


@dataclass(frozen=True)
class SidebarSessionStatus:
    id: str
    app_name: Literal["Nanobot", "OpenClaw", "Hermes"]
    display_session_id: str
    icon_type: IconType
    status: SessionRuntime
    activity_text: str
    latest_message: str
    model_text: str
    source_text: str
    pending_risk_count: int
    risk_state: RiskState


@dataclass(frozen=True)
class SetupPlatformInfo:
    id: SetupPlatform
    name: Literal["OpenClaw", "Hermes", "Nanobot"]
    icon_type: IconType
    description: str
    install_path: str


@dataclass
class SetupRuntimeState:
    state: SetupInstallState = "idle"
    version: str | None = None
    detail: str = "等待检测"


AGENTS: tuple[AgentItem, ...] = (
    AgentItem("openclaw", "OpenClaw", "ready", 0),
    AgentItem("hermes", "Hermes", "working", 0),
    AgentItem("nanobot", "Nanobot", "blocked", 1),
)

SETUP_PLATFORMS: tuple[SetupPlatformInfo, ...] = (
    SetupPlatformInfo(
        "openclaw",
        "OpenClaw",
        "openclaw",
        "官方 npm 安装：npm install -g openclaw@latest",
        "system/install",
    ),
    SetupPlatformInfo(
        "hermes",
        "Hermes",
        "hermes",
        "官方安装脚本：Linux/macOS 使用 install.sh，Windows 使用 install.ps1",
        "system/install-hermes",
    ),
    SetupPlatformInfo(
        "nanobot",
        "Nanobot",
        "nanobot",
        "官方 uv 安装：uv tool install nanobot-ai",
        "system/nanobot/install",
    ),
)

MOCK_AGENT_APPS: tuple[AgentAppStatus, ...] = (
    AgentAppStatus(
        "app_openclaw",
        "OpenClaw",
        "openclaw",
        2,
        0,
        "safe",
        "2 个会话 · 无风险",
    ),
    AgentAppStatus(
        "app_hermes",
        "Hermes",
        "hermes",
        1,
        0,
        "safe",
        "1 个会话 · 无风险",
    ),
    AgentAppStatus(
        "app_nanobot",
        "Nanobot",
        "nanobot",
        3,
        1,
        "pending",
        "3 个会话 · 1 个待确认",
    ),
)

MOCK_CURRENT_ACTIVE = CurrentActiveMock(
    app_name="Nanobot",
    session_display_id="websocket:documents-review",
    activity="最近访问 Documents",
    latest_message="读取 ~/Documents/XSafeClaw",
)

MOCK_RISK_SUMMARY = RiskSummaryMock(
    pending_risk_count=1,
    text="1 个待确认操作",
    hint="前往风险审批处理",
)

MOCK_RISK_APPROVAL_CARDS: tuple[RiskApprovalCard, ...] = (
    RiskApprovalCard(
        id="risk_hermes_upload_env",
        app_name="Hermes",
        agent_name="UploadAgent",
        action_verb="请求上传",
        target_name=".env",
        title="Hermes / UploadAgent 请求上传 .env",
        description="将上传敏感文件到远程服务器，可能导致凭证泄露",
        risk_level="high",
        risk_label="高风险",
        operation_type="网络操作",
        occurred_text="2 分钟前",
        icon_type="hermes",
    ),
    RiskApprovalCard(
        id="risk_nanobot_file_documents",
        app_name="Nanobot",
        agent_name="FileAgent",
        action_verb="请求访问",
        target_name="Documents",
        title="Nanobot / FileAgent 请求访问 Documents",
        description="访问受保护目录，可能包含敏感资料",
        risk_level="medium",
        risk_label="中风险",
        operation_type="文件访问",
        occurred_text="5 分钟前",
        icon_type="nanobot",
    ),
    RiskApprovalCard(
        id="risk_openclaw_clean_temp",
        app_name="OpenClaw",
        agent_name="CleanAgent",
        action_verb="请求删除",
        target_name="临时文件",
        title="OpenClaw / CleanAgent 请求删除临时文件",
        description="清理临时目录，删除无用文件",
        risk_level="low",
        risk_label="低风险",
        operation_type="文件删除",
        occurred_text="12 分钟前",
        icon_type="openclaw",
    ),
)

MOCK_SIDEBAR_SESSIONS: tuple[SidebarSessionStatus, ...] = (
    SidebarSessionStatus(
        id="session_nanobot_documents",
        app_name="Nanobot",
        display_session_id="websocket:documents-review",
        icon_type="nanobot",
        status="running",
        activity_text="访问 Documents",
        latest_message="读取 ~/Documents/XSafeClaw",
        model_text="GPT-4.1",
        source_text="~/.nanobot/workspace/sessions",
        pending_risk_count=1,
        risk_state="pending",
    ),
    SidebarSessionStatus(
        id="session_nanobot_summary",
        app_name="Nanobot",
        display_session_id="api:project-summary",
        icon_type="document",
        status="running",
        activity_text="生成项目摘要",
        latest_message="读取项目文件索引",
        model_text="GPT-4.1",
        source_text="~/.nanobot/workspace/sessions",
        pending_risk_count=0,
        risk_state="safe",
    ),
    SidebarSessionStatus(
        id="session_nanobot_cleanup",
        app_name="Nanobot",
        display_session_id="websocket:cleanup-check",
        icon_type="cleaner",
        status="waiting",
        activity_text="等待新消息",
        latest_message="暂无最近消息",
        model_text="GPT-4.1",
        source_text="~/.nanobot/workspace/sessions",
        pending_risk_count=0,
        risk_state="safe",
    ),
)

DEFAULT_SELECTED_SESSION_ID = "session_nanobot_documents"


def get_agent_pet_state(agents: tuple[AgentItem, ...]) -> AgentPetState:
    has_active_task = any(agent.status in {"working", "blocked"} for agent in agents)
    return "typing" if has_active_task else "sleeping"


def get_pending_risk_count(agents: tuple[AgentItem, ...]) -> int:
    return sum(agent.pending_risk_count for agent in agents)


def get_risk_badge_text(count: int) -> str:
    if count <= 0:
        return ""
    if count > 9:
        return "9+"
    return str(count)


def get_pending_risk_count_from_cards(
    cards: tuple[RiskApprovalCard, ...] | list[RiskApprovalCard],
) -> int:
    return len(cards)


def get_xsafeclaw_logo_path() -> Path | None:
    project_root = Path(__file__).resolve().parents[2]
    candidates = (
        project_root / "frontend" / "public" / "logo.png",
        project_root / "src" / "xsafeclaw" / "static" / "logo.png",
        project_root / "assets" / "logo.png",
        project_root / "assets" / "claw_logo.png",
        project_root / "claw-logo.png",
    )
    return next((path for path in candidates if path.exists()), None)


def get_sidebar_setting_icon_path() -> Path | None:
    package_root = Path(__file__).resolve().parent
    project_root = Path(__file__).resolve().parents[2]
    candidates = (
        package_root / "static" / "sidebar_setting.png",
        project_root / "src" / "xsafeclaw" / "static" / "sidebar_setting.png",
        project_root / "src" / "xsafeclaw" / "static" / "assets" / "sidebar" / "setting.png",
        project_root / "assets" / "sidebar" / "setting.png",
    )
    return next((path for path in candidates if path.exists()), None)


def get_sidebar_agent_icon_path(pet_state: AgentPetState) -> Path | None:
    filename = (
        "sidebar_agent_working.png" if pet_state == "typing" else "sidebar_agent_sleeping.png"
    )
    package_root = Path(__file__).resolve().parent
    project_root = Path(__file__).resolve().parents[2]
    candidates = (
        package_root / "static" / filename,
        project_root / "src" / "xsafeclaw" / "static" / filename,
        project_root / "assets" / "sidebar" / filename,
    )
    return next((path for path in candidates if path.exists()), None)


def is_scalable_canvas_width_item(item_type: str) -> bool:
    return item_type in {"arc", "line", "oval", "polygon", "rectangle"}


def get_collapsed_logo_crop_box(width: int, height: int) -> tuple[int, int, int, int]:
    if height > width:
        return 0, 0, width, height
    side = min(width, height)
    left = min(max(0, width - side), side // 6)
    return left, 0, left + side, side


def get_collapsed_logo_subsample_factor(source_size: int, target_size: int = 52) -> int:
    return max(1, round(source_size / target_size))


def get_collapsed_panel_for_design_y(design_y: float) -> ActivePanel | None:
    if 140 <= design_y < 300:
        return "agents"
    if 300 <= design_y < 470:
        return "riskApproval"
    if 470 <= design_y < 770:
        return "settings"
    return None


def normalize_api_base(api_base: str | None) -> str:
    base = (api_base or DEFAULT_API_BASE).strip() or DEFAULT_API_BASE
    return base.rstrip("/")


def parse_sse_data_line(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("data:"):
        return None
    payload = stripped[5:].strip()
    if not payload:
        return None
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def setup_states_from_install_status(data: dict[str, Any]) -> dict[SetupPlatform, SetupRuntimeState]:
    def _state(platform: SetupPlatform) -> SetupRuntimeState:
        installed_key = f"{platform}_installed"
        version_key = f"{platform}_version"
        error_key = f"{platform}_error"
        if platform == "openclaw":
            installed_key = "openclaw_installed"
            version_key = "openclaw_version"
            error_key = "openclaw_error"
        installed = bool(data.get(installed_key))
        if installed:
            version = data.get(version_key)
            detail = "已安装"
            if platform == "hermes" and data.get("requires_hermes_configure"):
                detail = "已安装，待配置模型"
            elif platform == "nanobot" and data.get("requires_nanobot_configure"):
                detail = "已安装，待配置模型"
            elif platform == "openclaw" and data.get("requires_configure"):
                detail = "已安装，待配置"
            return SetupRuntimeState(
                state="installed",
                version=str(version) if version else None,
                detail=detail,
            )
        error = data.get(error_key)
        return SetupRuntimeState(
            state="missing",
            version=None,
            detail=str(error) if error else "未安装",
        )

    return {platform.id: _state(platform.id) for platform in SETUP_PLATFORMS}


def sort_risk_approval_cards(
    cards: tuple[RiskApprovalCard, ...] | list[RiskApprovalCard],
    mode: RiskSortMode = "risk",
) -> list[RiskApprovalCard]:
    if mode == "time":
        return sorted(cards, key=lambda card: int(card.occurred_text.split(" ", 1)[0]))
    rank: dict[RiskLevel, int] = {"high": 0, "medium": 1, "low": 2}
    return sorted(cards, key=lambda card: rank[card.risk_level])


def get_risk_sort_selector_layout(panel_x: int, is_open: bool) -> dict[str, int | str]:
    left = panel_x + 550
    top = 112
    right = panel_x + 728
    bottom = 152
    arrow_center_x = right - 18
    arrow_center_y = (top + bottom) // 2
    arrow_left = arrow_center_x - 8
    arrow_right = arrow_center_x + 8
    arrow_top = arrow_center_y - 4
    arrow_bottom = arrow_center_y + 4
    label_left = left + 18
    label_right = arrow_left - 12
    return {
        "left": left,
        "top": top,
        "right": right,
        "bottom": bottom,
        "label_left": label_left,
        "label_right": label_right,
        "label_center_x": (label_left + label_right) // 2,
        "label_center_y": arrow_center_y,
        "label_max_width": label_right - label_left,
        "label_anchor": "center",
        "arrow_left": arrow_left,
        "arrow_right": arrow_right,
        "arrow_center_x": arrow_center_x,
        "arrow_center_y": arrow_center_y,
        "arrow_top": arrow_bottom if is_open else arrow_top,
        "arrow_bottom": arrow_top if is_open else arrow_bottom,
    }


def get_risk_footer_layout(panel_x: int) -> dict[str, int | str]:
    return {
        "icon_style": "alert_circle",
        "icon_x": panel_x + 46,
        "icon_y": 703,
        "hint_text_x": panel_x + 72,
        "hint_text_y": 704,
        "history_text_x": panel_x + 566,
        "history_text_y": 704,
        "history_arrow_x": panel_x + 694,
        "history_arrow_y": 716,
        "history_hitbox_left": panel_x + 566,
        "history_hitbox_top": 704,
        "history_hitbox_right": panel_x + 704,
        "history_hitbox_bottom": 726,
    }


def parse_approval_hitbox_key(key: str) -> tuple[str, ApprovalAction] | None:
    parts = key.split(":")
    if len(parts) != 3 or parts[0] != "approval":
        return None
    action = parts[2]
    if action not in {"allow_once", "always_allow_session", "block"}:
        return None
    return parts[1], action


def apply_risk_approval_action(
    cards: list[RiskApprovalCard],
    *,
    card_id: str,
    action: ApprovalAction,
) -> list[RiskApprovalCard]:
    # Keep the API explicit even though all actions remove card in mock mode.
    if action in {"allow_once", "always_allow_session", "block"}:
        return [card for card in cards if card.id != card_id]
    return list(cards)


def _process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def run(parent_pid: int | None = None, api_base: str = DEFAULT_API_BASE) -> None:
    import tkinter as tk
    import tkinter.font as tkfont

    class SidebarWindow:
        collapsed_width = 86
        expanded_width = 760
        expanded_gap = 12
        height = 770

        viewport_height_ratio = 0.50
        min_window_height = 420
        max_window_height = 720
        top_offset_ratio = 0.12
        font_scale_ratio = 0.92

        transparent = "#FF00FF"
        bg = "#071018"
        panel_bg = "#0D1217"
        card_bg = "#121A23"
        border = "#2A3440"
        card_border = "#24303A"
        text = "#F2F5F7"
        muted = "#A0A6AF"
        body_text = "#A9B0BA"
        weak = "#8B929C"
        soft = "#1A2029"
        risk = "#F16B6B"
        risk_hot = "#FF1717"
        ok = "#18D158"
        pending = "#FF9F0A"
        pending_text = "#FFB020"
        focus = "#36C275"
        ui_font = "Segoe UI"

        def __init__(self, parent_pid: int | None, api_base: str) -> None:
            self.root = tk.Tk()
            self.root.title("XSafeClaw Sidebar")
            self.root.overrideredirect(True)
            self.root.attributes("-topmost", True)
            try:
                self.root.attributes("-toolwindow", True)
            except tk.TclError:
                pass
            try:
                self.root.attributes("-transparentcolor", self.transparent)
            except tk.TclError:
                pass
            self._configure_window_metrics()

            self.active_panel: ActivePanel = "agents"
            self.expanded = False
            self.tooltip: tk.Toplevel | None = None
            self.pet_state = get_agent_pet_state(AGENTS)
            self.risk_sort_mode: RiskSortMode = "risk"
            self.risk_sort_dropdown_open = False
            self.risk_approval_cards = sort_risk_approval_cards(
                list(MOCK_RISK_APPROVAL_CARDS),
                mode=self.risk_sort_mode,
            )
            self.pending_risk_count = get_pending_risk_count_from_cards(self.risk_approval_cards)
            self.left = 0
            self.top = self.default_top
            self._press_root_x = 0
            self._press_root_y = 0
            self._press_left = 0
            self._press_top = 0
            self._dragging = False
            self._hitboxes: list[tuple[str, int, int, int, int]] = []
            self._focus_order: list[str] = []
            self._focused_key: str | None = None
            self.agent_detail_app: Literal["Nanobot", "OpenClaw", "Hermes"] | None = None
            self.agent_setup_open = False
            self.selected_session_id = DEFAULT_SELECTED_SESSION_ID
            self.api_base = normalize_api_base(api_base)
            self.setup_states: dict[SetupPlatform, SetupRuntimeState] = {
                platform.id: SetupRuntimeState() for platform in SETUP_PLATFORMS
            }
            self.setup_logs: list[tuple[str, str]] = []
            self.setup_installing_platform: SetupPlatform | None = None
            self.setup_detection_error = ""
            self._setup_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
            self._setup_poll_scheduled = False
            self._setup_status_thread_running = False
            self.cost_limit_app = "OpenClaw"
            self.cost_limit_amount = ""
            self.cost_limit_duration = ""
            self.cost_limit_unit = "天"
            self._settings_widgets: list[tk.Widget] = []
            self._cost_limit_app_select_geometry: tuple[int, int, int, int] | None = None
            self._cost_limit_amount_entry_geometry: tuple[int, int, int, int] | None = None
            self._cost_limit_duration_entry_geometry: tuple[int, int, int, int] | None = None
            self._cost_limit_unit_select_geometry: tuple[int, int, int, int] | None = None
            self.approval_mode: ApprovalMode = "smart"
            self._collapsed_logo_source: tk.PhotoImage | None = None
            self._collapsed_logo_image: tk.PhotoImage | None = None
            self._page_logo_source: tk.PhotoImage | None = None
            self._page_logo_image: tk.PhotoImage | None = None
            self._settings_icon_source: tk.PhotoImage | None = None
            self._settings_icon_image: tk.PhotoImage | None = None
            self._agent_icon_sources: dict[AgentPetState, tk.PhotoImage] = {}
            self._agent_icon_images: dict[AgentPetState, tk.PhotoImage] = {}
            self.parent_pid = parent_pid

            self.root.configure(bg=self.transparent)
            self.canvas = tk.Canvas(
                self.root,
                width=self.window_collapsed_width,
                height=self.window_height,
                bg=self.transparent,
                highlightthickness=0,
                bd=0,
                takefocus=1,
            )
            self.canvas.pack(fill="both", expand=True)
            self.canvas.bind("<ButtonPress-1>", self._start_drag)
            self.canvas.bind("<B1-Motion>", self._drag)
            self.canvas.bind("<ButtonRelease-1>", self._finish_click_or_drag)
            self.canvas.bind("<Motion>", self._handle_motion)
            self.canvas.bind(
                "<Leave>",
                lambda _event: (self._hide_tooltip(), self.canvas.configure(cursor="")),
            )
            self.root.bind("<Escape>", lambda _event: self.root.destroy())
            self.root.bind("<Button-3>", lambda _event: self.root.destroy())
            self.root.bind("<Tab>", self._focus_next)
            self.root.bind("<Return>", self._activate_focused)
            self.root.bind("<space>", self._activate_focused)
            self.canvas.focus_set()

            self._set_geometry()
            self._draw()
            self._schedule_setup_queue_poll()
            if self.parent_pid is not None:
                self._watch_parent_process()

        def _configure_window_metrics(self) -> None:
            screen_height = self.root.winfo_screenheight()
            target_height = round(screen_height * self.viewport_height_ratio)
            self.window_height = min(
                self.max_window_height,
                max(self.min_window_height, target_height),
            )
            scale = self.window_height / self.height
            self.window_collapsed_width = round(self.collapsed_width * scale)
            self.window_expanded_width = round(self.expanded_width * scale)
            self.window_expanded_gap = round(self.expanded_gap * scale)
            self.default_top = round(screen_height * self.top_offset_ratio)

        def _watch_parent_process(self) -> None:
            if self.parent_pid is not None and not _process_is_alive(self.parent_pid):
                self.root.destroy()
                return
            self.root.after(1000, self._watch_parent_process)

        def _schedule_setup_queue_poll(self) -> None:
            if self._setup_poll_scheduled:
                return
            self._setup_poll_scheduled = True
            self.root.after(120, self._poll_setup_queue)

        def _poll_setup_queue(self) -> None:
            self._setup_poll_scheduled = False
            changed = False
            while True:
                try:
                    event, payload = self._setup_queue.get_nowait()
                except queue.Empty:
                    break
                changed = True
                if event == "status_started":
                    self.setup_detection_error = ""
                    for state in self.setup_states.values():
                        state.state = "checking"
                        state.detail = "检测中..."
                elif event == "status_done":
                    self.setup_states.update(setup_states_from_install_status(payload))
                    self.setup_detection_error = ""
                    self._setup_status_thread_running = False
                elif event == "status_error":
                    self.setup_detection_error = str(payload)
                    for state in self.setup_states.values():
                        if state.state == "checking":
                            state.state = "failed"
                            state.detail = "检测失败"
                    self._setup_status_thread_running = False
                elif event == "install_log":
                    platform, text = payload
                    if text:
                        self.setup_logs.append((platform, text))
                        self.setup_logs = self.setup_logs[-80:]
                elif event == "install_done":
                    platform, success = payload
                    self.setup_installing_platform = None
                    state = self.setup_states[platform]
                    state.state = "checking" if success else "failed"
                    state.detail = "安装完成，正在刷新状态" if success else "安装失败"
                    self._start_setup_status_refresh()
                elif event == "install_error":
                    platform, message = payload
                    self.setup_installing_platform = None
                    state = self.setup_states[platform]
                    state.state = "failed"
                    state.detail = str(message)
                    self.setup_logs.append((platform, str(message)))
                    self.setup_logs = self.setup_logs[-80:]
            if changed and self.expanded and self.active_panel == "agents" and self.agent_setup_open:
                self._draw()
            self._schedule_setup_queue_poll()

        def _start_setup_status_refresh(self) -> None:
            if self._setup_status_thread_running:
                return
            self._setup_status_thread_running = True

            def worker() -> None:
                self._setup_queue.put(("status_started", None))
                url = f"{self.api_base}/system/install-status"
                try:
                    request = urllib.request.Request(url, headers={"Accept": "application/json"})
                    with urllib.request.urlopen(request, timeout=12) as response:
                        payload = json.loads(response.read().decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("install-status response was not an object")
                    self._setup_queue.put(("status_done", payload))
                except (OSError, ValueError, urllib.error.URLError) as exc:
                    self._setup_queue.put(("status_error", f"{type(exc).__name__}: {exc}"))

            threading.Thread(target=worker, daemon=True).start()

        def _start_setup_install(self, platform: SetupPlatform) -> None:
            if self.setup_installing_platform is not None:
                return
            info = next(item for item in SETUP_PLATFORMS if item.id == platform)
            self.setup_installing_platform = platform
            self.setup_states[platform].state = "installing"
            self.setup_states[platform].detail = "安装中..."
            self.setup_logs = [(platform, f"开始安装 {info.name}")]

            def worker() -> None:
                url = f"{self.api_base}/{info.install_path}"
                try:
                    request = urllib.request.Request(url, method="POST")
                    with urllib.request.urlopen(request, timeout=900) as response:
                        for raw_line in response:
                            line = raw_line.decode("utf-8", errors="replace")
                            event = parse_sse_data_line(line)
                            if not event:
                                continue
                            event_type = event.get("type")
                            if event_type == "output" and event.get("text") is not None:
                                self._setup_queue.put(
                                    ("install_log", (platform, str(event.get("text"))))
                                )
                            elif event_type == "node_status":
                                step = event.get("step", "node")
                                self._setup_queue.put(
                                    ("install_log", (platform, f"Node.js: {step}"))
                                )
                            elif event_type == "node_progress":
                                text = event.get("text") or event.get("percent")
                                if text is not None:
                                    self._setup_queue.put(
                                        ("install_log", (platform, f"Node.js: {text}"))
                                    )
                            elif event_type == "npm_install_start":
                                self._setup_queue.put(
                                    ("install_log", (platform, "开始执行 npm install"))
                                )
                            elif event_type == "done":
                                self._setup_queue.put(
                                    ("install_done", (platform, bool(event.get("success"))))
                                )
                                return
                            elif event_type == "error":
                                message = event.get("message") or "安装失败"
                                self._setup_queue.put(("install_error", (platform, str(message))))
                                return
                    self._setup_queue.put(
                        ("install_error", (platform, "安装流结束，但没有收到完成事件"))
                    )
                except (OSError, urllib.error.URLError) as exc:
                    self._setup_queue.put(("install_error", (platform, f"{type(exc).__name__}: {exc}")))

            threading.Thread(target=worker, daemon=True).start()

        def _set_geometry(self) -> None:
            width = (
                self.window_collapsed_width + self.window_expanded_gap + self.window_expanded_width
                if self.expanded
                else self.window_collapsed_width
            )
            self.root.geometry(f"{width}x{self.window_height}+{self.left}+{self.top}")
            self.canvas.configure(width=width, height=self.window_height)

        def _draw(self) -> None:
            self._destroy_settings_widgets()
            self.canvas.delete("all")
            self._hitboxes = []
            self._focus_order = []
            self._cost_limit_app_select_geometry = None
            self._cost_limit_amount_entry_geometry = None
            self._cost_limit_duration_entry_geometry = None
            self._cost_limit_unit_select_geometry = None
            self._draw_collapsed_sidebar()
            self.canvas.addtag_all("collapsed")
            if self.expanded:
                before_items = set(self.canvas.find_all())
                self._draw_expanded_panel()
                for item in set(self.canvas.find_all()) - before_items:
                    self.canvas.addtag_withtag("expanded", item)
            self._scale_scene()
            if self.expanded and self.active_panel == "settings":
                self._mount_cost_limit_controls()

        @property
        def _collapsed_scale_x(self) -> float:
            return self.window_collapsed_width / self.collapsed_width

        @property
        def _expanded_scale_x(self) -> float:
            return self.window_expanded_width / self.expanded_width

        @property
        def _scale_y(self) -> float:
            return self.window_height / self.height

        @property
        def _font_scale(self) -> float:
            return max(0.75, self._scale_y * self.font_scale_ratio)

        @property
        def _expanded_origin(self) -> int:
            return self.collapsed_width + self.expanded_gap

        @property
        def _window_expanded_origin(self) -> int:
            return self.window_collapsed_width + self.window_expanded_gap

        def _scale_scene(self) -> None:
            self.canvas.scale("collapsed", 0, 0, self._collapsed_scale_x, self._scale_y)
            self._scale_item_styles("collapsed", min(self._collapsed_scale_x, self._scale_y))
            if not self.expanded:
                return
            self.canvas.scale(
                "expanded",
                self._expanded_origin,
                0,
                self._expanded_scale_x,
                self._scale_y,
            )
            self.canvas.move(
                "expanded",
                self._window_expanded_origin - self._expanded_origin,
                0,
            )
            self._scale_item_styles("expanded", min(self._expanded_scale_x, self._scale_y))

        def _scale_item_styles(self, tag: str, scale: float) -> None:
            for item in self.canvas.find_withtag(tag):
                item_type = self.canvas.type(item)
                if is_scalable_canvas_width_item(item_type):
                    width = self.canvas.itemcget(item, "width")
                else:
                    width = ""
                if width:
                    try:
                        current_width = float(width)
                    except ValueError:
                        pass
                    else:
                        if current_width > 0:
                            scaled_width = max(1, int(round(current_width * scale)))
                            self.canvas.itemconfigure(item, width=scaled_width)

                if item_type != "text":
                    continue
                font_value = self.canvas.itemcget(item, "font")
                if not font_value:
                    continue
                font = tkfont.Font(root=self.root, font=font_value)
                actual = font.actual()
                size = max(1, int(round(abs(actual["size"]) * self._font_scale)))
                style: list[str] = []
                if actual["weight"] != "normal":
                    style.append(actual["weight"])
                if actual["slant"] != "roman":
                    style.append(actual["slant"])
                self.canvas.itemconfigure(item, font=(actual["family"], size, *style))

        def _window_x(self, x: int) -> int:
            if x <= self.collapsed_width:
                return round(x * self._collapsed_scale_x)
            return round(
                self._window_expanded_origin + (x - self._expanded_origin) * self._expanded_scale_x
            )

        def _window_y(self, y: int) -> int:
            return round(y * self._scale_y)

        def _design_y(self, y: int) -> float:
            return y / self._scale_y

        def _draw_collapsed_sidebar(self) -> None:
            self._rounded_rect(
                0,
                0,
                self.collapsed_width,
                self.height,
                16,
                fill=self.bg,
                outline=self.border,
                width=1,
            )
            self._draw_collapsed_logo(43, 70)
            self._draw_pet(43, 228)
            self._draw_risk_badge(43, 400)
            self._draw_settings(43, 634)

        def _rounded_rect(
            self,
            x1: int,
            y1: int,
            x2: int,
            y2: int,
            radius: int,
            *,
            fill: str,
            outline: str = "",
            width: int = 1,
        ) -> None:
            r = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)
            self.canvas.create_rectangle(x1 + r, y1, x2 - r, y2, fill=fill, outline="")
            self.canvas.create_rectangle(x1, y1 + r, x2, y2 - r, fill=fill, outline="")
            self.canvas.create_oval(x1, y1, x1 + 2 * r, y1 + 2 * r, fill=fill, outline="")
            self.canvas.create_oval(x2 - 2 * r, y1, x2, y1 + 2 * r, fill=fill, outline="")
            self.canvas.create_oval(x1, y2 - 2 * r, x1 + 2 * r, y2, fill=fill, outline="")
            self.canvas.create_oval(x2 - 2 * r, y2 - 2 * r, x2, y2, fill=fill, outline="")
            if not outline:
                return
            self.canvas.create_line(x1 + r, y1, x2 - r, y1, fill=outline, width=width)
            self.canvas.create_line(x1 + r, y2, x2 - r, y2, fill=outline, width=width)
            self.canvas.create_line(x1, y1 + r, x1, y2 - r, fill=outline, width=width)
            self.canvas.create_line(x2, y1 + r, x2, y2 - r, fill=outline, width=width)
            self.canvas.create_arc(
                x1,
                y1,
                x1 + 2 * r,
                y1 + 2 * r,
                start=90,
                extent=90,
                style="arc",
                outline=outline,
                width=width,
            )
            self.canvas.create_arc(
                x2 - 2 * r,
                y1,
                x2,
                y1 + 2 * r,
                start=0,
                extent=90,
                style="arc",
                outline=outline,
                width=width,
            )
            self.canvas.create_arc(
                x1,
                y2 - 2 * r,
                x1 + 2 * r,
                y2,
                start=180,
                extent=90,
                style="arc",
                outline=outline,
                width=width,
            )
            self.canvas.create_arc(
                x2 - 2 * r,
                y2 - 2 * r,
                x2,
                y2,
                start=270,
                extent=90,
                style="arc",
                outline=outline,
                width=width,
            )

        def _ellipsize(
            self, text: str, font: tuple[str, int] | tuple[str, int, str], max_width: int
        ) -> str:
            font_measure = tkfont.Font(root=self.root, font=font)
            if font_measure.measure(text) <= max_width:
                return text

            suffix = "…"
            if font_measure.measure(suffix) > max_width:
                return ""

            low = 0
            high = len(text)
            while low < high:
                mid = (low + high + 1) // 2
                if font_measure.measure(f"{text[:mid]}{suffix}") <= max_width:
                    low = mid
                else:
                    high = mid - 1
            return f"{text[:low]}{suffix}"

        def _draw_text_line(
            self,
            x: int,
            y: int,
            *,
            text: str,
            fill: str,
            font: tuple[str, int] | tuple[str, int, str],
            max_width: int,
        ) -> None:
            self.canvas.create_text(
                x,
                y,
                anchor="nw",
                text=self._ellipsize(text, font, max_width),
                fill=fill,
                font=font,
            )

        def _draw_shield(self, cx: int, cy: int) -> None:
            self._rounded_rect(
                cx - 25, cy - 25, cx + 25, cy + 25, 10, fill="#101923", outline="#182637"
            )
            points = [
                cx,
                cy - 18,
                cx + 16,
                cy - 10,
                cx + 13,
                cy + 10,
                cx,
                cy + 20,
                cx - 13,
                cy + 10,
                cx - 16,
                cy - 10,
            ]
            self.canvas.create_line(*points, fill=self.text, width=3, smooth=True)
            self.canvas.create_line(cx, cy - 10, cx, cy + 10, fill=self.text, width=2)

        def _draw_collapsed_logo(self, cx: int, cy: int) -> None:
            logo_image = self._get_collapsed_logo_image()
            if logo_image is None:
                self._draw_shield(cx, cy)
                return
            self.canvas.create_image(cx, cy, image=logo_image, anchor="center")

        def _get_collapsed_logo_image(self) -> tk.PhotoImage | None:
            if self._collapsed_logo_image is not None:
                return self._collapsed_logo_image
            logo_path = get_xsafeclaw_logo_path()
            if logo_path is None:
                return None
            try:
                source = tk.PhotoImage(file=str(logo_path))
                crop_left, crop_top, crop_right, crop_bottom = get_collapsed_logo_crop_box(
                    source.width(),
                    source.height(),
                )
                crop_width = crop_right - crop_left
                crop_height = crop_bottom - crop_top
                cropped = tk.PhotoImage(width=crop_width, height=crop_height)
                cropped.tk.call(
                    cropped,
                    "copy",
                    source,
                    "-from",
                    crop_left,
                    crop_top,
                    crop_right,
                    crop_bottom,
                    "-to",
                    0,
                    0,
                )
                self._collapsed_logo_source = source
                subsample_factor = get_collapsed_logo_subsample_factor(max(crop_width, crop_height))
                self._collapsed_logo_image = cropped.subsample(subsample_factor, subsample_factor)
            except tk.TclError:
                self._collapsed_logo_source = None
                self._collapsed_logo_image = None
            return self._collapsed_logo_image

        def _get_page_logo_image(self) -> tk.PhotoImage | None:
            if self._page_logo_image is not None:
                return self._page_logo_image
            logo_path = get_xsafeclaw_logo_path()
            if logo_path is None:
                return None
            try:
                source = tk.PhotoImage(file=str(logo_path))
                crop_left, crop_top, crop_right, crop_bottom = get_collapsed_logo_crop_box(
                    source.width(),
                    source.height(),
                )
                crop_width = crop_right - crop_left
                crop_height = crop_bottom - crop_top
                cropped = tk.PhotoImage(width=crop_width, height=crop_height)
                cropped.tk.call(
                    cropped,
                    "copy",
                    source,
                    "-from",
                    crop_left,
                    crop_top,
                    crop_right,
                    crop_bottom,
                    "-to",
                    0,
                    0,
                )
                self._page_logo_source = source
                subsample_factor = get_collapsed_logo_subsample_factor(
                    max(crop_width, crop_height),
                    target_size=40,
                )
                self._page_logo_image = cropped.subsample(subsample_factor, subsample_factor)
            except tk.TclError:
                self._page_logo_source = None
                self._page_logo_image = None
            return self._page_logo_image

        def _get_settings_icon_image(self) -> tk.PhotoImage | None:
            if self._settings_icon_image is not None:
                return self._settings_icon_image
            icon_path = get_sidebar_setting_icon_path()
            if icon_path is None:
                return None
            try:
                source = tk.PhotoImage(file=str(icon_path))
                self._settings_icon_source = source
                subsample_factor = get_collapsed_logo_subsample_factor(
                    max(source.width(), source.height()),
                    target_size=62,
                )
                self._settings_icon_image = source.subsample(subsample_factor, subsample_factor)
            except tk.TclError:
                self._settings_icon_source = None
                self._settings_icon_image = None
            return self._settings_icon_image

        def _get_agent_icon_image(self) -> tk.PhotoImage | None:
            if self.pet_state in self._agent_icon_images:
                return self._agent_icon_images[self.pet_state]
            icon_path = get_sidebar_agent_icon_path(self.pet_state)
            if icon_path is None:
                return None
            try:
                source = tk.PhotoImage(file=str(icon_path))
                self._agent_icon_sources[self.pet_state] = source
                subsample_factor = get_collapsed_logo_subsample_factor(
                    max(source.width(), source.height()),
                    target_size=68,
                )
                image = source.subsample(subsample_factor, subsample_factor)
                self._agent_icon_images[self.pet_state] = image
            except tk.TclError:
                self._agent_icon_sources.pop(self.pet_state, None)
                self._agent_icon_images.pop(self.pet_state, None)
                return None
            return self._agent_icon_images[self.pet_state]

        def _draw_pet(self, cx: int, cy: int) -> None:
            agent_icon = self._get_agent_icon_image()
            if agent_icon is not None:
                self.canvas.create_image(cx, cy, image=agent_icon, anchor="center")
                return
            self._draw_pet_fallback(cx, cy)

        def _draw_pet_fallback(self, cx: int, cy: int) -> None:
            self._rounded_rect(
                cx - 34,
                cy - 50,
                cx + 34,
                cy + 50,
                10,
                fill="#101923",
                outline=self.risk_hot,
                width=1,
            )
            self._rounded_rect(
                cx - 31, cy - 47, cx + 31, cy + 47, 9, fill="#111923", outline="#36141A", width=1
            )
            body = "#D9534F" if self.pet_state == "typing" else "#B84C4A"
            claw = "#FF6A32" if self.pet_state == "typing" else "#D85A33"
            self.canvas.create_oval(
                cx - 18, cy - 16, cx + 18, cy + 20, fill=body, outline="#7C231C", width=1
            )
            self.canvas.create_oval(cx - 8, cy - 8, cx - 2, cy - 2, fill="#1B0D0E", outline="")
            self.canvas.create_oval(cx + 2, cy - 8, cx + 8, cy - 2, fill="#1B0D0E", outline="")
            self.canvas.create_arc(
                cx - 10,
                cy,
                cx + 10,
                cy + 15,
                start=200,
                extent=140,
                style="arc",
                outline="#FFB076",
                width=1,
            )
            self.canvas.create_line(cx - 17, cy - 8, cx - 31, cy - 35, fill=claw, width=4)
            self.canvas.create_line(cx + 17, cy - 8, cx + 31, cy - 35, fill=claw, width=4)
            self.canvas.create_arc(
                cx - 42,
                cy - 50,
                cx - 18,
                cy - 23,
                start=275,
                extent=235,
                style="arc",
                outline=claw,
                width=7,
            )
            self.canvas.create_arc(
                cx + 18,
                cy - 50,
                cx + 42,
                cy - 23,
                start=30,
                extent=235,
                style="arc",
                outline=claw,
                width=7,
            )
            if self.pet_state == "typing":
                self._rounded_rect(
                    cx - 27, cy + 20, cx + 27, cy + 38, 3, fill="#12161D", outline="#47505B"
                )
                for row in range(2):
                    for col in range(6):
                        x = cx - 21 + col * 8
                        y = cy + 25 + row * 6
                        self.canvas.create_rectangle(x, y, x + 5, y + 3, fill="#5D6570", outline="")
            else:
                self.canvas.create_text(
                    cx + 20, cy - 24, text="Z", fill=self.muted, font=("Segoe UI", 12, "bold")
                )

        def _draw_risk_badge(self, cx: int, cy: int) -> None:
            text = get_risk_badge_text(self.pending_risk_count)
            if not text:
                return
            self.canvas.create_oval(cx - 32, cy - 32, cx + 32, cy + 32, fill="#240B12", outline="")
            self.canvas.create_oval(
                cx - 27, cy - 27, cx + 27, cy + 27, fill="#FF2531", outline="#111822", width=3
            )
            self.canvas.create_arc(
                cx - 27,
                cy - 27,
                cx + 27,
                cy + 27,
                start=40,
                extent=160,
                style="arc",
                outline="#FF6E6E",
                width=4,
            )
            self.canvas.create_text(
                cx, cy + 1, text=text, fill="#FFFFFF", font=("Segoe UI", 26, "bold")
            )

        def _draw_settings(self, cx: int, cy: int) -> None:
            if self.active_panel == "settings":
                self._rounded_rect(
                    cx - 31,
                    cy - 61,
                    cx + 31,
                    cy + 61,
                    8,
                    fill="#0D1B2A",
                    outline="#0A84FF",
                    width=1,
                )
            settings_icon = self._get_settings_icon_image()
            if settings_icon is not None:
                self.canvas.create_image(cx, cy, image=settings_icon, anchor="center")
                return
            self._draw_settings_fallback(cx, cy)

        def _draw_settings_fallback(self, cx: int, cy: int) -> None:
            self.canvas.create_oval(cx - 18, cy - 18, cx + 18, cy + 18, outline="#C5CAD1", width=3)
            self.canvas.create_oval(cx - 6, cy - 6, cx + 6, cy + 6, outline="#C5CAD1", width=3)
            for dx, dy in ((0, -23), (0, 23), (-23, 0), (23, 0)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=4)
            for dx, dy in ((17, -17), (-17, -17), (17, 17), (-17, 17)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=3)

        def _draw_expanded_panel(self) -> None:
            x = self.collapsed_width + self.expanded_gap
            if self.active_panel == "agents":
                if self.agent_setup_open:
                    self._draw_agent_setup_panel(x)
                    return
                if self.agent_detail_app:
                    self._draw_session_panel(x)
                    return
                self._draw_agents_app_panel(x)
                return
            if self.active_panel == "riskApproval":
                self._draw_risk_approval_panel(x)
                return
            if self.active_panel == "settings":
                self._draw_settings_panel(x)
                return

            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                13,
                fill=self.panel_bg,
                outline=self.border,
            )
            title_by_panel = {
                "agents": "智能体页",
                "riskApproval": "风险审批页",
                "settings": "设置页",
            }
            self.canvas.create_text(
                x + 20, 28, anchor="w", text="XSafeClaw", fill=self.muted, font=("Segoe UI", 9)
            )
            self.canvas.create_text(
                x + 20,
                58,
                anchor="w",
                text=title_by_panel[self.active_panel],
                fill=self.text,
                font=("Segoe UI", 16, "bold"),
            )
            for i, line in enumerate(self._panel_lines()):
                self.canvas.create_text(
                    x + 20,
                    102 + i * 26,
                    anchor="w",
                    text=line,
                    fill="#B8C0CC",
                    font=("Segoe UI", 10),
                )

        def _panel_lines(self) -> list[str]:
            if self.active_panel == "agents":
                pet = "打字" if self.pet_state == "typing" else "睡觉"
                return [
                    f"宠物状态：{pet}",
                    "OpenClaw：ready",
                    "Hermes：working",
                    "Nanobot：blocked",
                ]
            if self.active_panel == "riskApproval":
                return [self._risk_tooltip_text(), "默认展示第一条待处理风险。"]
            return ["设置页前端占位。", "本阶段不接入真实设置功能。"]

        def _draw_settings_panel(self, x: int) -> None:
            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                18,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )
            self.canvas.create_text(
                x + 32,
                34,
                anchor="nw",
                text="设置",
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_text_line(
                x + 32,
                88,
                text="安全策略与成本控制",
                fill=self.muted,
                font=(self.ui_font, 17),
                max_width=420,
            )
            self._draw_collapse_button(x + self.expanded_width - 72, 38)
            self._draw_cost_limit_section(x)
            self._draw_approval_mode_section(x)

        def _draw_cost_limit_section(self, x: int) -> None:
            content_x = x + 32
            content_width = self.expanded_width - 64
            top = 138
            bottom = 424
            self._rounded_rect(
                content_x,
                top,
                content_x + content_width,
                bottom,
                14,
                fill=self.card_bg,
                outline=self.card_border,
                width=1,
            )

            self._draw_cost_icon(content_x + 48, top + 60)
            self.canvas.create_text(
                content_x + 108,
                top + 46,
                anchor="nw",
                text="成本上限",
                fill=self.text,
                font=(self.ui_font, 26, "bold"),
            )

            self._draw_text_line(
                content_x + 50,
                top + 126,
                text="选择应用",
                fill=self.muted,
                font=(self.ui_font, 18),
                max_width=220,
            )
            self._rounded_rect(
                content_x + 50,
                top + 156,
                content_x + 270,
                top + 214,
                9,
                fill="#111922",
                outline="#46515E",
                width=1,
            )
            self._cost_limit_app_select_geometry = (content_x + 54, top + 160, 212, 50)

            divider_x = content_x + content_width // 2 - 14
            self.canvas.create_line(
                divider_x,
                top + 106,
                divider_x,
                top + 206,
                fill="#32404C",
                width=1,
            )

            input_x = divider_x + 44
            self._draw_text_line(
                input_x,
                top + 126,
                text="成本限制",
                fill=self.muted,
                font=(self.ui_font, 18),
                max_width=260,
            )
            app_select_y = top + 156
            control_outer_h = 58
            control_inner_offset = 4
            control_inner_h = 50
            control_center_offset = control_outer_h // 2
            amount_w = 70
            duration_w = 58
            unit_w = 82
            gap = 8
            row_y = app_select_y
            self._rounded_rect(
                input_x,
                row_y,
                input_x + amount_w,
                row_y + control_outer_h,
                9,
                fill="#111922",
                outline="#46515E",
                width=1,
            )
            self._cost_limit_amount_entry_geometry = (
                input_x + control_inner_offset,
                row_y + control_inner_offset,
                amount_w - control_inner_offset * 2,
                control_inner_h,
            )
            usd_x = input_x + amount_w + gap + 19
            self.canvas.create_text(
                usd_x,
                row_y + control_center_offset,
                text="USD",
                fill=self.muted,
                font=(self.ui_font, 17),
            )
            duration_x = input_x + amount_w + gap + 38 + gap
            self._rounded_rect(
                duration_x,
                row_y,
                duration_x + duration_w,
                row_y + control_outer_h,
                9,
                fill="#111922",
                outline="#46515E",
                width=1,
            )
            self._cost_limit_duration_entry_geometry = (
                duration_x + control_inner_offset,
                row_y + control_inner_offset,
                duration_w - control_inner_offset * 2,
                control_inner_h,
            )
            unit_x = duration_x + duration_w + gap
            self._rounded_rect(
                unit_x,
                row_y,
                unit_x + unit_w,
                row_y + control_outer_h,
                9,
                fill="#111922",
                outline="#46515E",
                width=1,
            )
            self._cost_limit_unit_select_geometry = (
                unit_x + control_inner_offset,
                row_y + control_inner_offset,
                unit_w - control_inner_offset * 2,
                control_inner_h,
            )
            self.canvas.create_text(
                unit_x + unit_w - 14,
                row_y + control_center_offset,
                text="▾",
                fill=self.muted,
                font=(self.ui_font, 18),
            )

        def _draw_cost_icon(self, cx: int, cy: int) -> None:
            self.canvas.create_oval(cx - 36, cy - 36, cx + 36, cy + 36, fill="#0D5C36", outline="")
            self.canvas.create_oval(
                cx - 24, cy - 24, cx + 24, cy + 24, fill="#20A957", outline="#36C275", width=1
            )
            self.canvas.create_text(
                cx, cy + 1, text="$", fill="#D8FFE4", font=(self.ui_font, 30, "bold")
            )

        def _validate_numeric_settings_input(self, proposed: str) -> bool:
            return proposed.isdigit() or proposed == ""

        def _settings_widget_geometry(
            self, geometry: tuple[int, int, int, int]
        ) -> tuple[int, int, int, int]:
            design_x, design_y, design_width, design_height = geometry
            x = self._window_x(design_x)
            y = self._window_y(design_y)
            width = self._window_x(design_x + design_width) - x
            height = self._window_y(design_y + design_height) - y
            return x, y, max(24, width), max(18, height)

        def _destroy_settings_widgets(self) -> None:
            for widget in self._settings_widgets:
                widget.destroy()
            self._settings_widgets = []

        def _mount_cost_limit_controls(self) -> None:
            if self._cost_limit_app_select_geometry is not None:
                self._mount_settings_select(
                    self._cost_limit_app_select_geometry,
                    self.cost_limit_app,
                    ("OpenClaw", "Hermes", "Nanobot"),
                    self._set_cost_limit_app,
                )
            if self._cost_limit_amount_entry_geometry is not None:
                self._mount_settings_entry(
                    self._cost_limit_amount_entry_geometry,
                    self.cost_limit_amount,
                    "金额",
                    self._set_cost_limit_amount,
                )
            if self._cost_limit_duration_entry_geometry is not None:
                self._mount_settings_entry(
                    self._cost_limit_duration_entry_geometry,
                    self.cost_limit_duration,
                    "时长",
                    self._set_cost_limit_duration,
                )
            if self._cost_limit_unit_select_geometry is not None:
                self._mount_settings_select(
                    self._cost_limit_unit_select_geometry,
                    self.cost_limit_unit,
                    ("分钟", "小时", "天"),
                    self._set_cost_limit_unit,
                )

        def _mount_settings_entry(
            self,
            geometry: tuple[int, int, int, int],
            value: str,
            placeholder: str,
            setter: Callable[[str], None],
        ) -> None:
            x, y, width, height = self._settings_widget_geometry(geometry)
            font_size = max(1, int(round(24 * self._font_scale)))
            placeholder_font_size = max(1, int(round(15 * self._font_scale)))
            validate_command = (self.root.register(self._validate_numeric_settings_input), "%P")
            entry = tk.Entry(
                self.canvas,
                justify="center",
                bg="#111922",
                fg=self.text if value else self.weak,
                insertbackground=self.text,
                disabledbackground="#111922",
                disabledforeground=self.text,
                relief="flat",
                borderwidth=0,
                highlightthickness=0,
                font=(
                    self.ui_font,
                    font_size if value else placeholder_font_size,
                    "bold" if value else "normal",
                ),
            )
            state = {"placeholder": not value}
            entry.insert(0, value or placeholder)
            entry.configure(validate="key", validatecommand=validate_command)

            def clear_placeholder() -> None:
                if not state["placeholder"]:
                    return
                entry.configure(fg=self.text, font=(self.ui_font, font_size, "bold"))
                entry.delete(0, "end")
                state["placeholder"] = False

            def show_placeholder() -> None:
                entry.configure(validate="none")
                entry.configure(fg=self.weak, font=(self.ui_font, placeholder_font_size))
                entry.delete(0, "end")
                entry.insert(0, placeholder)
                entry.configure(validate="key", validatecommand=validate_command)
                state["placeholder"] = True

            def handle_focus_in(_event: tk.Event) -> None:
                clear_placeholder()

            def handle_key_release(_event: tk.Event) -> None:
                if not state["placeholder"]:
                    setter(entry.get())

            def handle_focus_out(_event: tk.Event) -> None:
                if entry.get():
                    setter(entry.get())
                    return
                setter("")
                show_placeholder()

            entry.bind("<FocusIn>", handle_focus_in)
            entry.bind("<KeyRelease>", handle_key_release)
            entry.bind("<FocusOut>", handle_focus_out)
            entry.place(x=x, y=y, width=width, height=height)
            self._settings_widgets.append(entry)

        def _mount_settings_select(
            self,
            geometry: tuple[int, int, int, int],
            value: str,
            options: tuple[str, ...],
            setter: Callable[[str], None],
        ) -> None:
            x, y, width, height = self._settings_widget_geometry(geometry)
            font_size = max(1, int(round(17 * self._font_scale)))
            button = tk.Menubutton(
                self.canvas,
                text=f"{value}  ▾",
                bg="#111922",
                fg=self.text,
                activebackground="#172231",
                activeforeground=self.text,
                relief="flat",
                borderwidth=0,
                highlightthickness=0,
                anchor="center",
                font=(self.ui_font, font_size, "bold"),
            )
            menu = tk.Menu(
                button,
                tearoff=False,
                bg="#111922",
                fg=self.text,
                activebackground="#172231",
                activeforeground=self.text,
                borderwidth=0,
                font=(self.ui_font, font_size),
            )
            for option in options:
                menu.add_command(
                    label=option,
                    command=lambda selected=option: self._select_settings_option(
                        button, selected, setter
                    ),
                )
            button.configure(menu=menu)
            button.place(x=x, y=y, width=width, height=height)
            self._settings_widgets.append(button)

        def _select_settings_option(
            self, button: tk.Menubutton, selected: str, setter: Callable[[str], None]
        ) -> None:
            setter(selected)
            button.configure(text=f"{selected}  ▾")

        def _set_cost_limit_app(self, value: str) -> None:
            self.cost_limit_app = value

        def _set_cost_limit_amount(self, value: str) -> None:
            self.cost_limit_amount = value

        def _set_cost_limit_duration(self, value: str) -> None:
            self.cost_limit_duration = value

        def _set_cost_limit_unit(self, value: str) -> None:
            self.cost_limit_unit = value

        def _draw_approval_mode_section(self, x: int) -> None:
            content_x = x + 32
            content_width = self.expanded_width - 64
            top = 452
            bottom = 740
            self._rounded_rect(
                content_x,
                top,
                content_x + content_width,
                bottom,
                14,
                fill=self.card_bg,
                outline=self.card_border,
                width=1,
            )

            self._draw_settings_shield_badge(content_x + 48, top + 60)
            self.canvas.create_text(
                content_x + 108,
                top + 46,
                anchor="nw",
                text="审批模式",
                fill=self.text,
                font=(self.ui_font, 26, "bold"),
            )

            option_gap = 30
            option_x = content_x + 32
            option_y = top + 124
            option_area_width = content_width - 64
            option_width = (option_area_width - option_gap) // 2
            self._draw_approval_mode_option(
                "settings_approval:all",
                "全部拦截",
                option_x,
                option_y,
                option_width,
                116,
                self.approval_mode == "all",
            )
            self._draw_approval_mode_option(
                "settings_approval:smart",
                "智能拦截",
                option_x + option_width + option_gap,
                option_y,
                option_width,
                116,
                self.approval_mode == "smart",
            )

        def _draw_settings_shield_badge(self, cx: int, cy: int) -> None:
            self.canvas.create_oval(cx - 36, cy - 36, cx + 36, cy + 36, fill="#0B3768", outline="")
            points = [
                cx,
                cy - 25,
                cx + 20,
                cy - 16,
                cx + 17,
                cy + 13,
                cx,
                cy + 28,
                cx - 17,
                cy + 13,
                cx - 20,
                cy - 16,
            ]
            self.canvas.create_line(*points, fill="#5FD0FF", width=5, smooth=True)
            self.canvas.create_line(cx, cy - 16, cx, cy + 15, fill="#6EDBFF", width=2)

        def _draw_approval_mode_option(
            self,
            key: str,
            label: str,
            x: int,
            y: int,
            width: int,
            height: int,
            selected: bool,
        ) -> None:
            outline = "#0A84FF" if selected else "#46515E"
            fill = "#102033" if selected else "#111922"
            if self._focused_key == key:
                outline = self.focus
            self._rounded_rect(x, y, x + width, y + height, 12, fill=fill, outline=outline, width=1)
            dot_size = 24
            gap = 18
            font = (self.ui_font, 20, "bold")
            text_width = tkfont.Font(root=self.root, font=font).measure(label)
            group_width = dot_size + gap + text_width
            group_left = x + (width - group_width) // 2
            circle_x = group_left + dot_size // 2
            circle_y = y + height // 2
            self.canvas.create_oval(
                circle_x - 12,
                circle_y - 12,
                circle_x + 12,
                circle_y + 12,
                fill="",
                outline="#0A84FF" if selected else "#A8B0BA",
                width=3,
            )
            if selected:
                self.canvas.create_oval(
                    circle_x - 5,
                    circle_y - 5,
                    circle_x + 5,
                    circle_y + 5,
                    fill="#0A84FF",
                    outline="",
                )
            self.canvas.create_text(
                group_left + dot_size + gap,
                circle_y,
                anchor="w",
                text=label,
                fill=self.text,
                font=font,
            )
            self._add_hitbox(key, x, y, x + width, y + height)

        def _draw_risk_approval_panel(self, x: int) -> None:
            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                18,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )

            self._draw_page_icon(x + 32, 28)
            self.canvas.create_text(
                x + 112,
                30,
                anchor="nw",
                text="风险审批",
                fill=self.text,
                font=(self.ui_font, 28, "bold"),
            )
            self._draw_text_line(
                x + 112,
                84,
                text=f"待处理 {self.pending_risk_count} 个审批请求",
                fill=self.muted,
                font=(self.ui_font, 16),
                max_width=360,
            )
            self._draw_collapse_button(x + 710, 38)

            self._draw_risk_toolbar(x)
            self._draw_risk_cards(x)
            if self.risk_sort_dropdown_open:
                self._draw_risk_sort_dropdown(x)
            self._draw_risk_footer(x)

        def _draw_risk_toolbar(self, x: int) -> None:
            self._rounded_rect(x + 32, 106, x + 728, 158, 10, fill="", outline="", width=0)
            selector_layout = get_risk_sort_selector_layout(x, self.risk_sort_dropdown_open)
            self._rounded_rect(
                int(selector_layout["left"]),
                int(selector_layout["top"]),
                int(selector_layout["right"]),
                int(selector_layout["bottom"]),
                9,
                fill="#121A23",
                outline=self.card_border,
                width=1,
            )
            sort_label = "按时间顺序" if self.risk_sort_mode == "time" else "按风险级别"
            self.canvas.create_text(
                int(selector_layout["label_center_x"]),
                int(selector_layout["label_center_y"]),
                anchor=str(selector_layout["label_anchor"]),
                text=self._ellipsize(
                    sort_label,
                    (self.ui_font, 16),
                    int(selector_layout["label_max_width"]),
                ),
                fill="#C5CBD2",
                font=(self.ui_font, 16),
            )
            self.canvas.create_line(
                int(selector_layout["arrow_left"]),
                int(selector_layout["arrow_top"]),
                int(selector_layout["arrow_center_x"]),
                int(selector_layout["arrow_bottom"]),
                fill="#8F98A3",
                width=2,
            )
            self.canvas.create_line(
                int(selector_layout["arrow_center_x"]),
                int(selector_layout["arrow_bottom"]),
                int(selector_layout["arrow_right"]),
                int(selector_layout["arrow_top"]),
                fill="#8F98A3",
                width=2,
            )
            self._add_hitbox(
                "risk_sort_selector",
                int(selector_layout["left"]),
                int(selector_layout["top"]),
                int(selector_layout["right"]),
                int(selector_layout["bottom"]),
            )

        def _draw_risk_sort_dropdown(self, x: int) -> None:
            dropdown_left = x + 550
            dropdown_top = 156
            dropdown_right = x + 728
            option_height = 36
            options: list[tuple[RiskSortMode, str]] = [
                ("risk", "按风险级别"),
                ("time", "按时间顺序"),
            ]
            self._rounded_rect(
                dropdown_left,
                dropdown_top,
                dropdown_right,
                dropdown_top + option_height * len(options),
                9,
                fill="#121A23",
                outline=self.card_border,
                width=1,
            )
            for index, (mode, label) in enumerate(options):
                option_top = dropdown_top + option_height * index
                if mode == self.risk_sort_mode:
                    self._rounded_rect(
                        dropdown_left + 4,
                        option_top + 4,
                        dropdown_right - 4,
                        option_top + option_height - 4,
                        7,
                        fill="#172532",
                        outline="",
                        width=0,
                    )
                self._draw_text_line(
                    dropdown_left + 16,
                    option_top + 10,
                    text=label,
                    fill="#C5CBD2",
                    font=(self.ui_font, 15),
                    max_width=130,
                )
                self._add_hitbox(
                    f"risk_sort_option:{mode}",
                    dropdown_left,
                    option_top,
                    dropdown_right,
                    option_top + option_height,
                )

        def _draw_risk_footer(self, x: int) -> None:
            footer_layout = get_risk_footer_layout(x)
            self._draw_alert_circle_icon(
                int(footer_layout["icon_x"]),
                int(footer_layout["icon_y"]),
            )
            hint_text = (
                "按时间顺序展示，优先处理最近发生的请求"
                if self.risk_sort_mode == "time"
                else "按风险级别从高到低展示，优先处理高风险请求"
            )
            self._draw_text_line(
                int(footer_layout["hint_text_x"]),
                int(footer_layout["hint_text_y"]),
                text=hint_text,
                fill=self.muted,
                font=(self.ui_font, 15),
                max_width=460,
            )
            self._draw_text_line(
                int(footer_layout["history_text_x"]),
                int(footer_layout["history_text_y"]),
                text="查看已处理记录",
                fill="#C5CBD2",
                font=(self.ui_font, 15),
                max_width=110,
            )
            self.canvas.create_text(
                int(footer_layout["history_arrow_x"]),
                int(footer_layout["history_arrow_y"]),
                text="›",
                fill="#8F98A3",
                font=(self.ui_font, 18, "bold"),
            )
            self._add_hitbox(
                "risk_view_history",
                int(footer_layout["history_hitbox_left"]),
                int(footer_layout["history_hitbox_top"]),
                int(footer_layout["history_hitbox_right"]),
                int(footer_layout["history_hitbox_bottom"]),
            )

        def _draw_risk_cards(self, x: int) -> None:
            if not self.risk_approval_cards:
                self._draw_risk_empty_state(x + 32, 170)
                return
            card_y = 170
            for card in self.risk_approval_cards[:3]:
                self._draw_risk_approval_card(x + 32, card_y, card)
                card_y += 154

        def _draw_risk_approval_card(self, x: int, y: int, card: RiskApprovalCard) -> None:
            palette = self._risk_palette(card.risk_level)
            outline = palette["outline"]
            if self._focused_key == f"risk_detail:{card.id}":
                outline = self.focus

            self._rounded_rect(
                x, y, x + 696, y + 134, 14, fill=palette["fill"], outline=outline, width=1
            )
            self.canvas.create_line(x + 14, y, x + 682, y, fill=palette["accent"], width=1)

            self.canvas.create_oval(
                x + 18,
                y + 20,
                x + 40,
                y + 42,
                fill=palette["accent"],
                outline="",
            )
            marker_text = "!"
            if card.risk_level == "low":
                marker_text = "i"
            self.canvas.create_text(
                x + 29,
                y + 31,
                text=marker_text,
                fill="#FFFFFF",
                font=(self.ui_font, 14, "bold"),
            )

            self.canvas.create_oval(
                x + 42,
                y + 34,
                x + 100,
                y + 92,
                fill="#080D13",
                outline="#1F2A34",
            )
            self._draw_app_icon(card.icon_type, x + 71, y + 63)

            self._draw_text_line(
                x + 126,
                y + 20,
                text=card.title,
                fill=self.text,
                font=(self.ui_font, 17),
                max_width=300,
            )
            self._draw_text_line(
                x + 126,
                y + 60,
                text=card.description,
                fill="#B6BEC8",
                font=(self.ui_font, 14),
                max_width=300,
            )

            self._draw_risk_card_tags(x + 126, y + 90, card)
            self._draw_text_line(
                x + 290,
                y + 93,
                text=card.occurred_text,
                fill="#8F98A3",
                font=(self.ui_font, 14),
                max_width=130,
            )

            self._draw_risk_card_actions(x + 442, y + 49, card.id)
            self.canvas.create_text(
                x + 672,
                y + 67,
                text="›",
                fill=self.muted,
                font=(self.ui_font, 28, "bold"),
            )
            self._add_hitbox(f"risk_detail:{card.id}", x + 650, y + 45, x + 694, y + 89)

        def _draw_risk_card_actions(self, x: int, y: int, card_id: str) -> None:
            buttons: list[tuple[str, str, int, str, str]] = [
                ("allow_once", "允许一次", 72, "#0D2D45", "#58C7FF"),
                ("always_allow_session", "总是允许", 78, "#3A2B13", "#FFB020"),
                ("block", "阻止", 58, "#3A1416", "#FF4A4A"),
            ]
            button_x = x
            for action, label, width, fill, outline in buttons:
                key = f"approval:{card_id}:{action}"
                focused = self._focused_key == key
                self._rounded_rect(
                    button_x,
                    y,
                    button_x + width,
                    y + 36,
                    8,
                    fill=fill,
                    outline=self.focus if focused else outline,
                    width=1,
                )
                self.canvas.create_text(
                    button_x + width // 2,
                    y + 18,
                    text=label,
                    fill=outline,
                    font=(self.ui_font, 14, "bold"),
                )
                self._add_hitbox(key, button_x, y, button_x + width, y + 36)
                button_x += width + 8

        def _draw_risk_card_tags(self, x: int, y: int, card: RiskApprovalCard) -> None:
            risk_palette = self._risk_palette(card.risk_level)
            risk_tag_width = 58
            op_tag_width = 74
            self._rounded_rect(
                x,
                y,
                x + risk_tag_width,
                y + 26,
                6,
                fill=risk_palette["tag_fill"],
                outline="",
                width=0,
            )
            self.canvas.create_text(
                x + risk_tag_width // 2,
                y + 13,
                text=card.risk_label,
                fill=risk_palette["tag_text"],
                font=(self.ui_font, 13, "bold"),
            )

            op_x = x + risk_tag_width + 10
            self._rounded_rect(
                op_x,
                y,
                op_x + op_tag_width,
                y + 26,
                6,
                fill="#18202A",
                outline=self.card_border,
                width=1,
            )
            self._draw_text_line(
                op_x + 8,
                y + 5,
                text=card.operation_type,
                fill="#AAB2BC",
                font=(self.ui_font, 12),
                max_width=op_tag_width - 16,
            )

        def _risk_palette(self, level: RiskLevel) -> dict[str, str]:
            if level == "high":
                return {
                    "fill": "#151014",
                    "outline": "#773234",
                    "accent": "#FF3030",
                    "tag_fill": "#3A181A",
                    "tag_text": "#FF5A5A",
                }
            if level == "medium":
                return {
                    "fill": "#17130F",
                    "outline": "#7A5A2B",
                    "accent": "#FF9F0A",
                    "tag_fill": "#3F2E12",
                    "tag_text": "#FFB020",
                }
            return {
                "fill": "#0F1713",
                "outline": "#2F6A43",
                "accent": "#18D158",
                "tag_fill": "#173A24",
                "tag_text": "#22E36A",
            }

        def _draw_risk_empty_state(self, x: int, y: int) -> None:
            self._rounded_rect(
                x,
                y,
                x + 696,
                y + 520,
                14,
                fill="#10161D",
                outline=self.card_border,
                width=1,
            )
            self.canvas.create_text(
                x + 348,
                y + 232,
                text="暂无待审批请求",
                fill=self.text,
                font=(self.ui_font, 22, "bold"),
            )
            self.canvas.create_text(
                x + 348,
                y + 274,
                text="当前智能体操作均在安全范围内",
                fill=self.muted,
                font=(self.ui_font, 16),
            )

        def _draw_agents_app_panel(self, x: int) -> None:
            content_x = x + 32
            content_width = self.expanded_width - 64
            bottom_gap = 24
            bottom_width = (content_width - bottom_gap) // 2
            bottom_right_x = content_x + bottom_width + bottom_gap

            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                18,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )

            self.canvas.create_text(
                x + 32,
                34,
                anchor="nw",
                text="智能体",
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_setup_button(x + self.expanded_width - 124, 38)
            self._draw_collapse_button(x + self.expanded_width - 72, 38)

            card_y = 146
            for app in MOCK_AGENT_APPS:
                self._draw_agent_app_card(content_x, card_y, app, content_width)
                card_y += 108

            self._draw_current_active_card(content_x, 470, bottom_width)
            self._draw_risk_summary_card(bottom_right_x, 470, bottom_width)

        def _draw_page_icon(self, x: int, y: int) -> None:
            self._rounded_rect(
                x,
                y,
                x + 56,
                y + 56,
                12,
                fill="#121A23",
                outline=self.card_border,
                width=1,
            )
            logo_image = self._get_page_logo_image()
            if logo_image is not None:
                self.canvas.create_image(x + 28, y + 28, image=logo_image, anchor="center")

        def _draw_collapse_button(self, x: int, y: int, key: str = "collapse") -> None:
            if self._focused_key == key:
                self._rounded_rect(x, y, x + 40, y + 40, 8, fill="#172231", outline=self.focus)
            self.canvas.create_text(
                x + 20,
                y + 20,
                text="<<",
                fill="#C5CBD2",
                font=(self.ui_font, 22, "bold"),
            )
            self._add_hitbox(key, x, y, x + 40, y + 40)

        def _draw_setup_button(self, x: int, y: int) -> None:
            key = "open_agent_setup"
            outline = self.focus if self._focused_key == key else self.card_border
            self._rounded_rect(x, y, x + 40, y + 40, 8, fill="#172231", outline=outline)
            self.canvas.create_text(
                x + 20,
                y + 19,
                text="+",
                fill="#C5CBD2",
                font=(self.ui_font, 24, "bold"),
            )
            self._add_hitbox(key, x, y, x + 40, y + 40)

        def _draw_agent_app_card(self, x: int, y: int, app: AgentAppStatus, width: int) -> None:
            is_pending = app.risk_state == "pending"
            fill = "#151B20" if is_pending else self.card_bg
            outline = "#A15D14" if is_pending else self.card_border
            if self._focused_key == app.id:
                outline = self.focus

            self._rounded_rect(x, y, x + width, y + 90, 14, fill=fill, outline=outline, width=1)
            if is_pending:
                self.canvas.create_line(x + 14, y, x + width - 14, y, fill="#FF9F0A", width=1)

            self.canvas.create_oval(
                x + 24, y + 16, x + 82, y + 74, fill="#080D13", outline="#1F2A34"
            )
            self._draw_app_icon(app.icon_type, x + 53, y + 45)

            self._draw_text_line(
                x + 112,
                y + 12,
                text=app.app_name,
                fill=self.text,
                font=(self.ui_font, 21),
                max_width=width - 250,
            )
            if app.id == "app_nanobot":
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text="3 个会话 ·",
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=width - 360,
                )
                self._draw_text_line(
                    x + 340,
                    y + 53,
                    text="1 个待确认",
                    fill=self.pending_text,
                    font=(self.ui_font, 16, "bold"),
                    max_width=width - 450,
                )
            else:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=app.status_text,
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=width - 230,
                )

            dot = self.pending if is_pending else self.ok
            self.canvas.create_oval(
                x + width - 82, y + 40, x + width - 62, y + 60, fill=dot, outline=""
            )
            self.canvas.create_text(
                x + width - 28,
                y + 45,
                text="›",
                fill=self.muted,
                font=(self.ui_font, 28, "bold"),
            )
            self._add_hitbox(app.id, x, y, x + width, y + 90)

        def _setup_state_label(self, state: SetupRuntimeState) -> tuple[str, str]:
            if state.state == "checking":
                return "检测中", self.pending_text
            if state.state == "installed":
                return "已安装", self.ok
            if state.state == "missing":
                return "未安装", self.weak
            if state.state == "installing":
                return "安装中", self.pending_text
            if state.state == "failed":
                return "失败", self.risk
            return "待检测", self.weak

        def _draw_agent_setup_panel(self, x: int) -> None:
            content_x = x + 32
            content_width = self.expanded_width - 64
            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                18,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )
            self.canvas.create_text(
                x + 32,
                34,
                anchor="nw",
                text="安装",
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_text_line(
                x + 32,
                82,
                text="安装 OpenClaw / Hermes / Nanobot",
                fill=self.muted,
                font=(self.ui_font, 17),
                max_width=480,
            )
            self._draw_collapse_button(x + self.expanded_width - 72, 38, key="back_to_agent_apps")

            if self.setup_detection_error:
                self._draw_text_line(
                    content_x,
                    116,
                    text=f"检测失败：{self.setup_detection_error}",
                    fill=self.risk,
                    font=(self.ui_font, 13),
                    max_width=content_width,
                )

            card_y = 138
            for platform in SETUP_PLATFORMS:
                self._draw_setup_platform_card(content_x, card_y, platform, content_width)
                card_y += 120
            self._draw_setup_logs_card(content_x, 526, content_width)

        def _draw_setup_platform_card(
            self, x: int, y: int, platform: SetupPlatformInfo, width: int
        ) -> None:
            state = self.setup_states[platform.id]
            label, color = self._setup_state_label(state)
            installing_other = (
                self.setup_installing_platform is not None
                and self.setup_installing_platform != platform.id
            )
            can_install = state.state in {"missing", "failed"} and not installing_other
            outline = self.focus if self._focused_key == f"setup_install:{platform.id}" else self.card_border
            if state.state == "failed":
                outline = "#803333"
            elif state.state == "installing":
                outline = "#A15D14"

            self._rounded_rect(x, y, x + width, y + 104, 14, fill=self.card_bg, outline=outline)
            self.canvas.create_oval(x + 24, y + 22, x + 82, y + 80, fill="#080D13", outline="#1F2A34")
            self._draw_app_icon(platform.icon_type, x + 53, y + 51)
            center_y = y + 52
            title_font = (self.ui_font, 21, "bold")
            status_font = (self.ui_font, 15, "bold")
            self.canvas.create_text(
                x + 112,
                center_y,
                anchor="w",
                text=self._ellipsize(platform.name, title_font, width - 360),
                fill=self.text,
                font=title_font,
            )
            self.canvas.create_oval(
                x + width - 294,
                y + 44,
                x + width - 278,
                y + 60,
                fill=color,
                outline="",
            )
            self.canvas.create_text(
                x + width - 270,
                center_y,
                anchor="w",
                text=self._ellipsize(label, status_font, 110),
                fill=color,
                font=status_font,
            )

            button_x = x + width - 144
            button_y = y + 32
            button_fill = "#182333" if can_install else "#121820"
            button_outline = "#2F8E55" if can_install else self.card_border
            self._rounded_rect(
                button_x,
                button_y,
                button_x + 112,
                button_y + 42,
                10,
                fill=button_fill,
                outline=button_outline,
            )
            button_text = "安装"
            button_color = self.text if can_install else self.weak
            if state.state == "installed":
                button_text = "已检测到"
            elif state.state == "installing":
                button_text = "安装中"
            elif installing_other:
                button_text = "等待"
            self.canvas.create_text(
                button_x + 56,
                button_y + 21,
                text=button_text,
                fill=button_color,
                font=(self.ui_font, 15, "bold"),
            )
            if can_install:
                self._add_hitbox(
                    f"setup_install:{platform.id}",
                    button_x,
                    button_y,
                    button_x + 112,
                    button_y + 42,
                )

        def _draw_setup_logs_card(self, x: int, y: int, width: int) -> None:
            self._rounded_rect(x, y, x + width, y + 184, 14, fill=self.card_bg, outline=self.card_border)
            self.canvas.create_text(
                x + 24,
                y + 18,
                anchor="nw",
                text="安装日志",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            lines = self.setup_logs[-7:]
            if not lines:
                self._draw_text_line(
                    x + 24,
                    y + 58,
                    text="点击安装后，这里会显示下载与安装进度。",
                    fill=self.muted,
                    font=(self.ui_font, 14),
                    max_width=width - 48,
                )
                return
            platform_name = {item.id: item.name for item in SETUP_PLATFORMS}
            for index, (platform, text) in enumerate(lines):
                prefix = platform_name.get(platform, platform)
                self._draw_text_line(
                    x + 24,
                    y + 54 + index * 18,
                    text=f"{prefix}: {text}",
                    fill=self.body_text,
                    font=(self.ui_font, 12),
                    max_width=width - 48,
                )

        def _draw_session_panel(self, x: int) -> None:
            app_name = self.agent_detail_app or "Nanobot"
            content_x = x + 32
            content_width = self.expanded_width - 64
            bottom_gap = 24
            bottom_width = (content_width - bottom_gap) // 2
            bottom_right_x = content_x + bottom_width + bottom_gap

            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                18,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )

            self.canvas.create_text(
                x + 32,
                34,
                anchor="nw",
                text=app_name,
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_collapse_button(x + self.expanded_width - 72, 38, key="back_to_agent_apps")

            card_y = 146
            for session in MOCK_SIDEBAR_SESSIONS:
                self._draw_session_card(content_x, card_y, session, content_width)
                card_y += 108

            selected = self._selected_session()
            self._draw_selected_session_card(content_x, 470, selected, bottom_width)
            self._draw_session_model_card(bottom_right_x, 470, selected, bottom_width)

        def _selected_session(self) -> SidebarSessionStatus:
            for session in MOCK_SIDEBAR_SESSIONS:
                if session.id == self.selected_session_id:
                    return session
            return MOCK_SIDEBAR_SESSIONS[0]

        def _session_status_text(self, session: SidebarSessionStatus) -> str:
            if session.pending_risk_count:
                return f"{session.activity_text} · {session.pending_risk_count} 个待确认"
            return f"{session.activity_text} · 无风险"

        def _draw_session_card(
            self, x: int, y: int, session: SidebarSessionStatus, width: int
        ) -> None:
            selected = session.id == self.selected_session_id
            is_pending = session.pending_risk_count > 0
            outline = "#A15D14" if selected or is_pending else self.card_border
            fill = "#151B20" if selected or is_pending else self.card_bg
            if self._focused_key == session.id:
                outline = self.focus

            self._rounded_rect(x, y, x + width, y + 90, 14, fill=fill, outline=outline, width=1)
            if selected or is_pending:
                self.canvas.create_line(x + 14, y, x + width - 14, y, fill="#FF9F0A", width=1)

            self.canvas.create_oval(
                x + 24, y + 16, x + 82, y + 74, fill="#080D13", outline="#1F2A34"
            )
            self._draw_app_icon(session.icon_type, x + 53, y + 45)
            self._draw_text_line(
                x + 112,
                y + 18,
                text=session.display_session_id,
                fill=self.text,
                font=(self.ui_font, 21, "bold"),
                max_width=width - 250,
            )

            if is_pending:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=f"{session.activity_text} ·",
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=width - 360,
                )
                self._draw_text_line(
                    x + 340,
                    y + 53,
                    text=f"{session.pending_risk_count} 个待确认",
                    fill=self.pending_text,
                    font=(self.ui_font, 16, "bold"),
                    max_width=width - 450,
                )
            else:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=self._session_status_text(session),
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=width - 230,
                )

            dot = self.pending if is_pending else self.ok
            if session.status in {"waiting", "idle"}:
                dot = "#8A939E"
            self.canvas.create_oval(
                x + width - 82, y + 40, x + width - 62, y + 60, fill=dot, outline=""
            )
            self.canvas.create_text(
                x + width - 28,
                y + 45,
                text="›",
                fill=self.muted,
                font=(self.ui_font, 28, "bold"),
            )
            self._add_hitbox(session.id, x, y, x + width, y + 90)

        def _draw_selected_session_card(
            self, x: int, y: int, session: SidebarSessionStatus, width: int
        ) -> None:
            self._rounded_rect(
                x, y, x + width, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=self.ok, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#0F5F31", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="当前会话",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=session.display_session_id,
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 60,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=f"最近活动：{session.activity_text}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 60,
            )
            self._draw_text_line(
                x + 26,
                y + 124,
                text=f"最近消息：{session.latest_message}",
                fill=self.weak,
                font=(self.ui_font, 13),
                max_width=width - 60,
            )

        def _draw_session_model_card(
            self, x: int, y: int, session: SidebarSessionStatus, width: int
        ) -> None:
            self._rounded_rect(
                x, y, x + width, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            dot = self.pending if session.pending_risk_count else self.ok
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=dot, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#704C0A", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="模型 / 来源",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=f"模型：{session.model_text}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 52,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=f"来源：{session.source_text}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 52,
            )
            self.canvas.create_text(
                x + 26,
                y + 124,
                anchor="nw",
                text="风险：",
                fill=self.weak,
                font=(self.ui_font, 13),
            )
            risk_text = (
                f"{session.pending_risk_count} 个待确认" if session.pending_risk_count else "无风险"
            )
            self._draw_text_line(
                x + 76,
                y + 124,
                text=risk_text,
                fill=self.pending_text if session.pending_risk_count else self.body_text,
                font=(self.ui_font, 13, "bold") if session.pending_risk_count else (self.ui_font, 13),
                max_width=width - 112,
            )

        def _draw_app_icon(self, icon_type: IconType, cx: int, cy: int) -> None:
            if icon_type == "openclaw":
                for offset in (-15, 0, 15):
                    self.canvas.create_line(
                        cx + offset - 7,
                        cy + 16,
                        cx + offset + 8,
                        cy - 16,
                        fill=self.text,
                        width=8,
                        capstyle="round",
                    )
                return
            if icon_type == "hermes":
                gold = "#D9A441"
                light = "#F2C56B"
                self.canvas.create_polygon(
                    cx,
                    cy + 21,
                    cx - 23,
                    cy - 19,
                    cx - 4,
                    cy - 4,
                    fill=gold,
                    outline=light,
                )
                self.canvas.create_polygon(
                    cx,
                    cy + 21,
                    cx + 23,
                    cy - 19,
                    cx + 4,
                    cy - 4,
                    fill=gold,
                    outline=light,
                )
                self.canvas.create_rectangle(
                    cx - 6, cy - 8, cx + 6, cy + 24, fill=gold, outline=light
                )
                return
            if icon_type == "document":
                self.canvas.create_rectangle(
                    cx - 15, cy - 22, cx + 13, cy + 21, fill="#DDE3EA", outline="#8F98A3"
                )
                self.canvas.create_polygon(
                    cx + 3,
                    cy - 22,
                    cx + 13,
                    cy - 12,
                    cx + 3,
                    cy - 12,
                    fill="#AEB8C3",
                    outline="#8F98A3",
                )
                for line_y in (cy - 6, cy + 3, cy + 12):
                    self.canvas.create_line(cx - 9, line_y, cx + 7, line_y, fill="#5B6570", width=2)
                return
            if icon_type == "cleaner":
                self.canvas.create_line(cx + 11, cy - 22, cx - 7, cy + 8, fill="#C9D2DC", width=7)
                self.canvas.create_rectangle(
                    cx - 18, cy + 8, cx + 4, cy + 24, fill="#AEB8C3", outline="#6F7A86"
                )
                for offset in (-12, -4, 4):
                    self.canvas.create_line(
                        cx + offset, cy + 24, cx + offset - 6, cy + 34, fill="#8F98A3", width=2
                    )
                self.canvas.create_oval(
                    cx - 31, cy + 7, cx - 25, cy + 13, fill="#8F98A3", outline=""
                )
                self.canvas.create_oval(
                    cx - 21, cy - 2, cx - 15, cy + 4, fill="#8F98A3", outline=""
                )
                return

            self.canvas.create_oval(
                cx - 22, cy - 20, cx + 22, cy + 20, fill="#253543", outline="#79D8FF"
            )
            self.canvas.create_rectangle(
                cx - 20, cy - 4, cx + 20, cy + 18, fill="#182331", outline="#253543"
            )
            self.canvas.create_oval(cx - 11, cy - 4, cx - 4, cy + 3, fill="#37CFFF", outline="")
            self.canvas.create_oval(cx + 4, cy - 4, cx + 11, cy + 3, fill="#37CFFF", outline="")
            self.canvas.create_line(cx, cy - 20, cx, cy - 31, fill="#79D8FF", width=3)
            self.canvas.create_oval(cx - 4, cy - 36, cx + 4, cy - 28, fill="#37CFFF", outline="")

        def _draw_current_active_card(self, x: int, y: int, width: int) -> None:
            self._rounded_rect(
                x, y, x + width, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=self.ok, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#0F5F31", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="当前活跃",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=f"{MOCK_CURRENT_ACTIVE.app_name} / {MOCK_CURRENT_ACTIVE.session_display_id}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 60,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=MOCK_CURRENT_ACTIVE.activity,
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=width - 60,
            )
            self._draw_text_line(
                x + 26,
                y + 124,
                text=f"最近消息：{MOCK_CURRENT_ACTIVE.latest_message}",
                fill=self.weak,
                font=(self.ui_font, 13),
                max_width=width - 60,
            )
            self.canvas.create_line(
                x + 26, y + 178, x + width - 26, y + 178, fill="#303946", width=1
            )
            self._draw_hint_icon(x + 30, y + 213)
            self.canvas.create_text(
                x + 72,
                y + 204,
                anchor="nw",
                text="点击应用卡片查看详情",
                fill=self.weak,
                font=(self.ui_font, 14),
            )

        def _draw_risk_summary_card(self, x: int, y: int, width: int) -> None:
            self._rounded_rect(
                x, y, x + width, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            self._draw_shield_watermark(x + width - 67, y + 154)
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=self.pending, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#704C0A", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="风险状态",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=MOCK_RISK_SUMMARY.text,
                fill=self.pending_text,
                font=(self.ui_font, 17, "bold"),
                max_width=width - 52,
            )
            self._draw_text_line(
                x + 26,
                y + 98,
                text=MOCK_RISK_SUMMARY.hint,
                fill=self.muted,
                font=(self.ui_font, 15),
                max_width=width - 52,
            )

        def _draw_hint_icon(self, x: int, y: int) -> None:
            self._rounded_rect(
                x,
                y,
                x + 22,
                y + 17,
                4,
                fill="",
                outline=self.weak,
                width=2,
            )
            self.canvas.create_line(x + 7, y + 17, x + 4, y + 23, fill=self.weak, width=2)
            for dot_x in (x + 7, x + 11, x + 15):
                self.canvas.create_oval(dot_x, y + 7, dot_x + 2, y + 9, fill=self.weak, outline="")

        def _draw_alert_circle_icon(self, x: int, y: int) -> None:
            self.canvas.create_oval(
                x,
                y,
                x + 18,
                y + 18,
                fill="",
                outline="#8F98A3",
                width=1,
            )
            self.canvas.create_text(
                x + 9,
                y + 9,
                text="!",
                fill="#AEB8C3",
                font=(self.ui_font, 11, "bold"),
            )

        def _draw_shield_watermark(self, cx: int, cy: int) -> None:
            points = [
                cx,
                cy - 24,
                cx + 24,
                cy - 12,
                cx + 20,
                cy + 16,
                cx,
                cy + 28,
                cx - 20,
                cy + 16,
                cx - 24,
                cy - 12,
            ]
            self.canvas.create_line(*points, fill="#17202A", width=5, smooth=True)

        def _add_hitbox(self, key: str, x1: int, y1: int, x2: int, y2: int) -> None:
            self._hitboxes.append(
                (
                    key,
                    self._window_x(x1),
                    self._window_y(y1),
                    self._window_x(x2),
                    self._window_y(y2),
                )
            )
            self._focus_order.append(key)

        def _start_drag(self, event: tk.Event) -> None:
            self._hide_tooltip()
            self._press_root_x = event.x_root
            self._press_root_y = event.y_root
            self._press_left = self.left
            self._press_top = self.top
            self._dragging = False

        def _drag(self, event: tk.Event) -> None:
            dx = event.x_root - self._press_root_x
            dy = event.y_root - self._press_root_y
            if abs(dx) < 4 and abs(dy) < 4 and not self._dragging:
                return
            self._dragging = True
            self.left = self._press_left + dx
            self.top = self._press_top + dy
            self._set_geometry()

        def _finish_click_or_drag(self, event: tk.Event) -> None:
            if self._dragging:
                self._dragging = False
                return
            self._handle_click(event)

        def _handle_click(self, event: tk.Event) -> None:
            if event.x > self.window_collapsed_width:
                self._handle_expanded_click(event.x, event.y)
                return

            panel = self._panel_for_y(event.y)
            if not panel:
                return
            self.active_panel = panel
            self.expanded = True
            self.risk_sort_dropdown_open = False
            if panel == "agents":
                self.agent_detail_app = None
                self.agent_setup_open = False
            self._focused_key = None
            self._set_geometry()
            self._draw()

        def _handle_expanded_click(self, x: int, y: int) -> None:
            for key, x1, y1, x2, y2 in reversed(self._hitboxes):
                if x1 <= x <= x2 and y1 <= y <= y2:
                    self._activate_key(key)
                    return
            if self.risk_sort_dropdown_open:
                self.risk_sort_dropdown_open = False
                self._draw()

        def _activate_key(self, key: str) -> None:
            parsed_approval = parse_approval_hitbox_key(key)
            if parsed_approval:
                card_id, action = parsed_approval
                print(f"[XSafeClaw Mock] approval action: card={card_id}, action={action}")
                self.risk_approval_cards = apply_risk_approval_action(
                    self.risk_approval_cards,
                    card_id=card_id,
                    action=action,
                )
                self.pending_risk_count = get_pending_risk_count_from_cards(
                    self.risk_approval_cards
                )
                self._focused_key = None
                self._draw()
                return
            if key == "risk_sort_selector":
                self.risk_sort_dropdown_open = not self.risk_sort_dropdown_open
                print("[XSafeClaw Mock] sort selector toggled")
                self._draw()
                return
            if key.startswith("risk_sort_option:"):
                sort_mode = key.split(":", 1)[1]
                if sort_mode in {"risk", "time"}:
                    self.risk_sort_mode = sort_mode
                    self.risk_approval_cards = sort_risk_approval_cards(
                        self.risk_approval_cards,
                        mode=self.risk_sort_mode,
                    )
                    self.risk_sort_dropdown_open = False
                    self._focused_key = None
                    print(f"[XSafeClaw Mock] sort risk approvals by {sort_mode}")
                    self._draw()
                return
            if key == "risk_view_history":
                print("[XSafeClaw Mock] view handled approvals")
                return
            if key.startswith("risk_detail:"):
                card_id = key.split(":", 1)[1]
                print(f"[XSafeClaw Mock] open risk detail: {card_id}")
                return
            if key.startswith("settings_approval:"):
                mode = key.split(":", 1)[1]
                if mode in {"all", "smart"}:
                    self.approval_mode = mode
                    self._focused_key = key
                    print(f"[XSafeClaw Mock] approval mode: {mode}")
                    self._draw()
                return
            if key == "collapse":
                self.expanded = False
                self._focused_key = None
                self._set_geometry()
                self._draw()
                return
            if key == "back_to_agent_apps":
                self.agent_detail_app = None
                self.agent_setup_open = False
                self._focused_key = None
                self._draw()
                return
            if key == "open_agent_setup":
                print("[XSafeClaw Setup] open native setup page")
                self.agent_detail_app = None
                self.agent_setup_open = True
                self._focused_key = None
                self._start_setup_status_refresh()
                self._draw()
                return
            if key.startswith("setup_install:"):
                platform = key.split(":", 1)[1]
                if platform in {"openclaw", "hermes", "nanobot"}:
                    print(f"[XSafeClaw Setup] install {platform}")
                    self._focused_key = key
                    self._start_setup_install(platform)  # type: ignore[arg-type]
                    self._draw()
                return
            app_by_key = {
                "app_openclaw": "OpenClaw",
                "app_hermes": "Hermes",
                "app_nanobot": "Nanobot",
            }
            app_name = app_by_key.get(key)
            if app_name:
                print(f"[XSafeClaw Mock] open app detail: {app_name}")
                self.agent_detail_app = app_name
                self.agent_setup_open = False
                self.selected_session_id = DEFAULT_SELECTED_SESSION_ID
                self._focused_key = None
                self._draw()
                return
            for session in MOCK_SIDEBAR_SESSIONS:
                if session.id == key:
                    print(f"[XSafeClaw Mock] select session: {session.display_session_id}")
                    self.selected_session_id = session.id
                    self._focused_key = key
                    self._draw()
                    return

        def _focus_next(self, event: tk.Event) -> str:
            if not self.expanded or not self._focus_order:
                return "break"
            if self._focused_key not in self._focus_order:
                self._focused_key = self._focus_order[0]
            else:
                current = self._focus_order.index(self._focused_key)
                self._focused_key = self._focus_order[(current + 1) % len(self._focus_order)]
            self._draw()
            return "break"

        def _activate_focused(self, event: tk.Event) -> str:
            if self._focused_key:
                self._activate_key(self._focused_key)
            return "break"

        def _handle_motion(self, event: tk.Event) -> None:
            if self._dragging:
                self.canvas.configure(cursor="fleur")
                self._hide_tooltip()
                return
            if event.x > self.window_collapsed_width:
                clickable = any(
                    x1 <= event.x <= x2 and y1 <= event.y <= y2
                    for _, x1, y1, x2, y2 in self._hitboxes
                )
                self.canvas.configure(cursor="hand2" if clickable else "")
                self._hide_tooltip()
                return
            panel = self._panel_for_y(event.y)
            if not panel:
                self.canvas.configure(cursor="")
                self._hide_tooltip()
                return
            self.canvas.configure(cursor="hand2")
            self._show_tooltip(self._tooltip_for_panel(panel), event.y)

        def _panel_for_y(self, y: int) -> ActivePanel | None:
            return get_collapsed_panel_for_design_y(self._design_y(y))

        def _tooltip_for_panel(self, panel: ActivePanel) -> str:
            if panel == "agents":
                return "智能体正在工作" if self.pet_state == "typing" else "暂无智能体工作"
            if panel == "riskApproval":
                return self._risk_tooltip_text()
            return "设置"

        def _risk_tooltip_text(self) -> str:
            if self.pending_risk_count <= 0:
                return "暂无风险审批"
            return f"{self.pending_risk_count} 个风险审批待处理"

        def _show_tooltip(self, text: str, y: int) -> None:
            self._hide_tooltip()
            self.tooltip = tk.Toplevel(self.root)
            self.tooltip.overrideredirect(True)
            self.tooltip.attributes("-topmost", True)
            label = tk.Label(
                self.tooltip,
                text=text,
                bg=self.soft,
                fg=self.text,
                padx=10,
                pady=8,
                font=("Segoe UI", 9),
            )
            label.pack()
            self.tooltip.geometry(
                f"+{self.left + self.window_collapsed_width + 8}" f"+{self.top + max(0, y - 48)}"
            )

        def _hide_tooltip(self) -> None:
            if self.tooltip is not None:
                self.tooltip.destroy()
                self.tooltip = None

        def mainloop(self) -> None:
            self.root.mainloop()

    SidebarWindow(parent_pid, api_base).mainloop()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent-pid", type=int, default=None)
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    args = parser.parse_args()
    run(args.parent_pid, args.api_base)


if __name__ == "__main__":
    main()
