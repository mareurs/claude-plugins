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
- **SessionStart** (main agent): injects **pointers**, not content — memory-topic names (`CS_MEMORY_NAMES`) + a read-nudge. (It still also injects a system-prompt pointer `memory(action="read", topic="system-prompt")` — **redundant**: the main agent already receives the system-prompt via codescout's `## Custom Instructions`, and that memory topic is defunct post-fix; slated for removal — see `docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md`.) Verbatim injection on this path was removed in the injection-budget redesign (`docs/superpowers/specs/2026-05-19-injection-budget-design.md`); the model pulls bodies on demand.
- **SubagentStart** (`subagent-guidance.sh`): injects the codescout tool-routing directive + an Iron-Laws reminder, **and the project system-prompt verbatim** (`CS_SYSTEM_PROMPT`, read from the *root* `.codescout/system-prompt.md`). This verbatim push is **necessary, not an oversight**: subagents do **not** receive codescout's `server_instructions` (`claude-code#29655`, closed not-planned), so this hook is the only channel that delivers the system-prompt to them. codescout's `onboarding()` writes the *root* `.codescout/system-prompt.md` directly (post the `e492592986c67138` fix), making it the canonical always-on prompt — keep it fresh via `onboarding(action="refresh_prompt")`.
- PreToolUse: hard-blocks Read/Grep/Glob/Bash/Edit on source files (`permissionDecision: "deny"`)
- Auto-reindexing: checks index staleness at session start, triggers `codescout index` in background
- Drift warnings: surfaces high-drift files and stale docs/memories

**Dependencies:** `jq`, `sqlite3`, `git`, codescout binary on PATH or in MCP config

**Note:** Two facts about `server_instructions`, both the **opposite** of what this note once claimed. (1) codescout **does** inject the project system-prompt (the root `.codescout/system-prompt.md`) into the **main agent** via `server_instructions`, as a `## Custom Instructions` section (`project_status()` → `build_server_instructions`). (2) **Subagents do NOT receive `server_instructions`** — only the tool allowlist (`claude-code#29655`, closed not-planned). Consequence: the main agent already has the system-prompt from codescout (the SessionStart pointer is redundant), while **subagents get it only from the companion's SubagentStart hook** — which is therefore necessary. See `docs/superpowers/specs/2026-06-12-system-prompt-source-consolidation-design.md`.


**Himalayan-aesthetic companion plugin.**

Lives at `buddy/` in this repo. Provides mood-reactive statusline, 12 specialist personas (bodhisattvas), async LLM judges for plan drift and codescout tool violations, and a structured memory system mirrored across CC instances.

**What it does:**
- SessionStart: mood reset, PPID index, memory consolidation nudges
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

> ⚠ **The two plugins use different install models — `buddy` is dev-symlinked, `codescout-companion` is cache-based.**
> `buddy/scripts/dev-install.sh` points **all three** profiles' `cache/sdd-misc-plugins/buddy/0.1.0` at this repo via symlink, so buddy always runs the live repo. Buddy's install records must stay pinned at the `0.1.0` dev symlink. **Steps 5 and 6 below (cache-seed + install-record rewrite) apply to `codescout-companion` ONLY.** A buddy bump is: update `plugin.json` + `README` + run `check-versions.sh`, then re-run `buddy/scripts/dev-install.sh` (repairs the symlink record across all three profiles) and cold-restart. Running `bump-cache.sh` or the step-6 `jq` rewrite for buddy clobbers the dev symlink and silently freezes buddy at a stale cache snapshot on the next cold restart — that exact drift is what made a summon-path bug take a full session to diagnose (2026-06-13).

Before bumping, verify:

1. **Tests pass** — `./tests/run-all.sh` exits 0
2. **Tested** — new behavior works as expected
3. **Nothing pending** — no more changes planned for this version, `git status` clean

Then:

1. Update `<plugin>/.claude-plugin/plugin.json` — source of truth
2. Update the version table in `README.md`
3. Run `scripts/check-versions.sh` to verify consistency
4. Commit: `chore: bump <plugin> to <version>`
5. **Seed the versioned cache directory in all three profiles** (codescout-companion only — skip for the dev-symlinked buddy) — directory-source plugins read files from `cache/sdd-misc-plugins/<plugin>/<version>/`; if that path doesn't exist, the install record points at nothing and the hook silently fails to load:
   ```bash
   ./scripts/bump-cache.sh <plugin> <version>
   ```
   The script rsyncs the source dir into `~/.claude`, `~/.claude-sdd`, and `~/.claude-kat` under the matching version. Skipping this step is the #1 cause of "plugin appears installed but hook never fires" — installed_plugins.json claims `<version>` at a path that doesn't exist on disk.
6. Update `installPath` + `version` in **all three** install records (codescout-companion only — never for the dev-symlinked buddy; see the callout at the top of this section).
   Copy-paste (substitute `<plugin>` and `<version>`):
   ```bash
   PLUGIN=buddy; VERSION=0.7.12   # substitute
   for PROFILE in ~/.claude ~/.claude-sdd ~/.claude-kat; do
     jq --arg v "$VERSION" \
        --arg p "$PROFILE/plugins/cache/sdd-misc-plugins/$PLUGIN/$VERSION" \
        "(.plugins[\"$PLUGIN@sdd-misc-plugins\"][0].version) = \$v
        | (.plugins[\"$PLUGIN@sdd-misc-plugins\"][0].installPath) = \$p" \
        "$PROFILE/plugins/installed_plugins.json" > /tmp/ip.json \
        && mv /tmp/ip.json "$PROFILE/plugins/installed_plugins.json"
   done
   ```
   This applies to **`codescout-companion` only** — a versioned, cache-based,
   directory-source plugin keyed `codescout-companion@sdd-misc-plugins`.
   **`buddy` is dev-symlinked** (see the callout at the top of this section):
   never run `bump-cache.sh` or this `jq` rewrite for buddy — re-run
   `buddy/scripts/dev-install.sh` instead, which repairs buddy's `0.1.0` symlink
   record across all three profiles. If a sister-session bumped
   codescout-companion but missed a profile (e.g. `.claude-sdd` left a version
   behind), `check-versions.sh` won't catch it — only the per-profile sanity
   loop below does. Run it after every bump.
6.5. Refresh the version-bump-checklist tracker and verify every row is ✅:
   ```
   artifact(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)
   artifact(action="get", id="cc8cb9e23ab5cc67", full=true)
   ```
   Any ❌ blocks push. The tracker catches the 2026-05-16 cross-profile `installPath` drift and the missing cache-dir class automatically; passing it makes the manual sanity loop below redundant (kept as a fallback for environments without codescout MCP). See `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.
7. Push
8. **Cold-restart all three Claude Code instances — a `resume` is not enough.**
   CC resolves hook commands + `installPath` at process launch and caches them.
   Re-attaching a conversation with `source=resume` reuses the *old* in-memory
   hook even after `installed_plugins.json` points at the new version — the
   bumped code never runs. Confirm via the SessionStart payload: a true cold
   start reports `source=startup`; a re-attach reports `source=resume`. Either
   fully quit + relaunch, or run `/reload-plugins` to force a registry reload.
   (This is the trap behind "I bumped + restarted but the fix still isn't
   live" — verified 2026-05-21 chasing a buddy reload bug across 4 bumps.)

```bash
./scripts/check-versions.sh
```

Checks: plugin.json versions match README.md table, marketplace.json has no version fields.

**Sanity check after bumping** (codescout-companion, cache-based): for each profile, verify the path in installed_plugins.json actually exists on disk. Buddy (dev-symlinked) is verified separately by `bash buddy/scripts/dev-check.sh`, which confirms the `0.1.0` symlink resolves to this repo in all three profiles.

```bash
for p in ~/.claude ~/.claude-sdd ~/.claude-kat; do
  for plug in codescout-companion; do  # buddy is dev-symlinked — verify with: bash buddy/scripts/dev-check.sh
    v=$(jq -r ".plugins[\"$plug@sdd-misc-plugins\"][0].version" "$p/plugins/installed_plugins.json")
    [ -d "$p/plugins/cache/sdd-misc-plugins/$plug/$v" ] && echo "✓ $p $plug $v" || echo "✗ $p $plug $v MISSING"
  done
done
```
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
