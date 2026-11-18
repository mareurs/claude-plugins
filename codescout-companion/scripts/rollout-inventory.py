#!/usr/bin/env python3
"""Linux inventory only: no launcher execution, database access or config writes."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tomllib

FILE_LIMIT = 1024 * 1024
BINARY_LIMIT = 512 * 1024 * 1024
PATH_KEYS = ("LIBRARIAN_DB", "LIBRARIAN_WORKSPACE", "LIBRARIAN_CWD", "CODESCOUT_SQLITE_DIR")
ENV_KEYS = PATH_KEYS + (
    "CODESCOUT_VECTOR_BACKEND", "CODESCOUT_ARTIFACT_BACKEND",
    "CODESCOUT_EMBEDDING_MODEL", "CODESCOUT_EMBEDDER_MODEL", "CODESCOUT_EMBED_MODEL",
    "CODESCOUT_EMBEDDING_URL", "CODESCOUT_EMBEDDER_URL", "CODESCOUT_EMBED_URL",
    "CODESCOUT_EMBEDDING_API_KEY", "EMBED_API_KEY", "OPENAI_API_KEY",
    "LIBRARIAN_EMBED_MODEL", "LIBRARIAN_EMBED_URL", "LIBRARIAN_EMBED_API_KEY",
)
AUTH_NAMES = {"auth.json", "credentials.json", ".credentials.json", ".netrc"}
UNIT = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,200}\.(service|timer|socket|path|scope)$")
ROLE = re.compile(r"^(codescout.*|pi|pi-.*|claude|claude-.*|codex|codex-.*)$", re.I)


def read_bytes(path, limit=FILE_LIMIT):
    try:
        target = path.resolve()
        if target.name in AUTH_NAMES:
            return None, "refused_auth_file"
        if target.suffix.lower() in {".md", ".sqlite", ".sqlite3", ".db", ".bak"} or target.name.endswith(("-wal", "-shm")) or ".history" in target.parts:
            return None, "refused_data_file"
        # Nonblocking open and descriptor validation avoid a FIFO replacement
        # between path inspection and open. /proc pseudo-files are regular.
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                return None, "not_regular"
            data = stream.read(limit + 1)
        return (None, "over_limit") if len(data) > limit else (data, "ok")
    except FileNotFoundError:
        return None, "not_found"
    except (OSError, RuntimeError):
        return None, "unavailable"


def path_info(path):
    result = {"path": str(path)}
    try:
        result["canonical_path"] = str(path.resolve())
        result["symlink"] = path.is_symlink()
        mode = path.stat().st_mode
        result["status"] = "directory" if stat.S_ISDIR(mode) else "file" if stat.S_ISREG(mode) else "not_regular"
    except FileNotFoundError:
        result["status"] = "missing"
    except (OSError, RuntimeError):
        result["status"] = "unavailable"
    return result


def local_path(value, home):
    if not isinstance(value, str) or len(value) > 2048:
        return {"status": "unresolved"}
    if any(x in value for x in ("\n", "\r", "\0", "://", "$", "`")):
        return {"status": "unresolved"}
    if value.startswith("~/"):
        value = str(home / value[2:])
    if not value.startswith("/"):
        return {"status": "unresolved"}
    return path_info(Path(value))


def storage(env, home):
    return {key: local_path(env[key], home) for key in PATH_KEYS if key in env}


def candidate_command(value):
    return isinstance(value, str) and (
        bool(ROLE.match(Path(value).name)) or "pi-coding-agent/" in value
    )


def fingerprint(path, cache):
    try:
        meta = path.stat()
        key = (meta.st_dev, meta.st_ino, meta.st_size, meta.st_mtime_ns)
        if key not in cache:
            if meta.st_size > BINARY_LIMIT:
                cache[key] = {"status": "over_limit"}
            else:
                data, status = read_bytes(path, BINARY_LIMIT)
                cache[key] = {"status": status}
                if data is not None:
                    cache[key]["sha256"] = hashlib.sha256(data).hexdigest()
        return cache[key]
    except (OSError, RuntimeError):
        return {"status": "unavailable"}


def read_config(path):
    data, status = read_bytes(path)
    if data is None:
        return {}, status
    try:
        parsed = tomllib.loads(data.decode("utf-8")) if path.suffix == ".toml" else json.loads(data)
        return (parsed, "ok") if isinstance(parsed, dict) else ({}, "invalid")
    except (ValueError, UnicodeError):
        return {}, "invalid"


def config_inventory(home, projects):
    profiles = [".codex", ".Codex", ".Codex-sdd", ".Codex-kat",
                ".claude", ".claude-sdd", ".claude-kat"]
    paths = [home / ".mcp.json", home / ".claude.json", home / ".pi/agent/mcp.json",
             home / ".pi/agent/settings.json"]
    paths += [home / x / "config.toml" for x in profiles if "codex" in x.lower()]
    paths += [home / x / ".mcp.json" for x in profiles if "claude" in x]
    paths += [home / x / ".claude.json" for x in profiles if "claude" in x]
    paths += [home / x / "settings.json" for x in profiles if "claude" in x]
    paths += [p / ".mcp.json" for p in projects]
    for key in ("CODEX_HOME", "CLAUDE_CONFIG_DIR"):
        info = local_path(os.environ.get(key), home)
        if info.get("path"):
            base = Path(info["path"])
            paths += [base / "config.toml", base / ".mcp.json", base / ".claude.json", base / "settings.json"]
    files, launchers = [], []
    for path in dict.fromkeys(paths):
        data, status = read_config(path)
        files.append({**path_info(path), "status": status})
        # Claude may keep project-scoped MCP definitions in .claude.json.
        tables = [(None, data)]
        if isinstance(data.get("projects"), dict):
            tables += [(key, x) for key, x in data["projects"].items() if isinstance(x, dict)]
        for project_scope, table in tables:
            servers = table.get("mcpServers", table.get("mcp_servers", {}))
            if not isinstance(servers, dict):
                continue
            for name, server in servers.items():
                if not isinstance(server, dict):
                    continue
                command = server.get("command")
                if "codescout" not in str(name).lower() and not candidate_command(command):
                    continue
                args = server.get("args", [])
                args = args if isinstance(args, list) else []
                env = server.get("env", {})
                env = env if isinstance(env, dict) else {}
                launchers.append({
                    "config": str(path), "server": str(name), "command": local_path(command, home),
                    "project_scope": local_path(project_scope, home) if project_scope is not None else None,
                    "argument_paths": {"--project": local_path(server["args"][i + 1], home)
                                       for i, arg in enumerate(args)
                                       if isinstance(server.get("args"), list) and arg == "--project" and i + 1 < len(server["args"])},
                    "command_basename": Path(command).name if isinstance(command, str) and candidate_command(command) else None,
                    "argument_count": len(server["args"]) if isinstance(server.get("args"), list) else None,
                    "remote_transport_present": "url" in server,
                    "env_keys_present": [k for k in ENV_KEYS if k in env],
                    "storage": storage(env, home),
                    "binding_scope": "configured overrides; inherited/default values unresolved",
                })
    return files, launchers


def process_inventory(proc, home, cache, known=()):
    result = {"status": "ok", "scope": "visible PIDs with this real UID",
              "uid": os.getuid(), "pid_dirs_visited": 0, "unavailable": 0, "processes": []}
    try:
        entries = sorted((p for p in proc.iterdir() if p.name.isdigit()), key=lambda p: int(p.name))
    except OSError:
        result["status"] = "unavailable"
        return result
    if len(entries) > 10000:
        result["status"] = "over_limit"
        entries = entries[:10000]
    for path in entries:
        result["pid_dirs_visited"] += 1
        try:
            status, state = read_bytes(path / "status")
            if status is None:
                raise OSError(state)
            match = re.search(rb"^Uid:\s+(\d+)", status, re.M)
            if not match or int(match[1]) != os.getuid():
                continue
            before, state = read_bytes(path / "stat")
            argv, argv_state = read_bytes(path / "cmdline")
            if before is None or argv is None:
                raise OSError(state or argv_state)
            args = argv.decode("utf-8", "surrogateescape").split("\0")
            if not any(candidate_command(x) or x in known for x in args):
                continue
            fields = before.decode("utf-8", "surrogateescape").rpartition(")")[2].split()
            start = fields[19]
            exe = os.readlink(path / "exe")
            cwd = os.readlink(path / "cwd")
            env_bytes, env_state = read_bytes(path / "environ")
            env = {}
            if env_bytes is not None:
                for item in env_bytes.decode("utf-8", "surrogateescape").split("\0"):
                    key, sep, value = item.partition("=")
                    if sep and key in ENV_KEYS:
                        env[key] = value
            groups, group_state = read_bytes(path / "cgroup")
            units = []
            if groups is not None:
                for component in groups.decode("utf-8", "surrogateescape").replace("\n", "/").split("/"):
                    if UNIT.fullmatch(component):
                        units.append(component)
            binary = fingerprint(path / "exe", cache)
            after, _ = read_bytes(path / "stat")
            if before != after:
                # CPU counters change during a healthy scan: compare PID identity only.
                if after is None or after.decode("utf-8", "surrogateescape").rpartition(")")[2].split()[19] != start:
                    raise OSError("process changed during scan")
            result["processes"].append({
                "pid": int(path.name), "ppid": int(fields[1]), "start_time_ticks": start,
                "match_basis": "executable/argument name or known launcher candidate; not writer attestation",
                "executable": exe, "deleted_executable": exe.endswith(" (deleted)"),
                "binary": binary, "cwd": cwd,
                "detached_candidate": int(fields[1]) in (0, 1),
                "units": sorted(set(units)), "cgroup_status": group_state,
                "environment_status": env_state, "env_keys_present": [k for k in ENV_KEYS if k in env],
                "storage": storage(env, home),
            })
        except (OSError, ValueError, IndexError, RuntimeError):
            result["unavailable"] += 1
    return result


def declared_storage(text, home):
    env = {}
    for line in text.splitlines():
        candidate = line.strip()
        if candidate.startswith("export "):
            candidate = candidate[7:]
        if candidate.startswith("Environment="):
            candidate = candidate[len("Environment="):]
        try:
            tokens = shlex.split(candidate, comments=True)
        except ValueError:
            continue
        for token in tokens:
            key, sep, value = token.partition("=")
            if sep and key in PATH_KEYS:
                env[key] = value
    return storage(env, home)


def launcher_record(path, home, cache):
    data, status = read_bytes(path)
    row = {**path_info(path), "read_status": status, "fingerprint": fingerprint(path, cache)}
    if data is not None:
        try:
            text = data.decode("utf-8")
            row["storage"] = declared_storage(text, home)
            row["codescout_reference_present"] = "codescout" in text.lower()
        except UnicodeError:
            row["read_status"] = "invalid_utf8"
    return row


def scan_controller_files(home, known):
    roots = [home / ".config/systemd/user", home / ".config/autostart",
             Path("/etc/systemd/system"), Path("/usr/lib/systemd/system"),
             Path("/etc/xdg/autostart"), Path("/etc/cron.d"), Path("/etc/cron.daily")]
    rows, scopes = [], []
    for root in roots:
        scope = {"path": str(root), "visited_files": 0, "unavailable": 0, "status": "ok"}
        if not root.is_dir():
            scope["status"] = "not_found"
            scopes.append(scope)
            continue
        def onerror(_error):
            scope["status"] = "partial"
            scope["unavailable"] += 1
        for folder, dirs, files in os.walk(root, followlinks=False, onerror=onerror):
            # Linked directory trees may contain other owners' data; don't traverse them.
            dirs[:] = [d for d in dirs if not (Path(folder) / d).is_symlink()]
            for name in sorted(files):
                scope["visited_files"] += 1
                if scope["visited_files"] > 2000:
                    scope["status"] = "over_limit"
                    break
                path = Path(folder) / name
                data, status = read_bytes(path)
                if data is None:
                    scope["unavailable"] += 1
                    continue
                text = data.decode("utf-8", "replace")
                if "codescout" in text.lower() or any(x in text for x in known):
                    restart = re.findall(r"^Restart=(\S+)", text, re.M)
                    rows.append({**path_info(path), "restart": restart[-1] if restart and restart[-1] in (
                        "no", "always", "on-failure", "on-abnormal", "on-watchdog", "on-success", "on-abort") else None})
            if scope["status"] == "over_limit":
                break
        scopes.append(scope)
    return rows, scopes


def read_probe(argv):
    # These callers pass only fixed read operations and validated unit names.
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=10, check=False)
        return (p.stdout, "ok") if p.returncode == 0 else ("", "unavailable")
    except (OSError, subprocess.TimeoutExpired):
        return "", "unavailable"


def runtime_controllers(unit_names, known):
    runtime = {"status": "ok", "managers": [], "units": [], "user_crontab": {}}
    for manager, flags in (("user", ["--user"]), ("system", [])):
        output, status = read_probe(["/usr/bin/systemctl", *flags, "list-unit-files", "--no-pager", "--no-legend"])
        runtime["managers"].append({"manager": manager, "status": status})
        names = set(unit_names)
        for line in output.splitlines():
            name = line.split()[0] if line.split() else ""
            if UNIT.fullmatch(name) and "codescout" in name.lower():
                names.add(name)
        if len(names) > 200:
            runtime["status"] = "over_limit"
        for name in sorted(names)[:200]:
            if not UNIT.fullmatch(name):
                continue
            props = "Id,ActiveState,UnitFileState,Restart,TriggeredBy,Triggers,FragmentPath,MainPID"
            output, status = read_probe(["/usr/bin/systemctl", *flags, "show", "--no-pager", "--property=" + props, "--", name])
            row = {"manager": manager, "unit": name, "status": status}
            parsed = dict(line.split("=", 1) for line in output.splitlines() if "=" in line)
            for key in ("ActiveState", "UnitFileState", "Restart"):
                value = parsed.get(key, "")
                row[key] = value if re.fullmatch(r"[a-z-]{1,30}", value) else None
            for key in ("TriggeredBy", "Triggers"):
                row[key] = [x for x in parsed.get(key, "").split() if UNIT.fullmatch(x)]
            row["FragmentPath"] = parsed["FragmentPath"] if parsed.get("FragmentPath", "").startswith("/") else None
            row["MainPID"] = int(parsed["MainPID"]) if parsed.get("MainPID", "").isdigit() else None
            runtime["units"].append(row)
    output, status = read_probe(["/usr/bin/crontab", "-l"])
    runtime["user_crontab"] = {
        "status": status, "matching_line_count": sum(
            "codescout" in line.lower() or any(x in line for x in known)
            for line in output.splitlines() if line.strip() and not line.lstrip().startswith("#")),
    }
    return runtime


def collect(home, proc, projects, extra_launchers, use_runtime=True):
    home, proc = Path(home), Path(proc)
    projects = [Path(p).absolute() for p in projects]
    cache = {}
    configs, launchers = config_inventory(home, projects)
    known = [str(Path(p).absolute()) for p in extra_launchers]
    known += [row["command"]["path"] for row in launchers if row["command"].get("path")]
    known = list(dict.fromkeys(known))
    files = [launcher_record(Path(p), home, cache) for p in known]
    launcher_scopes = []
    for base in (home / ".local/bin", home / ".cargo/bin", home / ".pi/agent/extensions"):
        scope = path_info(base)
        try:
            children = sorted(base.iterdir())
            if len(children) > 2000:
                scope["status"] = "over_limit"
            for path in children[:2000]:
                if "codescout" in path.name.lower() and str(path) not in known:
                    files.append(launcher_record(path, home, cache))
                    known.append(str(path))
        except FileNotFoundError:
            scope["status"] = "missing"
        except OSError:
            scope["status"] = "unavailable"
        launcher_scopes.append(scope)
    processes = process_inventory(proc, home, cache, known)
    controllers, scopes = scan_controller_files(home, known)
    units = {Path(x["path"]).name for x in controllers if UNIT.fullmatch(Path(x["path"]).name)}
    units.update(u for p in processes["processes"] for u in p["units"])
    stores, store_scopes = [], []
    for project in projects:
        root = project / ".codescout"
        candidates = [root / "memories", root / "private-memories"]
        members = root / "projects"
        scope = path_info(members)
        try:
            children = sorted(members.iterdir())
            if len(children) > 2000:
                scope["status"] = "over_limit"
            candidates += [p / "memories" for p in children[:2000] if p.is_dir()]
        except FileNotFoundError:
            scope["status"] = "missing"
        except OSError:
            scope["status"] = "unavailable"
        store_scopes.append(scope)
        for path in candidates:
            info = path_info(path)
            store_scopes.append(info)
            if info["status"] == "directory":
                stores.append({"project": str(project), **info})
    return {
        "format": "codescout-rollout-inventory-v1",
        "captured_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "activation_ready": False, "execution_authorized": False, "inventory_complete": False,
        "context": {"home": str(home), "proc_root": str(proc), "projects": [str(x) for x in projects]},
        "config_files": configs, "launchers": launchers, "launcher_files": files,
        "launcher_scopes": launcher_scopes, "store_scopes": store_scopes,
        "process_scan": processes,
        "controllers": {"files": controllers, "scopes": scopes,
                        "runtime": runtime_controllers(units, known) if use_runtime else {"status": "not_requested"}},
        "store_candidates": stores,
        "unresolved": [
            "Inventory is a snapshot of accessible scopes, not proof all launchers/writers were found.",
            "Relative/dynamic bindings, PATH resolution, shell fallbacks and unselected projects need private review.",
            "No database was opened; namespaces, row conservation, backups, recall and rollback remain unverified.",
            "Other UIDs, PID namespaces, custom profile roots and generic wrappers may need explicit inventory.",
            "parent PID 1 is a detached candidate, not proof of its restart controller.",
            "No approval to stop processes, install, migrate or activate is implied.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--proc-root", type=Path, default=Path("/proc"))
    parser.add_argument("--project", type=Path, action="append", default=[])
    parser.add_argument("--launcher", type=Path, action="append", default=[])
    parser.add_argument("--skip-runtime", action="store_true", help="skip systemctl/crontab read probes")
    args = parser.parse_args()
    if not sys.platform.startswith("linux"):
        parser.error("Linux required; do not treat missing /proc as a clean inventory")
    report = collect(args.home, args.proc_root, args.project, args.launcher, not args.skip_runtime)
    json.dump(report, sys.stdout, indent=2, ensure_ascii=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
