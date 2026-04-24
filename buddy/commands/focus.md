---
name: buddy:focus
description: Set, clear, or show the active plan for this session. Scoped to session_id — multiple concurrent sessions on the same project each have their own focus. Usage: /buddy:focus <path>, /buddy:focus --clear, /buddy:focus (no args shows current).
---

You are handling a /buddy:focus request. The argument is `$1`.

## Step 1 — Resolve the session

Read `session_id` and `cwd` from the stdin JSON Claude Code delivers to this
command. If `session_id` is missing or the literal string "unknown", print
"Could not resolve session id — cannot scope focus" and stop. Do not guess.

Compute:

- `PROJECT_DIR = <cwd from stdin, or $CLAUDE_PROJECT_DIR fallback>`
- `SESSION_DIR = $PROJECT_DIR/.buddy/$session_id`

## Step 2 — Dispatch on argument

### No argument

Read `$SESSION_DIR/active_plan.json` via the Read tool. If present, print:

```
Active plan: <path> (<source>, set <relative time> ago)
```

If absent, print:

```
No active plan. Judge running in narrative-only mode.
```

### `--clear`

Use the Bash tool to delete `$SESSION_DIR/active_plan.json`:

```bash
rm -f "$SESSION_DIR/active_plan.json"
```

Print: `Active plan cleared. Judge now narrative-only.`

### Any other value (a path)

**Setup.** Before the sub-steps, export the inputs as env vars so all
Python one-liners can read them via `os.environ` — this eliminates shell
quoting/injection bugs from paths that may contain single quotes, spaces,
or `$`:

```bash
export BUDDY_FOCUS_RAW="$1"
export BUDDY_FOCUS_PROJECT_DIR="$PROJECT_DIR"
export BUDDY_FOCUS_SESSION_DIR="$SESSION_DIR"
```

Four sub-steps:

1. **Resolve.** If `BUDDY_FOCUS_RAW` is relative, resolve **against
   `BUDDY_FOCUS_PROJECT_DIR` (not the process cwd)**:

   ```bash
   export BUDDY_FOCUS_ABS=$(python3 -c '
   import os
   from pathlib import Path
   raw = os.environ["BUDDY_FOCUS_RAW"]
   base = Path(os.environ["BUDDY_FOCUS_PROJECT_DIR"])
   p = Path(raw)
   print(str(p.resolve()) if p.is_absolute() else str((base / raw).resolve()))
   ')
   ```

2. **Verify existence.** If `BUDDY_FOCUS_ABS` does not exist as a file,
   print "Plan file not found: $BUDDY_FOCUS_RAW" and stop:

   ```bash
   [ -f "$BUDDY_FOCUS_ABS" ] || { echo "Plan file not found: $BUDDY_FOCUS_RAW"; exit 0; }
   ```

3. **Normalize to project-relative.**

   ```bash
   export BUDDY_FOCUS_REL=$(python3 -c '
   import os
   from pathlib import Path
   try:
       print(Path(os.environ["BUDDY_FOCUS_ABS"]).relative_to(os.environ["BUDDY_FOCUS_PROJECT_DIR"]))
   except ValueError:
       print("OUTSIDE")
   ')
   ```

   If `BUDDY_FOCUS_REL == OUTSIDE`, print "Plan path outside project —
   cannot set active plan" and stop.

4. **Save.** Call `save_active_plan`:

   ```bash
   python3 -c '
   import os, sys, time
   sys.path.insert(0, os.environ["CLAUDE_PLUGIN_ROOT"])
   from pathlib import Path
   from scripts.state import save_active_plan
   save_active_plan(
       session_dir=Path(os.environ["BUDDY_FOCUS_SESSION_DIR"]),
       path=os.environ["BUDDY_FOCUS_REL"],
       source="explicit",
       now=int(time.time()),
   )
   ' || true
   ```

   Print: `Focused on: $BUDDY_FOCUS_REL`.

## Step 3 — Report state

Echo the final state of the active plan in one short line. Done.
