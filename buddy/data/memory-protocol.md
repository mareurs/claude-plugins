# Memory Protocol

You have a memory system. Use it to capture lessons that would change how you act next time. Three rules above all:

1. **Memory is for hard-won judgment, not transcripts.** If a lesson would not change a future decision, do not save it.
2. **POV is yours alone.** Save in your own voice. The user can read these later, but they are addressed to your future self.
3. **Empty is valid.** If nothing genuinely new came up, say so and move on. Do not invent lessons to fill space.

## When to save

- **Explicit user ask** — "remember that …", "save a memory about …".
- **Autonomous mid-turn** — you noticed a lesson worth keeping during work. Announce *before* writing so the user can object.
- **At dismissal** — when `/buddy:dismiss` triggers introspection, reflect across the turn(s) and save zero or more lessons.

## Routing — global vs project

| Channel | Path | Pick when |
| --- | --- | --- |
| **Project** | `<repo-root>/.buddy/memory/` | Lesson references this repo's files, conventions, infra, team decisions, tooling, or data. |
| **Global** | `<claude-dir>/buddy/memory/` | Lesson is about the craft itself — language/framework patterns, debugging instincts, generally-applicable heuristics. |

**Ambiguous → project.** Project memory only loads in this repo, so a wrong call there is contained. A wrong "global" call follows the user everywhere.

## File location

```
<channel>/<specialist>/<slug>.md     # POV-scoped: only loaded when that specialist is summoned
<channel>/common/<slug>.md           # Cross-buddy: loaded for every summoned specialist
```

`<specialist>` is your directory name under `buddy/skills/` (e.g. `debugging-yeti`).
Use `common` only when the lesson genuinely applies to every specialist (e.g. a project convention).

## Slug rules

- kebab-case, 3–6 words, derived from the lesson topic.
- Must be unique within `<channel>/<specialist>/`.
- A slug collision is treated as **update**, not new entry.

## Entry format

```markdown
---
specialist: <directory>           # or "common"
scope: global | project
slug: <kebab-slug>
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [tag1, tag2]
---

**Lesson:** <one-line claim, your POV first-person>

**Why:** <reason — incident, principle, or pattern observed>

**How to apply:** <when/where this kicks in for future work>
```

## Dedup — before writing

1. Read `<channel>/INDEX.md` for the target channel.
2. In your `<specialist>` (or `common`) section, look for either:
   - a **slug match** (exact or near-identical kebab tokens), or
   - **≥2 tag overlap** with an existing entry whose hook is topically similar.
3. If matched: load the existing file, merge the new info into the body, bump `updated:`. Do not create a new file.
4. If not matched: write a new file.
5. After every write or update, regenerate the INDEX line for the affected entry. (You may rewrite the whole INDEX.md from scratch if simpler — entries are sortable by `<specialist>/<slug>`.)

## Announce format

Always announce a save with one line *before* writing, so the user can object:

```
→ memory: <scope> / <specialist-or-common> / <slug> — <one-line hook>
```

If the user objects on the next turn, undo:
- Project: `git restore --staged <path> && rm <path>`
- Global: `rm <path>` and re-mirror.

## Staging — project only

After writing a project memory:

```bash
git add .buddy/memory/<rel-path>
```

**Do not commit.** Tell the user: `staged — commit when ready.`

If `git add` fails (not a repo, etc.), report `→ memory: skipped (project dir not writable)` and do not retry.

## Mirror — global only

After writing a global memory at `<current-claude-dir>/buddy/memory/<rel-path>`, mirror it to other instances:

```bash
python3 -c "
import sys; sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.memory import mirror_global_write
written = mirror_global_write(Path('<rel-path>'))
for p in written: print(f'mirrored: {p}')
" || true
```

If `<rel-path>` was an update (not new), the mirror copies the new content over. INDEX regeneration on the mirror is handled the next time that instance summons the specialist (lazy).

## Failure modes

- `.buddy/memory/` not writable → skip project write; announce skip; global still works.
- Mirror target dir missing → write current instance only; log one-line warning.
- Frontmatter parse error on load → skip that entry only; log warning; do not abort load.
