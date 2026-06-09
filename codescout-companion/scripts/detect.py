#!/usr/bin/env python3
"""Codescout detection logic, factored out of detect-tools.sh.

Reads env (CWD, HOME, CLAUDE_CONFIG_DIR) + filesystem, emits shell-eval lines
on stdout. Hooks consume via:

    eval "$(CWD=$CWD python3 .../scripts/detect.py)"

Variables emitted (matching the legacy detect-tools.sh contract byte-for-byte
where the characterization test asserts equality):

    HAS_CODESCOUT, CS_SERVER_NAME, CS_PREFIX, CS_BINARY, CS_PROJECT_DIR,
    HAS_CS_ONBOARDING, HAS_CS_MEMORIES, CS_MEMORY_NAMES,
    HAS_CS_SYSTEM_PROMPT, CS_SYSTEM_PROMPT, BLOCK_READS, WORKSPACE_ROOT,
    SOURCE_EXT_PATTERN

Use --json for a structured dump (no shell quoting; for tests).
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from pathlib import Path
from typing import Any

SOURCE_EXT_PATTERN = r"\.(kt|kts|java|ts|tsx|js|jsx|py|go|rs|cs|rb|scala|swift|cpp|c|h|hpp|sh|bash)$"
SERVER_NAME_RE = re.compile(r"codescout")


def _load_json(path: Path) -> dict[str, Any] | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _expand_home(value: str, home: str) -> str:
    if value.startswith("~/"):
        return f"{home}{value[1:]}"
    if value == "~":
        return home
    return value


def _find_routing_config(cwd: Path) -> Path | None:
    candidates = [
        cwd / ".claude" / "codescout-companion.json",
        cwd / ".claude" / "codescout-routing.json",
    ]
    for p in candidates:
        if p.is_file():
            return p
    return None


def _find_project_dir(cwd: Path) -> Path:
    return cwd / ".codescout"


def _server_name_from_mcp_config(cfg: dict[str, Any]) -> str:
    servers = cfg.get("mcpServers") or {}
    if not isinstance(servers, dict):
        return ""
    for key, value in servers.items():
        if not isinstance(value, dict):
            continue
        cmd = value.get("command", "") or ""
        if isinstance(cmd, str) and SERVER_NAME_RE.search(cmd):
            return key
        args = value.get("args") or []
        if isinstance(args, list) and any(
            isinstance(a, str) and SERVER_NAME_RE.search(a) for a in args
        ):
            return key
    return ""


def _extract_command(cfg: dict[str, Any], server_name: str) -> str:
    servers = cfg.get("mcpServers") or {}
    if not isinstance(servers, dict):
        return ""
    entry = servers.get(server_name)
    if not isinstance(entry, dict):
        return ""
    cmd = entry.get("command", "") or ""
    return cmd if isinstance(cmd, str) else ""


def detect(cwd: str, home: str, claude_config_dir: str | None) -> dict[str, str]:
    cwd_path = Path(cwd)

    routing_path = _find_routing_config(cwd_path)
    project_dir = _find_project_dir(cwd_path)
    memories_dir = project_dir / "memories"
    config_file = project_dir / "project.toml"
    system_prompt_file = project_dir / "system-prompt.md"
    mcp_json = cwd_path / ".mcp.json"

    has_codescout = False
    server_name = ""

    routing_cfg: dict[str, Any] = {}
    if routing_path is not None:
        routing_cfg = _load_json(routing_path) or {}
        override = routing_cfg.get("server_name")
        if isinstance(override, str) and override:
            has_codescout = True
            server_name = override

    if not has_codescout and mcp_json.is_file():
        cfg = _load_json(mcp_json)
        if cfg:
            name = _server_name_from_mcp_config(cfg)
            if name:
                has_codescout = True
                server_name = name

    claude_dir = Path(claude_config_dir) if claude_config_dir else Path(home) / ".claude"
    user_configs: list[Path] = [
        claude_dir / ".claude.json",
        claude_dir / "settings.json",
    ]
    if not claude_config_dir:
        user_configs.append(Path(home) / ".claude.json")

    if not has_codescout:
        for cfg_path in user_configs:
            if not cfg_path.is_file():
                continue
            cfg = _load_json(cfg_path)
            if not cfg:
                continue
            name = _server_name_from_mcp_config(cfg)
            if name:
                has_codescout = True
                server_name = name
                break

    prefix = f"mcp__{server_name}__" if has_codescout else ""

    binary = ""
    if has_codescout and server_name:
        binary_search = [mcp_json, claude_dir / ".claude.json", claude_dir / "settings.json", Path(home) / ".claude.json"]
        for cfg_path in binary_search:
            if not cfg_path.is_file():
                continue
            cfg = _load_json(cfg_path)
            if not cfg:
                continue
            cmd = _extract_command(cfg, server_name)
            if cmd:
                binary = _expand_home(cmd, home)
                break

    block_reads = "true"
    workspace_root = ""
    if routing_cfg:
        block_val = routing_cfg.get("block_reads")
        if block_val is False or (isinstance(block_val, str) and block_val == "false"):
            block_reads = "false"
        ws = routing_cfg.get("workspace_root")
        if isinstance(ws, str) and ws:
            workspace_root = _expand_home(ws, home)

    has_onboarding = "true" if config_file.is_file() else "false"

    has_memories = "false"
    memory_names = ""
    if memories_dir.is_dir():
        for entry in sorted(memories_dir.iterdir()):
            if entry.is_file() and entry.suffix == ".md":
                memory_names += f"{entry.stem} "
                has_memories = "true"

    has_system_prompt = "false"
    system_prompt = ""
    if system_prompt_file.is_file():
        try:
            system_prompt = system_prompt_file.read_text(encoding="utf-8")
            has_system_prompt = "true"
        except OSError:
            pass

    return {
        "HAS_CODESCOUT": "true" if has_codescout else "false",
        "CS_SERVER_NAME": server_name,
        "CS_PREFIX": prefix,
        "CS_BINARY": binary,
        "CS_PROJECT_DIR": str(project_dir),
        "CS_MEMORIES_DIR": str(memories_dir),
        "CS_CONFIG_FILE": str(config_file),
        "ROUTING_CONFIG": str(routing_path) if routing_path else "",
        "HAS_CS_ONBOARDING": has_onboarding,
        "HAS_CS_MEMORIES": has_memories,
        "CS_MEMORY_NAMES": memory_names,
        "HAS_CS_SYSTEM_PROMPT": has_system_prompt,
        "CS_SYSTEM_PROMPT": system_prompt,
        "BLOCK_READS": block_reads,
        "WORKSPACE_ROOT": workspace_root,
        "SOURCE_EXT_PATTERN": SOURCE_EXT_PATTERN,
    }


def emit_shell(values: dict[str, str]) -> None:
    for key, value in values.items():
        sys.stdout.write(f"{key}={shlex.quote(value)}\n")


def emit_json(values: dict[str, str]) -> None:
    json.dump(values, sys.stdout, indent=2)
    sys.stdout.write("\n")


def main(argv: list[str]) -> int:
    json_mode = "--json" in argv

    cwd = os.environ.get("CWD", "")
    home = os.environ.get("HOME", "")
    claude_config_dir = os.environ.get("CLAUDE_CONFIG_DIR") or None

    if not cwd:
        print("CWD must be set in env", file=sys.stderr)
        return 1

    values = detect(cwd, home, claude_config_dir)

    if json_mode:
        emit_json(values)
    else:
        emit_shell(values)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
