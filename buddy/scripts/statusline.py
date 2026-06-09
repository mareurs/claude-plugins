"""Claude Code statusline for the buddy plugin.

Reads session metadata from stdin, reads state + identity from disk,
renders the primary bodhisattva to stdout.

Zero LLM involvement. < 1ms per render.
"""
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

# Make the plugin root importable so `from scripts.xxx` works when this file
# is launched as a script (`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/statusline.py`).
# Python's default sys.path adds only the script's own directory, which is
# `scripts/` — that would break `from scripts.state import load_state`.
_PLUGIN_ROOT = Path(__file__).resolve().parent.parent
if str(_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(_PLUGIN_ROOT))

from scripts.buddha import derive_mood
from scripts import buddy_paths

BUDDY_DIR = buddy_paths.global_root()
IDENTITY_PATH = buddy_paths.identity_path()

PLUGIN_ROOT = _PLUGIN_ROOT
DATA_DIR = PLUGIN_ROOT / "data"


SPECIALIST_SHORT = {
    "debugging-yeti": "yeti",
    "refactoring-yak": "yak",
    "testing-snow-leopard": "leopard",
    "performance-lammergeier": "lammergeier",
    "security-ibex": "ibex",
    "architecture-snow-lion": "lion",
    "planning-crane": "crane",
    "docs-lotus-frog": "frog",
    "data-leakage-snow-pheasant": "pheasant",
    "ml-training-takin": "takin",
    "prompt-hamsa": "hamsa",
    "codescout-pika": "pika",
}


SPECIALIST_ROLE = {
    "debugging-yeti": "debugger",
    "refactoring-yak": "refactorer",
    "testing-snow-leopard": "tester",
    "performance-lammergeier": "perf",
    "security-ibex": "security",
    "architecture-snow-lion": "architect",
    "planning-crane": "planner",
    "docs-lotus-frog": "docs",
    "data-leakage-snow-pheasant": "leakage",
    "ml-training-takin": "ml",
    "prompt-hamsa": "prompt",
    "codescout-pika": "watcher",
}

_CSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _visible_width(s: str) -> int:
    return len(_CSI_RE.sub("", s))


def _terminal_width() -> int:
    """Width for statusline layout. COLUMNS env wins (CC sets it per render); shutil ioctl as fallback; 80 on failure."""
    raw = os.environ.get("COLUMNS")
    if raw:
        try:
            n = int(raw)
            if n > 0:
                return n
        except ValueError:
            pass
    try:
        return shutil.get_terminal_size((80, 24)).columns
    except OSError:
        return 80


def _format_specialists(active: list[str], pairs: list[tuple[str, str]]) -> str:
    """Adaptive specialist line. ≤2 active → full labels from pairs (slug fallback); ≥3 → role names from SPECIALIST_ROLE (slug fallback)."""
    if not active:
        return ""
    label_map = dict(pairs)
    if len(active) <= 2:
        return ", ".join(label_map.get(slug, slug) for slug in active)
    return ", ".join(
        SPECIALIST_ROLE.get(slug, SPECIALIST_SHORT.get(slug, slug))
        for slug in active
    )
def _truncate_visible(s: str, max_w: int) -> str:
    if max_w <= 0:
        return ""
    if _visible_width(s) <= max_w:
        return s
    had_csi = bool(_CSI_RE.search(s))
    plain = _CSI_RE.sub("", s)
    cut_w = max(max_w - 1, 0)
    truncated = plain[:cut_w] + "…"
    if had_csi:
        truncated += "\033[0m"
    return truncated


def _compose_rows(base: str, segments: list[str], term_w: int) -> str:
    art_rows = base.split("\n")

    trimmed = list(segments)
    while trimmed and trimmed[-1] == "":
        trimmed.pop()
    n = max(len(art_rows), len(trimmed))

    art_visible_widths = [_visible_width(r) for r in art_rows]
    anchor = (max(art_visible_widths) if art_visible_widths else 0) + 2
    right_budget = max(term_w - anchor, 20)

    work = list(trimmed)
    # Truncation priority — slot 2 (specialists) is intentionally OMITTED:
    # term width detection falsely reports 80 cols inside CC's statusline
    # subprocess, so capping specialists eats visible names even on wide
    # terminals. Let slot 2 overflow and wrap; that's better than always
    # ellipsizing roles when there's actually space. Bubbles/recon stay
    # capped because they're short-by-design and a wrap onto art rows
    # below would look worse than truncation.
    priority = [3, 4, 5, 1]
    for idx in priority:
        if idx >= len(work):
            continue
        if _visible_width(work[idx]) > right_budget:
            work[idx] = _truncate_visible(work[idx], right_budget)

    out_lines = []
    for i in range(n):
        art_piece = art_rows[i] if i < len(art_rows) else ""
        seg = work[i] if i < len(work) else ""
        if art_piece == "" and seg == "":
            continue
        if seg:
            pad = anchor - _visible_width(art_piece)
            if pad < 0:
                pad = 0
            out_lines.append(art_piece + (" " * pad) + seg)
        else:
            out_lines.append(art_piece)

    return "\n".join(out_lines)
