# Buddy Judge System — Design Spec

> Async LLM judge that watches Claude work, detects plan drifts / doc drifts /
> missed callers / scope creep, and blocks Claude via PreToolUse exit(2) when
> issues are serious.

**Date:** 2026-04-14
**Status:** Draft
**Inspired by:** [claude-code-tamagotchi](https://github.com/Ido-Levi/claude-code-tamagotchi) — adapted to use codescout code intelligence instead of raw transcript analysis.

---

## 1. Problem

Claude Code sessions can run deep (300k+ tokens). During long implementation
runs, Claude may:

- **Drift from the plan** — work on step 5 when step 3 isn't done
- **Contradict project docs** — violate conventions, ignore gotchas
- **Miss callers/dependents** — change a function signature without updating call sites
- **Expand scope** — refactor unrelated code or add unrequested features
- **Ignore constraints** — skip atomic writes, forget error handling patterns

Claude can't easily self-audit without spending tool calls. An external judge
with access to the codebase (via codescout) catches things Claude would miss.

## 2. Architecture

Three independent processes communicate through two shared files:

```
Claude Code session (Process A — owns the 300k context)
  │
  ├── PostToolUse hook (sync, <50ms)
  │     reads last transcript entry
  │     appends to narrative file
  │     if threshold reached → spawns Process B
  │
  ├── PreToolUse hook (sync, <10ms)  [Process C]
  │     reads verdicts file
  │     if blocking verdict → stderr + exit(2)
  │     else → exit(0)
  │
  └── Background judge (Process B — async, 2-15s)
        reads narrative + codescout context
        calls LLM judge
        writes verdict to verdicts file
        exits
```

**Shared files:**

| File | Writer | Reader | Purpose |
|------|--------|--------|---------|
| `~/.claude/buddy/narrative.jsonl` | PostToolUse hook | Judge worker | Rolling session summary |
| `~/.claude/buddy/verdicts.json` | Judge worker | PreToolUse hook | Cached judge findings |

**Key invariant:** The PreToolUse hook never calls an LLM. It reads a JSON file
and exits. The LLM runs in a background process that finished before the hook
fires. One tool call of latency between detection and blocking.

## 3. Incremental Narrative

The narrative is a bounded, append-only JSONL log that compresses the session
into a judge-readable summary without re-reading 300k tokens.

### Entry types

```jsonl
{"ts":1713100000,"type":"goal","text":"User wants to add PreToolUse hook to buddy-plugin"}
{"ts":1713100005,"type":"action","text":"Claude Edit scripts/hook_helpers.py — added pre_tool_check function"}
{"ts":1713100012,"type":"decision","text":"Using JSON for verdict storage instead of SQLite"}
{"ts":1713100030,"type":"plan_ref","text":"Plan: docs/superpowers/specs/2026-04-14-design.md, step 3 of 7"}
{"ts":1713100040,"type":"compact","text":"[SUMMARY] Building PreToolUse enforcement. Created judge.py, hook_helpers updated. On step 3/7. Key decisions: JSON for verdicts, async judge pattern."}
```

**`goal`** — extracted from user messages in the transcript. First user message
in a turn, or messages after a `/` command. Simple heuristic extraction, no LLM.

**`action`** — what Claude just did. Formatted from the PostToolUse event:
tool name + file path + one-line description. Example:
`"Claude Edit scripts/buddha.py — changed derive_mood to add 'drifting' mood"`.

**`decision`** — extracted from assistant text blocks when they contain decision
language ("I'll use", "let's go with", "choosing X over Y"). Keyword detection.

**`plan_ref`** — when the narrative detects a plan file reference in recent
actions, it records which step is active.

**`compact`** — LLM-generated summary of older entries. Produced during
compaction.

### Compaction

When the narrative exceeds 50 entries, the judge worker (not the hook) compacts
the oldest 40 into a single `compact` summary entry before judging. After
compaction: 1 compact entry + 10 recent entries.

This bounds the judge's input to ~1500-3000 tokens regardless of session length.

### PostToolUse accumulation (<50ms)

```python
def accumulate_narrative(event: dict, transcript_path: str, narrative_path: Path) -> None:
    """Append action entry to narrative. Spawn judge if threshold reached."""
```

Reads the tool call from the event (tool_name, file path, error). Formats a
one-line action entry. Appends to `narrative.jsonl`. If entry count modulo
`BUDDY_JUDGE_INTERVAL` == 0, spawns the judge worker as a detached process.

No LLM. No network. Just a file append + occasional `subprocess.Popen` with
`start_new_session=True`.

## 4. The Judge

### Context assembly

Before calling the LLM, the judge worker gathers structured context from
codescout:

1. **Active plan** — glob `docs/superpowers/specs/*.md` and
   `docs/superpowers/plans/*.md`, read the most recent. This is ground truth for
   "what should be happening."

2. **Project memories** — read codescout memories: `conventions`, `gotchas`,
   `architecture`. These are standing constraints.

3. **Affected symbols** — from recent narrative actions, extract edited file
   paths. Call `codescout list_symbols` / `codescout find_references` on those
   files to identify callers and dependents.

4. **Test state** — read buddy's `state.json` for `last_test_result`.

The judge queries codescout via its CLI (`codescout` binary) or MCP protocol,
not via the running MCP server instance (which is owned by the Claude session).

### Verdict categories

| Verdict | Meaning | Example |
|---------|---------|---------|
| `plan-drift` | Implementation diverges from active plan | Plan says "step 3: add hook" but Claude is refactoring buddha.py |
| `doc-drift` | Code contradicts project docs/conventions/memories | Convention says atomic writes, Claude used `open(f, 'w')` |
| `missed-callers` | Edit didn't account for dependents | Changed `derive_mood()` signature but 3 callers still pass old args |
| `missed-consideration` | Implementation ignores a relevant gotcha or constraint | Gotcha says "hooks must be silent-on-failure" but no try/except |
| `scope-creep` | Claude is doing work not in the plan or user request | User asked for one hook, Claude is refactoring three files |
| `ok` | No issues found | — |

### Severity levels

| Severity | Behavior |
|----------|----------|
| `info` | Statusline thought only. No blocking. |
| `warning` | Statusline thought with warning indicator. No blocking. |
| `blocking` | PreToolUse hook exits 2. Claude must address before continuing. |

### Judge prompt

```
You are a code review judge for an active coding session.

SESSION NARRATIVE:
{compact_summary}
{recent_entries}

ACTIVE PLAN:
{plan_content or "No active plan found"}

PROJECT CONSTRAINTS:
{conventions}
{gotchas}
{architecture_notes}

AFFECTED SYMBOLS:
{symbol_references for recently edited files}

RECENT TEST STATE:
{last_test_result or "No recent tests"}

Evaluate whether the most recent actions:
1. Drift from the active plan (working on wrong step, skipping steps)
2. Contradict project constraints (conventions, gotchas, architecture)
3. Miss callers or dependents of edited symbols
4. Expand scope beyond what was requested
5. Ignore a consideration the constraints call out

Respond with JSON only:
{
  "verdict": "ok|plan-drift|doc-drift|missed-callers|missed-consideration|scope-creep",
  "severity": "info|warning|blocking",
  "evidence": "what specifically is wrong — cite the constraint or plan step",
  "correction": "what Claude should do instead",
  "affected_files": ["file paths"]
}

Rules:
- Multi-step workflows are normal. Reading before writing is not drift.
- Preparation steps (reading files, listing symbols) are not scope creep.
- Only flag REAL issues with specific evidence. When in doubt, verdict is "ok".
- severity "blocking" only for clear plan contradictions or missed callers that
  will cause bugs. Use "warning" for style/convention issues.
```

### LLM configuration

The judge calls any OpenAI-compatible chat completions endpoint:

```
BUDDY_JUDGE_ENABLED=false          # opt-in, off by default
BUDDY_JUDGE_API_URL=               # e.g. http://localhost:11434/v1 (Ollama)
BUDDY_JUDGE_MODEL=                 # e.g. llama3.1:8b
BUDDY_JUDGE_API_KEY=               # optional, empty for local
BUDDY_JUDGE_INTERVAL=5             # run judge every N tool calls
BUDDY_JUDGE_BLOCK_SEVERITY=blocking
```

Works with Ollama, Groq, OpenRouter, LM Studio, or any hosted API. No SDK
dependency — plain HTTP POST via `requests` or `httpx`.

## 5. PreToolUse Gate

**Status (2026-04-19):** warnings-only mode is the default. Hard-blocking is
gated behind `BUDDY_JUDGE_BLOCK=true` in `hooks/judge.env`. See § 5.6 below
for the open subagent issue that motivated this default.

### 5.1 Verdict storage

`<project>/.buddy/<session_id>/verdicts.json` (plan judge) and
`<project>/.buddy/<session_id>/cs_verdicts.json` (cs judge). Both are
session-scoped — subagent verdicts live under the subagent's own session id.

```json
{
  "session_id": "abc123",
  "last_updated": 1713100040,
  "active_verdicts": [
    {
      "ts": 1713100038,
      "verdict": "missed-callers",
      "severity": "blocking",
      "evidence": "derive_mood() signature changed but render() still passes old args",
      "correction": "Update render() in scripts/statusline.py to pass the new parameter.",
      "affected_files": ["scripts/buddha.py", "scripts/statusline.py"],
      "acknowledged": false
    }
  ]
}
```

### 5.2 Hook logic

`hooks/pre-tool-use.sh` reads `EVENT_JSON` from stdin (captured into an env
var before the Python heredoc, which otherwise steals stdin), then:

1. Read `verdicts.json` (plan) and `cs_verdicts.json` (codescout).
2. Filter: `acknowledged == false` AND severity meets threshold AND not expired.
3. Collect blocking-severity verdicts from both judges into `all_blocking`.
4. If `all_blocking` is non-empty **and** `BUDDY_JUDGE_BLOCK=true`:
   - Build correction message.
   - Print to stderr.
   - `sys.exit(2)` (bash captures exit code via `|| _py_exit=$?`, re-exits 2).
5. Otherwise: `exit 0`. Warnings are never injected via `additionalContext`
   (that field is not valid for PreToolUse per the CC hook spec) nor via
   `systemMessage` (which renders in transcript mode and spammed every tool
   call during the 30-min TTL window).

### 5.3 Blocking toggle

`BUDDY_JUDGE_BLOCK` in `hooks/judge.env` controls hard-blocking:

- `false` (default) — blocking verdicts are detected and written to file, but
  PreToolUse does not interrupt. The statusline bubble surfaces them. Users
  can observe warning-only behavior without flow disruption.
- `true` — blocking verdicts hard-block via `exit 2` with stderr correction.

The env var uses conditional assignment (`"${BUDDY_JUDGE_BLOCK:-false}"`) so
settings.json or test suites can override the default without touching
`judge.env`.

### 5.4 Correction message format (when blocking is enabled)

```
BUDDY: MISSED-CALLERS DETECTED

derive_mood() signature changed but render() still passes old args

Update render() in scripts/statusline.py to pass the new parameter.

Fix this before continuing, then proceed with your task.
```

### 5.5 Acknowledgment

After Claude addresses the issue and the next PostToolUse fires, the background
judge re-evaluates. If the issue is resolved, the verdict is marked
`acknowledged: true`. With blocking disabled, this is a tidiness concern only
(acknowledgment expires stale verdicts from the statusline bubble).

### 5.6 Open issue: subagent blocking

Verdicts are session-scoped — a subagent's cs_verdicts live under
`.buddy/<subagent_session_id>/` and cannot leak into the parent's PreToolUse
path via the file system. However, blocking a subagent's tool call via
`exit 2` can crumble the subagent's flow (it has no way to recover from a
judge block mid-task, and the parent then has to reason about a failed
subagent result).

