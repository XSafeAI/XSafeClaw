"""Codex developer-instruction assembly for XSafeClaw safety policies."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
from pathlib import Path


_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "data" / "templates"
_SAFETY_FILES: tuple[str, ...] = ("SAFETY.md", "PERMISSION.md")


class CodexSafetyPromptError(RuntimeError):
    """Raised when Codex safety instructions cannot be assembled safely."""


@dataclass(frozen=True)
class CodexDeveloperInstructions:
    text: str
    source_paths: list[str]
    sha256: str
    byte_length: int


def _read_required_template(path: Path) -> str:
    try:
        content = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise CodexSafetyPromptError(f"Unable to read Codex safety template: {path.name}") from exc
    if not content:
        raise CodexSafetyPromptError(f"Codex safety template is empty: {path.name}")
    return content


def build_codex_developer_instructions() -> CodexDeveloperInstructions:
    """Return SAFETY.md and PERMISSION.md as Codex developer instructions.

    Codex app-server supports ``developerInstructions`` on thread start/resume.
    We inject the existing XSafeClaw Markdown templates directly there so the
    host safety policy is present without writing AGENTS.md, config.toml, or a
    temporary prompt file.
    """
    sections: list[str] = []
    source_paths: list[str] = []
    for filename in _SAFETY_FILES:
        path = _TEMPLATES_DIR / filename
        content = _read_required_template(path)
        sections.append(f"## {filename}\n{content}")
        source_paths.append(str(path))

    text = (
        "# XSafeClaw Codex Safety Instructions\n\n"
        "These developer instructions are injected by XSafeClaw for this Codex session.\n\n"
        + "\n\n".join(sections)
    )
    encoded = text.encode("utf-8")
    return CodexDeveloperInstructions(
        text=text,
        source_paths=source_paths,
        sha256=hashlib.sha256(encoded).hexdigest(),
        byte_length=len(encoded),
    )


__all__ = [
    "CodexDeveloperInstructions",
    "CodexSafetyPromptError",
    "build_codex_developer_instructions",
]
