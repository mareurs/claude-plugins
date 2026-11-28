"""A process the buddy hooks start must not open a console window.

The hook daemon (scripts/hookd.py) is started detached, so it has no console. A console program it
starts then makes Windows allocate a new console, and with Windows Terminal as the default terminal
that opens a visible window for each call. Every subprocess call in scripts/ therefore passes
`creationflags` (CREATE_NO_WINDOW, or the detached flags for a fire-and-forget worker), or builds its
keyword arguments in a dict that sets it.
"""
import re
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
CALL = re.compile(r"subprocess\.(run|Popen|check_output|check_call|call)\(")


def _call_text(src: str, open_idx: int) -> str:
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] == "(":
            depth += 1
        elif src[i] == ")":
            depth -= 1
            if depth == 0:
                return src[open_idx : i + 1]
    return src[open_idx:]


def _scripts():
    return sorted(p for p in SCRIPTS.glob("*.py") if not p.name.startswith("test_"))


def test_the_scan_sees_the_subprocess_calls():
    calls = [m for p in _scripts() for m in CALL.finditer(p.read_text(encoding="utf-8"))]
    assert len(calls) >= 5, f"expected the known subprocess calls, found {len(calls)}"


def test_every_subprocess_call_sets_creationflags_or_forwards_kwargs():
    offenders = []
    for path in _scripts():
        src = path.read_text(encoding="utf-8")
        for m in CALL.finditer(src):
            text = _call_text(src, m.end() - 1)
            # `**kwargs` means the caller built the flags itself (hook_helpers / hookd set creationflags there).
            if "creationflags" in text or "**kwargs" in text:
                continue
            offenders.append(f"{path.name}:{src[: m.start()].count(chr(10)) + 1} subprocess.{m.group(1)}(...)")
    assert offenders == [], "these calls open a console window when the caller has no console"


def test_the_kwargs_builders_set_creationflags_on_windows():
    for name in ("hook_helpers.py", "hookd.py"):
        src = (SCRIPTS / name).read_text(encoding="utf-8")
        assert "creationflags" in src, f"{name} builds subprocess kwargs without creationflags"