Pending decision: either keep warnings-only permanently, or re-enable blocking
with subagent detection (e.g., compare `event.session_id` against
`state.current_session_id`; block only when they match). Tracked via
`BUDDY_JUDGE_BLOCK=false` default until this is resolved.

### 5.7 Fail-open

- Judge process dead → no verdicts written → hook reads empty → exit 0
- LLM API down → judge returns no verdict → exit 0
- Verdicts older than 30 min → auto-expired → exit 0
- `verdicts.json` missing or corrupt → exit 0
- Python heredoc crashes → bash `_py_exit` captures non-2 exit → treated as
  no-op (only exit code 2 propagates through the `|| _py_exit=$?` guard)

The hook never blocks due to infrastructure failure.
## 6. Integration with Existing Buddy Systems

### New signals in `default_state()`

```python
"signals": {
    # ... existing ...
    "judge_verdict": None,
    "judge_severity": None,
    "judge_block_count": 0,
    "judge_last_ts": 0,
}
```

### New moods in `derive_mood()` waterfall

```
Priority:
  1. full-context       (existing)
  2. drifting           NEW — judge_verdict in (plan-drift, doc-drift, scope-creep)
  3. broken             NEW — judge_verdict in (missed-callers, missed-consideration)
  4. stuck              (existing)
  5. victorious         (existing)
  ... rest unchanged ...
```

