"""Background judge worker — assembles context, calls LLM, writes verdicts.

Intended to be spawned as a detached subprocess by the PostToolUse hook.
Usage: python3 -m scripts.judge_worker <narrative_path> <verdicts_path> <project_root> <session_id> <state_path>
"""
import os
import sys
import time
from pathlib import Path

from scripts.narrative import read_narrative, compact_narrative, MAX_ENTRIES_BEFORE_COMPACT
import scripts.judge as _judge
from scripts.judge import build_judge_prompt, parse_judge_response
from scripts.verdicts import write_verdict


CS_TOOL_LABEL = {
    "mcp__codescout__read_file": "read_file",
    "mcp__codescout__read_markdown": "read_md",
    "mcp__codescout__edit_file": "edit_file",
    "mcp__codescout__create_file": "create_file",
    "mcp__codescout__insert_code": "insert_code",
    "mcp__codescout__replace_symbol": "replace_sym",
    "mcp__codescout__remove_symbol": "remove_sym",
    "mcp__codescout__find_symbol": "find_sym",
    "mcp__codescout__grep": "grep",
    "mcp__codescout__list_dir": "list_dir",
}



def format_action_entry(event: dict) -> str:
    """Format a PostToolUse event into a one-line narrative action."""
    tool = event.get("tool_name", "Unknown")
    tool_input = event.get("tool_input") or {}

    if tool in ("Edit", "Write", "NotebookEdit"):
        file_path = tool_input.get("file_path", "unknown file")
        parts = Path(file_path).parts
        short = "/".join(parts[-3:]) if len(parts) > 3 else file_path
        return f"Claude {tool} {short}"

    if tool == "Bash":
        command = tool_input.get("command", "")
        short_cmd = command[:80] + ("..." if len(command) > 80 else "")
        return f"Claude Bash: {short_cmd}"

    if tool == "Read":
        file_path = tool_input.get("file_path", "unknown file")
        parts = Path(file_path).parts
        short = "/".join(parts[-3:]) if len(parts) > 3 else file_path
        return f"Claude Read {short}"

    if tool in CS_TOOL_LABEL:
        label = CS_TOOL_LABEL[tool]
        path = tool_input.get("path") or tool_input.get("file_path")
        if path:
            parts = Path(path).parts
            short = "/".join(parts[-3:]) if len(parts) > 3 else path
            return f"Claude cs.{label} {short}"
        return f"Claude cs.{label}"

    return f"Claude {tool}"


def assemble_context(
    narrative_path: Path,
    project_root: Path,
    state_path: Path,
) -> dict:
    """Gather all context the judge needs."""
    narrative_entries = read_narrative(narrative_path)

    # Read session-scoped active plan, not a global glob.
    plan_content = None
    try:
        from scripts.state import load_active_plan
        active = load_active_plan(narrative_path.parent)
        if active:
            plan_path = Path(active["path"])
            if not plan_path.is_absolute():
                plan_path = project_root / plan_path
            try:
                plan_content = plan_path.read_text(encoding="utf-8")[:4000]
            except Exception:
                plan_content = None
    except Exception:
        plan_content = None

    # Load project constraints from codescout memories
    constraints_parts = []
    memory_dir = project_root / ".codescout" / "memory"
    for name in ("conventions", "gotchas", "architecture"):
        mem_file = memory_dir / f"{name}.md"
        if mem_file.exists():
            try:
                constraints_parts.append(
                    f"### {name}\n{mem_file.read_text(encoding='utf-8')[:1500]}"
                )
            except Exception:
                pass
    project_constraints = "\n\n".join(constraints_parts)

    # Extract edited files from recent narrative
    affected_symbols = ""
    edited_files = []
    EDIT_MARKERS = (
        "Edit ", "Write ",
        "cs.edit_file ", "cs.create_file ", "cs.insert_code ",
    )
    for entry in narrative_entries[-10:]:
        text = entry.get("text", "")
        for marker in EDIT_MARKERS:
            idx = text.find(marker)
            if idx >= 0:
                after = text[idx + len(marker):].strip().split()
                if after:
                    edited_files.append(after[0])
                break
    if edited_files:
        affected_symbols = "Recently edited: " + ", ".join(set(edited_files))

    # Test state from session-scoped buddy state
    test_state = None
    try:
        import json
        with open(state_path) as f:
            state = json.load(f)
        test_state = state.get("signals", {}).get("last_test_result")
    except Exception:
        pass

    return {
        "narrative_entries": narrative_entries,
        "plan_content": plan_content,
        "project_constraints": project_constraints,
        "affected_symbols": affected_symbols,
        "test_state": test_state,
    }


def run_judge(
    narrative_path: Path,
    verdicts_path: Path,
    project_root: Path,
    session_id: str,
    state_path: Path,
) -> None:
    """Run the full judge cycle: assemble, compact, call LLM, write verdict."""
    try:
        ctx = assemble_context(narrative_path, project_root, state_path=state_path)

        if not ctx["narrative_entries"]:
            return

        # Compact if needed
        entries = ctx["narrative_entries"]
        if len(entries) > MAX_ENTRIES_BEFORE_COMPACT:
            old_text = "\n".join(
                e.get("text", "") for e in entries[:-10]
            )
            try:
                summary = _judge.call_judge_llm(
                    f"Summarize this coding session narrative in 2-3 sentences:\n{old_text}"
                )
                compact_narrative(narrative_path, summary=summary)
                ctx["narrative_entries"] = read_narrative(narrative_path)
            except Exception:
                pass

        # Build prompt and call judge
        prompt = build_judge_prompt(
            narrative_entries=ctx["narrative_entries"],
            plan_content=ctx["plan_content"],
            project_constraints=ctx["project_constraints"],
            affected_symbols=ctx["affected_symbols"],
            test_state=ctx["test_state"],
        )

        raw_response = _judge.call_judge_llm(prompt)
        result = parse_judge_response(raw_response)

        # Only write non-ok verdicts
        if result["verdict"] != "ok":
            verdict = {
                "ts": int(time.time()),
                "verdict": result["verdict"],
                "severity": result["severity"],
                "evidence": result["evidence"],
                "correction": result["correction"],
                "affected_files": result["affected_files"],
                "acknowledged": False,
            }
            write_verdict(verdicts_path, verdict, session_id=session_id)

    except Exception:
        pass


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(0)
    run_judge(
        narrative_path=Path(sys.argv[1]),
        verdicts_path=Path(sys.argv[2]),
        project_root=Path(sys.argv[3]),
        session_id=sys.argv[4],
        state_path=Path(sys.argv[5]),
    )
