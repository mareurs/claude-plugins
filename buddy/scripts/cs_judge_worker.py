"""Async codescout judge worker — spawned as a detached subprocess.

Mirrors scripts/judge_worker.py but evaluates codescout tool usage patterns
instead of plan-following.  Reads cs_tool_log.jsonl, calls LLM via
cs_judge.py, writes non-ok verdicts to cs_verdicts.json.

Usage (called by handle_cs_tool_use):
    python3 -m scripts.cs_judge_worker <cs_log_path> <cs_verdicts_path> <project_root> <session_id>
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

# Max entries sent to the LLM (most recent N from the log).
JUDGE_WINDOW = 20


def run_cs_judge(
    cs_log_path: Path,
    cs_verdicts_path: Path,
    project_root: Path,
    session_id: str,
) -> None:
    """Run the full cs judge cycle: read log, call LLM, write verdict."""
    try:
        from scripts.cs_tool_log import read_entries
        from scripts.cs_judge import (
            build_cs_judge_prompt,
            call_cs_judge_llm,
            parse_cs_judge_response,
        )
        from scripts.verdicts import write_verdict, read_verdicts

        entries = read_entries(cs_log_path)
        if not entries:
            return

        # Send the most recent JUDGE_WINDOW entries
        recent = entries[-JUDGE_WINDOW:]
        prompt = build_cs_judge_prompt(recent)
        raw_response = call_cs_judge_llm(prompt)
        result = parse_cs_judge_response(raw_response)

        # Only write non-ok verdicts
        if result["verdict"] != "ok":
            # Dedup: skip if an unacknowledged verdict with the same
            # (verdict, affected_tools) is already present.
            new_key = (result["verdict"], sorted(result["affected_tools"]))
            existing = read_verdicts(cs_verdicts_path)
            for ev in existing["active_verdicts"]:
                if not ev.get("acknowledged", False):
                    ev_key = (ev["verdict"], sorted(ev.get("affected_tools", [])))
                    if ev_key == new_key:
                        return

            verdict = {
                "ts": int(time.time()),
                "verdict": result["verdict"],
                "severity": result["severity"],
                "evidence": result["evidence"],
                "correction": result["correction"],
                "affected_tools": result["affected_tools"],
                "acknowledged": False,
            }
            write_verdict(cs_verdicts_path, verdict, session_id=session_id)

    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) < 5:
        sys.exit(1)
    run_cs_judge(
        cs_log_path=Path(sys.argv[1]),
        cs_verdicts_path=Path(sys.argv[2]),
        project_root=Path(sys.argv[3]),
        session_id=sys.argv[4],
    )