- **`drifting`** — suggested specialist: `planning-crane`
- **`broken`** — suggested specialist: `debugging-yeti`

### Data catalog updates

- `data/bodhisattvas.json` — add eyes for `drifting` and `broken` per form
- `data/environment.json` — add environment strips for `drifting` and `broken`
- `tests/test_data_catalogs.py` — update `EXPECTED_MOODS`

### Session lifecycle

| Event | Action |
|-------|--------|
| `SessionStart` | Clear narrative file, clear verdicts file, reset judge signals |
| `PostToolUse` | Existing signal update + `accumulate_narrative()` + maybe spawn judge |
| `PreToolUse` | Read verdicts, maybe block |
| Statusline render | Read judge signals for mood/thought (existing pipeline) |

## 7. File Inventory

### New files

| File | Purpose |
|------|---------|
| `scripts/narrative.py` | Narrative accumulation + compaction |
| `scripts/judge.py` | LLM judge client — prompt building, API call, response parsing |
| `scripts/judge_worker.py` | Background process entry point |
| `scripts/verdicts.py` | Verdict I/O with atomic JSON writes |
| `hooks/pre-tool-use.sh` | PreToolUse gate hook |
| `tests/test_narrative.py` | Narrative append, compaction, bounds |
| `tests/test_judge.py` | Prompt building, response parsing, verdict categories |
| `tests/test_verdicts.py` | Verdict read/write, expiry, acknowledgment |

