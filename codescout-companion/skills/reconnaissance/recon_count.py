#!/usr/bin/env python3
"""Session-scoped reconnaissance F/W counter.

Maintains <root>/.buddy/<sid>/recon-counts.json = {"F": int, "W": int}, where
<sid> is this session's id, preferring $CLAUDE_CODE_SESSION_ID and falling back
to <root>/.buddy/.current_session_id (same order the recon SKILL.md Phase-1
marker touch uses). The buddy statusline reads this file to append an F<n>/W<n>
suffix to the [recon] badge.

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


def _session_id(root: Path) -> str | None:
    """This session's id, preferring the PROCESS-scoped source over the shared file.

    `$CLAUDE_CODE_SESSION_ID` is set per session by the harness and is the same id
    Claude Code hands the statusline on stdin — which is what
    `buddy/scripts/statusline.py` reads (`parse_stdin_session`) to locate
    `.buddy/<sid>/`. Preferring it aligns this writer with that reader.

    `.buddy/.current_session_id` is a documented **last-writer pointer** (see
    `buddy/docs/superpowers/specs/2026-04-27-per-session-statusline-isolation-design.md`,
    which lists it as the *fallback* below a process-derived lookup). On a checkout
    with concurrent sessions it names whoever wrote it most recently, which need not
    be the caller. Measured 2026-09-02 on a nine-session codescout checkout: the
    pointer named a peer session at the moment recon ran, so the `recon-active`
    marker and these counts landed under a sid the statusline never reads — the
    badge simply never appeared, with no error anywhere.

    It is **volatile rather than consistently wrong**, which is why it went
    unnoticed: minutes later the same file held the caller's own id. A source that
    is usually right produces no reproducible symptom, so the failure reads as "the
    badge is flaky" rather than as a resolution bug.

    The pointer stays as a fallback — it is correct whenever the caller is the only
    writer, which covers single-session checkouts and any non-CC invocation where
    the env var is absent.
    """
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID", "").strip()
    if sid:
        return sid
    try:
        sid = (root / ".buddy" / ".current_session_id").read_text().strip()
    except OSError:
        return None
    return sid or None


def _counts_path(root: Path) -> Path | None:
    sid = _session_id(root)
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
