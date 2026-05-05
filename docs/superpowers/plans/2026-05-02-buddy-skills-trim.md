# Buddy Skills Surface Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce buddy's user-visible skill surface from 18 skills to 1 (`buddy:summon`), keeping everything else as slash-command-only, and upgrade summon to use natural-language inference instead of strict alias matching.

**Architecture:** Claude Code discovers skills by scanning `name` frontmatter in `commands/*.md` and `skills/*/SKILL.md`. Removing `name` + `description` frontmatter from a file prevents it from appearing in the skills list while preserving its slash-command functionality. Specialist SKILL.md files stay in place (summon reads them by path); their frontmatter removal just hides them from auto-discovery.

**Tech Stack:** Bash, markdown frontmatter, Claude Code plugin system

---

### Task 1: Delete focus-probe

**Files:**
- Delete: `buddy/commands/focus-probe.md`

- [ ] **Step 1: Delete the file**

```bash
rm buddy/commands/focus-probe.md
```

- [ ] **Step 2: Verify gone**

```bash
ls buddy/commands/
```
Expected: `check.md  dismiss.md  focus.md  install.md  legend.md  status.md  summon.md`

- [ ] **Step 3: Commit**

```bash
git add buddy/commands/focus-probe.md
git commit -m "chore(buddy): remove focus-probe dev artifact"
```

---

### Task 2: Strip skill frontmatter from commands that should be command-only

Removing `name` + `description` from frontmatter prevents Claude Code from listing these in the user-invocable skills list. The slash command (`/buddy:check` etc.) continues to work — it's derived from the filename, not the frontmatter.

**Files:**
- Modify: `buddy/commands/check.md`
- Modify: `buddy/commands/dismiss.md`
- Modify: `buddy/commands/legend.md`
- Modify: `buddy/commands/focus.md`
- Modify: `buddy/commands/status.md`
- Modify: `buddy/commands/install.md`

- [ ] **Step 1: Strip frontmatter from check.md**

Replace:
```markdown
---
name: buddy:check
description: Ask the primary bodhisattva to observe the user's current coding state and reflect it into the conversation. Use when the user wants Claude to factor in their context usage, fatigue, recent struggles, or session length. On the very first invocation, this also "hatches" the bodhisattva by generating its name and personality (one-time).
---
```
With: *(remove the entire frontmatter block — file starts directly with content)*

- [ ] **Step 2: Strip frontmatter from dismiss.md**

Replace:
```markdown
---
name: buddy:dismiss
description: Release one or all currently summoned specialists. With no argument, dismisses every active specialist. With an alias argument (yeti, yak, leopard, lammergeier, ibex, lion, crane, frog, pheasant, takin), dismisses only that one. The primary bodhisattva stays.
---
```
With: *(remove entire frontmatter block)*

- [ ] **Step 3: Strip frontmatter from legend.md**

Replace:
```markdown
---
name: buddy:legend
description: Print a reference card showing specialist initials, aliases, and mood meanings. Useful when the statusline shows [DT] and you want to know what that means.
---
```
With: *(remove entire frontmatter block)*

- [ ] **Step 4: Strip frontmatter from focus.md**

Replace:
```markdown
---
name: buddy:focus
description: Set, clear, or show the active plan for this session. Scoped to session_id — multiple concurrent sessions on the same project each have their own focus. Usage: /buddy:focus <path>, /buddy:focus --clear, /buddy:focus (no args shows current).
---
```
With: *(remove entire frontmatter block)*

- [ ] **Step 5: Strip frontmatter from status.md**

Replace:
```markdown
---
name: buddy:status
description: Diagnostics for the buddy plugin. Prints identity, current mood, signal values, and hook health. Used for debugging the plugin itself, not a user-facing feature.
---
```
With: *(remove entire frontmatter block)*

- [ ] **Step 6: Strip frontmatter from install.md**

