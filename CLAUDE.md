# Claude Plugins Marketplace

Claude Code plugin marketplace. Primary active plugin: `codescout-companion`.

## Structure

```
.claude-plugin/marketplace.json  -- marketplace catalog (NO version fields here)
sdd/                             -- SDD plugin (stable)
  .claude-plugin/plugin.json     -- version source of truth
  hooks/, commands/, skills/     -- plugin content
codescout-companion/               -- companion plugin for codescout MCP server
  .claude-plugin/plugin.json     -- version source of truth
  hooks/                         -- tool routing, guidance injection, auto-indexing
  docs/plans/                    -- design and implementation docs
scripts/check-versions.sh       -- version consistency validator
```

## Config Dir Resolution

CC sets `CLAUDE_CONFIG_DIR` per profile. Plugin code must resolve config paths via `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` — never bare `$HOME/.claude`.

- Unset → single-profile user, falls back to `~/.claude` (correct).
- Set → multi-profile install (e.g. `~/.claude-sdd`), uses the right profile.

Same shape works for both. Hardcoding `$HOME/.claude` writes to the wrong profile for multi-profile users; the fallback pattern costs nothing.

For `.claude.json` (the file): single-profile users have it at `~/.claude.json`; multi-profile users have it inside the profile dir as `<profile>/.claude.json`. When code needs to read it, try `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.claude.json` first, fall back to `$HOME/.claude.json`. See `codescout-companion/scripts/detect.py` for the canonical implementation.

## Active Development Focus

**When "the plugin" is mentioned without qualification, it refers to `codescout-companion`.**

- `codescout-companion` — **actively developed**, primary focus of all plugin work
- `sdd` — **stable**, no active development expected

## codescout-companion

**Companion plugin for the codescout MCP server.**

Intentionally tightly coupled to codescout — reads its SQLite DB, calls its CLI
binary, and references its internal schema (meta table, drift_report table, project.toml).
Update this plugin whenever codescout adds features that affect exploration workflows.

**What it does:**
- **SessionStart** (main agent): injects **pointers**, not content — memory-topic names (`CS_MEMORY_NAMES`) + a read-nudge. (It still also injects a system-prompt pointer `memory(action="read", topic="system-prompt")` — **redundant**: codescout already delivers the system-prompt to the main agent via `server_instructions` (`project_status()` → `build_server_instructions`, as a `## Custom Instructions` section; sourced from the root `.codescout/system-prompt.md`, or `project.toml [project].system_prompt` if absent), and that memory topic is defunct post-fix; slated for removal — see `docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md`.) Verbatim injection on this path was removed in the injection-budget redesign (`docs/superpowers/specs/2026-05-19-injection-budget-design.md`); the model pulls bodies on demand.
- **SubagentStart** (`subagent-guidance.sh`): injects the codescout tool-routing directive + an Iron-Laws reminder, **and the project system-prompt verbatim** (`CS_SYSTEM_PROMPT`, read from the *root* `.codescout/system-prompt.md`). This verbatim push is **necessary, not an oversight**: subagents do **not** receive codescout's `server_instructions` (`claude-code#29655`, closed not-planned), so this hook is the only channel that delivers the system-prompt to them. codescout's `onboarding()` writes the *root* `.codescout/system-prompt.md` directly (post the `e492592986c67138` fix), making it the canonical always-on prompt — keep it fresh via `onboarding(action="refresh_prompt")`. (server_instructions model — main agent yes, subagents no — verified against codescout source 2026-06-14; issue `4c3331864bcf8d9f`.)
- PreToolUse: hard-blocks Read/Grep/Glob/Bash/Edit on source files (`permissionDecision: "deny"`)
- Auto-reindexing: checks index staleness at session start, triggers `codescout index` in background
- Drift warnings: surfaces high-drift files and stale docs/memories

**Dependencies:** `jq`, `sqlite3`, `git`, codescout binary on PATH or in MCP config


## buddy

**Himalayan-aesthetic companion plugin.**