def _compose_segments(
    form_label: str,
    mood: str,
    suggested: str | None,
    specialists_line: str,
    recon_badge: str,
    verdict_bubble: str,
    cs_verdict_bubble: str,
) -> list[str]:
    """Build the 6-slot segment list for the right column of the statusline.

    Slot 0 is always empty (env strip row). Slot 1 is form · mood (always). Slot 2 is the
    specialists line (or empty). Slot 3 combines `<short> nearby` and the recon badge.
    Slots 4 and 5 carry the plan verdict and codescout verdict bubbles respectively.
    """
    slot1 = f"{form_label} · {mood}" if form_label else mood
    parts = []
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        parts.append(f"{short} nearby")
    if recon_badge:
        parts.append(recon_badge)
    slot3 = " ".join(parts)
    return ["", slot1, specialists_line, slot3, verdict_bubble, cs_verdict_bubble]



def _load_json(path: Path) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def parse_stdin_context_pct(raw: str) -> float:
    """Extract context_window.used_percentage from Claude Code session JSON.

    Returns 0.0 on any parse failure, missing field, or null value. Never raises.
    """
    try:
        session = json.loads(raw)
        ctx = session.get("context_window", {}).get("used_percentage")
        if ctx is None:
            return 0.0
        return float(ctx)
    except (json.JSONDecodeError, ValueError, TypeError, AttributeError):
        return 0.0


def parse_stdin_session(raw: str):
    """Extract session_id and project root from Claude Code's stdin JSON.

    Returns (None, None) on any parse failure — statusline still renders.
    Schema drift is tolerated by silent fallback.
    """
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError, TypeError):
        return None, None
    session_id = data.get("session_id")
    cwd = (data.get("workspace") or {}).get("current_dir") or data.get("cwd")
    project_root = Path(cwd) if cwd else None
    if not session_id or not project_root:
        return None, None
    return session_id, project_root


SEVERITY_FORMAT = {
    "info": ("\033[32m", "[ok]"),
    "warning": ("\033[33m", "[!]"),
    "blocking": ("\033[31m", "[X]"),
}
RESET = "\033[0m"


def _render_bubble(session_id, project_root, now):
    if not session_id or session_id == "unknown" or project_root is None:
        return ""
    try:
        from scripts.verdicts import fresh_verdict
        session_dir = project_root / ".buddy" / session_id
        result = fresh_verdict(session_dir, now or int(time.time()))
        if result is None:
            return ""
        latest, count = result
        color, icon = SEVERITY_FORMAT.get(
            latest.get("severity", ""), ("", "[?]")
        )
        correction = (latest.get("correction") or "")[:60]
        verdict_name = latest.get("verdict", "")
        suffix = f" (+{count - 1})" if count > 1 else ""
        return f"{color}{icon} {verdict_name}: {correction}{RESET}{suffix}"
    except Exception:
        return ""


CS_SEVERITY_FORMAT = {
    "info": ("\033[36m", "[cs]"),       # cyan
    "warning": ("\033[33m", "[cs!]"),    # yellow
    "blocking": ("\033[31m", "[csX]"),   # red
}


def _render_cs_bubble(session_id, project_root, now):
    """Render codescout judge verdict badge (separate from plan verdicts)."""
    if not session_id or session_id == "unknown" or project_root is None:
        return ""
    try:
        from scripts.verdicts import fresh_verdict
        session_dir = project_root / ".buddy" / session_id
        cs_verdicts_path = session_dir / "cs_verdicts.json"
        if not cs_verdicts_path.exists():
            return ""
        result = fresh_verdict(session_dir, now or int(time.time()),
                               verdicts_file="cs_verdicts.json")
        if result is None:
            return ""
        latest, count = result
        color, icon = CS_SEVERITY_FORMAT.get(
            latest.get("severity", ""), ("", "[cs?]"),
        )
        correction = (latest.get("correction") or "")[:60]
        suffix = f" (+{count - 1})" if count > 1 else ""
        return f"{color}{icon} {correction}{RESET}{suffix}"
    except Exception:
        return ""




RECON_FRESH_SECS = 30 * 60


