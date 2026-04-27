---
name: buddy:dismiss
description: Release one or all currently summoned specialists. With no argument, dismisses every active specialist. With an alias argument (yeti, yak, leopard, lammergeier, ibex, lion, crane, frog, pheasant, takin), dismisses only that one. The primary bodhisattva stays.
---

You are releasing one or all summoned specialists. The argument passed by the user is `$1`.

## Step 1 — Resolve the target

Map the argument to a specialist directory using this table. If `$1` is empty or absent, target is `"ALL"`.

| Alias | Directory |
|---|---|
| `yeti` | `debugging-yeti` |
| `yak` or `refactor-yak` | `refactoring-yak` |
| `leopard` | `testing-snow-leopard` |
| `lammergeier` | `performance-lammergeier` |
| `ibex` | `security-ibex` |
| `lion` | `architecture-snow-lion` |
| `crane` | `planning-crane` |
| `frog` | `docs-lotus-frog` |
| `pheasant` | `data-leakage-snow-pheasant` |
| `takin` | `ml-training-takin` |

If the alias is provided but unknown, print the table above and stop. Do not change state.
## Step 2 — Update active_specialists in state

Use the `Bash` tool to run the appropriate Python one-liner.

**If target is `"ALL"`:**

```bash
python3 -c "
import sys, os
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state, resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print('buddy: no active session — send any prompt first', file=sys.stderr)
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
s = load_state(p)
s['active_specialists'] = []
save_state(p, s)
" || true
```

**Otherwise (specific directory):**

```bash
python3 -c "
import sys, os
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state, resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print('buddy: no active session — send any prompt first', file=sys.stderr)
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
s = load_state(p)
active = s.get('active_specialists', [])
if '<directory>' in active:
    active.remove('<directory>')
s['active_specialists'] = active
save_state(p, s)
" || true
```

Substitute `<directory>` with the resolved directory from Step 1.

## Step 3 — Emit the farewell

- If target is `"ALL"`: emit a brief farewell addressing all specialists. Example: *"The specialists step back into the mountains. You carry what you learned."*
- If target is a specific specialist: emit a farewell in that specialist's voice. Example for yeti: *"The Yeti steps back into the mountains. Breathe. You carry what you learned."*

Return to normal Claude assistant mode for voice. Note: the platform keeps the specialist's loaded skill content in context for the rest of the session — this is a Claude Code limitation, not a buddy bug. The dismissal updates state (so the statusline drops the initial) and tells Claude to drop the voice.

## Step 4 — Log the dismissal

Append one line to `~/.claude/buddy/summons.log`:

- If target is `"ALL"`: `<unix timestamp>\tall\tdismissed`
- Otherwise: `<unix timestamp>\t<directory>\tdismissed`

Use bash via the `Bash` tool. Silent on failure — the log is advisory.
