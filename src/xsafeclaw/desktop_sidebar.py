"""Standalone desktop floating Sidebar for XSafeClaw.

This module intentionally does not depend on the browser frontend.  It is
launched as a separate local process by the backend, so the floating Sidebar
keeps running after the browser tab/window is closed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

AgentStatus = Literal["ready", "working", "blocked", "offline"]
ActivePanel = Literal["overview", "agents", "riskApproval", "settings"]
AgentPetState = Literal["typing", "sleeping"]


@dataclass(frozen=True)
class AgentItem:
    id: Literal["openclaw", "hermes", "nanobot"]
    name: Literal["OpenClaw", "Hermes", "Nanobot"]
    status: AgentStatus
    pending_risk_count: int


AGENTS: tuple[AgentItem, ...] = (
    AgentItem("openclaw", "OpenClaw", "ready", 0),
    AgentItem("hermes", "Hermes", "working", 0),
    AgentItem("nanobot", "Nanobot", "blocked", 1),
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


def run() -> None:
    import tkinter as tk

    class SidebarWindow:
        collapsed_width = 56
        expanded_width = 340
        expanded_gap = 8
        height = 304
        default_top = 120

        transparent = "#FF00FF"
        bg = "#071018"
        panel_bg = "#0B121B"
        border = "#223244"
        text = "#E7ECF3"
        muted = "#8B95A5"
        soft = "#1A2029"
        risk = "#F16B6B"
        risk_hot = "#FF1717"
        focus = "#36C275"

        def __init__(self) -> None:
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

            self.root.configure(bg=self.transparent)
            self.canvas = tk.Canvas(
                self.root,
                width=self.collapsed_width,
                height=self.height,
                bg=self.transparent,
                highlightthickness=0,
                bd=0,
            )
            self.canvas.pack(fill="both", expand=True)
            self.canvas.bind("<ButtonPress-1>", self._start_drag)
            self.canvas.bind("<B1-Motion>", self._drag)
            self.canvas.bind("<ButtonRelease-1>", self._finish_click_or_drag)
            self.canvas.bind("<Motion>", self._handle_motion)
            self.canvas.bind("<Leave>", lambda _event: self._hide_tooltip())
            self.root.bind("<Escape>", lambda _event: self.root.destroy())
            self.root.bind("<Button-3>", lambda _event: self.root.destroy())

            self._set_geometry()
            self._draw()

        def _set_geometry(self) -> None:
            width = (
                self.collapsed_width + self.expanded_gap + self.expanded_width
                if self.expanded
                else self.collapsed_width
            )
            self.root.geometry(f"{width}x{self.height}+{self.left}+{self.top}")
            self.canvas.configure(width=width, height=self.height)

        def _draw(self) -> None:
            self.canvas.delete("all")
            self._draw_collapsed_sidebar()
            if self.expanded:
                self._draw_expanded_panel()

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
            if event.x > self.collapsed_width:
                return
            panel = self._panel_for_y(event.y)
            if not panel:
                return
            self.active_panel = panel
            self.expanded = True
            self._set_geometry()
            self._draw()

        def _handle_motion(self, event: tk.Event) -> None:
            if self._dragging:
                self._hide_tooltip()
                return
            if event.x > self.collapsed_width:
                self._hide_tooltip()
                return
            panel = self._panel_for_y(event.y)
            if not panel:
                self._hide_tooltip()
                return
            self._show_tooltip(self._tooltip_for_panel(panel), event.y)

        def _panel_for_y(self, y: int) -> ActivePanel | None:
            if 0 <= y < 72:
                return "overview"
            if 72 <= y < 164:
                return "agents"
            if 164 <= y < 232:
                return "riskApproval"
            if 232 <= y < 304:
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
            self.tooltip.geometry(f"+{self.left + 64}+{self.top + max(0, y - 16)}")

        def _hide_tooltip(self) -> None:
            if self.tooltip is not None:
                self.tooltip.destroy()
                self.tooltip = None

        def mainloop(self) -> None:
            self.root.mainloop()

    SidebarWindow().mainloop()


if __name__ == "__main__":
    run()
