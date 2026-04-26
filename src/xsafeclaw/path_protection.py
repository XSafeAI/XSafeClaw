"""Shared helpers for user-defined path protection rules."""

from __future__ import annotations

import json
import ntpath
import os
import posixpath
import re
import shlex
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any, Iterable, Mapping

PROTECTED_OPERATION_ORDER = ("read", "modify", "delete")
_PROTECTED_OPERATION_SET = set(PROTECTED_OPERATION_ORDER)
_OPERATION_ALIASES = {
    "read": "read",
    "write": "modify",
    "modify": "modify",
    "create": "modify",
    "delete": "delete",
}
_DISPLAY_NAMES_ZH = {
    "read": "读取",
    "modify": "修改",
    "delete": "删除",
}
_READ_COMMANDS = {
    "cat", "less", "more", "head", "tail", "ls", "find", "stat", "file", "wc",
    "type", "dir", "get-content", "gc",
}
_READ_PATTERN_COMMANDS = {"grep", "rg", "findstr", "select-string", "sls"}
_MODIFY_COMMANDS = {
    "mv", "cp", "touch", "mkdir", "chmod", "chown", "tee", "install",
    "copy", "move", "ren", "rename", "md", "mklink",
    "copy-item", "move-item", "rename-item", "new-item", "ni", "set-content", "add-content", "out-file",
}
_DELETE_COMMANDS = {
    "rm", "rmdir", "unlink", "trash", "trash-put", "gio-trash", "srm", "shred",
    "del", "erase", "rd", "remove-item", "ri",
}
_SHELL_SEPARATORS = {"&&", "||", ";", "|", "&"}
_WRITE_REDIRECTION = re.compile(r"^(?:\d+)?>>?$")
_READ_REDIRECTION = re.compile(r"^(?:\d+)?<$")
_POSIX_SHELL_WRAPPERS = {"bash", "sh", "zsh"}
_WINDOWS_SHELL_WRAPPERS = {"cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"}
_SHELL_WRAPPERS = _POSIX_SHELL_WRAPPERS | _WINDOWS_SHELL_WRAPPERS
_SCRIPT_RUNNERS = {"python", "python3", "perl", "ruby", "node", "osascript"}
_EXEC_TOOL_NAMES = {
    "exec", "exec_command", "shell", "bash", "terminal", "run_command",
    "execute_command", "execute_shell_command",
}
_DIRECT_TOOL_OPERATIONS = {
    "read": "read",
    "read_file": "read",
    "file_read": "read",
    "view_file": "read",
    "open_file": "read",
    "write": "modify",
    "write_file": "modify",
    "file_write": "modify",
    "edit": "modify",
    "edit_file": "modify",
    "file_edit": "modify",
    "replace": "modify",
    "append": "modify",
    "create": "modify",
    "create_file": "modify",
    "mkdir": "modify",
    "copy": "modify",
    "move": "modify",
    "rename": "modify",
    "delete": "delete",
    "delete_file": "delete",
    "remove": "delete",
    "remove_file": "delete",
    "rm": "delete",
    "rmdir": "delete",
    "unlink": "delete",
}
_TOOL_COMMAND_KEYS = ("command", "cmd")
_TOOL_CWD_KEYS = (
    "cwd", "workdir", "working_dir", "workingDirectory",
    "current_dir", "currentDirectory",
)
_TOOL_PATH_KEYS = {
    "path", "file", "file_path", "filePath", "filepath", "filename", "target",
    "target_path", "targetPath", "dir", "directory", "folder",
    "folder_path", "folderPath", "source", "src", "destination",
    "dest", "dst", "new_path", "newPath", "old_path", "oldPath",
    "from", "to",
}
_TOOL_PATH_LIST_KEYS = {
    "paths", "files", "file_paths", "filePaths", "targets",
    "directories", "folders",
}
_TOOL_NESTED_PARAM_KEYS = {"arguments", "args", "params", "input"}
_ARCHIVE_COMMANDS = {"tar", "bsdtar", "gtar"}
_ZIP_COMMANDS = {"zip"}
_UNZIP_COMMANDS = {"unzip"}
_SYNC_COMMANDS = {"rsync"}
_POSIX_PATH_LITERAL_PATTERN = re.compile(r'(?P<path>(?:~|/|\./|\.\./)[^\s"\'`;,|&><]+)')
_WINDOWS_DRIVE_PATH_PATTERN = re.compile(r'(?P<path>[A-Za-z]:[\\/][^\s"\'`;,|&><]+)')
_WINDOWS_UNC_PATH_PATTERN = re.compile(r'(?P<path>(?:\\\\|//)[^\\/\s"\'`;,|&><]+(?:[\\/][^\\/\s"\'`;,|&><]+)+)')
_WINDOWS_PERCENT_PATH_PATTERN = re.compile(r'(?P<path>%[A-Za-z_][A-Za-z0-9_]*%(?:[\\/][^\s"\'`;,|&><]+)*)')
_POWERSHELL_ENV_PATH_PATTERN = re.compile(r'(?P<path>\$env:[A-Za-z_][A-Za-z0-9_]*(?:[\\/][^\s"\'`;,|&><]+)*)', re.IGNORECASE)
_WINDOWS_DRIVE_PREFIX = re.compile(r"^[A-Za-z]:[\\/]")
_WINDOWS_UNC_PREFIX = re.compile(r"^(?:\\\\|//)[^\\/]+[\\/][^\\/]+")
_PERCENT_ENV_PATTERN = re.compile(r"%([A-Za-z_][A-Za-z0-9_]*)%")
_POWERSHELL_ENV_PATTERN = re.compile(r"\$env:([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)
_OSASCRIPT_PATH_PATTERNS = (
    re.compile(r'POSIX file\s+"([^"]+)"', re.IGNORECASE),
    re.compile(r"POSIX file\s+'([^']+)'", re.IGNORECASE),
    re.compile(r'alias\s+"([^"]+)"', re.IGNORECASE),
    re.compile(r"alias\s+'([^']+)'", re.IGNORECASE),
)


def normalize_protected_operation(operation: str | None) -> str | None:
    """Normalize an operation name into the path-protection operation space."""
    if not operation:
        return None
    return _OPERATION_ALIASES.get(operation.strip().lower())


def _strip_wrapping_quotes(value: str) -> str:
    text = value.strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        return text[1:-1]
    return text


def _expand_percent_vars(value: str) -> str:
    return _PERCENT_ENV_PATTERN.sub(lambda match: os.environ.get(match.group(1), match.group(0)), value)


def _expand_powershell_env_vars(value: str) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        return (
            os.environ.get(key)
            or os.environ.get(key.upper())
            or os.environ.get(key.lower())
            or match.group(0)
        )

    return _POWERSHELL_ENV_PATTERN.sub(replace, value)


def _expand_shell_path(path: str) -> str:
    expanded = os.path.expandvars(path.strip())
    expanded = _expand_percent_vars(expanded)
    expanded = _expand_powershell_env_vars(expanded)
    return expanded


def _looks_like_windows_path(path: str) -> bool:
    text = _strip_wrapping_quotes(path)
    return bool(
        _WINDOWS_DRIVE_PREFIX.match(text)
        or _WINDOWS_UNC_PREFIX.match(text)
        or text.startswith((".\\", "..\\"))
        or ("\\" in text and not text.startswith(("/", "./", "../", "~")))
        or text.lower().startswith("$env:")
        or text.startswith("%")
    )


def _expand_windows_user(path: str) -> str:
    text = _strip_wrapping_quotes(path)
    if not text.startswith("~"):
        return text

    home = os.environ.get("USERPROFILE") or os.environ.get("HOME")
    if not home:
        return text

    normalized_home = home.replace("/", "\\")
    if text == "~":
        return normalized_home
    if text.startswith(("~/", "~\\")):
        return ntpath.join(normalized_home, text[2:].replace("/", "\\"))
    return text


def resolve_user_path(path: str) -> Path:
    """Resolve a user-supplied path using shell-like expansion."""
    expanded = _expand_shell_path(path)

    if _looks_like_windows_path(expanded):
        normalized_windows = _expand_windows_user(expanded)
        if os.name == "nt":
            return Path(normalized_windows).expanduser().resolve()
        return Path(ntpath.normcase(ntpath.normpath(normalized_windows)))

    return Path(expanded).expanduser().resolve()


def normalize_rule_input(path: str, operations: Iterable[str] | None) -> tuple[str, list[str]]:
    """Normalize a rule payload and validate operations."""
    resolved_path = str(resolve_user_path(path))

    normalized_ops: list[str] = []
    seen: set[str] = set()
    raw_operations = list(operations or [])
    if not raw_operations:
        raw_operations = list(PROTECTED_OPERATION_ORDER)

    for raw in raw_operations:
        normalized = normalize_protected_operation(raw)
        if normalized in _PROTECTED_OPERATION_SET and normalized not in seen:
            normalized_ops.append(normalized)
            seen.add(normalized)

    if not normalized_ops:
        raise ValueError("At least one protected operation must be selected")

    normalized_ops.sort(key=PROTECTED_OPERATION_ORDER.index)
    return resolved_path, normalized_ops


def load_rules(file_path: Path) -> dict[str, set[str]]:
    """Load path-protection rules from disk.

    Supports both the current object-based schema and the old list-of-paths
    schema for backward compatibility.
    """
    if not file_path.exists():
        return {}

    try:
        payload = json.loads(file_path.read_text("utf-8"))
    except Exception:
        return {}

    rules: dict[str, set[str]] = {}
    if not isinstance(payload, list):
        return rules

    for item in payload:
        if isinstance(item, str):
            try:
                resolved_path, operations = normalize_rule_input(item, PROTECTED_OPERATION_ORDER)
            except ValueError:
                continue
        elif isinstance(item, dict):
            path = item.get("path")
            if not isinstance(path, str) or not path.strip():
                continue
            raw_operations = item.get("operations")
            ops = raw_operations if isinstance(raw_operations, list) else PROTECTED_OPERATION_ORDER
            try:
                resolved_path, operations = normalize_rule_input(path, ops)
            except ValueError:
                continue
        else:
            continue

        rules[resolved_path] = set(operations)

    return rules


def serialize_rules(rules: dict[str, set[str]]) -> list[dict[str, list[str]]]:
    """Serialize rules into a stable list for API responses and persistence."""
    return [
        {
            "path": path,
            "operations": sorted(ops, key=PROTECTED_OPERATION_ORDER.index),
        }
        for path, ops in sorted(rules.items())
    ]


def save_rules(file_path: Path, rules: dict[str, set[str]]) -> None:
    """Persist rules to disk."""
    file_path.write_text(
        json.dumps(serialize_rules(rules), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def match_protected_rule(
    target_path: str | Path,
    operation: str | None,
    rules: dict[str, set[str]],
) -> str | None:
    """Return the matched protected root path if a rule blocks this operation."""
    normalized = normalize_protected_operation(operation)
    if normalized is None or not rules:
        return None

    try:
        resolved_target = resolve_user_path(str(target_path))
    except Exception:
        return None

    for protected_path, protected_ops in sorted(rules.items(), key=lambda item: len(item[0]), reverse=True):
        if normalized not in protected_ops:
            continue
        if _is_relative_to(resolved_target, protected_path):
            return protected_path

    return None


def match_protected_scope(
    target_path: str | Path,
    operation: str | None,
    rules: dict[str, set[str]],
) -> str | None:
    """Return a matched protected root for commands that operate on broader scopes.

    Unlike ``match_protected_rule``, this treats ancestor paths as a match too,
    so commands like ``find ~/Desktop`` or ``rm -rf ~/Desktop`` cannot be used
    to reach a protected child directory.
    """
    normalized = normalize_protected_operation(operation)
    if normalized is None or not rules:
        return None

    try:
        resolved_target = resolve_user_path(str(target_path))
    except Exception:
        return None

    for protected_path, protected_ops in sorted(rules.items(), key=lambda item: len(item[0]), reverse=True):
        if normalized not in protected_ops:
            continue
        if _is_relative_to(resolved_target, protected_path) or _is_relative_to(protected_path, resolved_target):
            return protected_path

    return None


def build_block_reason(target_path: str | Path, operation: str, protected_path: str) -> str:
    """Build a consistent user-facing block reason."""
    normalized = normalize_protected_operation(operation) or operation
    op_name = _DISPLAY_NAMES_ZH.get(normalized, normalized)
    return f"路径已受保护，已阻止{op_name}操作：{target_path}（命中保护路径 {protected_path}）"


def extract_tool_operations(tool_name: str, params: Mapping[str, Any] | None) -> list[tuple[str, str]]:
    """Best-effort extraction of protected path operations from a tool call."""
    if not isinstance(params, Mapping):
        params = {}

    normalized_tool = _normalize_tool_name(tool_name)
    cwd = _extract_tool_cwd(params)

    if normalized_tool in _EXEC_TOOL_NAMES:
        command = _first_string_param(params, _TOOL_COMMAND_KEYS)
        return extract_exec_operations(command, cwd=cwd) if command else []

    operation = _DIRECT_TOOL_OPERATIONS.get(normalized_tool)
    if operation is None:
        return []

    operations = [
        (operation, _apply_cwd_to_target(path, cwd))
        for path in _extract_tool_paths(params)
    ]
    return _unique_operations(operations)


def extract_exec_operations(command: str, cwd: str | Path | None = None) -> list[tuple[str, str]]:
    """Best-effort extraction of file operations from a shell command.

    The goal is to support the common commands the agent uses in Safe Chat
    without trying to fully parse arbitrary shell syntax.
    """
    extracted: list[tuple[str, str]] = []
    base_cwd = _normalize_working_dir(cwd)
    for tokens in _split_command_variants(command):
        current_cwd = base_cwd
        for segment in _split_shell_segments(tokens):
            next_cwd = _extract_cd_target(segment, current_cwd)
            if next_cwd is not None:
                current_cwd = next_cwd
                continue
            extracted.extend(_extract_segment_operations(segment, cwd=current_cwd))

    return _unique_operations(extracted)


def _normalize_tool_name(tool_name: str) -> str:
    cleaned = str(tool_name or "").strip().lower().replace("-", "_")
    if "." in cleaned:
        cleaned = cleaned.rsplit(".", 1)[-1]
    return cleaned


def _first_string_param(params: Mapping[str, Any], keys: Iterable[str]) -> str | None:
    for key in keys:
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _extract_tool_cwd(params: Mapping[str, Any]) -> str | None:
    cwd = _first_string_param(params, _TOOL_CWD_KEYS)
    if cwd:
        return _normalize_working_dir(cwd)
    for key in _TOOL_NESTED_PARAM_KEYS:
        value = params.get(key)
        if isinstance(value, Mapping):
            nested = _extract_tool_cwd(value)
            if nested:
                return nested
    return None


def _extract_tool_paths(params: Mapping[str, Any]) -> list[str]:
    paths: list[str] = []

    def visit(value: Any, key: str | None = None) -> None:
        if key in _TOOL_PATH_KEYS and isinstance(value, str) and value.strip():
            paths.append(_strip_wrapping_quotes(value))
            return
        if key in _TOOL_PATH_LIST_KEYS and isinstance(value, list):
            for item in value:
                if isinstance(item, str) and item.strip():
                    paths.append(_strip_wrapping_quotes(item))
            return
        if key in _TOOL_NESTED_PARAM_KEYS and isinstance(value, Mapping):
            for nested_key, nested_value in value.items():
                visit(nested_value, str(nested_key))

    for raw_key, raw_value in params.items():
        visit(raw_value, str(raw_key))

    return _unique_paths(paths)


def _split_shell_segments(tokens: list[str]) -> list[list[str]]:
    segments: list[list[str]] = []
    current: list[str] = []
    for token in tokens:
        if token in _SHELL_SEPARATORS:
            if current:
                segments.append(current)
                current = []
            continue
        current.append(token)
    if current:
        segments.append(current)
    return segments


def _extract_cd_target(tokens: list[str], cwd: str | None) -> str | None:
    if not tokens or _command_name(tokens[0]) not in {"cd", "chdir", "pushd"}:
        return None

    values = _non_option_args(tokens[1:])
    target = values[0] if values else os.environ.get("HOME")
    if not target:
        return cwd
    return _normalize_working_dir(_apply_cwd_to_target(target, cwd))


def _split_command_variants(command: str) -> list[list[str]]:
    variants: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()
    for posix_mode in (True, False):
        try:
            tokens = shlex.split(command, posix=posix_mode)
        except Exception:
            continue
        normalized = tuple(tokens)
        if tokens and normalized not in seen:
            variants.append(tokens)
            seen.add(normalized)
    return variants


def _command_name(token: str) -> str:
    cleaned = _strip_wrapping_quotes(token)
    return ntpath.basename(posixpath.basename(cleaned)).lower()


def _extract_segment_operations(tokens: list[str], cwd: str | None = None) -> list[tuple[str, str]]:
    if not tokens:
        return []

    executable = _command_name(tokens[0])
    args = tokens[1:]
    if executable == "env":
        nested = _extract_env_wrapper(args)
        if nested:
            executable, args = nested
    if executable == "gio" and args and args[0].lower() == "trash":
        executable = "gio-trash"
        args = args[1:]

    operations: list[tuple[str, str]] = []
    operations.extend(_extract_redirections(tokens))

    if executable in _SHELL_WRAPPERS:
        operations.extend(_extract_shell_wrapper_operations(executable, args, cwd=cwd))
        return _apply_cwd_to_operations(operations, cwd)

    if executable == "find":
        operations.extend(_extract_find_operations(args))
        return _apply_cwd_to_operations(operations, cwd)

    if executable == "osascript":
        operations.extend(_extract_osascript_operations(args))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _ARCHIVE_COMMANDS:
        operations.extend(_extract_tar_operations(args, cwd=cwd))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _ZIP_COMMANDS:
        operations.extend(_extract_zip_operations(args))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _UNZIP_COMMANDS:
        operations.extend(_extract_unzip_operations(args, cwd=cwd))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _SYNC_COMMANDS:
        operations.extend(_extract_sync_operations(args))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _SCRIPT_RUNNERS:
        operations.extend(_extract_inline_script_operations(executable, args))
        operations.extend(_extract_script_runner_argument_operations(args))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _DELETE_COMMANDS:
        for value in _non_option_args(args):
            operations.append(("delete", value))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _READ_COMMANDS:
        for value in _non_option_args(args):
            operations.append(("read", value))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _READ_PATTERN_COMMANDS:
        values = _non_option_args(args)
        for value in values[1:]:
            operations.append(("read", value))
        return _apply_cwd_to_operations(operations, cwd)

    if executable == "sed":
        values = _non_option_args(args)
        op = "modify" if any(arg == "-i" or arg.startswith("-i") for arg in args) else "read"
        start_index = 1 if values else 0
        for value in values[start_index:]:
            operations.append((op, value))
        return _apply_cwd_to_operations(operations, cwd)

    if executable in _MODIFY_COMMANDS:
        for value in _non_option_args(args):
            operations.append(("modify", value))
        return _apply_cwd_to_operations(operations, cwd)

    return _apply_cwd_to_operations(operations, cwd)


def _extract_env_wrapper(args: list[str]) -> tuple[str, list[str]] | None:
    passthrough = False
    for idx, arg in enumerate(args):
        if arg == "--":
            passthrough = True
            continue
        if not passthrough and "=" in arg and not _looks_like_windows_path(arg) and not arg.startswith(("~", "/", "./", "../")):
            continue
        if not passthrough and arg.startswith("-"):
            continue
        return _command_name(arg), args[idx + 1 :]
    return None


def _extract_shell_wrapper_operations(
    executable: str,
    args: list[str],
    *,
    cwd: str | None = None,
) -> list[tuple[str, str]]:
    if executable in {"cmd", "cmd.exe"}:
        script = _extract_wrapper_script(args, {"/c", "/k"}, take_rest=True)
    elif executable in {"powershell", "powershell.exe", "pwsh", "pwsh.exe"}:
        script = _extract_wrapper_script(args, {"-c", "-command", "/c", "/command"}, take_rest=True)
    else:
        script = _extract_wrapper_script(args, {"-c", "-lc", "-xc"})
    if not script:
        return []
    return extract_exec_operations(script, cwd=cwd)


def _extract_find_operations(args: list[str]) -> list[tuple[str, str]]:
    operations: list[tuple[str, str]] = []
    roots = _extract_find_roots(args)
    if not roots:
        roots = ["."]

    for root in roots:
        operations.append(("read", root))

    if "-delete" in args:
        for root in roots:
            operations.append(("delete", root))

    exec_ops = _extract_find_exec_operations(args)
    for op in exec_ops:
        for root in roots:
            operations.append((op, root))

    return operations


def _extract_find_roots(args: list[str]) -> list[str]:
    roots: list[str] = []
    for arg in args:
        if arg in {"--", "!", "("} or arg.startswith("-"):
            break
        roots.append(_strip_wrapping_quotes(arg))
    return roots


def _extract_find_exec_operations(args: list[str]) -> set[str]:
    operations: set[str] = set()
    idx = 0
    while idx < len(args):
        token = args[idx]
        if token not in {"-exec", "-execdir", "-ok", "-okdir"}:
            idx += 1
            continue

        collected: list[str] = []
        idx += 1
        while idx < len(args) and args[idx] not in {";", "+"}:
            collected.append(args[idx])
            idx += 1

        if collected:
            for operation, _target in _extract_segment_operations(collected):
                operations.add(operation)

        idx += 1

    return operations


def _extract_osascript_operations(args: list[str]) -> list[tuple[str, str]]:
    script = " ".join(args)
    if not script.strip():
        return []

    operation = _classify_text_operation(
        script,
        delete_words=(" delete ", " trash ", " remove "),
        modify_words=(" move ", " duplicate ", " set ", " write ", " make ", " rename "),
        read_words=(" open ", " read ", " get ", " list ", " exists "),
        default="read",
    )
    return [(operation, path) for path in _extract_osascript_paths(script)]


def _extract_osascript_paths(script: str) -> list[str]:
    matches: list[str] = []
    for pattern in _OSASCRIPT_PATH_PATTERNS:
        matches.extend(pattern.findall(script))
    if matches:
        return _unique_paths(matches)
    return _extract_path_literals(script)


def _extract_inline_script_operations(executable: str, args: list[str]) -> list[tuple[str, str]]:
    script = _extract_wrapper_script(args, {"-c", "-e"})
    if not script:
        return []

    operation = _classify_text_operation(
        script,
        delete_words=("unlink", "remove", "rmtree", "delete", "trash"),
        modify_words=("write", "touch", "mkdir", "rename", "replace", "chmod", "copy", "move", "append"),
        read_words=("read", "open", "listdir", "scandir", "walk", "glob", "stat", "exists"),
        default="read",
    )
    return [(operation, path) for path in _extract_path_literals(script)]


def _extract_tar_operations(args: list[str], cwd: str | None = None) -> list[tuple[str, str]]:
    values = _non_option_args(args)
    if not values:
        return []

    options = "".join(arg.lstrip("-").lower() for arg in args if arg.startswith("-"))
    create_mode = "c" in options
    extract_mode = "x" in options
    operations: list[tuple[str, str]] = []

    if create_mode:
        archive, *sources = values
        operations.append(("modify", archive))
        operations.extend(("read", source) for source in sources)
        return operations

    if extract_mode:
        archive = values[0]
        operations.append(("read", archive))
        destination = _option_value(args, "-C") or "."
        operations.append(("modify", _apply_cwd_to_target(destination, cwd)))
        return operations

    return [("read", value) for value in values]


def _extract_zip_operations(args: list[str]) -> list[tuple[str, str]]:
    values = _non_option_args(args)
    if not values:
        return []
    archive, *sources = values
    operations: list[tuple[str, str]] = [("modify", archive)]
    operations.extend(("read", source) for source in sources)
    return operations


def _extract_unzip_operations(args: list[str], cwd: str | None = None) -> list[tuple[str, str]]:
    values = _non_option_args(args)
    destination = _option_value(args, "-d")
    if destination in values:
        values = [value for value in values if value != destination]
    operations = [("read", value) for value in values]
    operations.append(("modify", _apply_cwd_to_target(destination or ".", cwd)))
    return operations


def _extract_sync_operations(args: list[str]) -> list[tuple[str, str]]:
    values = _non_option_args(args)
    if not values:
        return []
    if len(values) == 1:
        return [("read", values[0])]
    operations = [("read", value) for value in values[:-1]]
    operations.append(("modify", values[-1]))
    return operations


def _extract_script_runner_argument_operations(args: list[str]) -> list[tuple[str, str]]:
    values = _script_runner_path_args(args)
    if not values:
        return []

    operations: list[tuple[str, str]] = []
    for idx, value in enumerate(values):
        if idx == 0:
            operations.append(("read", value))
        else:
            operations.extend((operation, value) for operation in PROTECTED_OPERATION_ORDER)
    return operations


def _script_runner_path_args(args: list[str]) -> list[str]:
    values: list[str] = []
    idx = 0
    passthrough = False
    options_with_value = {
        "-c", "-e", "--eval", "-m", "--module", "-r", "--require",
        "-I", "-S", "-W",
    }
    while idx < len(args):
        arg = _strip_wrapping_quotes(args[idx])
        lowered = arg.lower()
        if arg == "--":
            passthrough = True
            idx += 1
            continue
        if not passthrough and lowered in options_with_value:
            idx += 2
            continue
        if not passthrough and lowered.startswith("-"):
            idx += 1
            continue
        if _looks_like_path_argument(arg):
            values.append(arg)
        idx += 1
    return _unique_paths(values)


def _looks_like_path_argument(value: str) -> bool:
    text = _strip_wrapping_quotes(value)
    if not text or text == "-":
        return False
    if text.startswith(("~", "/", "./", "../", ".\\", "..\\")):
        return True
    if _looks_like_windows_path(text):
        return True
    return any(separator in text for separator in ("/", "\\")) or bool(re.search(r"\.[A-Za-z0-9_*?]+$", text))


def _option_value(args: list[str], option: str) -> str | None:
    for idx, arg in enumerate(args):
        cleaned = _strip_wrapping_quotes(arg)
        if cleaned == option and idx + 1 < len(args):
            return _strip_wrapping_quotes(args[idx + 1])
        if cleaned.startswith(option) and len(cleaned) > len(option):
            return cleaned[len(option) :]
        if option.startswith("--") and cleaned.lower().startswith(option.lower()) and len(cleaned) > len(option):
            return cleaned[len(option) :]
    return None


def _extract_wrapper_script(args: list[str], flags: set[str], *, take_rest: bool = False) -> str | None:
    for idx, arg in enumerate(args):
        cleaned = _strip_wrapping_quotes(arg)
        lowered = cleaned.lower()
        if lowered in flags and idx + 1 < len(args):
            tail = [_strip_wrapping_quotes(item) for item in args[idx + 1 :]]
            return " ".join(tail) if take_rest else tail[0]
        for flag in flags:
            if lowered.startswith(flag) and len(cleaned) > len(flag):
                return cleaned[len(flag) :]
    return None


def _classify_text_operation(
    text: str,
    *,
    delete_words: tuple[str, ...],
    modify_words: tuple[str, ...],
    read_words: tuple[str, ...],
    default: str,
) -> str:
    lowered = f" {text.lower()} "
    if any(word in lowered for word in delete_words):
        return "delete"
    if any(word in lowered for word in modify_words):
        return "modify"
    if any(word in lowered for word in read_words):
        return "read"
    return default


def _extract_path_literals(text: str) -> list[str]:
    matches: list[str] = []
    for pattern in (
        _POSIX_PATH_LITERAL_PATTERN,
        _WINDOWS_DRIVE_PATH_PATTERN,
        _WINDOWS_UNC_PATH_PATTERN,
        _WINDOWS_PERCENT_PATH_PATTERN,
        _POWERSHELL_ENV_PATH_PATTERN,
    ):
        matches.extend(match.group("path") for match in pattern.finditer(text))
    return _unique_paths(matches)


def _unique_paths(paths: Iterable[str]) -> list[str]:
    unique: list[str] = []
    seen: set[str] = set()
    for path in paths:
        if path not in seen:
            unique.append(path)
            seen.add(path)
    return unique


def _unique_operations(operations: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    unique: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for operation, target in operations:
        item = (operation, target)
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique


def _normalize_working_dir(cwd: str | Path | None) -> str | None:
    if cwd is None:
        return None
    text = _strip_wrapping_quotes(str(cwd))
    if not text:
        return None
    try:
        return str(resolve_user_path(text))
    except Exception:
        return text


def _apply_cwd_to_operations(
    operations: Iterable[tuple[str, str]],
    cwd: str | None,
) -> list[tuple[str, str]]:
    return [(operation, _apply_cwd_to_target(target, cwd)) for operation, target in operations]


def _apply_cwd_to_target(target: str, cwd: str | None) -> str:
    text = _strip_wrapping_quotes(str(target))
    if not text or cwd is None or not _is_relative_target(text):
        return text

    cwd_text = _strip_wrapping_quotes(str(cwd))
    if _looks_like_windows_path(cwd_text) or "\\" in text:
        return ntpath.normpath(ntpath.join(cwd_text, text))
    return posixpath.normpath(posixpath.join(cwd_text, text))


def _is_relative_target(path: str) -> bool:
    text = _strip_wrapping_quotes(path)
    if not text:
        return False
    expanded = _expand_shell_path(text)
    if text.startswith("~") or expanded.startswith("/"):
        return False
    if _WINDOWS_DRIVE_PREFIX.match(expanded) or _WINDOWS_UNC_PREFIX.match(expanded):
        return False
    if text.startswith("%") or text.lower().startswith("$env:"):
        return False
    return True


def _to_comparable_path(path: str | os.PathLike[str]) -> tuple[str, PurePosixPath | PureWindowsPath]:
    resolved = resolve_user_path(str(path))
    resolved_text = str(resolved)
    if _looks_like_windows_path(resolved_text):
        return "windows", PureWindowsPath(ntpath.normcase(ntpath.normpath(resolved_text)))
    return "posix", PurePosixPath(posixpath.normpath(resolved_text))


def _is_relative_to(path: str | os.PathLike[str], other: str | os.PathLike[str]) -> bool:
    path_style, pure_path = _to_comparable_path(path)
    other_style, pure_other = _to_comparable_path(other)
    if path_style != other_style:
        return False

    try:
        pure_path.relative_to(pure_other)
        return True
    except ValueError:
        return False


def _non_option_args(args: list[str]) -> list[str]:
    values: list[str] = []
    passthrough = False
    for arg in args:
        if arg == "--":
            passthrough = True
            continue
        if not passthrough and arg.startswith("-") and arg != "-":
            continue
        values.append(_strip_wrapping_quotes(arg))
    return values


def _extract_redirections(tokens: list[str]) -> list[tuple[str, str]]:
    results: list[tuple[str, str]] = []
    for idx, token in enumerate(tokens):
        if _WRITE_REDIRECTION.match(token):
            if idx + 1 < len(tokens):
                results.append(("modify", _strip_wrapping_quotes(tokens[idx + 1])))
            continue
        if _READ_REDIRECTION.match(token):
            if idx + 1 < len(tokens):
                results.append(("read", _strip_wrapping_quotes(tokens[idx + 1])))
            continue

        compact_write = re.match(r"^(?:\d+)?(>>?)(.+)$", token)
        if compact_write:
            results.append(("modify", _strip_wrapping_quotes(compact_write.group(2))))
            continue

        compact_read = re.match(r"^(?:\d+)?(<)(.+)$", token)
        if compact_read:
            results.append(("read", _strip_wrapping_quotes(compact_read.group(2))))
    return results