### Modified files

| File | Change |
|------|--------|
| `scripts/hook_helpers.py` | Add `accumulate_narrative()` call |
| `scripts/buddha.py` | Add `drifting` and `broken` moods at priority 2-3 |
| `scripts/state.py` | Add judge signals to `default_state()` |
| `hooks/post-tool-use.sh` | Call `accumulate_narrative` after signal update |
| `hooks/hooks.json` | Add `PreToolUse` entry |
| `hooks/session-start.sh` | Clear narrative + verdicts on new session |
| `data/bodhisattvas.json` | Eyes for new moods |
| `data/environment.json` | Strips for new moods |
| `tests/test_data_catalogs.py` | Update expected moods |
| `tests/test_buddha.py` | Test new mood priority |

### Dependencies

- `requests` or `httpx` — for OpenAI-compatible API calls. Single new dependency.
- Everything else is Python stdlib.

## 8. Configuration

All opt-in. Judge is disabled by default.

**`hooks/judge.env` is the authoritative source for all judge env vars.** Hook subprocesses source this file directly — `settings.json` env vars are overridden by it. To change model, URL, or intervals, edit `judge.env` only.

```bash
# Enable the judge
BUDDY_JUDGE_ENABLED=false

# LLM endpoint (OpenAI-compatible)
BUDDY_JUDGE_API_URL=               # http://localhost:11434/v1 for Ollama
BUDDY_JUDGE_MODEL=                 # model alias as registered in litellm proxy
BUDDY_JUDGE_API_KEY=               # empty for local

# Tuning
BUDDY_JUDGE_INTERVAL=5             # judge every N tool calls
BUDDY_JUDGE_BLOCK=false            # default warnings-only; true enables exit(2)
BUDDY_JUDGE_BLOCK_SEVERITY=blocking  # minimum severity to exit(2) when BLOCK=true
BUDDY_JUDGE_VERDICT_TTL=1800       # verdict expiry in seconds (30 min)
BUDDY_JUDGE_MAX_NARRATIVE=50       # entries before compaction

# Codescout tool-usage judge
BUDDY_CS_JUDGE_ENABLED=false
BUDDY_CS_JUDGE_INTERVAL=8          # judge every N codescout tool calls
```
## 9. Open Questions

1. **Codescout access from judge worker** — should the worker shell out to the
   `codescout` CLI binary, or use the MCP protocol over stdio? CLI is simpler
   but requires the binary on PATH. MCP gives richer data but adds protocol
   complexity.

2. **Plan detection heuristic** — how to reliably find "the active plan"? Glob
   for most recent spec/plan file? Read a `buddy_plan_path` from state? Let the
   user set an env var?

3. **Compaction quality** — the LLM that compacts the narrative is the same one
   that judges. If using a small local model (8B), compaction summaries may lose
   important nuance. Should compaction use a separate, better model?

4. **Subagent blocking** (2026-04-19) — currently gated off via
   `BUDDY_JUDGE_BLOCK=false`. Blocking a subagent's tool call breaks the
   subagent's flow. Decision pending user evaluation of warnings-only mode.
   If blocking stays, add subagent-aware gating: only `exit 2` when
   `event.session_id == state.current_session_id`.
