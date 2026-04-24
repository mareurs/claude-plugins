# Buddy Plugin

Himalayan-aesthetic bodhisattva companion for Claude Code with 9 specialist masters on demand.

## Deep Context → codescout Memories

Read relevant memories before exploring code:

| Topic | Contents |
|---|---|
| `architecture` | Layer structure (BONES/WITNESS/SOUL), data flows, design patterns, invariants |
| `conventions` | Naming, error handling pattern, state access, testing, skill/command file structure |
| `development-commands` | Test commands, hook testing, statusline testing, checklist before merging |
| `domain-glossary` | Bodhisattva, form, hatching, mood, signals, specialist, environment strip |
| `gotchas` | Known pitfalls, silent failures, wiring issues, catalog test sync |
| `language-patterns` | Python anti-patterns and correct patterns for this codebase |
| `project-overview` | Purpose, tech stack, runtime requirements, plugin layout |

## Iron Rules

These break things silently if violated:

- **Silent-on-failure**: all hook handlers wrap in `except Exception: pass`; shell wrappers end with `|| true`
- **Atomic writes**: `save_state` must use `mkstemp + os.replace` — never `open(path, 'w')`
- **Live mood**: `render()` always calls `derive_mood()` directly — never reads `state["derived_mood"]`
- **Catalog sync**: adding a form to `data/bodhisattvas.json` → update `EXPECTED_FORMS` in `tests/test_data_catalogs.py`
- **Run pytest** from project root before completing any change to `scripts/`

## Plugin Development (dev mode)

This repo is the source for the `buddy` Claude Code plugin. For development,
the plugin cache is symlinked to this repo so edits are instantly live.

### First-time setup

```bash
bash scripts/dev-install.sh
```

Registers buddy in both Claude Code instances (`~/.claude` and `~/.claude-sdd`)
and replaces the cache copies with symlinks to this repo.

### After `/reload-plugins` clobbers the symlink

If you see `⚠ buddy: dev symlink broken` at session start, re-run:

```bash
bash scripts/dev-install.sh
```

### Adding new commands, hooks, skills, or agents

File changes are live immediately (symlink). But Claude Code only discovers
new component files (new `.md` commands, new skill dirs, etc.) on reload:

```
/reload-plugins
```

If the reload replaces the symlink with a copy, re-run `dev-install.sh`.

### Checking symlink health

```bash
bash scripts/dev-check.sh
```

### For non-dev users

Install via the marketplace — no dev scripts needed:

```
/plugin install buddy@sdd-misc-plugins
```

## Running Tests

```bash
python3 -m pytest tests/ -x -q
```
