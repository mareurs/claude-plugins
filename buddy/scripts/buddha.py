"""Mood derivation from signals. Pure function, no I/O.

Heuristics match docs/superpowers/specs/2026-04-13-claude-code-buddy-plugin-design.md §6.2.
Priority order matters — higher-priority moods short-circuit lower ones.

All 10 spec moods are implemented. Thresholds are tunable starting values.
"""

STUCK_WINDOW_SEC = 15 * 60
STUCK_FAIL_THRESHOLD = 3
FULL_CONTEXT_THRESHOLD = 80
LONG_SESSION_SEC = 2 * 3600
IDLE_SEC = 5 * 60

RACING_MIN_CALLS_PER_MIN = 15
RACING_MIN_SESSION_SEC = 60

EXPLORATORY_MIN_SESSION_SEC = 15 * 60
EXPLORATORY_MIN_TOOL_CALLS = 50
EXPLORATORY_MAX_CONTEXT_PCT = 60

VICTORIOUS_WINDOW_SEC = 2 * 60
VICTORIOUS_MIN_PRIOR_ERRORS = 1


def derive_mood(signals: dict, now: int, local_hour: int):
    """Return (mood, suggested_specialist | None) from current signals.

    Priority order (highest first):
        1. full-context  (≥80% context usage — most actionable)
        2. drifting      (judge detected plan/doc/scope issues)
        3. broken        (judge detected structural issues)
        4. stuck         (≥3 test failures in last 15 min)
        5. victorious    (recent green after red)
        6. test-streak   (recent green, no prior red)
        7. long-session  (session age >2h)
        8. racing        (high edit velocity in young session)
        9. exploratory   (moderate session, lots of calls, low context)
       10. idle          (no user input for 5+ min)
       11. late-night    (hour ≥23 or ≤5)
       12. flow          (default)
    """
    ctx = signals.get("context_pct", 0)
    if ctx >= FULL_CONTEXT_THRESHOLD:
        return ("full-context", "planning-crane")

    # Priority 2: drifting — judge detected plan/doc/scope issues
    judge_verdict = signals.get("judge_verdict")
    if judge_verdict in ("plan-drift", "doc-drift", "scope-creep"):
        return ("drifting", "planning-crane")

    # Priority 3: broken — judge detected structural issues
    if judge_verdict in ("missed-callers", "missed-consideration"):
        return ("broken", "debugging-yeti")

    # Priority 3b: correction — codescout judge detected blocking misuse
    cs_severity = signals.get("cs_judge_severity")
    if cs_severity == "blocking":
        return ("correction", None)

    last_test = signals.get("last_test_result")
    if last_test and last_test.get("failed", 0) >= STUCK_FAIL_THRESHOLD:
        if (now - last_test.get("ts", 0)) <= STUCK_WINDOW_SEC:
            return ("stuck", "debugging-yeti")

    if last_test and last_test.get("failed", 0) == 0 and last_test.get("passed", 0) > 0:
        test_age = now - last_test.get("ts", 0)
        if test_age <= VICTORIOUS_WINDOW_SEC:
            prior_errors = [
                e for e in signals.get("recent_errors", [])
                if e.get("ts", 0) < last_test.get("ts", 0)
            ]
            if len(prior_errors) >= VICTORIOUS_MIN_PRIOR_ERRORS:
                return ("victorious", None)
        if test_age <= STUCK_WINDOW_SEC:
            return ("test-streak", None)

    session_start = signals.get("session_start_ts", 0)
    session_age = (now - session_start) if session_start > 0 else 0

    if session_age >= LONG_SESSION_SEC:
        return ("long-session", "planning-crane")

    tool_calls = signals.get("tool_call_count", 0)
    if session_age >= RACING_MIN_SESSION_SEC and tool_calls > 0:
        calls_per_min = tool_calls / max(1, session_age / 60)
        if calls_per_min >= RACING_MIN_CALLS_PER_MIN:
            return ("racing", "refactoring-yak")

    if (session_age >= EXPLORATORY_MIN_SESSION_SEC
            and tool_calls >= EXPLORATORY_MIN_TOOL_CALLS
            and ctx <= EXPLORATORY_MAX_CONTEXT_PCT):
        return ("exploratory", "architecture-snow-lion")

    idle_ts = signals.get("idle_ts", 0)
    if idle_ts > 0 and (now - idle_ts) >= IDLE_SEC:
        return ("idle", None)

    if local_hour >= 23 or local_hour <= 5:
        return ("late-night", None)

    return ("flow", None)
