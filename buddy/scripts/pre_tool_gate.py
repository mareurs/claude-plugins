"""PreToolUse gate — reads cached verdicts and decides whether to block Claude.

Used by hooks/pre-tool-use.sh. Never calls an LLM. Must stay under 10ms.
"""
import json
import time
from pathlib import Path

from scripts.verdicts import read_verdicts, DEFAULT_VERDICT_TTL


def should_block(
    verdicts_path: Path,
    min_severity: str = "blocking",
    ttl: int = DEFAULT_VERDICT_TTL,
) -> tuple[bool, list[dict]]:
    """Return unacknowledged verdicts at or above min_severity.

    Severity order: info < warning < blocking.
    Returns (any_found, list_of_matching_verdicts).
    """
    _SEVERITY_ORDER = {"info": 0, "warning": 1, "blocking": 2}
    try:
        data = read_verdicts(verdicts_path)
        cutoff = int(time.time()) - ttl
        threshold = _SEVERITY_ORDER.get(min_severity, 2)

        matching = []
        for v in data.get("active_verdicts", []):
            if v.get("acknowledged"):
                continue
            if v.get("ts", 0) <= cutoff:
                continue
            if _SEVERITY_ORDER.get(v.get("severity", "info"), 0) >= threshold:
                matching.append(v)

        return (len(matching) > 0, matching)
    except Exception:
        return (False, [])


def build_correction_message(verdicts: list[dict]) -> str:
    """Build the stderr message that Claude will see when blocked."""
    if len(verdicts) == 1:
        v = verdicts[0]
        header = f"BUDDY: {v['verdict'].upper()} DETECTED"
        return (
            f"{header}\n\n"
            f"{v.get('evidence', '')}\n\n"
            f"{v.get('correction', '')}\n\n"
            f"Fix this before continuing, then proceed with your task."
        )

    lines = [f"BUDDY: {len(verdicts)} ISSUES DETECTED\n"]
    for i, v in enumerate(verdicts, 1):
        lines.append(f"--- {i}. {v['verdict'].upper()} ---")
        lines.append(v.get("evidence", ""))
        lines.append(v.get("correction", ""))
        lines.append("")
    lines.append("Fix all issues before continuing, then proceed with your task.")
    return "\n".join(lines)
