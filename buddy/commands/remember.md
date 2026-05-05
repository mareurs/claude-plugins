---
name: buddy:remember
description: Ask the currently active specialist(s) to save a memory about the given lesson. Pass the lesson as the argument — e.g. `/buddy:remember in this repo, integration tests must hit a real database`. The specialist decides global vs project scope and the slug.
---

You are processing an explicit memory request. The argument passed by the user is `$1`.

## Step 1 — Resolve who saves it

Read `active_specialists` from session state.

```bash
python3 -c "
import sys, os
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.state import load_state, resolve_session_id_for_command, session_state_path
sid = resolve_session_id_for_command(Path.cwd(), os.getppid())
if not sid:
    print('NONE')
    raise SystemExit(0)
p = session_state_path(Path.cwd(), sid)
s = load_state(p)
print(','.join(s.get('active_specialists', [])) or 'NONE')
" || echo NONE
```

- If output is `NONE` or empty: tell the user `No specialist is summoned. Run /buddy:summon <name> first, or pick which POV should hold this memory.` and stop.
- If exactly one specialist: that one saves the memory.
- If multiple specialists: pick the most relevant based on `$1` and the specialist descriptions in `commands/summon.md`. If genuinely tied, ask the user which POV.

## Step 2 — Save the memory

The chosen specialist (you, in their voice) follows the Memory Protocol from `${CLAUDE_PLUGIN_ROOT}/data/memory-protocol.md` to write `$1` as a memory:

1. Decide scope (global vs project).
2. Propose a slug.
3. Dedup-scan the target channel's INDEX.md.
4. Update existing entry or create new file.
5. Announce save with `→ memory: <scope> / <specialist> / <slug> — <hook>`.
6. Stage (project) or mirror (global).
7. Regenerate INDEX line.

If the input is too vague to capture as a lesson, ask one clarifying question instead of writing.
