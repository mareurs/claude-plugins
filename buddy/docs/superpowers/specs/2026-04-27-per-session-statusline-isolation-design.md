# Per-Session Statusline Isolation Design

**Date:** 2026-04-27
**Status:** approved

## Problem

Buddy's `state.json` lives at `~/.claude/buddy/state.json` — a single global file. Multiple Claude Code instances all read/write it, so summoned bodhisattvas, mood, and signals from one session spill into the statusline of every other session. Each session should have its own state.

Per-session dirs already exist at `<project_root>/.buddy/<session_id>/` (used for verdicts, narrative, active plan). Only `state.json` is global.

## Goal

Move state to `<project_root>/.buddy/<session_id>/state.json`. Identity (`~/.claude/buddy/identity.json`) stays global. Solve session_id resolution for slash commands, including the multi-instance same-cwd case.

## Non-goals

- Cross-session state sharing
- Stale `<root>/.buddy/<sid>/` directory garbage collection (future feature)
- Identity migration

## Architecture

### State path resolution

New helper in `scripts/state.py`:

```python
def session_state_path(project_root: Path, session_id: str) -> Path:
    return project_root / ".buddy" / session_id / "state.json"
```

`STATE_PATH` constant in `statusline.py` removed. All callers compute the path from
`(project_root, session_id)`.

### session_id sources

| Caller | Source |
|---|---|
| Hooks (SessionStart, UserPromptSubmit, PostToolUse, PreToolUse) | stdin event JSON: `event["session_id"]`, `event["cwd"]` |
| Statusline | stdin JSON: `session_id`, `workspace.current_dir` (already parsed by `parse_stdin_session()`) |
| Slash commands | PPID resolution chain (see below) — stdin not available |
| `judge_worker.py` (subprocess) | spawn args (already passed by parent) |

### Slash command session_id resolution

