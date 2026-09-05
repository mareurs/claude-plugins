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

## This Machine (verified 2026-08-05)

- **Git Bash is installed**, but not at the usual `C:\Program Files\Git`: it's a
  per-user install at `%LOCALAPPDATA%\Programs\Git\bin\bash.exe` (also
  `...\usr\bin\bash.exe`). The bare `bash` on PATH resolves to Windows' WSL
  launcher stub instead, which fails (`WSL ... Relay ... execvpe failed`) —
  this machine's WSL previously had no Linux distro installed (only a stopped
  `docker-desktop` entry); an Ubuntu distro has since been added. Invoke Git
  Bash by full path, don't rely on bare `bash`/`bash.exe` resolving correctly
  in a plain PowerShell terminal.
- **Claude Code CLI was genuinely installed and used here, then uninstalled**
  — it turned out not to be a company-accepted app. `~/.claude` has real usage
  artifacts (`daemon.log`, `sessions/`, `projects/`, `telemetry/`, a populated
  `settings.json` with `enabledPlugins` for `codescout-companion`/`buddy`/
  `sdd`, last touched 2026-06-17) proving it wasn't a dead scaffold — but
  today there is no `claude` binary on PATH, no install under `Program Files`,
  `LOCALAPPDATA\Programs`, or the global npm prefix. **Zero active Claude Code
  profiles exist now — GitHub Copilot Chat in VS Code is the only agent
  surface on this machine.**
- **The plugins are still needed and actively used** — just exclusively
  through Copilot's own loader now (`.copilot/installed-plugins/`, a separate
  install mechanism from Claude Code's cache; see `INSTALL-COPILOT.md`).
  Uninstalling Claude Code did NOT retire `codescout-companion`/`buddy`/`sdd`
  — don't treat "no Claude Code" as "no plugins in use" when reasoning about
  this repo's relevance.
- Of the three Claude Code profile dirs `release.sh` seeds
  (`~/.claude`/`~/.claude-sdd`/`~/.claude-kat`), only `~/.claude` was ever the
  real one in use; `~/.claude-sdd` and `~/.claude-kat` each contain a single
  empty scaffold entry and were never actually used. All three are now
  entirely inert since Claude Code itself is uninstalled — `release.sh`'s
  Claude-Code-side steps (cache-seeding 3 profiles, cold-restarting 3
  instances) are no-ops here; only the Copilot half (`sync-copilot.sh`) has
  any real effect on this box.
- **Cross-shell git gotcha**: WSL's git and Git Bash's git can disagree wildly
  on file state for this repo. WSL's git has no `core.autocrlf` set, so it sees
  hundreds of files as "modified" purely from CRLF/LF normalization vs. the
  Windows-native checkout (which has `core.autocrlf=true`) — do NOT run
  `git add`/`git commit` from WSL against this repo; use Git Bash (or native
  PowerShell git) for anything that touches the index, so the working tree
  view matches what's actually committed.
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
- **SubagentStart** (`subagent-guidance.sh`): injects the codescout tool-routing directive + an Iron-Laws reminder, **and the project system-prompt verbatim** (`CS_SYSTEM_PROMPT`, read from the *root* `.codescout/system-prompt.md`). This verbatim push is **necessary, not an oversight**: subagents do **not** receive codescout's `server_instructions` (`claude-code#29655`, closed not-planned), so this hook is the only channel that delivers the system-prompt to them. codescout's `onboarding()` writes the *root* `.codescout/system-prompt.md` directly (post the `e492592986c67138` fix), making it the canonical always-on prompt — keep it fresh via `onboarding(action="refresh_prompt")`. (server_instructions model — main agent yes, subagents no — verified against codescout source 2026-06-14; issue `6a0a74627fc66478`.)
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

**One command runs the whole dance:**

```bash
./scripts/release.sh <plugin> [patch|minor|major|X.Y.Z]   # default: patch
#   ./scripts/release.sh buddy patch                 → bumps 0.7.21 → 0.7.22
#   ./scripts/release.sh codescout-companion 1.12.0  → explicit version
```

