# Buddy Plugin

Himalayan-aesthetic bodhisattva companion for Claude Code. 9 specialist masters on demand.

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

Break things silently if violated:

- **Judge config lives in `hooks/judge.env`**: this file is sourced by all hook subprocesses and overrides any `settings.json` env vars — edit only `judge.env` to change model, URL, or intervals

- **Silent-on-failure**: all hook handlers wrap in `except Exception: pass`; shell wrappers end with `|| true`
- **Atomic writes**: `save_state` must use `mkstemp + os.replace` — never `open(path, 'w')`
- **Live mood**: `render()` always calls `derive_mood()` directly — never reads `state["derived_mood"]`
- **Catalog sync**: adding form to `data/bodhisattvas.json` → update `EXPECTED_FORMS` in `tests/test_data_catalogs.py`
- **Run pytest** from project root before completing any change to `scripts/`

## Plugin Development (dev mode)

Repo is source for `buddy` Claude Code plugin. Dev mode: plugin cache symlinked to repo, edits live instantly.

### First-time setup

```bash
bash scripts/dev-install.sh
```

Registers buddy in both Claude Code instances (`~/.claude` and `~/.claude-sdd`), replaces cache copies with symlinks to this repo.

### After `/reload-plugins` clobbers the symlink

See `⚠ buddy: dev symlink broken` at session start? Re-run:

```bash
bash scripts/dev-install.sh
```

### Adding new commands, hooks, skills, or agents

File changes live immediately (symlink). New component files (new `.md` commands, new skill dirs, etc.) need reload:

```
/reload-plugins
```

If reload replaces symlink with copy, re-run `dev-install.sh`.

### Checking symlink health

```bash
bash scripts/dev-check.sh
```

### For non-dev users

Install via marketplace — no dev scripts needed:

```
/plugin install buddy@sdd-misc-plugins
```

## Running Tests

```bash
python3 -m pytest tests/ -x -q
```