Replace:
```markdown
---
name: buddy:install
description: Auto-wire the buddy statusline into ~/.claude/settings.json. Detects whether claude-statusline is also installed and picks composed vs standalone mode accordingly. Asks before overwriting an existing statusLine entry.
---
```
With: *(remove entire frontmatter block)*

- [ ] **Step 7: Update dismiss.md alias resolution to match summon**

`dismiss.md` currently uses a strict alias table. Since summon now infers by intent, dismiss should too — otherwise `/buddy:dismiss ML` fails. Replace the Step 1 alias table in `dismiss.md` with the same natural-language inference approach as summon: use the specialist descriptions table, infer from intent, print the table and stop if ambiguous.

- [ ] **Step 8: Commit**

```bash
git add buddy/commands/check.md buddy/commands/dismiss.md buddy/commands/legend.md buddy/commands/focus.md buddy/commands/status.md buddy/commands/install.md
git commit -m "chore(buddy): demote commands to slash-command-only, natural language dismiss"
```

---

### Task 3: Strip skill frontmatter from all 10 specialist SKILL.md files

Specialists are loaded by `summon` via direct `Read` on their path — frontmatter is not used by summon. Removing it prevents auto-discovery in the skills list.

**Files:**
- Modify: `buddy/skills/debugging-yeti/SKILL.md`
- Modify: `buddy/skills/testing-snow-leopard/SKILL.md`
- Modify: `buddy/skills/refactoring-yak/SKILL.md`
- Modify: `buddy/skills/ml-training-takin/SKILL.md`
- Modify: `buddy/skills/performance-lammergeier/SKILL.md`
- Modify: `buddy/skills/planning-crane/SKILL.md`
- Modify: `buddy/skills/architecture-snow-lion/SKILL.md`
- Modify: `buddy/skills/docs-lotus-frog/SKILL.md`
- Modify: `buddy/skills/data-leakage-snow-pheasant/SKILL.md`
- Modify: `buddy/skills/security-ibex/SKILL.md`

Each file currently starts with:
```markdown
---
name: <specialist-name>
description: <one-line description>
---
```

- [ ] **Step 1: Remove frontmatter from all 10 specialist files**

For each file, delete the opening `---\nname: ...\ndescription: ...\n---\n\n` block. The file should start directly with the `# The <Specialist Name>` heading.

Run after editing all 10 to verify:
```bash
for f in buddy/skills/*/SKILL.md; do head -1 "$f" | grep -q "^---" && echo "STILL HAS FRONTMATTER: $f"; done
```
Expected: no output (all frontmatter removed).

- [ ] **Step 2: Commit**

```bash
git add buddy/skills/
git commit -m "chore(buddy): hide specialist skills from auto-discovery (strip frontmatter)"
```

---

### Task 4: Rewrite summon.md — natural language inference

Replace the strict alias table with specialist descriptions. Claude infers the match from intent. Keep all other steps (log, state update) intact.

**Files:**
- Modify: `buddy/commands/summon.md`

- [ ] **Step 1: Rewrite summon.md**

Replace the entire file content with:

```markdown
---
name: buddy:summon
description: Summon a specialist bodhisattva to help with a specific craft. Describe who you need in plain language — e.g. "debug", "testing", "ML training", "architecture", "security", "refactor", "performance", "docs", "data leakage", "planning". An ambiguous argument prints the specialist table and exits without loading anything.
---

You are resolving a summon request. The argument passed by the user is `$1`.

## Step 1 — Identify the specialist

The user's argument is plain language. Match it to the best specialist using their descriptions below. Trust intent over exact words — "debug", "yeti", "debugging" all resolve to debugging-yeti.

| Directory | When to summon |
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

If the argument is empty or genuinely ambiguous (matches multiple specialists equally), print the table above with a one-line description and stop. Do not load any specialist.

## Step 2 — Load the specialist skill file

Use the `Read` tool to load `${CLAUDE_PLUGIN_ROOT}/skills/<directory>/SKILL.md`.

If the file doesn't exist, report: "That specialist is not yet authored. Current bestiary: <list directories under skills/ that exist>."

## Step 3 — Announce the summon

Emit a short italicized line announcing the specialist. Example:

> *The Debugging Yeti arrives. Patient, methodical. The mountain waits.*

## Step 4 — Adopt the specialist voice for the rest of the turn

After the announcement, the full contents of the specialist's SKILL.md become your operating instructions. Follow its voice and method until the user runs `/buddy:dismiss` or the session ends.

## Step 5 — Log the summon

Append one line to `~/.claude/buddy/summons.log`:

```
<unix timestamp>\t<directory>\tsummoned
```

Use bash via the `Bash` tool to append. Silent on failure — the log is advisory.

## Step 6 — Track the active specialist in state

Append the resolved `<directory>` to the `active_specialists` list in the session-scoped state file.

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
```

