"""Claude Code statusline for the buddy plugin.

Reads session metadata from stdin, reads state + identity from disk,
renders the primary bodhisattva to stdout.

Zero LLM involvement. < 1ms per render.
"""
import json
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

BUDDY_DIR = Path.home() / ".claude" / "buddy"
IDENTITY_PATH = BUDDY_DIR / "identity.json"

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
}

SPECIALIST_INITIAL = {
    "debugging-yeti": "D",
    "refactoring-yak": "R",
    "testing-snow-leopard": "T",
    "performance-lammergeier": "P",
    "security-ibex": "S",
    "architecture-snow-lion": "A",
    "planning-crane": "C",
    "docs-lotus-frog": "W",
    "data-leakage-snow-pheasant": "L",
    "ml-training-takin": "M",
}


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

    label_parts = [form.get("label", form_name), mood]
    if suggested:
        short = SPECIALIST_SHORT.get(suggested, suggested)
        label_parts.append(f"{short} nearby")

    active = state.get("active_specialists", [])
    if active:
        initials = "".join(SPECIALIST_INITIAL.get(s, "?") for s in active)
        label_parts.append(f"[{initials}]")

    label = " · ".join(label_parts)

    bubble = _render_bubble(session_id, project_root, now)
    if bubble:
        label = f"{label} {bubble}"

    cs_bubble = _render_cs_bubble(session_id, project_root, now)
    if cs_bubble:
        label = f"{label} {cs_bubble}"

    return f"{base}\n {label}"


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
