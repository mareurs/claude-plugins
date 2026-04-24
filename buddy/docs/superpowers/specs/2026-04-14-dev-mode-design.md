# Buddy Plugin — Dev Mode Design Spec

## 1. Problem

The Claude Code plugin loader copies plugin files from the marketplace source into a
per-instance cache directory at install time. After that, edits in the dev repo are
invisible until the plugin is uninstalled and reinstalled — the official docs have no
"dev mode."

On this machine the situation is compounded by:

- **Two Claude Code instances** (`~/.claude/` and `~/.claude-sdd/`), each with its own
  cache and `installed_plugins.json`.
- **A symlink chain** that creates a false sense of liveness: the monorepo at
  `/home/marius/work/claude/claude-plugins/buddy` symlinks to the dev repo at
  `/home/marius/agents/buddy-plugin`, but the cache is a frozen copy, not a link.
- **No feedback** when the cache is stale — edits land in the dev repo, hooks run from
  the cache, and the mismatch is silent.

## 2. Goals

1. Edits in the dev repo are instantly live in both Claude Code instances (zero-command
   inner loop).
2. If a plugin reinstall or auto-update clobbers the symlink, the user is warned at
   session start.
3. A single script restores dev mode in both instances.
4. Non-dev users are unaffected — they install normally via the marketplace.

## 3. Mechanism

Replace the cache directory with a symlink to the dev repo.

### Before (current)

```
~/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.0/
  ├── scripts/buddha.py   ← frozen copy (different inode)
  ├── hooks/hooks.json
  └── ...
```

### After (dev mode)

```
~/.claude-sdd/plugins/cache/sdd-misc-plugins/buddy/0.1.0
  → /home/marius/agents/buddy-plugin   ← symlink
```

All file reads by the plugin loader resolve through the symlink to the live dev repo.

## 4. Components

### 4.1 `scripts/dev-install.sh`

One-shot, idempotent script that sets up dev mode in both instances.

**Inputs:** None (paths are derived from the script's own location and known constants).

**Steps:**

1. Resolve `PLUGIN_ROOT` — the dev repo root (parent of `scripts/`).
2. For each Claude Code config dir (`~/.claude`, `~/.claude-sdd`):
   a. Derive the expected cache path:
      `<config_dir>/plugins/cache/sdd-misc-plugins/buddy/0.1.0`
   b. If the cache path is already a symlink pointing to `PLUGIN_ROOT` → skip (idempotent).
   c. If the cache path is a directory (real copy) → remove it, create symlink.
   d. If the cache path doesn't exist → create parent dirs, create symlink.
   e. Ensure buddy is registered in `<config_dir>/plugins/installed_plugins.json`:
      - If `buddy@sdd-misc-plugins` key exists → leave it.
      - If missing → add a minimal entry with scope `"user"`, current timestamp,
        and the cache path as `installPath`.
3. Print summary of what was done per instance.

**Error handling:** If any step fails for one instance, continue with the other.
Print errors to stderr but exit 0 (dev convenience script, not CI).

**Exit codes:**
- 0: success (including "already set up")
- 1: both instances failed

### 4.2 `scripts/dev-check.sh`

Lightweight health check — verifies symlinks are intact.

**Inputs:** None.

**Output:** One line per instance:
- `✓ ~/.claude: dev symlink OK`
- `✓ ~/.claude-sdd: dev symlink OK`
- `✗ ~/.claude-sdd: cache is a copy, not a symlink — run scripts/dev-install.sh`
- `- ~/.claude: buddy not installed (skip)`

**Exit codes:**
- 0: all installed instances have valid symlinks
- 1: at least one symlink is broken

### 4.3 SessionStart hook addition

In `hooks/session-start.sh`, add a check before the existing Python block:

```bash
# Dev-mode symlink health check (fast, no Python)
# CLAUDE_PLUGIN_ROOT is set by the plugin loader to the cache path.
# In dev mode it's a symlink; if it's a real dir, the symlink got clobbered.
if [ -n "$CLAUDE_PLUGIN_ROOT" ] && [ -d "$CLAUDE_PLUGIN_ROOT" ] && [ ! -L "$CLAUDE_PLUGIN_ROOT" ]; then
    echo "⚠ buddy: dev symlink broken — run scripts/dev-install.sh from the buddy repo" >&2
fi
```

This is pure bash, no Python, adds <1ms. It warns but does not auto-fix.
Only triggers when `CLAUDE_PLUGIN_ROOT` is a real directory (copy), not a symlink.

### 4.4 CLAUDE.md addition

Add a "Plugin Development" section:

```markdown
## Plugin Development (dev mode)

This repo is the source for the `buddy` Claude Code plugin. For development,
the plugin cache is symlinked to this repo so edits are instantly live.

### First-time setup

    bash scripts/dev-install.sh

This registers buddy in both Claude Code instances (~/.claude and ~/.claude-sdd)
and replaces the cache copies with symlinks to this repo.

### After /reload-plugins clobbers the symlink

If you see "⚠ buddy: dev symlink broken" at session start, re-run:

    bash scripts/dev-install.sh

### Adding new commands, hooks, skills, or agents

File changes are live immediately (symlink). But Claude Code only discovers
new component files (new .md commands, new skill dirs, etc.) on reload:

    /reload-plugins

If the reload replaces the symlink with a copy, re-run dev-install.sh.

### For non-dev users

Install normally via the marketplace — no dev scripts needed:

    /plugin install buddy@sdd-misc-plugins
```

## 5. What stays the same

- **`plugin.json`**: No `commands` or `hooks` fields. Auto-discovery handles both.
- **Monorepo symlink**: `/home/marius/work/claude/claude-plugins/buddy → dev repo`.
  Still needed as the marketplace source for initial install.
- **`installed_plugins.json` structure**: dev-install only adds/patches, never removes.
- **Non-dev install path**: Normal marketplace install is unaffected.

## 6. File inventory

### New files

| File                    | Purpose                                      |
| :---------------------- | :------------------------------------------- |
| `scripts/dev-install.sh`| Set up dev-mode symlinks in both instances   |
| `scripts/dev-check.sh`  | Verify symlink health                        |

### Modified files

| File                    | Change                                       |
| :---------------------- | :------------------------------------------- |
| `hooks/session-start.sh`| Add bash symlink check (3 lines)             |
| `CLAUDE.md`             | Add "Plugin Development" section             |

## 7. Open questions

None — design is intentionally minimal. If `/reload-plugins` behavior changes in
future Claude Code versions (e.g., adding native dev mode), we can remove these
scripts entirely.
