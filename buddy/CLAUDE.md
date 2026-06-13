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

## Plugin Development

Repo is the source for the `buddy` Claude Code plugin. buddy is a **cache-based directory-source plugin** in the `sdd-misc-plugins` marketplace — installed and version-bumped exactly like its siblings (codescout-companion, etc.). It is NOT dev-symlinked, so edits to `buddy/` are not live.

### Applying a change

Follow the repo-root `CLAUDE.md` § "When bumping a plugin version":

```bash
# 1. bump buddy/.claude-plugin/plugin.json + the README version table, then:
./scripts/check-versions.sh
# 2. seed the versioned cache in all three profiles:
./scripts/bump-cache.sh buddy <version>
# 3. repoint installPath + version in all three install records (root CLAUDE.md step 6)
# 4. cold-restart all three instances
```

### Install (any user)

```
/plugin install buddy@sdd-misc-plugins
```

## Running Tests

```bash
python3 -m pytest tests/ -x -q
```