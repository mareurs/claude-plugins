# Codescout Judge — Design Spec

**Date:** 2026-04-14
**Status:** Approved

## Overview

A dedicated codescout-usage observer for buddy, parallel in architecture to the existing
plan-following judge. It watches every codescout MCP tool call, detects bad or inefficient
usage patterns, and surfaces corrections via two channels: immediate injection into the
active conversation (Tier 1) and a statusline badge driven by an async LLM judge (Tier 2).

---

## Architecture

```
PostToolUse hook
       │
       ├─► handle_post_tool_use()     ← existing (edits, commits, errors)
       │
       ├─► accumulate_narrative()     ← existing (plan judge pipeline)
       │
       └─► handle_cs_tool_use()       ← NEW
               │
               ├─ [SYNC] cs_heuristics.check(event, session_log)
               │         if bad pattern → print correction to stdout
               │         (injected into conversation by Claude Code)
               │
               └─ [ASYNC] every N calls → spawn cs_judge_worker.py
                          LLM evaluates cs_tool_log.jsonl
                          writes → cs_verdicts.json
                          statusline renders badge
```

---

## New Files

| File | Purpose |
|---|---|
| `scripts/cs_heuristics.py` | Deterministic pattern checkers (Tier 1) |
| `scripts/cs_judge_worker.py` | Async LLM judge entry point (mirrors `judge_worker.py`) |
| `scripts/cs_judge.py` | Prompt builder + LLM caller (mirrors `judge.py`) |
| `scripts/cs_tool_log.py` | Append / read the per-session cs tool call log |
| `data/cs_rules.md` | Codescout rule book — embedded in the LLM system prompt |

## Existing Files Modified

| File | Change |
|---|---|
| `scripts/hook_helpers.py` | Add `handle_cs_tool_use()` call inside `handle_post_tool_use` |
| `scripts/state.py` | Add 4 new signals to `default_state()` |
| `scripts/buddha.py` | Add cs-alert mood condition |
| `scripts/statusline.py` | Render `cs_verdicts.json` badge |
| `tests/test_data_catalogs.py` | No change (no new bodhisattva forms) |

---

## Tier 1: Heuristic Injection

`cs_heuristics.check(event, session_log)` is a pure function — no I/O, no LLM. Returns
a correction string or `None`. Called synchronously in `handle_cs_tool_use` before the
hook exits. Non-None result is printed to stdout, which Claude Code injects into the
conversation as a system-level message.

`session_log` is the last N entries from `cs_tool_log.jsonl`, passed in by
`handle_cs_tool_use` after appending the current event. This gives heuristics read access
to the previous call for look-back patterns.

### Heuristics

| Pattern | Trigger | Correction injected |
|---|---|---|
| `edit_file` structural edit | tool=`mcp__codescout__edit_file`, `new_string` contains `def `/`fn `/`class `/`struct ` on LSP-supported file extension | "Use `replace_symbol` for structural edits — `edit_file` on definition bodies risks LSP range corruption (BUG-027)" |
| Forgot to restore project | tool=`mcp__codescout__activate_project` with path≠home, no restore recorded in `cs_active_project` signal this session | "You activated a foreign project. Restore home with `activate_project('.')` when done — Iron Law 4" |
| Ignored buffer ref | Current event is any codescout call that does NOT reference a `@cmd_*` buffer, AND the previous `cs_tool_log` entry was a `run_command` whose output contained `@cmd_` | "Large output buffered as `@cmd_*`. Query it: `run_command('grep PATTERN @cmd_id')` instead of ignoring" |
| Native Bash on source | tool=`Bash`, command matches `cat`/`head`/`tail`/`sed` on source file extension | "Use `read_file` or `find_symbol` — Bash on source files bypasses codescout's LSP index" |
| Parallel write smell | Current event is a write-class tool AND the previous `cs_tool_log` entry was also a write-class tool with the same timestamp (same-second = parallel dispatch) | "Parallel writes risk inconsistent state (BUG-021) — serialize write tool calls" |

Write-class tools: `Edit`, `Write`, `mcp__codescout__edit_file`, `mcp__codescout__create_file`,
`mcp__codescout__replace_symbol`, `mcp__codescout__insert_code`, `mcp__codescout__remove_symbol`.

**What does NOT go in heuristics:** any pattern requiring a sequence of 3+ calls (e.g.,
"4 edit_file in a row on the same file"). Those are Tier 2 territory.

**Controllable:** set `BUDDY_CS_HEURISTICS_ENABLED=false` to disable injection without
affecting Tier 2.
## Tier 2: Async LLM Judge

