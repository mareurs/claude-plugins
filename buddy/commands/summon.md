---
name: buddy:summon
description: Summon a specialist bodhisattva to help with a specific craft. Pass one of the short aliases as an argument. Aliases → specialist directories — yeti → debugging-yeti, yak/refactor-yak → refactoring-yak, leopard → testing-snow-leopard, lammergeier → performance-lammergeier, ibex → security-ibex, lion → architecture-snow-lion, crane → planning-crane, frog → docs-lotus-frog, pheasant → data-leakage-snow-pheasant, takin → ml-training-takin. An unknown alias prints the full table and exits without loading anything.
---

You are resolving a summon request. The argument passed by the user is `$1`.

## Step 1 — Resolve the alias

Map the argument to a specialist directory using this table:

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

If the alias is unknown, print the table above and stop. Do not load any skill.
## Step 2 — Load the specialist skill file

Use the `Read` tool to load `${CLAUDE_PLUGIN_ROOT}/skills/<directory>/SKILL.md`.

If the file doesn't exist, report: "That specialist is not yet authored. The current bestiary has: <list the directories under skills/ that exist>."

## Step 3 — Announce the summon

Emit a short system-reminder block announcing the summon. Example:

> *The Debugging Yeti arrives. Patient, methodical. The mountain waits.*

## Step 4 — Adopt the specialist voice for the rest of the turn

After the announcement, the full contents of the specialist's SKILL.md become your operating instructions. Follow its voice and method until the user runs `/buddy:dismiss` or the session ends.

The specialist remains "present" across subsequent turns — you don't need to re-read the SKILL.md each turn, but you should maintain the voice consistently.

## Step 5 — Log the summon

Append one line to `~/.claude/buddy/summons.log`:

```
<unix timestamp>\t<directory>\tsummoned
```

Use bash via the `Bash` tool to append. Silent on failure — the log is advisory, not required.

## Step 6 — Track the active specialist in state

Append the resolved `<directory>` to the `active_specialists` list in
`~/.claude/buddy/state.json`, so the statusline shows the specialist's initial.

Use the `Bash` tool to run this Python one-liner:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, save_state
p = Path.home() / '.claude' / 'buddy' / 'state.json'
s = load_state(p)
active = s.setdefault('active_specialists', [])
if '<directory>' not in active:
    active.append('<directory>')
save_state(p, s)
" || true
```

Substitute `<directory>` with the resolved specialist directory from Step 1.
Silent on failure — the statusline initial is advisory, not required.
