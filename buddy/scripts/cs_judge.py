"""Codescout usage judge — prompt builder and LLM caller.

Mirrors scripts/judge.py but specialized for evaluating codescout MCP tool
usage patterns.  Reads cs_tool_log.jsonl entries and evaluates against
data/cs_rules.md.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

SYSTEM_PROMPT = "You are a codescout tool-usage judge. Respond with JSON only."

VALID_VERDICTS = {"cs-misuse", "cs-inefficient", "ok"}
VALID_SEVERITIES = {"blocking", "warning", "info"}

CS_JUDGE_TEMPLATE = """## Recent codescout tool calls (last {count})

{tool_log}

## Task

Evaluate the tool call sequence above for correctness and efficiency.
Look for:
- Iron Law violations (read_file on source, edit_file for structural changes,
  piping run_command output, missing project restore)
- Parallel write hazards (same-second writes)
- Buffer reference waste (ignoring @cmd_* handles)
- Repeated inefficient patterns across 3+ calls

Return a single JSON verdict. If everything looks fine, return {{"verdict": "ok"}}.
"""


def load_rules() -> str:
    """Load cs_rules.md from the data directory."""
    rules_path = Path(__file__).parent.parent / "data" / "cs_rules.md"
    try:
        return rules_path.read_text(encoding="utf-8")
    except Exception:
        return SYSTEM_PROMPT


def build_cs_judge_prompt(tool_log_entries: list[dict]) -> str:
    """Build the judge prompt from recent tool log entries."""
    if not tool_log_entries:
        return "No tool calls to evaluate."

    lines = []
    for entry in tool_log_entries:
        ts = entry.get("ts", 0)
        tool = entry.get("tool", "?")
        args = entry.get("args", "")
        outcome = entry.get("outcome", "?")
        lines.append(f"[{ts}] {tool}({args}) → {outcome}")

    tool_log_text = "\n".join(lines)

    return CS_JUDGE_TEMPLATE.format(
        count=len(tool_log_entries),
        tool_log=tool_log_text,
    )


def call_cs_judge_llm(prompt: str) -> str:
    """Call the LLM endpoint for codescout judgment.

    Uses the same env vars as the plan judge (BUDDY_JUDGE_API_*).
    Raises on failure — caller must handle exceptions.
    """
    import requests

    api_url = os.environ.get("BUDDY_JUDGE_API_URL", "")
    model = os.environ.get("BUDDY_JUDGE_MODEL", "")
    api_key = os.environ.get("BUDDY_JUDGE_API_KEY", "")

    if not api_url or not model:
        raise RuntimeError("BUDDY_JUDGE_API_URL and BUDDY_JUDGE_MODEL must be set")

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    rules = load_rules()
    system_content = f"{rules}\n\n---\n\n{SYSTEM_PROMPT}"

    url = api_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_content},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 500,
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]


def parse_cs_judge_response(raw: str) -> dict:
    """Parse LLM response JSON.  Returns safe defaults on any failure."""
    default = {
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_tools": [],
    }
    try:
        stripped = raw.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1]
            stripped = stripped.rsplit("```", 1)[0].strip()
        parsed = json.loads(stripped)
    except (json.JSONDecodeError, TypeError):
        return default

    if not isinstance(parsed, dict):
        return default

    verdict = parsed.get("verdict", "ok")
    if verdict not in VALID_VERDICTS:
        verdict = "ok"

    severity = parsed.get("severity", "info")
    if severity not in VALID_SEVERITIES:
        severity = "info"

    return {
        "verdict": verdict,
        "severity": severity,
        "evidence": str(parsed.get("evidence", "")),
        "correction": str(parsed.get("correction", "")),
        "affected_tools": list(parsed.get("affected_tools", [])),
    }