- [ ] **Step 2: Commit**

```bash
git add buddy/commands/summon.md
git commit -m "feat(buddy): summon via natural language inference, drop strict alias table"
```

---

### Task 5: Version bump and cache update

**Files:**
- Modify: `buddy/.claude-plugin/plugin.json`
- Modify: `README.md`
- Modify: `~/.claude/plugins/installed_plugins.json`
- Modify: `~/.claude-sdd/plugins/installed_plugins.json`

- [ ] **Step 1: Run tests**

```bash
cd buddy && python3 -m pytest tests/ -q 2>&1 | tail -20
```
Expected: all pass (no test touches skill frontmatter discovery).

- [ ] **Step 2: Bump version in plugin.json**

In `buddy/.claude-plugin/plugin.json`, change:
```json
"version": "0.3.1"
```
to:
```json
"version": "0.3.2"
```

- [ ] **Step 3: Update README.md version table**

Find the buddy row in the version table and update `0.3.1` → `0.3.2`.

- [ ] **Step 4: Verify consistency**

```bash
./scripts/check-versions.sh
```
Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add buddy/.claude-plugin/plugin.json README.md
git commit -m "chore(buddy): bump to 0.3.2 — trim skills surface to 1, natural language summon"
```

- [ ] **Step 6: Push**

```bash
git push
```

- [ ] **Step 7: Update both installed_plugins.json files**

Copy new cache snapshot for both instances:
```bash
# Copy source to new cache version
cp -r ~/.claude/plugins/cache/sdd-misc-plugins/buddy/0.3.1 \
       ~/.claude/plugins/cache/sdd-misc-plugins/buddy/0.3.2

# Sync source files into new cache
rsync -a --delete /home/marius/work/claude/claude-plugins/buddy/ \
  ~/.claude/plugins/cache/sdd-misc-plugins/buddy/0.3.2/
```

Then in `~/.claude/plugins/installed_plugins.json`, update buddy entry:
```json
"installPath": "/home/marius/.claude/plugins/cache/sdd-misc-plugins/buddy/0.3.2",
"version": "0.3.2"
```

Repeat for `~/.claude-sdd/plugins/installed_plugins.json`.

- [ ] **Step 8: Restart both Claude Code instances**

Restart to pick up the new plugin cache.

---

### Task 6: Smoke test

- [ ] **Step 1: Verify skills list**

Start a new session. Confirm the available skills section shows only `buddy:summon` under buddy. All others should be gone.

- [ ] **Step 2: Test slash commands still work**

Run each of these and confirm they execute (content loads, correct output):
- `/buddy:check`
- `/buddy:dismiss`
- `/buddy:legend`
- `/buddy:status`

- [ ] **Step 3: Test summon natural language**

- `/buddy:summon yeti` — should load debugging-yeti
- `/buddy:summon debug` — should load debugging-yeti
- `/buddy:summon ML training` — should load ml-training-takin
- `/buddy:summon testing` — should load testing-snow-leopard
- `/buddy:summon plan` — should load planning-crane
- `/buddy:dismiss` — should clear all

- [ ] **Step 4: Test ambiguous input**

- `/buddy:summon help` — should print the specialist table and stop, not load anything
