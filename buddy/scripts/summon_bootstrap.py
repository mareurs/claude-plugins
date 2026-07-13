#!/usr/bin/env python3
"""Hook-side summon bootstrap — deliver the specialist payload at prompt time.

Called from the user-prompt-submit hook entry (scripts.hook_entry) when the
prompt starts with /buddy:summon.
Reads the hook event JSON on stdin; prints the full summon payload to stdout
(UserPromptSubmit stdout is injected as context); exits 0 always. A cold
summon thereby costs ZERO model tool calls — summon.md's load steps become a
fallback for the cases this script declines (fuzzy args, lens prompts).

Declines (prints nothing) when:
- the argument is empty, ambiguous, or matches no discovered specialist
  (conservative matching only — intent-fuzzy resolution is a model strength);
- a required lens is missing or the named lens file does not exist
  (the interactive lens prompt stays a summon.md concern).

Already-active specialists get a one-line marker instead of the payload
(dedup — the certain channel the statusline also reads; see skill_ledger.py
for the Skill-tool counterpart).

Design: docs/superpowers/specs/2026-06-12-skill-loading-bootstrap-design.md.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

_HERE = Path(__file__).resolve().parent.parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from scripts import buddy_paths  # noqa: E402
from scripts.reload import parse_frontmatter, strip_frontmatter  # noqa: E402
from scripts.state import load_state, save_state, session_state_path  # noqa: E402

PLUGIN_ROOT = _HERE
MEMORY_SOFT_CAP = 30
BINDING_LINE_CAP = 500


# ---------------------------------------------------------------- discovery

def discover(project_root: Path) -> dict[str, tuple[str, Path]]:
    """name → (scope, path), precedence applied (project > global > builtin).

    Pure-Python scan (no bash) so it runs on Windows too. Scans builtin, then
    global, then project; later assignment wins, which IS the precedence rule.
    A specialist is a subdirectory containing a SKILL.md. Mirrors the retired
    discover-specialists.sh (self-located builtin; $BUDDY_HOME global via
    buddy_paths; project under <project_root>/.buddy/skills).
    """
    scopes = (
        ("builtin", PLUGIN_ROOT / "skills"),
        ("global", buddy_paths.global_skills()),
        ("project", Path(project_root) / ".buddy" / "skills"),
    )
    index: dict[str, tuple[str, Path]] = {}
    for scope, root in scopes:
        if not root or not root.is_dir():
            continue
        try:
            entries = sorted(root.iterdir())
        except OSError:
            continue
        for entry in entries:
            try:
                if entry.is_dir() and (entry / "SKILL.md").is_file():
                    index[entry.name] = (scope, entry)
            except OSError:
                continue
    return index


def parse_argument(prompt: str) -> str:
    """'/buddy:summon data-leakage:llm' → 'data-leakage:llm' (raw argument)."""
    parts = prompt.split(None, 1)
    return parts[1].strip() if len(parts) > 1 else ""


def resolve_with_lens(arg: str, index: dict) -> tuple[str | None, str | None]:
    """Resolve the raw argument to (directory, lens).

    Order: the whole argument as a name first ('prompt hamsa' → prompt-hamsa),
    then `name:lens` / `name lens` splits. Conservative — ambiguity → (None, None).
    """
    if not arg:
        return None, None
    whole = resolve(arg, index)
    if whole is not None:
        return whole, None
    if ":" in arg:
        spec, _, lens = arg.partition(":")
        return resolve(spec.strip(), index), (lens.strip() or None)
    tokens = arg.split()
    if len(tokens) == 2:
        return resolve(tokens[0], index), tokens[1]
    return None, None


def resolve(arg: str, index: dict) -> str | None:
    """Conservative match: exact key, kebab-joined exact, else unique substring.

    Substring matching requires ≥3 chars — shorter fragments matching uniquely
    is accident, not intent ('x' → security-ibex), and the model fallback
    handles fuzzy intent better than the hook should try to.
    """
    if not arg:
        return None
    candidates = [arg.lower(), arg.lower().replace(" ", "-")]
    for c in candidates:
        if c in index:
            return c
    if len(arg) < 3:
        return None
    hits = [k for k in index if candidates[0] in k or candidates[1] in k]
    return hits[0] if len(hits) == 1 else None


# ---------------------------------------------------------------- payload

def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def collect_memories(directory: str, project_root: Path) -> str:
    """summon.md Step 2.5, hook-side: POV + common across global/project channels."""
    channels = [
        ("Project (this repo)", project_root / ".buddy" / "memory"),
        ("Global", buddy_paths.global_memory()),
    ]
    sections: list[str] = []
    hints: list[str] = []
    for label, root in channels:
        if not root.is_dir():
            continue
        entries: list[str] = []
        for sub in (directory, "common"):
            sub_dir = root / sub
            if not sub_dir.is_dir():
                continue
            for f in sorted(sub_dir.glob("*.md")):
                text = _read(f)
                if text and text.strip():
                    entries.append(text.strip())
        if entries:
            sections.append(f"### {label}\n\n" + "\n\n".join(entries))
        if len(entries) > MEMORY_SOFT_CAP:
            hints.append(
                f"→ memory: {label} channel has {len(entries)} entries — "
                "consider consolidating"
            )
    if not sections:
        return ""
    out = f"## Memories — {directory} POV\n\n" + "\n\n".join(sections)
    if hints:
        out += "\n\n" + "\n".join(hints)
    return out


def collect_bindings(meta: dict, project_root: Path) -> str:
    """Layer D: frontmatter `inject_trackers` (project-relative files) +
    `inject_memory_topics` (.codescout/memories/<topic>.md). Flat inline-array
    keys — writable via edit_markdown's frontmatter tooling. Soft-skip
    anything missing: bindings cost zero in projects that lack the files."""
    blocks: list[str] = []
    trackers = meta.get("inject_trackers") or []
    topics = meta.get("inject_memory_topics") or []
    for rel in (trackers if isinstance(trackers, list) else []):
        text = _read(project_root / rel)
        if text is None:
            continue
        lines = text.splitlines()
        if len(lines) > BINDING_LINE_CAP:
            text = "\n".join(lines[:BINDING_LINE_CAP]) + (
                f"\n… (truncated at {BINDING_LINE_CAP} lines — "
                f"read the rest via read_markdown(path=\"{rel}\"))"
            )
        blocks.append(f"### Tracker: {rel}\n\n{text.strip()}")
    for topic in (topics if isinstance(topics, list) else []):
        text = _read(project_root / ".codescout" / "memories" / f"{topic}.md")
        if text is None:
            continue
        blocks.append(f"### codescout memory: {topic}\n\n{text.strip()}")
    if not blocks:
        return ""
    return "## Live State\n\n" + "\n\n".join(blocks)


def build_payload(
    directory: str,
    scope: str,
    skill_dir: Path,
    lens: str | None,
    project_root: Path,
) -> str | None:
    raw = _read(skill_dir / "SKILL.md")
    if raw is None:
        return None
    meta = parse_frontmatter(raw)
    body = strip_frontmatter(raw).strip()

    lens_clause = f" lens={lens}" if lens else ""
    parts = [
        f"<!-- buddy:summon-payload specialist={directory}{lens_clause} scope={scope} -->",
        (
            "The summon payload below was injected by buddy's prompt hook — "
            "the load steps in /buddy:summon are already done. Announce the "
            "specialist (italic arrival line) and adopt its voice for the "
            "rest of the session."
        ),
        body,
    ]
    if lens:
        lens_text = _read(skill_dir / f"_{lens}.md")
        if lens_text is None:
            return None  # named lens missing → model fallback reports options
        parts.append(f"## Lens addendum — {lens}\n\n{strip_frontmatter(lens_text).strip()}")

    memories = collect_memories(directory, project_root)
    if memories:
        parts.append(memories)
    protocol = _read(PLUGIN_ROOT / "data" / "memory-protocol.md")
    if protocol:
        parts.append("## Memory Protocol\n\n" + protocol.strip())
    gates = _read(PLUGIN_ROOT / "data" / "gates.md")
    if gates:
        parts.append("## Gates\n\n" + gates.strip())
    bindings = collect_bindings(meta, project_root)
    if bindings:
        parts.append(bindings)
    return "\n\n".join(parts)
def spill_payload(payload: str, directory: str, project_root: Path, sid: str) -> str | None:
    """Write the full payload to the guard-exempt `.buddy/<sid>/` tree.

    CC's persisted-output mechanism truncates any hook stdout over its inline
    cap to a ~2KB preview with NO @ref handle (documented in codescout's
    docs/superpowers/specs/2026-03-29-onboarding-buffered-output-design.md —
    codescout hit the identical wall and fixed it the same way). Personas
    assemble to 18-48KB, so inlining always truncates behind a "fully-loaded"
    marker. Mirror codescout's core principle — always buffer, return a compact
    pointer: keep stdout tiny, spill the body to a file the guard already
    exempts (`*/.buddy/*` in pre-tool-guard.sh), and let the model pull it in
    one Read. Returns the project-relative path, or None if the write failed.
    """
    try:
        out_dir = project_root / ".buddy" / sid
        out_dir.mkdir(parents=True, exist_ok=True)
        name = f"summon-payload-{directory}.md"
        tmp = out_dir / f".{name}.tmp"
        tmp.write_text(payload, encoding="utf-8")
        os.replace(tmp, out_dir / name)
        return f".buddy/{sid}/{name}"
    except OSError:
        return None


# ---------------------------------------------------------------- tracking

def is_active(directory: str, project_root: Path, sid: str) -> bool:
    state = load_state(session_state_path(project_root, sid))
    return directory in (state.get("active_specialists") or [])


def track_summon(directory: str, project_root: Path, sid: str) -> None:
    try:
        path = session_state_path(project_root, sid)
        state = load_state(path)
        active = state.setdefault("active_specialists", [])
        if directory not in active:
            active.append(directory)
        save_state(path, state)
    except Exception:
        pass


def log_summon(directory: str, lens: str | None) -> None:
    try:
        suffix = f":{lens}" if lens else ""
        log = buddy_paths.summons_log()
        log.parent.mkdir(parents=True, exist_ok=True)
        with open(log, "a", encoding="utf-8") as f:
            f.write(f"{int(time.time())}\t{directory}{suffix}\tsummoned\n")
    except OSError:
        pass


# ---------------------------------------------------------------- entry

def bootstrap(event: dict) -> str:
    """Return the text to inject (may be empty). Never raises."""
    try:
        prompt = (event.get("prompt") or "").strip()
        if not prompt.startswith("/buddy:summon"):
            return ""
        cwd = event.get("cwd") or os.getcwd()
        sid = event.get("session_id") or ""
        project_root = Path(cwd)

        index = discover(project_root)
        directory, lens = resolve_with_lens(parse_argument(prompt), index)
        if directory is None:
            return ""
        scope, skill_dir = index[directory]

        lenses = sorted(p.stem[1:] for p in skill_dir.glob("_*.md"))
        if not lenses:
            lens = None  # lens supplied to a lens-less specialist: ignore silently
        elif lens is None:
            return ""  # required lens not supplied → model prompts the user
        elif lens not in lenses:
            return ""  # unknown lens → model fallback reports options

        if sid and is_active(directory, project_root, sid):
            return (
                f"<!-- buddy:summon-already-active specialist={directory} -->\n"
                f"Specialist `{directory}` is already active in this session — "
                "voice, principles, and memories are in scope. Emit a short "
                "refresh line and continue; do not reload."
            )

        payload = build_payload(directory, scope, skill_dir, lens, project_root)
        if payload is None:
            return ""
        if sid:
            track_summon(directory, project_root, sid)
        log_summon(directory, lens)

        lens_clause = f" lens={lens}" if lens else ""
        rel = spill_payload(payload, directory, project_root, sid) if sid else None
        if rel is not None:
            # Compact pointer — stays well under CC's inline cap, so it is never
            # truncated. The model reads the spilled file (one guard-exempt Read);
            # if the spill is ever absent, summon.md's legacy load path covers it.
            return (
                f"<!-- buddy:summon-payload specialist={directory}{lens_clause} "
                f"scope={scope} payload-file={rel} -->\n"
                "The summon payload is too large to inline, so buddy's prompt hook "
                f"spilled the full SKILL.md + memories + protocol + gates to `{rel}` "
                "(a guard-exempt path). Read that file once, then announce the "
                "specialist (italic arrival line) and adopt its voice. The load "
                "steps in /buddy:summon are already done."
            )
        # No session id (or the spill write failed): inline the payload and accept
        # that CC may truncate it — summon.md's legacy load path then recovers.
        return payload
    except Exception:
        return ""


def main() -> int:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except (json.JSONDecodeError, ValueError):
        return 0
    out = bootstrap(event if isinstance(event, dict) else {})
    if out:
        print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
