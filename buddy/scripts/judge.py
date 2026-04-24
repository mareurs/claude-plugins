"""LLM judge client — prompt building, API call, response parsing.

Calls any OpenAI-compatible chat completions endpoint. No SDK dependency.
"""
import json
import os

VALID_VERDICTS = {
    "ok", "plan-drift", "doc-drift", "missed-callers",
    "missed-consideration", "scope-creep",
}
VALID_SEVERITIES = {"info", "warning", "blocking"}

SYSTEM_PROMPT = "You are a code review judge for an active coding session. Respond with JSON only."

JUDGE_TEMPLATE = """Evaluate whether the most recent actions in this coding session have issues.

SESSION NARRATIVE:
{narrative}

ACTIVE PLAN:
{plan}

PROJECT CONSTRAINTS:
{constraints}

AFFECTED SYMBOLS:
{symbols}

RECENT TEST STATE:
{tests}

Check for:
1. Plan drift — working on wrong step, skipping steps, diverging from plan
2. Doc drift — contradicting project conventions, gotchas, architecture docs
3. Missed callers — editing a function/symbol without updating its call sites
4. Missed consideration — ignoring a relevant gotcha or constraint
5. Scope creep — doing work not in the plan or user request

Respond with JSON only:
{{
  "verdict": "ok|plan-drift|doc-drift|missed-callers|missed-consideration|scope-creep",
  "severity": "info|warning|blocking",
  "evidence": "what specifically is wrong — cite the constraint or plan step",
  "correction": "what should be done instead",
  "affected_files": ["file paths"]
}}

Rules:
- Multi-step workflows are normal. Reading before writing is not drift.
- Preparation steps (reading files, listing symbols) are not scope creep.
- Only flag REAL issues with specific evidence. When in doubt, verdict is "ok".
- "blocking" severity only for clear plan contradictions or missed callers that will cause bugs.
- "warning" for style/convention issues. "info" for minor observations.
"""


def build_judge_prompt(
    narrative_entries: list[dict],
    plan_content: str | None,
    project_constraints: str,
    affected_symbols: str,
    test_state: dict | None,
) -> str:
    """Build the judge prompt from narrative + context."""
    narrative_lines = []
    for entry in narrative_entries:
        prefix = f"[{entry.get('type', '?')}]"
        narrative_lines.append(f"{prefix} {entry.get('text', '')}")
    narrative_text = "\n".join(narrative_lines) if narrative_lines else "No narrative yet"

    plan_text = plan_content or "No active plan found"
    constraints_text = project_constraints or "No project constraints loaded"
    symbols_text = affected_symbols or "No affected symbols identified"

    if test_state and test_state.get("passed") is not None:
        test_text = (
            f"Passed: {test_state.get('passed', 0)}, "
            f"Failed: {test_state.get('failed', 0)}"
        )
    else:
        test_text = "No recent tests"

    return JUDGE_TEMPLATE.format(
        narrative=narrative_text,
        plan=plan_text,
        constraints=constraints_text,
        symbols=symbols_text,
        tests=test_text,
    )


def parse_judge_response(raw: str) -> dict:
    """Parse LLM response JSON. Returns safe defaults on any failure."""
    default = {
        "verdict": "ok",
        "severity": "info",
        "evidence": "",
        "correction": "",
        "affected_files": [],
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
        "affected_files": list(parsed.get("affected_files", [])),
    }


def call_judge_llm(prompt: str) -> str:
    """Call the OpenAI-compatible LLM endpoint. Returns raw response text.

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

    url = api_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.3,
        "max_tokens": 1000,
    }

    resp = requests.post(url, json=payload, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["choices"][0]["message"]["content"]