Each step is gated (aborts on first failure): **pre-flight** (working tree clean +
`./tests/run-all.sh` + buddy pytest green) → bump `plugin.json` + the README version
table → `check-versions.sh` → commit `chore: bump …` → seed the versioned cache in all
three profiles (`bump-cache.sh`) → repoint `version` + `installPath` in all three install
records → **sanity loop** → `git push`. Toggles: `NO_PUSH=1` (commit locally, skip push —
use it to dry-run a release), `SKIP_TESTS=1`. **The script header is the authoritative
step-by-step** — read/edit it there, not here.

The sanity loop guards the two classic failure classes: a **missing cache dir** — the #1
cause of "plugin appears installed but hook never fires" (`installed_plugins.json` claims a
version at a path that isn't on disk) — and **cross-profile `installPath` drift** (a record
whose `installPath` points at another profile's cache).

**Never bump a version inline in a feature commit — use `release.sh`.** Doing it by hand
gets you the *number* without any of the machinery the number promises, and nothing
outside a release notices: `check-versions.sh` compares `plugin.json` to the README and
never reads an install record, and `check-profile-parity.sh` runs only *inside*
`release.sh`. Measured 2026-08-28 — `1.19.5` was bumped this way inside `80ed23f`
(a `feat(hooks)` commit), and `~/.claude-kat` sat stranded at `1.19.4` with no cache dir
for nine hours while every automated gate stayed green. The drift was invisible precisely
because the step that catches it is the step that was skipped.

Closed 2026-08-28 by a second guard in `scripts/pre-push-guard.sh`: when a pushed range
touches a `<plugin>/.claude-plugin/plugin.json`, parity must pass for that plugin.
**Opt-in per clone — `./scripts/install-hooks.sh`** (git hooks are local, never synced).
It fires only on a version change, so ordinary pushes are never gated on local profile
state; it is a no-op during a real release, which has already repaired and verified parity
at step 6.5 before it pushes at step 7; and a machine with no profiles passes, because
`check-profile-parity.sh` reports "not installed in any profile" and exits 0. Override
with `SKIP_PARITY_CHECK=1`. Covered by `tests/test-pre-push-guard.sh`.

It deliberately does **not** live in `tests/run-all.sh`: `release.sh` runs that at step 0,
*before* seeding caches and repointing records, so gating there would abort the release on
exactly the drift the release exists to repair.

**Two steps the script CANNOT do — you must do them after it finishes:**

1. **Refresh the codescout `version-bump-checklist` tracker** (needs the MCP tool, not bash),
   then verify every row is ✅ — any ❌ is real drift:
   ```
   doc(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)   # update params + body for the new version
   doc(action="get",    id="cc8cb9e23ab5cc67", full=true)
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

**First thing in a fresh clone — install the local git hooks:**

```bash
./scripts/install-hooks.sh
```

Git hooks live in `.git/hooks/` and are never cloned or synced, so this is opt-in per
clone. It installs a `pre-push` shim carrying two guards: force-push protection on `main`,
and version-bump parity (a bump that skipped `release.sh` cannot reach `main` while the
three profiles disagree about it). `./tests/run-all.sh` prints a notice when they are
missing — a guard that is not installed is otherwise indistinguishable from a guard
finding nothing wrong.

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

    doc(action="find", kind="tracker",
        filter={"and":[{"tags":{"contains":"passover"}}, {"status":{"eq":"active"}}]})

**`contains`, not `in`** — `in` on a tag array matches nothing and returns a clean zero, which
reads exactly like "no handoffs". Measured 2026-08-27: the `in` form returned 0 against 5 live
tagged passovers. See `CLAUDE.md` § Session Passover.

Zero results → proceed normally. One → resume it (auto-confirm if your own session id equals
`origin_session_id`, which holds on `--resume`). Multiple → pick by `topic`/`branch`.
Always run Next-actions step 1 (verify state) before acting.

**Consume:** when done, flip `status: archived`, append `## Consumed — YYYY-MM-DD`, and
`doc(action="move", …)` into `docs/trackers/archive/` (never bare `git mv`).

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