Mirrors `judge_worker.py` / `judge.py` exactly. Spawned as a detached subprocess
(`start_new_session=True`, `stdout=DEVNULL`, `stderr=DEVNULL`) — silent on failure.

### Trigger

`handle_cs_tool_use` increments `cs_tool_call_count` in state for every codescout-
namespaced tool call. When `cs_tool_call_count % BUDDY_CS_JUDGE_INTERVAL == 0`, the
worker is spawned.

Default interval: **8** tool calls. Configurable via `BUDDY_CS_JUDGE_INTERVAL`.
Disabled by default — enable via `BUDDY_CS_JUDGE_ENABLED=true`.

### Input: cs_tool_log.jsonl

Per-session log in the session dir alongside `narrative.jsonl`. One entry per codescout
tool call:

```json
{"ts": 1713100000, "tool": "mcp__codescout__edit_file", "args": "foo.py old→new(3 lines)", "overflowed": false, "outcome": "ok"}
```

Rolling cap: **50 entries**. Written by `handle_cs_tool_use` before heuristics run.
`outcome` is derived from `tool_error` presence in the event: `"error"` / `"ok"`.

### LLM Prompt Structure

```
system: [content of data/cs_rules.md]
        — all 29 codescout tools with correct/incorrect usage
        — 5 bad pattern categories (LSP corruption, parallel writes, buffer refs,
          index staleness, activate_project restore)
        — Iron laws

user:   Last 20 entries from cs_tool_log.jsonl
        → Evaluate for session-level smells
```

### Verdict Schema

```json
{
  "verdict": "cs-misuse | cs-inefficient | ok",
  "severity": "blocking | warning | info",
  "evidence": "Used edit_file 5× on scripts/foo.py instead of replace_symbol",
  "correction": "Switch to replace_symbol for multi-edit sequences on the same file",
  "affected_tools": ["edit_file"]
}
```

`ok` verdicts are discarded (not written). Non-ok verdicts are written to
`cs_verdicts.json` in the session dir.

### Output: cs_verdicts.json

Same structure and lifecycle as `verdicts.json` (acknowledge/dismiss). A separate file
so plan verdicts and cs verdicts can be independently acknowledged and styled differently
in the statusline.

---

## State & Signals

Four new fields added to `default_state()["signals"]`:

```python
"cs_judge_verdict": None,      # "cs-misuse" | "cs-inefficient" | None
"cs_judge_severity": None,     # "blocking" | "warning" | "info"
"cs_tool_call_count": 0,       # counts codescout-namespaced calls only
"cs_active_project": None,     # current activate_project path; None = home
"root_cwd": None,              # set once at session start; static for session
```

`root_cwd` is set once during `handle_session_start` from `event["cwd"]`. It is the
directory where Claude Code was launched — static for the session lifetime. All "is this
the home project?" comparisons and `.buddy/` path computations read this value.

`cs_active_project` is set when `activate_project` is called and cleared when the home
project is restored (detected via `"."` or `os.path.normpath` match against `root_cwd`).

---
## Mood Integration

`derive_mood()` gains one new condition at the top of the waterfall (high priority):

- `cs_judge_severity == "blocking"` → mood shifts to `correction` (reuses existing mood;
  no new mood needed to keep the waterfall simple)
- `cs_judge_severity == "warning"` → statusline badge only, mood unaffected

---

## Statusline Badge

`render()` reads `cs_verdicts.json` (if present) and appends a compact badge to the
label row, e.g.:

```
[cs⚠ serialize writes]
```

Rendered only when an active (unacknowledged) cs verdict exists. Style mirrors the
existing verdict bubble but uses a `cs` prefix to distinguish from plan verdicts.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `BUDDY_CS_JUDGE_ENABLED` | `false` | Enable async LLM tier |
| `BUDDY_CS_JUDGE_INTERVAL` | `8` | Spawn judge every N cs tool calls |
| `BUDDY_CS_HEURISTICS_ENABLED` | `true` | Enable/disable sync injection tier |

---

## Error Handling

All new code follows the existing iron rule: every entry point wraps in
`except Exception: pass`. The heuristics returning `None` on any exception is safe —
no injection is better than a broken hook.

---

## Testing

- `tests/test_cs_heuristics.py` — unit tests for each heuristic, pure function
- `tests/test_cs_tool_log.py` — append/read/cap behaviour
- `tests/test_cs_judge_worker.py` — mirrors `test_judge_worker.py`
- `scripts/state.py` shape change → update `tests/test_state.py` for new signal keys
