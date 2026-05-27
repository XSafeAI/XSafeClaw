"""Standalone desktop floating Sidebar for XSafeClaw.

This module intentionally does not depend on the browser frontend.  It is
launched as a separate local process by the backend, so the floating Sidebar
keeps running after the browser tab/window is closed.  When launched by the
backend, it receives the backend PID and exits when that parent process exits.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from typing import Literal

AgentStatus = Literal["ready", "working", "blocked", "offline"]
ActivePanel = Literal["overview", "agents", "riskApproval", "settings"]
AgentPetState = Literal["typing", "sleeping"]
RiskState = Literal["safe", "pending", "blocked"]
IconType = Literal["openclaw", "hermes", "nanobot", "document", "cleaner"]
AgentInstanceRuntime = Literal["running", "waiting", "idle"]
RiskLevel = Literal["high", "medium", "low"]
ApprovalAction = Literal["allow_once", "always_allow_session", "block"]


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
    agent_name: str
    task: str
    latest_action: str


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
class AgentInstanceStatus:
    id: str
    app_name: Literal["Nanobot", "OpenClaw", "Hermes"]
    agent_name: str
    icon_type: IconType
    status: AgentInstanceRuntime
    task_text: str
    latest_action: str
    model_text: str
    permission_text: str
    pending_risk_count: int
    risk_state: RiskState


AGENTS: tuple[AgentItem, ...] = (
    AgentItem("openclaw", "OpenClaw", "ready", 0),
    AgentItem("hermes", "Hermes", "working", 0),
    AgentItem("nanobot", "Nanobot", "blocked", 1),
)

MOCK_AGENT_APPS: tuple[AgentAppStatus, ...] = (
    AgentAppStatus(
        "app_openclaw",
        "OpenClaw",
        "openclaw",
        2,
        0,
        "safe",
        "2 个 Agent 运行中 · 无风险",
    ),
    AgentAppStatus(
        "app_hermes",
        "Hermes",
        "hermes",
        1,
        0,
        "safe",
        "1 个 Agent 运行中 · 无风险",
    ),
    AgentAppStatus(
        "app_nanobot",
        "Nanobot",
        "nanobot",
        3,
        1,
        "pending",
        "3 个 Agent 运行中 · 1 个待确认",
    ),
)

MOCK_CURRENT_ACTIVE = CurrentActiveMock(
    app_name="Nanobot",
    agent_name="FileAgent",
    task="正在访问 Documents",
    latest_action="读取 ~/Documents/XSafeClaw",
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

MOCK_AGENT_INSTANCES: tuple[AgentInstanceStatus, ...] = (
    AgentInstanceStatus(
        id="nanobot_file_agent",
        app_name="Nanobot",
        agent_name="FileAgent",
        icon_type="nanobot",
        status="running",
        task_text="正在访问 Documents",
        latest_action="读取 ~/Documents/XSafeClaw",
        model_text="继承 App 默认 GPT-4.1",
        permission_text="读取 Documents",
        pending_risk_count=1,
        risk_state="pending",
    ),
    AgentInstanceStatus(
        id="nanobot_summary_agent",
        app_name="Nanobot",
        agent_name="SummaryAgent",
        icon_type="document",
        status="running",
        task_text="正在生成项目摘要",
        latest_action="读取项目文件索引",
        model_text="继承 App 默认 GPT-4.1",
        permission_text="读取项目目录",
        pending_risk_count=0,
        risk_state="safe",
    ),
    AgentInstanceStatus(
        id="nanobot_cleaner_agent",
        app_name="Nanobot",
        agent_name="CleanerAgent",
        icon_type="cleaner",
        status="waiting",
        task_text="等待中",
        latest_action="无最近动作",
        model_text="继承 App 默认 GPT-4.1",
        permission_text="未启用写入权限",
        pending_risk_count=0,
        risk_state="safe",
    ),
)

DEFAULT_SELECTED_AGENT_ID = "nanobot_file_agent"


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


def sort_risk_approval_cards(
    cards: tuple[RiskApprovalCard, ...] | list[RiskApprovalCard],
) -> list[RiskApprovalCard]:
    rank: dict[RiskLevel, int] = {"high": 0, "medium": 1, "low": 2}
    return sorted(cards, key=lambda card: rank[card.risk_level])


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


def run(parent_pid: int | None = None) -> None:
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

        def __init__(self, parent_pid: int | None) -> None:
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

            self.active_panel: ActivePanel = "overview"
            self.expanded = False
            self.tooltip: tk.Toplevel | None = None
            self.pet_state = get_agent_pet_state(AGENTS)
            self.risk_approval_cards = sort_risk_approval_cards(list(MOCK_RISK_APPROVAL_CARDS))
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
            self.selected_agent_id = DEFAULT_SELECTED_AGENT_ID
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

        def _set_geometry(self) -> None:
            width = (
                self.window_collapsed_width + self.window_expanded_gap + self.window_expanded_width
                if self.expanded
                else self.window_collapsed_width
            )
            self.root.geometry(f"{width}x{self.window_height}+{self.left}+{self.top}")
            self.canvas.configure(width=width, height=self.window_height)

        def _draw(self) -> None:
            self.canvas.delete("all")
            self._hitboxes = []
            self._focus_order = []
            self._draw_collapsed_sidebar()
            self.canvas.addtag_all("collapsed")
            if self.expanded:
                before_items = set(self.canvas.find_all())
                self._draw_expanded_panel()
                for item in set(self.canvas.find_all()) - before_items:
                    self.canvas.addtag_withtag("expanded", item)
            self._scale_scene()

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
                width = self.canvas.itemcget(item, "width")
                if item_type != "text" and width:
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
            self._draw_shield(43, 70)
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

        def _draw_pet(self, cx: int, cy: int) -> None:
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
            self.canvas.create_oval(cx - 18, cy - 18, cx + 18, cy + 18, outline="#C5CAD1", width=3)
            self.canvas.create_oval(cx - 6, cy - 6, cx + 6, cy + 6, outline="#C5CAD1", width=3)
            for dx, dy in ((0, -23), (0, 23), (-23, 0), (23, 0)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=4)
            for dx, dy in ((17, -17), (-17, -17), (17, 17), (-17, 17)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=3)

        def _draw_expanded_panel(self) -> None:
            x = self.collapsed_width + self.expanded_gap
            if self.active_panel == "agents":
                if self.agent_detail_app:
                    self._draw_agent_instance_panel(x)
                    return
                self._draw_agents_app_panel(x)
                return
            if self.active_panel == "riskApproval":
                self._draw_risk_approval_panel(x)
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
                "overview": "总览页",
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
            if self.active_panel == "overview":
                return ["当前为前端 Mock 展示。", f"待处理风险审批：{self.pending_risk_count}"]
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
                76,
                text=f"待处理 {self.pending_risk_count} 个审批请求",
                fill=self.muted,
                font=(self.ui_font, 16),
                max_width=360,
            )
            self._draw_collapse_button(x + 710, 38)

            self._draw_risk_toolbar(x)
            self._draw_risk_cards(x)
            self._draw_risk_footer(x)

        def _draw_risk_toolbar(self, x: int) -> None:
            self._rounded_rect(x + 32, 118, x + 728, 170, 10, fill="", outline="", width=0)
            self._rounded_rect(
                x + 625,
                126,
                x + 748,
                166,
                9,
                fill="#121A23",
                outline=self.card_border,
                width=1,
            )
            self._draw_text_line(
                x + 639,
                138,
                text="按风险级别",
                fill="#C5CBD2",
                font=(self.ui_font, 16),
                max_width=88,
            )
            self.canvas.create_line(x + 731, 142, x + 739, 150, fill="#8F98A3", width=2)
            self.canvas.create_line(x + 739, 150, x + 747, 142, fill="#8F98A3", width=2)
            self._add_hitbox("risk_sort_selector", x + 625, 126, x + 748, 166)

        def _draw_risk_footer(self, x: int) -> None:
            self._rounded_rect(
                x + 32,
                690,
                x + 728,
                738,
                10,
                fill="#10161D",
                outline=self.card_border,
                width=1,
            )
            self._draw_hint_icon(x + 48, 708)
            self._draw_text_line(
                x + 72,
                704,
                text="按风险级别从高到低展示，优先处理高风险请求",
                fill=self.muted,
                font=(self.ui_font, 15),
                max_width=460,
            )
            self._draw_text_line(
                x + 600,
                704,
                text="查看已处理记录",
                fill="#C5CBD2",
                font=(self.ui_font, 15),
                max_width=110,
            )
            self.canvas.create_text(
                x + 718,
                716,
                text="›",
                fill="#8F98A3",
                font=(self.ui_font, 18, "bold"),
            )
            self._add_hitbox("risk_view_history", x + 600, 704, x + 728, 726)

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
                y + 26,
                text=card.title,
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
                max_width=300,
            )
            self._draw_text_line(
                x + 126,
                y + 58,
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
                34,
                anchor="nw",
                text="智能体",
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_text_line(
                x + 112,
                80,
                text="3 个应用 · 6 个 Agent 运行中",
                fill=self.muted,
                font=(self.ui_font, 17),
                max_width=420,
            )
            self._draw_collapse_button(x + 598, 38)

            card_y = 146
            for app in MOCK_AGENT_APPS:
                self._draw_agent_app_card(x + 32, card_y, app)
                card_y += 108

            self._draw_current_active_card(x + 32, 470)
            self._draw_risk_summary_card(x + 356, 470)

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
            cx = x + 28
            cy = y + 28
            points = [
                cx,
                cy - 18,
                cx + 17,
                cy - 10,
                cx + 14,
                cy + 12,
                cx,
                cy + 21,
                cx - 14,
                cy + 12,
                cx - 17,
                cy - 10,
            ]
            self.canvas.create_line(*points, fill=self.text, width=3, smooth=True)

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

        def _draw_agent_app_card(self, x: int, y: int, app: AgentAppStatus) -> None:
            is_pending = app.risk_state == "pending"
            fill = "#151B20" if is_pending else self.card_bg
            outline = "#A15D14" if is_pending else self.card_border
            if self._focused_key == app.id:
                outline = self.focus

            self._rounded_rect(x, y, x + 606, y + 90, 14, fill=fill, outline=outline, width=1)
            if is_pending:
                self.canvas.create_line(x + 14, y, x + 592, y, fill="#FF9F0A", width=1)

            self.canvas.create_oval(
                x + 24, y + 16, x + 82, y + 74, fill="#080D13", outline="#1F2A34"
            )
            self._draw_app_icon(app.icon_type, x + 53, y + 45)

            self._draw_text_line(
                x + 112,
                y + 18,
                text=app.app_name,
                fill=self.text,
                font=(self.ui_font, 21, "bold"),
                max_width=260,
            )
            if app.id == "app_nanobot":
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text="3 个 Agent 运行中 ·",
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=230,
                )
                self._draw_text_line(
                    x + 340,
                    y + 53,
                    text="1 个待确认",
                    fill=self.pending_text,
                    font=(self.ui_font, 16, "bold"),
                    max_width=160,
                )
            else:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=app.status_text,
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=360,
                )

            dot = self.pending if is_pending else self.ok
            self.canvas.create_oval(x + 524, y + 40, x + 544, y + 60, fill=dot, outline="")
            self.canvas.create_text(
                x + 578,
                y + 45,
                text="›",
                fill=self.muted,
                font=(self.ui_font, 28, "bold"),
            )
            self._add_hitbox(app.id, x, y, x + 606, y + 90)

        def _draw_agent_instance_panel(self, x: int) -> None:
            app_name = self.agent_detail_app or "Nanobot"
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
                34,
                anchor="nw",
                text=app_name,
                fill=self.text,
                font=(self.ui_font, 30, "bold"),
            )
            self._draw_text_line(
                x + 112,
                80,
                text="3 个 Agent 运行中",
                fill=self.muted,
                font=(self.ui_font, 17),
                max_width=420,
            )
            self._draw_collapse_button(x + 598, 38, key="back_to_agent_apps")

            card_y = 146
            for agent in MOCK_AGENT_INSTANCES:
                self._draw_agent_instance_card(x + 32, card_y, agent)
                card_y += 108

            selected = self._selected_agent()
            self._draw_selected_agent_card(x + 32, 470, selected)
            self._draw_agent_model_card(x + 356, 470, selected)

        def _selected_agent(self) -> AgentInstanceStatus:
            for agent in MOCK_AGENT_INSTANCES:
                if agent.id == self.selected_agent_id:
                    return agent
            return MOCK_AGENT_INSTANCES[0]

        def _agent_status_text(self, agent: AgentInstanceStatus) -> str:
            if agent.pending_risk_count:
                return f"{agent.task_text} · {agent.pending_risk_count} 个待确认"
            return f"{agent.task_text} · 无风险"

        def _draw_agent_instance_card(self, x: int, y: int, agent: AgentInstanceStatus) -> None:
            selected = agent.id == self.selected_agent_id
            is_pending = agent.pending_risk_count > 0
            outline = "#A15D14" if selected or is_pending else self.card_border
            fill = "#151B20" if selected or is_pending else self.card_bg
            if self._focused_key == agent.id:
                outline = self.focus

            self._rounded_rect(x, y, x + 606, y + 90, 14, fill=fill, outline=outline, width=1)
            if selected or is_pending:
                self.canvas.create_line(x + 14, y, x + 592, y, fill="#FF9F0A", width=1)

            self.canvas.create_oval(
                x + 24, y + 16, x + 82, y + 74, fill="#080D13", outline="#1F2A34"
            )
            self._draw_app_icon(agent.icon_type, x + 53, y + 45)
            self._draw_text_line(
                x + 112,
                y + 18,
                text=agent.agent_name,
                fill=self.text,
                font=(self.ui_font, 21, "bold"),
                max_width=260,
            )

            if is_pending:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=f"{agent.task_text} ·",
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=230,
                )
                self._draw_text_line(
                    x + 340,
                    y + 53,
                    text=f"{agent.pending_risk_count} 个待确认",
                    fill=self.pending_text,
                    font=(self.ui_font, 16, "bold"),
                    max_width=160,
                )
            else:
                self._draw_text_line(
                    x + 112,
                    y + 53,
                    text=self._agent_status_text(agent),
                    fill=self.muted,
                    font=(self.ui_font, 16),
                    max_width=360,
                )

            dot = self.pending if is_pending else self.ok
            if agent.status in {"waiting", "idle"}:
                dot = "#8A939E"
            self.canvas.create_oval(x + 524, y + 40, x + 544, y + 60, fill=dot, outline="")
            self.canvas.create_text(
                x + 578,
                y + 45,
                text="›",
                fill=self.muted,
                font=(self.ui_font, 28, "bold"),
            )
            self._add_hitbox(agent.id, x, y, x + 606, y + 90)

        def _draw_selected_agent_card(self, x: int, y: int, agent: AgentInstanceStatus) -> None:
            self._rounded_rect(
                x, y, x + 300, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=self.ok, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#0F5F31", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="当前选中",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=agent.agent_name,
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=240,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=f"任务：{agent.task_text.replace('正在', '')}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=240,
            )
            self._draw_text_line(
                x + 26,
                y + 124,
                text=f"最近动作：{agent.latest_action}",
                fill=self.weak,
                font=(self.ui_font, 13),
                max_width=240,
            )

        def _draw_agent_model_card(self, x: int, y: int, agent: AgentInstanceStatus) -> None:
            self._rounded_rect(
                x, y, x + 282, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            dot = self.pending if agent.pending_risk_count else self.ok
            self.canvas.create_oval(x + 26, y + 24, x + 40, y + 38, fill=dot, outline="")
            self.canvas.create_oval(x + 22, y + 20, x + 44, y + 42, outline="#704C0A", width=3)
            self.canvas.create_text(
                x + 64,
                y + 20,
                anchor="nw",
                text="模型 / 权限",
                fill=self.text,
                font=(self.ui_font, 19, "bold"),
            )
            self._draw_text_line(
                x + 26,
                y + 68,
                text=f"模型：{agent.model_text}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=230,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=f"权限：{agent.permission_text}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=230,
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
                f"{agent.pending_risk_count} 个待确认" if agent.pending_risk_count else "无风险"
            )
            self._draw_text_line(
                x + 76,
                y + 124,
                text=risk_text,
                fill=self.pending_text if agent.pending_risk_count else self.body_text,
                font=(self.ui_font, 13, "bold") if agent.pending_risk_count else (self.ui_font, 13),
                max_width=170,
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

        def _draw_current_active_card(self, x: int, y: int) -> None:
            self._rounded_rect(
                x, y, x + 300, y + 266, 14, fill=self.card_bg, outline=self.card_border
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
                text=f"{MOCK_CURRENT_ACTIVE.app_name} / {MOCK_CURRENT_ACTIVE.agent_name}",
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=240,
            )
            self._draw_text_line(
                x + 26,
                y + 96,
                text=MOCK_CURRENT_ACTIVE.task,
                fill=self.body_text,
                font=(self.ui_font, 15),
                max_width=240,
            )
            self._draw_text_line(
                x + 26,
                y + 124,
                text=f"最近动作：{MOCK_CURRENT_ACTIVE.latest_action}",
                fill=self.weak,
                font=(self.ui_font, 13),
                max_width=240,
            )
            self.canvas.create_line(x + 26, y + 178, x + 274, y + 178, fill="#303946", width=1)
            self._draw_hint_icon(x + 30, y + 213)
            self.canvas.create_text(
                x + 72,
                y + 204,
                anchor="nw",
                text="点击应用卡片查看详情",
                fill=self.weak,
                font=(self.ui_font, 14),
            )

        def _draw_risk_summary_card(self, x: int, y: int) -> None:
            self._rounded_rect(
                x, y, x + 282, y + 266, 14, fill=self.card_bg, outline=self.card_border
            )
            self._draw_shield_watermark(x + 215, y + 154)
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
                max_width=210,
            )
            self._draw_text_line(
                x + 26,
                y + 98,
                text=MOCK_RISK_SUMMARY.hint,
                fill=self.muted,
                font=(self.ui_font, 15),
                max_width=210,
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
            if panel == "agents":
                self.agent_detail_app = None
            self._focused_key = None
            self._set_geometry()
            self._draw()

        def _handle_expanded_click(self, x: int, y: int) -> None:
            for key, x1, y1, x2, y2 in self._hitboxes:
                if x1 <= x <= x2 and y1 <= y <= y2:
                    self._activate_key(key)
                    return

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
                print("[XSafeClaw Mock] sort selector clicked")
                return
            if key == "risk_view_history":
                print("[XSafeClaw Mock] view handled approvals")
                return
            if key.startswith("risk_detail:"):
                card_id = key.split(":", 1)[1]
                print(f"[XSafeClaw Mock] open risk detail: {card_id}")
                return
            if key == "collapse":
                self.expanded = False
                self._focused_key = None
                self._set_geometry()
                self._draw()
                return
            if key == "back_to_agent_apps":
                self.agent_detail_app = None
                self._focused_key = None
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
                self.selected_agent_id = DEFAULT_SELECTED_AGENT_ID
                self._focused_key = None
                self._draw()
                return
            for agent in MOCK_AGENT_INSTANCES:
                if agent.id == key:
                    print(f"[XSafeClaw Mock] select agent: {agent.agent_name}")
                    self.selected_agent_id = agent.id
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
            design_y = self._design_y(y)
            if 0 <= design_y < 140:
                return "overview"
            if 140 <= design_y < 300:
                return "agents"
            if 300 <= design_y < 470:
                return "riskApproval"
            if 470 <= design_y < self.height:
                return "settings"
            return None

        def _tooltip_for_panel(self, panel: ActivePanel) -> str:
            if panel == "overview":
                return "XSafeClaw"
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

    SidebarWindow(parent_pid).mainloop()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--parent-pid", type=int, default=None)
    args = parser.parse_args()
    run(args.parent_pid)


if __name__ == "__main__":
    main()
