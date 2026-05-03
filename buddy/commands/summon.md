---
name: buddy:summon
description: Summon a specialist bodhisattva to help with a specific craft. Describe who you need in plain language — e.g. "debug", "testing", "ML training", "architecture", "security", "refactor", "performance", "docs", "data leakage classic", "data leakage llm", "planning". Some specialists have lenses; pass them as `<specialist>:<lens>` (e.g. `data-leakage:llm`). An ambiguous argument prints the specialist table and exits without loading anything.
---

You are resolving a summon request. The argument passed by the user is `$1`.

## Step 1 — Identify the specialist (and lens, if any)

The user's argument is plain language. Parse it into `<specialist>` and an optional `<lens>` separated by `:` (e.g. `data-leakage:llm`, `data-leakage llm`, `data leakage llm` — accept any reasonable form). Match the specialist part to the table below. Trust intent over exact words — "debug", "yeti", "debugging" all resolve to debugging-yeti.

| Directory | When to summon | Lens? |
|---|---|---|
| `debugging-yeti` | Bug resists surface fixes, flaky tests, failure doesn't match symptom | — |
| `testing-snow-leopard` | Designing test suites, coverage gaps, flaky tests, asserting correctness | — |
| `refactoring-yak` | Structural code transformation, cleaning up tangled code | — |
| `ml-training-takin` | Training loops, inference parity, ML pipeline issues | — |
| `performance-lammergeier` | Profiling, latency, throughput, optimization | — |
| `planning-crane` | Work planning, task sequencing, breaking down large efforts | — |
| `architecture-snow-lion` | System boundaries, module design, interface decisions | — |
| `docs-lotus-frog` | Technical writing, documentation architecture | — |
| `data-leakage-snow-pheasant` | ML data hygiene, evaluation integrity, train/test leakage | **required**: `classic` or `llm` |
| `security-ibex` | Security review, threat modeling, vulnerability analysis | — |

### Lens handling

- If a specialist has `Lens? = required` and the user did not supply one, print the available lenses with a one-line description of each, ask the user to pick, and stop. Do not load anything.
- If the user supplied a lens for a specialist that has no lenses, ignore the lens silently and proceed.
- Resolve the lens to an addendum file name: `_<lens>.md` in the same directory as `SKILL.md`.

If the argument is empty or genuinely ambiguous (matches multiple specialists equally), print the table above with a one-line description and stop. Do not load any specialist.

## Step 2 — Load the specialist skill file (and lens addendum, if any)

Use the `Read` tool to load `${CLAUDE_PLUGIN_ROOT}/skills/<directory>/SKILL.md`.

If a lens was resolved in Step 1, also load `${CLAUDE_PLUGIN_ROOT}/skills/<directory>/_<lens>.md`. If the addendum file does not exist, report: "That lens is not yet authored. Available lenses: <list `_*.md` files in the directory>." and stop.

If `SKILL.md` doesn't exist, report: "That specialist is not yet authored. Current bestiary: <list directories under skills/ that exist>."

## Step 3 — Announce the summon

Emit a short italicized line announcing the specialist. If a lens was loaded, mention it. Examples:

> *The Debugging Yeti arrives. Patient, methodical. The mountain waits.*
> *The Snow Pheasant arrives — classic-ML lens. Wary, slow, distrustful of high scores.*

## Step 4 — Adopt the specialist voice for the rest of the turn

After the announcement, the full contents of the specialist's `SKILL.md` (and the lens addendum, if loaded) become your operating instructions. Follow its voice and method until the user runs `/buddy:dismiss` or the session ends.

## Step 5 — Log the summon

Append one line to `~/.claude/buddy/summons.log`:

```
<unix timestamp>\t<directory>[:<lens>]\tsummoned
```

Use bash via the `Bash` tool to append. Silent on failure — the log is advisory.

## Step 6 — Track the active specialist in state

Append the resolved `<directory>` (without lens suffix) to the `active_specialists` list in the session-scoped state file.

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
active = s.setdefault('active_specialists', [])
if '<directory>' not in active:
    active.append('<directory>')
save_state(p, s)
" || true
```

Substitute `<directory>` with the resolved specialist directory from Step 1.
Silent on failure — the statusline initial is advisory.
