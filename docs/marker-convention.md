# codescout-active marker convention

**Shared contract between `codescout-companion` and `claude-statusline`.**

A session-scoped marker file records the agent's *declared* active workspace,
so the statusline can display the truthful branch even when CC's process PWD
is frozen at session start.

## Path

```
$CLAUDE_CONFIG_DIR/codescout-active/<session_id>
```

`$CLAUDE_CONFIG_DIR` defaults to `~/.claude` when unset. `<session_id>` is the
value of `.session_id` in CC's hook/statusline JSON payload.

## Contents

One line: an absolute filesystem path to the active workspace (a git repo or
worktree root). No trailing newline required. No metadata, no JSON.

## Writers — `codescout-companion`

| Hook | Trigger | Path written |
|------|---------|--------------|
| `cs-activate-project.sh` | PostToolUse on `mcp__*__workspace` | `.tool_input.path` (last activation wins) |
| `worktree-activate.sh` | PostToolUse on `EnterWorktree` | `.tool_response.worktree_path` |
| `session-start.sh` | SessionStart, only when CWD is inside a worktree | `git rev-parse --show-toplevel` of CWD |

`session-start.sh` deliberately does NOT seed the marker for main-repo
sessions. A main-repo seed would false-confirm wrong belief if the agent
later operates on a worktree via `git -C` or chained `cd && git`.

`session-start.sh` also sweeps markers older than 7 days (cheap garbage
collection; markers cannot be relied on across longer gaps).

## Reader — `claude-statusline`

When `.workspace.git_worktree.name` is absent from the CC payload and a
marker exists for `.session_id`, statusline runs `git -C <marker> branch
--show-current` and displays `cs:<branch>` (dim `cs:` prefix, blue
branch).

If the marker is missing, points at a removed directory, or git fails,
statusline silently falls back to `git branch --show-current` in its own
PWD with the `·Nwt` multi-worktree warning suffix.

## Why a file (not env, not PID)

- **File survives across plugin processes.** Hooks and statusline are
  separate subprocesses with no shared memory; env vars from one do not
  reach the other.
- **Session-scoped is the right granularity.** CC PWD is session-scoped;
  worktree activation is session-scoped; the marker matches.
- **Path is the agent's intent.** It is the literal argument the agent
  passed to `workspace()` or the directory CC entered via `EnterWorktree`.
  No interpretation, no inference.

## Edge cases

- Marker points at a path that no longer exists (worktree pruned) →
  statusline falls back silently.
- Two sessions in the same workspace → each writes its own marker keyed by
  `session_id`; no contention.
- Session resumed without prior `workspace()` call but CWD is inside a
  worktree → `session-start.sh` seeds the marker so first render is truthful.
- User has `claude-statusline` but not `codescout-companion` (or vice
  versa) → no marker is ever written / read; statusline falls back. No
  hard coupling between the plugins.