Lives at `buddy/` in this repo. Provides mood-reactive statusline, 12 specialist personas (bodhisattvas), async LLM judges for plan drift and codescout tool violations, and a structured memory system mirrored across CC instances.

**What it does:**
- SessionStart: mood reset, PPID index, memory consolidation nudges; on **compact** releases summoned specialists with a re-summon notice (reconnaissance kept). Specialists are **not** auto-reloaded on resume — they're already in the restored transcript.
- PostToolUse: signal tracking, narrative accumulation, CS heuristics (sync), judge subprocess spawning
- PreToolUse: reads judge verdicts, optionally hard-blocks (`exit 2`) when `BUDDY_JUDGE_BLOCK=true`
- Statusline: mood-reactive ASCII spirit animal with specialist eye expressions

**Dependencies:** `jq`, `python3` (3.13+), `requests` (lazy, for judge only)

**Judge config:** `buddy/hooks/judge.env` is the authoritative source — do NOT put judge config in settings.json.
## Version Management

**Single source of truth**: each plugin's `.claude-plugin/plugin.json` is the canonical version.

**marketplace.json must NOT contain version fields.** Claude Code reads version from
plugin.json at install time. Duplicating it in marketplace.json causes drift.

### When bumping a plugin version

**Claude Code and GitHub Copilot are separate apps with separate plugin systems** —
Copilot's registry (`.copilot/config.json`, JSONC) and cache
(`.copilot/installed-plugins/<marketplace>/<plugin>/`, flat/unversioned — no
per-version subdir the way Claude Code's is) are unrelated to the 3-profile dance
above. `release.sh` covers both as of the `sync-copilot.sh` step; if you ever run
the two halves separately, don't assume bumping Claude Code's caches also updated
Copilot's — they don't share any state.

**Optional but recommended: `./scripts/install-hooks.sh`** (one-time per clone — git
hooks live in `.git/hooks/`, which isn't cloned/synced). Installs a `pre-push` guard
that refuses a force-push to `main` unless the remote tip is an ancestor of what
you're pushing (fast-forward), or `ALLOW_FORCE_PUSH_MAIN=1` is set. This is the
guard that would have caught the 2026-07-08 incident where a force-push to `main`
silently dropped 3 already-merged commits (a concurrent branch had been based on
an older snapshot) — see `docs/superpowers/specs/2026-07-08-plugin-install-sync-design.md`.

**One command runs the whole dance:**

```bash
./scripts/release.sh <plugin> [patch|minor|major|X.Y.Z]   # default: patch
#   ./scripts/release.sh buddy patch                 → bumps 0.7.21 → 0.7.22
#   ./scripts/release.sh codescout-companion 1.12.0  → explicit version
```

Each step is gated (aborts on first failure): **pre-flight** (working tree clean +
`./tests/run-all.sh` + buddy pytest green) → bump `plugin.json` + the README version
table → `check-versions.sh` → commit `chore: bump …` → seed the versioned cache in all
three Claude Code profiles (`bump-cache.sh`) → sync to **GitHub Copilot's separate marketplace/cache** (`sync-copilot.sh` — soft-skips if this machine has no Copilot install) → repoint `version` + `installPath` in all three Claude Code install
records → **sanity loop** → `git push`. Toggles: `NO_PUSH=1` (commit locally, skip push —
use it to dry-run a release), `SKIP_TESTS=1`. **The script header is the authoritative
step-by-step** — read/edit it there, not here.

The sanity loop guards the two classic failure classes: a **missing cache dir** — the #1
cause of "plugin appears installed but hook never fires" (`installed_plugins.json` claims a
version at a path that isn't on disk) — and **cross-profile `installPath` drift** (a record
whose `installPath` points at another profile's cache).

**Two steps the script CANNOT do — you must do them after it finishes:**

1. **Refresh the codescout `version-bump-checklist` tracker** (needs the MCP tool, not bash),
   then verify every row is ✅ — any ❌ is real drift:
   ```
   artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)   # update params + body for the new version
   artifact(action="get",    id="cc8cb9e23ab5cc67", full=true)
   ```
   It is the richer cross-check of the same two failure classes the bash sanity loop covers;
   design in `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

2. **Cold-restart all three Claude Code instances — a `resume` is NOT enough.** CC resolves
   hook commands + `installPath` at process launch and caches them; re-attaching with
   `source=resume` reuses the *old* in-memory hook even after the records point at the new
   version, so the bumped code never runs. Fully quit + relaunch, or run `/reload-plugins`.
   Confirm via the SessionStart payload: a true cold start reports `source=startup`, a
   re-attach reports `source=resume`. (This is the trap behind "I bumped + restarted but the
   fix still isn't live.")
## Development

- Hooks use `jq` for JSON parsing — required dependency
- Hook scripts use `${CLAUDE_PLUGIN_ROOT}` to reference files within the plugin install directory
- Test hooks locally: `echo '{"cwd":"/some/path"}' | bash codescout-companion/hooks/session-start.sh`

## Testing

Run before any version bump:

```bash
./tests/run-all.sh
```

**Write tests when you find issues.** If a design review, code review, or debugging session
reveals a bug or edge case — write a test for it before or alongside the fix. Don't rely on
manual verification for behavior that can be captured as an automated test.

**Test isolation: always clean up mutated state.** Each test that writes config, files, or
env vars must remove them before the next test runs — otherwise subsequent tests run in a
corrupted environment and produce false results. The pattern is: write config → test →
remove config. If test N establishes this pattern, make sure test N+1 doesn't silently
inherit leftover state.

## Session Passover

Hand a live work thread to a fresh session (e.g. after compaction, or one of several
parallel threads on this repo). **Manual and selective** — write one only when a session is
worth resuming; a finished session needs none.

**Author (outgoing session):** copy `docs/templates/passover-template.md` to
`docs/trackers/passover-<topic>-YYYY-MM-DD.md`, fill State / Next actions / Working state /
Anti-goals. Get `origin_session_id` from `cat .codescout/cc_session_id` (or
`.buddy/.current_session_id`); omit if absent.

**Discover (incoming session):** run, early in the session —

    artifact(action="find", kind="tracker",
             filter={"and":[{"tags":{"in":["passover"]}}, {"status":{"eq":"active"}}]})

Zero results → proceed normally. One → resume it (auto-confirm if your own session id equals
`origin_session_id`, which holds on `--resume`). Multiple → pick by `topic`/`branch`.
Always run Next-actions step 1 (verify state) before acting.

**Consume:** when done, flip `status: archived`, append `## Consumed — YYYY-MM-DD`, and
`artifact(action="move", …)` into `docs/trackers/archive/` (never bare `git mv`).

## Plugin Install Path (directory-source gotcha)

Claude Code freezes `installPath` + `version` in `~/.claude/plugins/installed_plugins.json`
at install time. For directory-source plugins (marketplace `source: directory`), the
`installPath` points to the source folder — but commands and hooks are read from `installPath`,
so **new components added after initial install are invisible until the record is updated**.

**After adding a new component type (e.g. `commands/`) or bumping the version, update the
install record to point at the new cache snapshot:**

```bash
# Check the latest cache version
ls ~/.claude/plugins/cache/claude-plugins/codescout-companion/

# Edit installed_plugins.json: update installPath + version to the new cache entry
~/.claude/plugins/installed_plugins.json
# → "installPath": "~/.claude/plugins/cache/claude-plugins/codescout-companion/<version>"
# → "version": "<version>"
```

Then restart Claude Code.

## Installing

```
/plugin marketplace add mareurs/claude-plugins
/plugin install codescout-companion@claude-plugins
/plugin install sdd@claude-plugins
```

For project-level setup, add to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "claude-plugins": {
      "source": { "source": "github", "repo": "mareurs/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "codescout-companion@claude-plugins": true
  }
}
```
