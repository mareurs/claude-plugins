---
name: buddy:summon
description: Summon a specialist bodhisattva to help with a specific craft. Describe who you need in plain language — e.g. "debug", "testing", "ML training", "architecture", "security", "refactor", "performance", "docs", "data leakage classic", "data leakage llm", "planning", "prompt". Some specialists have lenses; pass them as `<specialist>:<lens>` (e.g. `data-leakage:llm`). An ambiguous argument prints the specialist table and exits without loading anything.
---

You are resolving a summon request. The argument passed by the user is `$1`.

## Step 1 — Identify the specialist (and lens, if any)

The user's argument is plain language. Parse it into `<specialist>` and an optional `<lens>` separated by `:` (e.g. `data-leakage:llm`, `data-leakage llm`, `data leakage llm` — accept any reasonable form).

### Compose the specialist index from three scopes

Specialists are discovered at lookup time from three scope roots, with precedence **project > global > builtin** (a later scope's entry shadows the earlier one on name collision):

1. **builtin** — `${CLAUDE_PLUGIN_ROOT}/skills/`
   Frozen, plugin-shipped. The 11 entries in the table below are the only builtin specialists; the table is authoritative documentation.
2. **global** — `<claude-dir>/buddy/skills/`
   `<claude-dir>` is the parent of `CLAUDE_PLUGIN_ROOT` whose basename matches `.claude`, `.claude-sdd`, or `.claude-kat`. Optional — directory may not exist.
3. **project** — `<cwd>/.buddy/skills/`
   Optional — directory may not exist.

For each existing scope root, enumerate immediate subdirectories that contain a `SKILL.md` file. Each such subdirectory is a specialist; the directory name is the specialist's lookup key.

Use the `Bash` tool to compose the index:

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}"
# Detect claude-dir by walking ancestors of CLAUDE_PLUGIN_ROOT until basename
# matches .claude / .claude-sdd / .claude-kat. The fixed 2-dirname pattern
# breaks for cached directory-source installs at
# <claude-dir>/plugins/cache/<marketplace>/<plugin>/<version>/ (5 levels deep).
CLAUDE_DIR=""
d="$PLUGIN_ROOT"
while [ -n "$d" ] && [ "$d" != "/" ]; do
  case "$(basename "$d")" in
    .claude|.claude-sdd|.claude-kat) CLAUDE_DIR="$d"; break ;;
  esac
  d=$(dirname "$d")
done