def _render_recon_badge(project_root, now, session_id=None):
    """Reconnaissance badge with session F/W counters.

    Markers under <project_root>/.buddy/<session_id>/:
      - recon-loaded : SessionStart dropped it; recon SKILL.md in scope.
                       No freshness check — lives for the session.
      - recon-active : LLM touched during a scout. Fresh-mtime (<30 min)
                       indicates scout in progress.
      - recon-counts.json : {"F": n, "W": n} session-scoped entry counts,
                       bumped by recon_count.py at SKILL.md Phase 3.

    Display:
      - active fresh   → "[recon•]" (bright purple)
      - loaded only    → "[recon]" (dim purple)
      - neither        → empty
    A non-zero count suffix (" F<n>/W<n>", omitting a zero side) is appended
    inside the brackets in both the dim and bright states.
    """
    try:
        if not project_root or not session_id or session_id == "unknown":
            return ""
        session_dir = Path(project_root) / ".buddy" / session_id
        loaded = session_dir / "recon-loaded"
        active = session_dir / "recon-active"
        now_ts = now or int(time.time())

        active_fresh = False
        if active.is_file():
            try:
                if now_ts - int(active.stat().st_mtime) <= RECON_FRESH_SECS:
                    active_fresh = True
            except OSError:
                pass

        if active_fresh:
            color, glyph = "\033[95m", "recon•"  # bright purple, scout in progress
        elif loaded.is_file():
            color, glyph = "\033[35m", "recon"   # purple, in scope
        else:
            return ""

        suffix = ""
        try:
            data = json.loads((session_dir / "recon-counts.json").read_text())
            f, w = int(data.get("F", 0)), int(data.get("W", 0))
            parts = []
            if f > 0:
                parts.append(f"F{f}")
            if w > 0:
                parts.append(f"W{w}")
            if parts:
                suffix = " " + "/".join(parts)
        except (OSError, ValueError, TypeError):
            suffix = ""

        return f"{color}[{glyph}{suffix}]\033[0m"
    except Exception:
        return ""

def render(
    identity: dict,
    state: dict,
    bodhisattvas: dict,
    env: dict,
    now: int | None = None,
    local_hour: int | None = None,
    *,
    session_id: str | None = None,
    project_root: Path | None = None,
) -> str:
    """Compose the statusline output."""
    import time as _t
    if now is None:
        now = int(_t.time())
    if local_hour is None:
        local_hour = datetime.now().hour

    mood, suggested = derive_mood(state.get("signals", {}), now, local_hour)

    form_name = identity.get("form", "")
    form = bodhisattvas.get(form_name)
    if not form:
        return f"· {identity.get('name', '?')} · {mood}"

    env_strip = env.get(mood, env.get("flow", ""))
    eyes = form["eyes"].get(mood) or form["eyes"].get("flow", "·_·")
    base = form["base"].replace("{env}", env_strip).replace("{eyes}", eyes)

    form_label = form.get("label", form_name)

    active = state.get("active_specialists", [])
    specialists_line = ""
    if active:
        plugin_root = _PLUGIN_ROOT
        proj_root = project_root or Path.cwd()
        try:
            from scripts.specialist_labels import resolve_labels
            pairs = resolve_labels(
                active,
                plugin_root=plugin_root,
                project_root=proj_root,
            )
        except Exception:
            pairs = []
        specialists_line = _format_specialists(active, pairs)

    recon_badge = _render_recon_badge(project_root, now, session_id=session_id)
    verdict_bubble = _render_bubble(session_id, project_root, now)
    cs_verdict_bubble = _render_cs_bubble(session_id, project_root, now)

    segments = _compose_segments(
        form_label=form_label,
        mood=mood,
        suggested=suggested,
        specialists_line=specialists_line,
        recon_badge=recon_badge,
        verdict_bubble=verdict_bubble,
        cs_verdict_bubble=cs_verdict_bubble,
    )

    return _compose_rows(base, segments, _terminal_width())


def main() -> int:
    try:
        raw_stdin = sys.stdin.read()
    except Exception:
        raw_stdin = ""

    try:
        from scripts.state import load_state, default_state, session_state_path
        from scripts.identity import load_identity

        session_id, project_root = parse_stdin_session(raw_stdin)
        if session_id and project_root:
            state = load_state(session_state_path(project_root, session_id))
        else:
            state = default_state()

        ctx_pct = parse_stdin_context_pct(raw_stdin)
        if ctx_pct > 0:
            state.setdefault("signals", {})["context_pct"] = ctx_pct

        import os
        user_id = os.environ.get("CLAUDE_CODE_USER_ID") or os.environ.get("USER", "user")
        identity = load_identity(IDENTITY_PATH, user_id=user_id)

        bodhis = _load_json(DATA_DIR / "bodhisattvas.json")
        env = _load_json(DATA_DIR / "environment.json")

        sys.stdout.write(render(
            identity, state, bodhis, env,
            session_id=session_id, project_root=project_root,
        ))
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
