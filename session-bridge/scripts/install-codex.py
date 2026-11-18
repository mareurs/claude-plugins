#!/usr/bin/env python3
"""Merge the bridge MCP server and hooks into one existing Codex home; dry-run by default."""
import argparse
import json
import os
from pathlib import Path
import re
import shlex
import tempfile
import tomllib

def replace_server(text, binary):
    parsed = tomllib.loads(text)
    current = parsed.get("mcp_servers", {}).get("session-bridge")
    command = json.dumps(str(binary))
    section = re.compile(r'(?m)^[ \t]*\[mcp_servers\.(?:session-bridge|"session-bridge"|\'session-bridge\')\][ \t]*(?:#.*)?$')
    match = section.search(text)
    if current is not None and not match:
        raise ValueError("existing session-bridge uses an inline/unrecognized TOML form; no files changed")
    if match:
        end = re.search(r"(?m)^[ \t]*\[", text[match.end():])
        stop = match.end() + end.start() if end else len(text)
        body = text[match.end():stop]
        for key, value in [("command", command), ("args", '["serve"]')]:
            pattern = re.compile(r"(?m)^[ \t]*" + key + r"[ \t]*=.*$")
            if pattern.search(body): body = pattern.sub(lambda _: key+" = "+value, body)
            else: body = "\n"+key+" = "+value+body
        result = text[:match.end()] + body + text[stop:]
    else:
        result = text.rstrip()+"\n\n[mcp_servers.session-bridge]\ncommand = "+command+'\nargs = ["serve"]\n'
    final = tomllib.loads(result)
    assert final["mcp_servers"]["session-bridge"]["command"] == str(binary)
    assert final["mcp_servers"]["session-bridge"]["args"] == ["serve"]
    return result

def owned(handler, binaries):
    try:
        args = shlex.split(handler.get("command", ""))
        return len(args) == 5 and args[0] in binaries and args[1] == "hook" and args[2] in {"session-start", "prompt", "post-tool"} and args[3:] == ["--harness", "codex"]
    except (ValueError, AttributeError):
        return False

def merge_hooks(document, binary, previous_binary=None):
    if not isinstance(document, dict) or not isinstance(document.get("hooks", {}), dict):
        raise ValueError("incompatible hooks.json; no files changed")
    result = json.loads(json.dumps(document))
    result.setdefault("hooks", {})
    for event, argument in [("SessionStart","session-start"),("UserPromptSubmit","prompt"),("PostToolUse","post-tool")]:
        groups = result["hooks"].get(event, [])
        if not isinstance(groups, list): raise ValueError("incompatible hook group")
        kept = []
        for group in groups:
            if not isinstance(group, dict) or not isinstance(group.get("hooks"), list):
                raise ValueError("incompatible hook handlers")
            remaining = [h for h in group["hooks"] if not owned(h, {str(binary), previous_binary})]
            if remaining:
                kept.append(dict(group, hooks=remaining))
        kept.append({"hooks":[{"type":"command","command":shlex.join([str(binary),"hook",argument,"--harness","codex"]),"timeout":5}]})
        result["hooks"][event] = kept
    return result

def atomic_write(path, content):
    mode = path.stat().st_mode & 0o777 if path.exists() else 0o600
    descriptor, name = tempfile.mkstemp(prefix=".session-bridge-", dir=path.parent)
    try:
        os.fchmod(descriptor, mode)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)

def apply_changes(changes):
    completed = []
    try:
        for path, new in changes:
            previous = path.read_text() if path.exists() else None
            atomic_write(path, new)
            completed.append((path, previous))
    except OSError as error:
        failures = []
        for path, previous in reversed(completed):
            try:
                if previous is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write(path, previous)
            except OSError as rollback_error:
                failures.append(str(path) + ": " + str(rollback_error))
        if failures:
            raise OSError(str(error) + "; rollback failed: " + "; ".join(failures)) from error
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", type=Path, required=True, help="Existing CODEX_HOME")
    parser.add_argument("--binary", type=Path, required=True, help="Built session-bridge executable")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    profile = args.profile.expanduser().resolve(strict=True)
    binary = args.binary.expanduser().resolve(strict=True)
    if not profile.is_dir() or not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError("an existing profile and executable binary are required")
    config = profile / "config.toml"
    hooks = profile / "hooks.json"
    if config.is_symlink() or hooks.is_symlink():
        raise ValueError("refusing to replace symlinked config files")
    original = config.read_text() if config.exists() else ""
    parsed = tomllib.loads(original)
    features = parsed.get("features", {})
    if features.get("hooks") is False or features.get("codex_hooks") is False:
        raise ValueError("hooks are explicitly disabled; enable them in Codex before installing the notice hooks")
    new_config = replace_server(original, binary)
    old_hooks = hooks.read_text() if hooks.exists() else ""
    new_hooks = json.dumps(merge_hooks(json.loads(old_hooks) if old_hooks else {}, binary, parsed.get("mcp_servers", {}).get("session-bridge", {}).get("command")), indent=2)+"\n"
    # Validate and prepare BOTH before any write. Preserve Codex trust settings untouched.
    changes = [(path, new) for path, old, new in [(config, original, new_config), (hooks, old_hooks, new_hooks)] if old != new]
    changed = [str(path) for path, _ in changes]
    if args.apply:
        apply_changes(changes)
    print(json.dumps({"applied":args.apply,"profile":str(profile),"changed":changed,
        "next":"Review/enable the three hook commands in Codex's hook trust UI, then reconnect the MCP server. No Codex source or binary was modified."}))

if __name__ == "__main__":
    try:
        main()
    except (OSError,ValueError,AssertionError) as error:
        raise SystemExit(str(error))
