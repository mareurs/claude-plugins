You are releasing one or all summoned specialists. The argument passed by the user is `$1`.

## Step 1 — Resolve the target

If `$1` is empty or absent, target is `"ALL"` — skip to Step 2.

Otherwise, match `$1` to the best specialist using their descriptions below. Trust intent over exact words — "debug", "yeti", "debugging" all resolve to `debugging-yeti`.

| Directory | When to dismiss |
|---|---|
| `debugging-yeti` | Bug resists surface fixes, flaky tests, failure doesn't match symptom |
| `testing-snow-leopard` | Designing test suites, coverage gaps, flaky tests, asserting correctness |
| `refactoring-yak` | Structural code transformation, cleaning up tangled code |
| `ml-training-takin` | Training loops, inference parity, ML pipeline issues |
| `performance-lammergeier` | Profiling, latency, throughput, optimization |
| `planning-crane` | Work planning, task sequencing, breaking down large efforts |
| `architecture-snow-lion` | System boundaries, module design, interface decisions |
| `docs-lotus-frog` | Technical writing, documentation architecture |
| `data-leakage-snow-pheasant` | ML data hygiene, evaluation integrity, train/test leakage |
| `security-ibex` | Security review, threat modeling, vulnerability analysis |

If the argument is genuinely ambiguous (matches multiple equally), print the table above and stop. Do not change state.

## Step 1.5 — Run introspection before dismissing

Before clearing the specialist(s) from state, give them a chance to capture lessons.

**If target is `"ALL"`:** for each entry in `active_specialists` (alphabetical order), run the introspection block below scoped to that specialist. Then proceed to Step 2.

**Otherwise:** run the introspection block for the resolved `<directory>` only.

**Introspection block** (emit verbatim as a system-style nudge to the buddy, then await its response):

> Before you depart, <directory>: reflect on this session from your POV. What did you learn that would change how you'd act next time? For each lesson:
> 1. Decide global vs project scope (see the Memory Protocol).
> 2. Propose a slug (3–6 kebab-case words).
> 3. Read the target channel's `INDEX.md` and check for slug match or ≥2-tag overlap with a topically similar hook. If matched, update the existing file; else create a new one.
> 4. Announce each save (`→ memory: <scope> / <specialist> / <slug> — <hook>`).
> 5. Stage project writes with `git add`. Mirror global writes via `scripts/memory.py`.
>
> If nothing genuinely new came up, say so explicitly and stop. Do not invent lessons.

Wait for the buddy to complete (zero or more saves). Then continue with Step 2.

If the project memory dir does not exist or the working tree is not a git repo, project writes during introspection are skipped silently — see the protocol's failure modes.

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
