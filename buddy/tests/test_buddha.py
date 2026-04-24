"""Tests for buddha.py — mood derivation from signals.

Each test constructs a minimal signals dict and asserts the derived mood.
Covers all 10 moods from spec §6.2.
"""
import pytest
from scripts.buddha import derive_mood


@pytest.fixture
def base_signals():
    def _make(now: int) -> dict:
        return {
            "context_pct": 30,
            "last_edit_ts": now - 60,
            "last_commit_ts": now - 1800,
            "session_start_ts": now - 600,
            "prompt_count": 5,
            "tool_call_count": 10,
            "last_test_result": None,
            "recent_errors": [],
            "idle_ts": now - 30,
            "judge_verdict": None,
            "judge_severity": None,
            "judge_block_count": 0,
            "judge_last_ts": 0,
        }
    return _make


def test_mood_flow_default(base_signals):
    now = 1000000
    mood, specialist = derive_mood(base_signals(now), now, local_hour=14)
    assert mood == "flow"
    assert specialist is None


def test_mood_stuck_on_three_test_failures(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["last_test_result"] = {"ts": now - 60, "passed": 0, "failed": 4}
    signals["recent_errors"] = [
        {"ts": now - 900 + i * 100, "tool": "Bash", "error": "fail"}
        for i in range(3)
    ]
    mood, specialist = derive_mood(signals, now, local_hour=14)
    assert mood == "stuck"
    assert specialist == "debugging-yeti"


def test_mood_late_night_after_23(base_signals):
    now = 1000000
    mood, _ = derive_mood(base_signals(now), now, local_hour=23)
    assert mood == "late-night"


def test_mood_late_night_before_5(base_signals):
    now = 1000000
    mood, _ = derive_mood(base_signals(now), now, local_hour=3)
    assert mood == "late-night"


def test_mood_full_context_over_80(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["context_pct"] = 85
    mood, specialist = derive_mood(signals, now, local_hour=14)
    assert mood == "full-context"
    assert specialist == "planning-crane"


def test_mood_long_session_over_2h(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["session_start_ts"] = now - (3 * 3600)
    mood, specialist = derive_mood(signals, now, local_hour=14)
    assert mood == "long-session"
    assert specialist == "planning-crane"


def test_mood_idle_over_5min(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["idle_ts"] = now - (6 * 60)
    mood, _ = derive_mood(signals, now, local_hour=14)
    assert mood == "idle"


def test_mood_priority_full_context_beats_late_night(base_signals):
    """Full context is more actionable than 'it's late' — surface it first."""
    now = 1000000
    signals = base_signals(now)
    signals["context_pct"] = 90
    mood, _ = derive_mood(signals, now, local_hour=23)
    assert mood == "full-context"


def test_mood_test_streak_all_passing(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["last_test_result"] = {"ts": now - 30, "passed": 12, "failed": 0}
    mood, _ = derive_mood(signals, now, local_hour=14)
    assert mood == "test-streak"


def test_mood_victorious_red_to_green(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["recent_errors"] = [
        {"ts": now - 600, "tool": "Bash", "error": "fail"},
        {"ts": now - 300, "tool": "Bash", "error": "fail"},
    ]
    signals["last_test_result"] = {"ts": now - 30, "passed": 12, "failed": 0}
    mood, _ = derive_mood(signals, now, local_hour=14)
    assert mood == "victorious"


def test_mood_racing_high_edit_velocity(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["session_start_ts"] = now - 120
    signals["tool_call_count"] = 40
    mood, specialist = derive_mood(signals, now, local_hour=14)
    assert mood == "racing"
    assert specialist == "refactoring-yak"


def test_mood_exploratory_many_calls_moderate_session(base_signals):
    now = 1000000
    signals = base_signals(now)
    signals["session_start_ts"] = now - 1800
    signals["tool_call_count"] = 80
    signals["context_pct"] = 40
    mood, specialist = derive_mood(signals, now, local_hour=14)
    assert mood == "exploratory"
    assert specialist == "architecture-snow-lion"


def test_mood_drifting_on_plan_drift(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "plan-drift"
    sig["judge_severity"] = "blocking"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"
    assert specialist == "planning-crane"


def test_mood_drifting_on_scope_creep(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "scope-creep"
    sig["judge_severity"] = "warning"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"


def test_mood_broken_on_missed_callers(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "missed-callers"
    sig["judge_severity"] = "blocking"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "broken"
    assert specialist == "debugging-yeti"


def test_mood_broken_on_missed_consideration(base_signals):
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "missed-consideration"
    sig["judge_severity"] = "warning"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "broken"


def test_mood_full_context_beats_drifting(base_signals):
    """full-context is priority 1, drifting is priority 2."""
    now = 1_000_000
    sig = base_signals(now)
    sig["context_pct"] = 85
    sig["judge_verdict"] = "plan-drift"
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "full-context"


def test_mood_drifting_beats_stuck(base_signals):
    """drifting is priority 2, stuck is priority 4."""
    now = 1_000_000
    sig = base_signals(now)
    sig["judge_verdict"] = "plan-drift"
    sig["last_test_result"] = {"ts": now - 60, "passed": 0, "failed": 5}
    mood, specialist = derive_mood(sig, now, local_hour=14)
    assert mood == "drifting"
