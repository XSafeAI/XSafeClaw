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
IconType = Literal["openclaw", "hermes", "nanobot"]


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
        collapsed_width = 56
        expanded_width = 340
        expanded_gap = 8
        height = 304

        viewport_height_ratio = 0.70
        min_window_height = 420
        max_window_height = 720
        top_offset_ratio = 0.12

        transparent = "#FF00FF"
        bg = "#071018"
        panel_bg = "#0D1217"
        card_bg = "#121A23"
        border = "#2A3440"
        card_border = "#24303A"
        text = "#F2F5F7"
        muted = "#9DA7B2"
        weak = "#8F98A3"
        soft = "#1A2029"
        risk = "#F16B6B"
        risk_hot = "#FF1717"
        ok = "#18D158"
        pending = "#FF9F0A"
        pending_text = "#FFB020"
        focus = "#36C275"

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
            self.pending_risk_count = get_pending_risk_count(AGENTS)
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
                size = max(1, int(round(abs(actual["size"]) * self._scale_y)))
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
                13,
                fill=self.bg,
                outline=self.border,
                width=1,
            )
            self._draw_shield(28, 36)
            self._draw_pet(28, 118)
            self._draw_risk_badge(28, 198)
            self._draw_settings(28, 268)

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
                cx - 17, cy - 17, cx + 17, cy + 17, 7, fill="#101923", outline="#182637"
            )
            points = [
                cx,
                cy - 12,
                cx + 10,
                cy - 7,
                cx + 8,
                cy + 7,
                cx,
                cy + 13,
                cx - 8,
                cy + 7,
                cx - 10,
                cy - 7,
            ]
            self.canvas.create_line(*points, fill=self.text, width=2, smooth=True)
            self.canvas.create_line(cx, cy - 7, cx, cy + 7, fill=self.text, width=1)

        def _draw_pet(self, cx: int, cy: int) -> None:
            self._rounded_rect(
                cx - 23,
                cy - 33,
                cx + 23,
                cy + 33,
                7,
                fill="#101923",
                outline=self.risk_hot,
                width=1,
            )
            self._rounded_rect(
                cx - 21, cy - 31, cx + 21, cy + 31, 6, fill="#111923", outline="#36141A", width=1
            )
            body = "#D9534F" if self.pet_state == "typing" else "#B84C4A"
            claw = "#FF6A32" if self.pet_state == "typing" else "#D85A33"
            self.canvas.create_oval(
                cx - 12, cy - 11, cx + 12, cy + 13, fill=body, outline="#7C231C", width=1
            )
            self.canvas.create_oval(cx - 5, cy - 5, cx - 1, cy - 1, fill="#1B0D0E", outline="")
            self.canvas.create_oval(cx + 1, cy - 5, cx + 5, cy - 1, fill="#1B0D0E", outline="")
            self.canvas.create_arc(
                cx - 7,
                cy - 1,
                cx + 7,
                cy + 9,
                start=200,
                extent=140,
                style="arc",
                outline="#FFB076",
                width=1,
            )
            self.canvas.create_line(cx - 11, cy - 6, cx - 21, cy - 24, fill=claw, width=3)
            self.canvas.create_line(cx + 11, cy - 6, cx + 21, cy - 24, fill=claw, width=3)
            self.canvas.create_arc(
                cx - 28,
                cy - 33,
                cx - 12,
                cy - 15,
                start=275,
                extent=235,
                style="arc",
                outline=claw,
                width=5,
            )
            self.canvas.create_arc(
                cx + 12,
                cy - 33,
                cx + 28,
                cy - 15,
                start=30,
                extent=235,
                style="arc",
                outline=claw,
                width=5,
            )
            if self.pet_state == "typing":
                self._rounded_rect(
                    cx - 18, cy + 12, cx + 18, cy + 25, 2, fill="#12161D", outline="#47505B"
                )
                for row in range(2):
                    for col in range(6):
                        x = cx - 14 + col * 5
                        y = cy + 15 + row * 4
                        self.canvas.create_rectangle(x, y, x + 3, y + 2, fill="#5D6570", outline="")
            else:
                self.canvas.create_text(
                    cx + 13, cy - 15, text="Z", fill=self.muted, font=("Segoe UI", 8, "bold")
                )

        def _draw_risk_badge(self, cx: int, cy: int) -> None:
            text = get_risk_badge_text(self.pending_risk_count)
            if not text:
                return
            self.canvas.create_oval(cx - 21, cy - 21, cx + 21, cy + 21, fill="#240B12", outline="")
            self.canvas.create_oval(
                cx - 18, cy - 18, cx + 18, cy + 18, fill="#FF2531", outline="#111822", width=2
            )
            self.canvas.create_arc(
                cx - 18,
                cy - 18,
                cx + 18,
                cy + 18,
                start=40,
                extent=160,
                style="arc",
                outline="#FF6E6E",
                width=3,
            )
            self.canvas.create_text(
                cx, cy + 1, text=text, fill="#FFFFFF", font=("Segoe UI", 17, "bold")
            )

        def _draw_settings(self, cx: int, cy: int) -> None:
            self.canvas.create_oval(cx - 12, cy - 12, cx + 12, cy + 12, outline="#C5CAD1", width=2)
            self.canvas.create_oval(cx - 4, cy - 4, cx + 4, cy + 4, outline="#C5CAD1", width=2)
            for dx, dy in ((0, -15), (0, 15), (-15, 0), (15, 0)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=3)
            for dx, dy in ((11, -11), (-11, -11), (11, 11), (-11, 11)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill="#C5CAD1", width=2)

        def _draw_expanded_panel(self) -> None:
            x = self.collapsed_width + self.expanded_gap
            if self.active_panel == "agents":
                self._draw_agents_app_panel(x)
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

        def _draw_agents_app_panel(self, x: int) -> None:
            self._rounded_rect(
                x,
                0,
                x + self.expanded_width,
                self.height,
                14,
                fill=self.panel_bg,
                outline=self.border,
                width=1,
            )

            self._draw_page_icon(x + 12, 10)
            self.canvas.create_text(
                x + 58,
                12,
                anchor="nw",
                text="智能体",
                fill=self.text,
                font=("Microsoft YaHei UI", 20, "bold"),
            )
            self._draw_text_line(
                x + 58,
                36,
                text="3 个应用 · 6 个 Agent 运行中",
                fill=self.muted,
                font=("Microsoft YaHei UI", 12),
                max_width=210,
            )
            self._draw_collapse_button(x + 304, 12)

            card_y = 50
            for app in MOCK_AGENT_APPS:
                self._draw_agent_app_card(x + 12, card_y, app)
                card_y += 50

            self._draw_current_active_card(x + 12, 204)
            self._draw_risk_summary_card(x + 173, 204)

        def _draw_page_icon(self, x: int, y: int) -> None:
            self._rounded_rect(
                x,
                y,
                x + 34,
                y + 34,
                8,
                fill="#121A23",
                outline=self.card_border,
                width=1,
            )
            cx = x + 17
            cy = y + 17
            points = [
                cx,
                cy - 11,
                cx + 10,
                cy - 6,
                cx + 8,
                cy + 7,
                cx,
                cy + 13,
                cx - 8,
                cy + 7,
                cx - 10,
                cy - 6,
            ]
            self.canvas.create_line(*points, fill=self.text, width=2, smooth=True)

        def _draw_collapse_button(self, x: int, y: int) -> None:
            if self._focused_key == "collapse":
                self._rounded_rect(x, y, x + 24, y + 24, 6, fill="#172231", outline=self.focus)
            self.canvas.create_text(
                x + 12,
                y + 12,
                text="<<",
                fill="#C5CBD2",
                font=("Segoe UI", 14, "bold"),
            )
            self._add_hitbox("collapse", x, y, x + 24, y + 24)

        def _draw_agent_app_card(self, x: int, y: int, app: AgentAppStatus) -> None:
            is_pending = app.risk_state == "pending"
            fill = "#151B20" if is_pending else self.card_bg
            outline = "#A15D14" if is_pending else self.card_border
            if self._focused_key == app.id:
                outline = self.focus

            self._rounded_rect(x, y, x + 316, y + 44, 10, fill=fill, outline=outline, width=1)
            if is_pending:
                self.canvas.create_line(x + 8, y, x + 308, y, fill="#FF9F0A", width=1)

            self.canvas.create_oval(
                x + 10, y + 6, x + 42, y + 38, fill="#080D13", outline="#1F2A34"
            )
            self._draw_app_icon(app.icon_type, x + 26, y + 22)

            self._draw_text_line(
                x + 54,
                y + 8,
                text=app.app_name,
                fill=self.text,
                font=("Microsoft YaHei UI", 15, "bold"),
                max_width=120,
            )
            if app.id == "app_nanobot":
                self._draw_text_line(
                    x + 54,
                    y + 27,
                    text="3 个 Agent 运行中 ·",
                    fill=self.muted,
                    font=("Microsoft YaHei UI", 12),
                    max_width=108,
                )
                self._draw_text_line(
                    x + 166,
                    y + 27,
                    text="1 个待确认",
                    fill=self.pending_text,
                    font=("Microsoft YaHei UI", 12, "bold"),
                    max_width=86,
                )
            else:
                self._draw_text_line(
                    x + 54,
                    y + 27,
                    text=app.status_text,
                    fill=self.muted,
                    font=("Microsoft YaHei UI", 12),
                    max_width=170,
                )

            dot = self.pending if is_pending else self.ok
            self.canvas.create_oval(x + 280, y + 17, x + 290, y + 27, fill=dot, outline="")
            self.canvas.create_text(
                x + 306,
                y + 22,
                text="›",
                fill=self.muted,
                font=("Segoe UI", 22, "bold"),
            )
            self._add_hitbox(app.id, x, y, x + 316, y + 44)

        def _draw_app_icon(self, icon_type: IconType, cx: int, cy: int) -> None:
            if icon_type == "openclaw":
                for offset in (-8, 0, 8):
                    self.canvas.create_line(
                        cx + offset - 4,
                        cy + 8,
                        cx + offset + 5,
                        cy - 8,
                        fill=self.text,
                        width=4,
                        capstyle="round",
                    )
                return
            if icon_type == "hermes":
                gold = "#D9A441"
                light = "#F2C56B"
                self.canvas.create_polygon(
                    cx,
                    cy + 10,
                    cx - 12,
                    cy - 9,
                    cx - 2,
                    cy - 2,
                    fill=gold,
                    outline=light,
                )
                self.canvas.create_polygon(
                    cx,
                    cy + 10,
                    cx + 12,
                    cy - 9,
                    cx + 2,
                    cy - 2,
                    fill=gold,
                    outline=light,
                )
                self.canvas.create_rectangle(
                    cx - 3, cy - 4, cx + 3, cy + 12, fill=gold, outline=light
                )
                return

            self.canvas.create_oval(
                cx - 12, cy - 11, cx + 12, cy + 11, fill="#253543", outline="#79D8FF"
            )
            self.canvas.create_rectangle(
                cx - 11, cy - 2, cx + 11, cy + 10, fill="#182331", outline="#253543"
            )
            self.canvas.create_oval(cx - 6, cy - 2, cx - 2, cy + 2, fill="#37CFFF", outline="")
            self.canvas.create_oval(cx + 2, cy - 2, cx + 6, cy + 2, fill="#37CFFF", outline="")
            self.canvas.create_line(cx, cy - 11, cx, cy - 17, fill="#79D8FF", width=2)
            self.canvas.create_oval(cx - 2, cy - 20, cx + 2, cy - 16, fill="#37CFFF", outline="")

        def _draw_current_active_card(self, x: int, y: int) -> None:
            self._rounded_rect(
                x, y, x + 155, y + 88, 10, fill=self.card_bg, outline=self.card_border
            )
            self.canvas.create_oval(x + 10, y + 13, x + 18, y + 21, fill=self.ok, outline="")
            self.canvas.create_oval(x + 8, y + 11, x + 20, y + 23, outline="#0F5F31", width=2)
            self.canvas.create_text(
                x + 26,
                y + 8,
                anchor="nw",
                text="当前活跃",
                fill=self.text,
                font=("Microsoft YaHei UI", 14, "bold"),
            )
            self._draw_text_line(
                x + 10,
                y + 36,
                text=f"{MOCK_CURRENT_ACTIVE.app_name} / {MOCK_CURRENT_ACTIVE.agent_name}",
                fill="#B6BEC8",
                font=("Microsoft YaHei UI", 12),
                max_width=135,
            )
            self._draw_text_line(
                x + 10,
                y + 54,
                text=MOCK_CURRENT_ACTIVE.task,
                fill="#B6BEC8",
                font=("Microsoft YaHei UI", 12),
                max_width=135,
            )
            self._draw_text_line(
                x + 10,
                y + 72,
                text=f"最近动作：{MOCK_CURRENT_ACTIVE.latest_action}",
                fill=self.weak,
                font=("Microsoft YaHei UI", 9),
                max_width=135,
            )

        def _draw_risk_summary_card(self, x: int, y: int) -> None:
            self._rounded_rect(
                x, y, x + 155, y + 88, 10, fill=self.card_bg, outline=self.card_border
            )
            self._draw_shield_watermark(x + 100, y + 44)
            self.canvas.create_oval(x + 10, y + 13, x + 18, y + 21, fill=self.pending, outline="")
            self.canvas.create_oval(x + 8, y + 11, x + 20, y + 23, outline="#704C0A", width=2)
            self.canvas.create_text(
                x + 26,
                y + 8,
                anchor="nw",
                text="风险状态",
                fill=self.text,
                font=("Microsoft YaHei UI", 14, "bold"),
            )
            self._draw_text_line(
                x + 10,
                y + 36,
                text=MOCK_RISK_SUMMARY.text,
                fill=self.pending_text,
                font=("Microsoft YaHei UI", 13, "bold"),
                max_width=135,
            )
            self._draw_text_line(
                x + 10,
                y + 58,
                text=MOCK_RISK_SUMMARY.hint,
                fill=self.muted,
                font=("Microsoft YaHei UI", 12),
                max_width=135,
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
            self._focused_key = None
            self._set_geometry()
            self._draw()

        def _handle_expanded_click(self, x: int, y: int) -> None:
            for key, x1, y1, x2, y2 in self._hitboxes:
                if x1 <= x <= x2 and y1 <= y <= y2:
                    self._activate_key(key)
                    return

        def _activate_key(self, key: str) -> None:
            if key == "collapse":
                self.expanded = False
                self._focused_key = None
                self._set_geometry()
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

        def _focus_next(self, event: tk.Event) -> str:
            if not self.expanded or self.active_panel != "agents" or not self._focus_order:
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
            if 0 <= design_y < 72:
                return "overview"
            if 72 <= design_y < 164:
                return "agents"
            if 164 <= design_y < 232:
                return "riskApproval"
            if 232 <= design_y < 304:
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