scan() {
  local scope="$1" root="$2"
  [ -z "$root" ] && return
  [ -d "$root" ] || return
  for dir in "$root"/*/; do
    [ -f "$dir/SKILL.md" ] || continue
    echo "$scope $(basename "$dir") $dir"
  done
}

scan builtin "$PLUGIN_ROOT/skills"
scan global "${CLAUDE_DIR:+$CLAUDE_DIR/buddy/skills}"
scan project "$PWD/.buddy/skills"
```

The output is one line per `(scope, name, path)` triple. Compose into an index in your reasoning state, applying precedence: later scopes override earlier ones on the same `name`. Track shadows (entries that were overridden) for the announcement in Step 2.

### Builtin specialist table (frozen — 11 entries)

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
| `prompt-hamsa` | Improving a prompt — critique, drafting from scratch, diagnosing model misbehavior, or coaching toward eval-driven iteration | — |

### Argument matching

Match the parsed `<specialist>` part against the composed index keys. Trust intent over exact words — "debug", "yeti", "debugging" all resolve to `debugging-yeti`. Fuzzy matching is over the **keys of the composed index**, not just the builtin table.

### Lens handling

- **Builtin specialists** — lens requirements are declared in the table above.
- **Global / project specialists** — lens is required if and only if the resolved `SKILL.md`'s directory contains one or more `_*.md` files. The lens names are the basenames stripped of the leading `_` and trailing `.md`.

Apply these rules:

- If a specialist has a required lens and the user did not supply one, print the available lenses with a one-line description of each (read from the addendum's first paragraph), ask the user to pick, and stop. Do not load anything.
- If the user supplied a lens for a specialist that has no lenses, ignore the lens silently and proceed.
- Resolve the lens to an addendum file name: `_<lens>.md` in the same directory as the resolved `SKILL.md`.

### Empty / ambiguous argument

If the argument is empty or genuinely ambiguous (matches multiple specialists equally), print the composed index grouped by scope, then stop without loading:

```
### Builtin
- <name> — <description from builtin table>
...

### Global (N specialists)        # omit section if N=0
- <name> — <first paragraph of SKILL.md, or "no description">
...

### Project (N specialists)        # omit section if N=0
- <name> — <first paragraph of SKILL.md, or "no description">
...
```

Mark shadowed entries with `(shadowed by <higher-scope>)` next to the lower-scope listing so the user knows which version `/buddy:summon <name>` will actually load.
## Step 2 — Load the specialist skill file (and lens addendum, if any)

The resolved specialist has a `(scope, path)` pair from Step 1.

### Step 2a — Cheap dedup check (skip on already-active)

Before loading SKILL.md, check whether this specialist is already active in
the current session. SKILL.md is 150-300 lines; re-injecting it on every
`/buddy:summon` for an already-summoned specialist wastes context.

Use the `Bash` tool:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/track_specialist.py" status <directory>
```

- **Exit 0 → already active in this session.** Skip the rest of Step 2,
  Step 2.5 (memories), and Step 2.6 (gates) — they were injected on the
  prior summon and survive `/compact` and resume via the SessionStart reload
  block. Emit a short refresh line and jump to Step 3:

  > *The <Label> is already with you — voice, principles, and memories are in scope. Continuing.*

  Substitute `<Label>` with the specialist's display label (e.g. "Debugging
  Yeti"). Then proceed to Step 3 (announce) and Step 4 (adopt voice).

- **Exit non-zero → not active.** Proceed with the heavy load below.

### Step 2b — Load SKILL.md and lens addendum

Use the `Read` tool to load `<path>/SKILL.md`.

If a lens was resolved in Step 1, also load `<path>/_<lens>.md`. If the addendum file does not exist, report: "That lens is not yet authored. Available lenses: <list `_*.md` files in `<path>`>." and stop.

If `SKILL.md` doesn't exist (race condition between Step 1 enumeration and Step 2 read), report: "That specialist disappeared between lookup and load. Re-run the summon." and stop.

### Shadow announcement

If the resolved specialist's name also exists in a lower-precedence scope (project shadows global or builtin; global shadows builtin), emit one line before proceeding:

> *loading `<name>` from `<scope>` (shadows `<other-scope>`)*

This makes shadowing visible. Silent shadowing breeds confusion when a user expects the plugin version and gets a project override.
## Step 2.5 — Load memories and inject the memory protocol

Memories are POV-scoped — only the resolved `<directory>` (and the `common` bucket) are loaded.

**Resolve channels:**
- **Global root**: pick the current CC instance dir. Detect via `CLAUDE_PLUGIN_ROOT` — the parent matching `.claude` or `.claude-sdd`. The global memory root is `<claude-dir>/buddy/memory/`.
- **Project root**: `<cwd>/.buddy/memory/` if the directory exists. Skip if missing or if the user has the dir gitignored — in that case emit one warning line: `→ memory: project dir gitignored, skipping project channel`.

**For each existing channel root**, read in this order:
1. `<channel>/<directory>/*.md` (specialist POV)
2. `<channel>/common/*.md` (cross-buddy)

Use the `Read` tool for each file. If a file's frontmatter is malformed, skip it silently.

**Inject under a `## Memories` heading appended to the specialist's instructions:**

```
## Memories — <directory> POV

### Project (this repo)
<project specialist entries verbatim, blank line between, then project common entries>

### Global
<global specialist entries verbatim, blank line between, then global common entries>
```

If a sub-section is empty, omit its heading. If both are empty, omit the whole `## Memories` section.

**Soft cap:** if any one channel has more than 30 entries in `<directory>` + `common` combined, after loading print a one-line hint: `→ memory: <channel> has <N> entries — consider consolidating`. Still load all entries.

**After memories are injected, also inject the protocol:**

Use the `Read` tool on `${CLAUDE_PLUGIN_ROOT}/data/memory-protocol.md` and inject its contents verbatim under a `## Memory Protocol` heading right after `## Memories` (or right after the specialist instructions if `## Memories` was omitted).


## Step 2.6 — Inject the gates

Every summoned specialist operates within tool, runtime, role, and memory
gates. They must be aware of these gates explicitly — implicit gate-knowledge
drifts as the plugin evolves.

Use the `Read` tool on `${CLAUDE_PLUGIN_ROOT}/data/gates.md` and inject its
contents verbatim under a `## Gates` heading right after `## Memory Protocol`
(or right after `## Memories` if no protocol was injected, or right after the
specialist instructions if neither memories nor protocol were injected).

Gates are universal — every specialist sees the same gate text. The
specialist's own `## Operating Principles` and yields-to convention add
specialist-specific gate detail; the injected `## Gates` carries the
plugin-wide gate landscape.

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

Use the `Bash` tool to call the helper:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/track_specialist.py" summon <directory>
```

Substitute `<directory>` with the resolved specialist directory from Step 1 (no lens suffix). Silent on failure — the statusline initial is advisory.
