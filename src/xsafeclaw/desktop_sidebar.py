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
        top = 120

        bg = "#0F141B"
        panel_bg = "#111821"
        border = "#2A313C"
        text = "#E7ECF3"
        muted = "#8B95A5"
        soft = "#1A2029"
        risk = "#F16B6B"
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

            self.active_panel: ActivePanel = "overview"
            self.expanded = False
            self.tooltip: tk.Toplevel | None = None
            self.pet_state = get_agent_pet_state(AGENTS)
            self.pending_risk_count = get_pending_risk_count(AGENTS)

            self.root.configure(bg=self.bg)
            self.canvas = tk.Canvas(
                self.root,
                width=self.collapsed_width,
                height=self.height,
                bg=self.bg,
                highlightthickness=1,
                highlightbackground=self.border,
                bd=0,
            )
            self.canvas.pack(fill="both", expand=True)
            self.canvas.bind("<Button-1>", self._handle_click)
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
            self.root.geometry(f"{width}x{self.height}+0+{self.top}")
            self.canvas.configure(width=width, height=self.height)

        def _draw(self) -> None:
            self.canvas.delete("all")
            width = int(self.canvas["width"])
            self.canvas.create_rectangle(0, 0, width, self.height, fill=self.bg, outline=self.border)
            self._draw_collapsed_sidebar()
            if self.expanded:
                self._draw_expanded_panel()

        def _draw_collapsed_sidebar(self) -> None:
            self.canvas.create_rectangle(0, 0, self.collapsed_width, self.height, fill=self.bg, outline=self.border)
            self._draw_shield(28, 36)
            self._draw_pet(28, 118)
            self._draw_risk_badge(28, 198)
            self._draw_settings(28, 268)

        def _draw_shield(self, cx: int, cy: int) -> None:
            self.canvas.create_rectangle(cx - 16, cy - 16, cx + 16, cy + 16, fill="#1A2029", outline="")
            points = [cx, cy - 12, cx + 10, cy - 7, cx + 8, cy + 7, cx, cy + 13, cx - 8, cy + 7, cx - 10, cy - 7]
            self.canvas.create_line(*points, fill=self.text, width=2, smooth=True)
            self.canvas.create_line(cx, cy - 7, cx, cy + 7, fill=self.text, width=1)

        def _draw_pet(self, cx: int, cy: int) -> None:
            self.canvas.create_rectangle(cx - 22, cy - 22, cx + 22, cy + 22, fill="#151B23", outline="")
            body = "#D9534F" if self.pet_state == "typing" else "#B84C4A"
            self.canvas.create_oval(cx - 12, cy - 7, cx + 12, cy + 11, fill=body, outline="")
            self.canvas.create_oval(cx - 17, cy - 5, cx - 8, cy + 4, outline=body, width=2)
            self.canvas.create_oval(cx + 8, cy - 5, cx + 17, cy + 4, outline=body, width=2)
            self.canvas.create_line(cx - 7, cy + 13, cx + 7, cy + 13, fill="#5C6470", width=2)
            if self.pet_state == "typing":
                self.canvas.create_rectangle(cx - 13, cy + 13, cx + 13, cy + 18, fill="#252D38", outline="")
                self.canvas.create_line(cx - 8, cy + 15, cx + 8, cy + 15, fill="#8B95A5", width=1)
            else:
                self.canvas.create_text(cx + 13, cy - 15, text="Z", fill=self.muted, font=("Segoe UI", 8, "bold"))

        def _draw_risk_badge(self, cx: int, cy: int) -> None:
            text = get_risk_badge_text(self.pending_risk_count)
            if not text:
                return
            self.canvas.create_oval(cx - 16, cy - 16, cx + 16, cy + 16, fill=self.risk, outline="")
            self.canvas.create_text(cx, cy, text=text, fill="#FFFFFF", font=("Segoe UI", 10, "bold"))

        def _draw_settings(self, cx: int, cy: int) -> None:
            self.canvas.create_oval(cx - 9, cy - 9, cx + 9, cy + 9, outline=self.muted, width=2)
            self.canvas.create_oval(cx - 3, cy - 3, cx + 3, cy + 3, fill=self.muted, outline="")
            for dx, dy in ((0, -15), (0, 15), (-15, 0), (15, 0)):
                self.canvas.create_line(cx, cy, cx + dx, cy + dy, fill=self.muted, width=1)

        def _draw_expanded_panel(self) -> None:
            x = self.collapsed_width + self.expanded_gap
            self.canvas.create_rectangle(x, 0, x + self.expanded_width, self.height, fill=self.panel_bg, outline=self.border)
            title_by_panel = {
                "overview": "总览页",
                "agents": "智能体页",
                "riskApproval": "风险审批页",
                "settings": "设置页",
            }
            self.canvas.create_text(x + 20, 28, anchor="w", text="XSafeClaw", fill=self.muted, font=("Segoe UI", 9))
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
                return [f"宠物状态：{pet}", "OpenClaw：ready", "Hermes：working", "Nanobot：blocked"]
            if self.active_panel == "riskApproval":
                return [self._risk_tooltip_text(), "默认展示第一条待处理风险。"]
            return ["设置页前端占位。", "本阶段不接入真实设置功能。"]

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
            self.tooltip.geometry(f"+64+{self.top + max(0, y - 16)}")

        def _hide_tooltip(self) -> None:
            if self.tooltip is not None:
                self.tooltip.destroy()
                self.tooltip = None

        def mainloop(self) -> None:
            self.root.mainloop()

    SidebarWindow().mainloop()


if __name__ == "__main__":
    run()