Claude Code does not expose `CLAUDE_SESSION_ID` (issue #13733, not implemented). Slash
commands receive no stdin event. Resolution uses a PPID-indexed pointer maintained by
hooks, with PID start-time verification to survive PID reuse.

**Hooks write on every fire (SessionStart + UserPromptSubmit):**

1. `<root>/.buddy/.current_session_id` — last-writer pointer (compat / distinct-cwd)
2. `<root>/.buddy/by-ppid/<PPID>/session_id` — PPID-keyed index for same-cwd concurrency
3. `<root>/.buddy/by-ppid/<PPID>/started_at` — parent process start time
   (`ps -o lstart= -p $PPID`), used to detect PID reuse

Both hook scripts and slash command `!`bash` ` blocks run as direct children of the same
CC node process, so `$PPID` matches between them.

**Slash command resolution chain (in order):**

1. `<root>/.buddy/by-ppid/$PPID/` — read `session_id`, verify `started_at` matches
   current `ps -o lstart= -p $PPID`. Match → use it. Mismatch (PID reused) → fall through.
2. `<root>/.buddy/.current_session_id` — fallback for first prompt before
   UserPromptSubmit
3. If exactly one `<root>/.buddy/<sid>/` dir exists, use it
4. Else: error gracefully ("send any prompt first to initialize")

**Cleanup of stale `by-ppid/<pid>/` entries — three layers:**

1. **SessionEnd hook (graceful exit, ~99% of cases):** removes own `by-ppid/$PPID/`
   directory immediately when session shuts down normally.
2. **SessionStart GC (crash exits):** for each `by-ppid/<pid>/` entry, compare stored
   `started_at` with `ps -o lstart= -p <pid>`. Mismatch (or pid gone) → remove. Catches
   kill -9, OOM, and any case where SessionEnd never fires.
3. **Resolution-time verification (race window):** the slash-command resolver also
   checks `started_at` before trusting an entry. If a CC instance dies and a new
   process inherits the same PID before the next SessionStart's GC runs, the stale
   entry is rejected at read time.

`ps -o lstart=` works on both Linux and macOS. Stored value is opaque — only equality
matters.
### Identity (unchanged)

`~/.claude/buddy/identity.json` stays global. Holds user_id, consent flags — no
session coupling.

## Components changed

### `scripts/state.py`

- Add `session_state_path(project_root: Path, session_id: str) -> Path`
- Add `resolve_session_id_for_command(project_root: Path, ppid: int) -> str | None`
  implementing the resolution chain above
- `load_state` / `save_state` signatures unchanged (still take `path: Path`)

### `scripts/statusline.py`

- Remove `STATE_PATH = BUDDY_DIR / "state.json"` (line 25)
- Remove `BUDDY_DIR` global (still needed only for `IDENTITY_PATH`)
- After `parse_stdin_session()`, build `state_path = session_state_path(project_root, session_id)`
- If `session_id` or `project_root` missing → use `default_state()` (statusline still renders)

### `scripts/hook_helpers.py`

8 callsites of `load_state(path)` / `save_state(path, ...)`. Already parameterized —
callers (hook shell scripts) pass the resolved path.

### `scripts/judge_worker.py`

Line 124: `state_path = Path.home() / ".claude" / "buddy" / "state.json"` → receive
`state_path` from spawn args (already passed by `hook_helpers.py:419`'s
`subprocess.Popen` call — wire it through).

### `hooks/session-start.sh`

- Compute `session_dir = <cwd>/.buddy/<session_id>` from event
- Write `<root>/.buddy/.current_session_id` (sid)
- Write `<root>/.buddy/by-ppid/$PPID/session_id` (sid)
- Write `<root>/.buddy/by-ppid/$PPID/started_at` (`ps -o lstart= -p $PPID`)
- GC: for each `by-ppid/<pid>/` entry, read stored `started_at` and compare with
  current `ps -o lstart= -p <pid>`. Mismatch or pid missing → `rm -rf` the entry
- Pass `session_dir / "state.json"` to handler
### `hooks/user-prompt-submit.sh`

- Same pointer + by-ppid writes as SessionStart (including `started_at`)
- Pass session-scoped state path to `handle_user_prompt_submit`
### `hooks/post-tool-use.sh`

- Compute `session_dir` from event
- Pass session-scoped state path to handler

### `hooks/session-end.sh` (NEW)

- Read `event["cwd"]` and `$PPID`
- `rm -rf <cwd>/.buddy/by-ppid/$PPID/`
- Register in `hooks/hooks.json` under `SessionEnd` event

### Slash commands (`commands/*.md`)

Update `summon.md`, `dismiss.md`, `status.md`, `check.md`. Replace inline Python:

```python
p = Path.home() / '.claude' / 'buddy' / 'state.json'
```

With:

```python
from scripts.state import resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print("buddy: no active session — send any prompt first")
    raise SystemExit
p = session_state_path(Path.cwd(), sid)
```

## Migration

- Existing `~/.claude/buddy/state.json` becomes a dead file — ignored after upgrade.
  SessionStart hook deletes it on first run if present (one-shot cleanup).
- Existing `<root>/.buddy/<sid>/` dirs unchanged. `state.json` joins existing siblings.
- Identity.json stays at `~/.claude/buddy/identity.json` — no migration.

## Tests

Use existing pytest infrastructure at `buddy/tests/`.

- **`test_state.py`** — add cases for `session_state_path(root, sid)` and
  `resolve_session_id_for_command()` resolution chain (each fallback rung +
  error case + start_time mismatch)
- **`test_statusline.py`** — feed stdin with session_id+cwd, verify reads
  session-scoped state; verify graceful default when missing
- **`test_hook_helpers.py`** — update callers to pass session-scoped paths;
  existing `path`-parameterized tests remain valid
- **`test_judge_worker.py`** — verify `state_path` is read from spawn args, not
  hardcoded
- New shell-level test for `hooks/user-prompt-submit.sh` — verify pointer +
  `by-ppid/<PPID>/{session_id,started_at}` are all written
- New shell-level test for `hooks/session-end.sh` — verify `by-ppid/$PPID/`
  removed on session end
- New shell-level test for SessionStart GC — seed a fake `by-ppid/<bogus_pid>/`
  with mismatched `started_at`, verify SessionStart removes it
## Documented limitations

- PPID approach assumes CC spawns hooks and `!`bash` ` blocks as direct children of
  the CC node process. Verify empirically per CC version. Track issue #13733 — when
  `CLAUDE_SESSION_ID` env var lands, the PPID dance becomes obsolete.
- Two CC instances submitting prompts in the exact same cwd in the same millisecond
  could theoretically race the `.current_session_id` pointer — but `by-ppid/`
  resolution wins for slash commands, so this is benign.

## Out of scope

- Stale `<root>/.buddy/<sid>/` directory GC
- `~/.claude/buddy/` cleanup beyond removing the dead `state.json`
- Cross-session state inheritance
