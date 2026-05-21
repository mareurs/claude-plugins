#!/usr/bin/env python3
"""Session-scoped reconnaissance F/W counter.

Maintains <root>/.buddy/<sid>/recon-counts.json = {"F": int, "W": int}, where
<sid> comes from <root>/.buddy/.current_session_id (same source the recon
SKILL.md Phase-1 marker touch uses). The buddy statusline reads this file to
append an F<n>/W<n> suffix to the [recon] badge.

CLI:
  recon_count.py bump F [--root DIR]   # +1 friction
  recon_count.py bump W [--root DIR]   # +1 win
  recon_count.py read   [--root DIR]   # print {"F":n,"W":n} as JSON

Never raises: missing session id, missing/corrupt counts file, and write
errors all degrade to a silent exit 0 — this runs inside an LLM turn and must
not break it. Per-session by construction: a new CC session has a new <sid>
dir, so counts start at zero with no explicit reset.
"""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def _counts_path(root: Path) -> Path | None:
    sid_file = root / ".buddy" / ".current_session_id"
    try:
        sid = sid_file.read_text().strip()
    except OSError:
        return None
    if not sid:
        return None
    return root / ".buddy" / sid / "recon-counts.json"


def _load(path: Path) -> dict:
    try:
        data = json.loads(path.read_text())
        return {"F": int(data.get("F", 0)), "W": int(data.get("W", 0))}
    except (OSError, ValueError, TypeError):
        return {"F": 0, "W": 0}


def _write_atomic(path: Path, counts: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(counts, f)
        os.replace(tmp, path)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Recon F/W session counter")
    ap.add_argument("action", choices=["bump", "read"])
    ap.add_argument("kind", nargs="?", choices=["F", "W"])
    ap.add_argument("--root", default=".")
    args = ap.parse_args(argv)

    try:
        root = Path(args.root)
        path = _counts_path(root)
        if path is None:
            if args.action == "read":
                print(json.dumps({"F": 0, "W": 0}))
            return 0  # no session id → silent no-op
        counts = _load(path)
        if args.action == "read":
            print(json.dumps(counts))
            return 0
        if args.kind:  # bump
            counts[args.kind] += 1
            _write_atomic(path, counts)
        return 0
    except Exception:  # noqa: BLE001 - must never break the caller
        return 0


if __name__ == "__main__":
    sys.exit(main())
