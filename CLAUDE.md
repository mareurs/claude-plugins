# Claude Plugins Marketplace

Claude Code plugin marketplace. Primary active plugin: `codescout-companion`.

## IRON LAW — build for the agent

Agents are the main users of every surface this repository ships: MCP tool schemas and descriptions, hook text, deny messages, skill text and scripts. When you design, change or review one, these outrank completeness and cleverness:

1. **Simplicity.** One model and one method per job. Replace an old way; never add a second.
2. **Natural for an agent.** The right call is the one an agent would guess.
3. **Known patterns.** Prefer what git, the shell, markdown and common CLIs already teach over an invention of ours.
4. **Token economy.** Every byte an agent reads costs: tool descriptions, hook payloads, deny text, skills. Claude Code cuts a hook payload of about 10 KB or more to a 2 KB preview (§ codescout-companion, SubagentStart).
5. **Few turns.** One call that answers beats a call and a follow-up. A refusal names the fix.
6. **Lenient.** Do what the agent meant, and say in one line what you understood. Refuse only what you cannot read or undo. Teach a limit up front, in the schema and the description, and keep the refusal as a net: `post_notice` advises 120 and 4000 characters, accepts a fifth more, and refuses beyond that with the count to cut.

A design that adds a surface, a mode, a format or a skill names which of these it costs, and why the cost is worth it.

Agent-facing text (hook output, deny messages, skill and tool descriptions) states the current situation only, with no history ("was removed", "formerly"). History belongs in commit messages, trackers and issues.

## What belongs in this file

A line earns residency here only if a session that never opens another doc would act wrongly without it. Put new measurements in a memory topic and incident history in `docs/` or a tracker, and leave a one-line pointer under the same heading (the `Where things live` table), because scripts and other docs cite this file's sections by name.

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
cs-hint-codex/                     -- Codex-only [cs-hint] hook; root must stay 5 files (§ cs-hint-codex)
hint-echo/                         -- Claude Code mod: shows hook additionalContext to the user
scripts/check-versions.sh       -- version consistency validator
```

## Where things live

Read a memory topic with `memory(action="read", topic=…)`.

| Need | Read |
|---|---|
| Release, profile or Codex work on this machine | `codescout box runtime find "Linux workstation"` and `find "Codex on this machine"` |
| A claim about a Windows work box (another host, not this machine) | `codescout box runtime find "Windows work box"` |
| Why a hook edit is live and a skill edit is not; the measurement behind the table | `plugin-load-channels` |
| The SessionStart or SubagentStart payload: what it holds and why it is capped | `agent-dispatch-hooks` |
| Write, resume or archive a passover | `session-passover` |
| Writing a skill whose mechanics differ by harness or OS | `conventions` |
| Where to put an instruction an agent must act on (system prompt, not tool output or a hook message) | `where-agents-listen` |
| A release incident, or how the pre-push parity guard works | `development-commands` |
| Open leftovers, decisions and questions of this repository | `codescout box` (the root view; ledgers `runtime` and `runtime-residuals`) |

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
- **SessionStart** (main agent): injects **pointers**, not content: memory-topic names (`CS_MEMORY_NAMES`) and a read-nudge. Design: `docs/superpowers/specs/2026-05-19-injection-budget-design.md`. Detail: memory `agent-dispatch-hooks`.
- **SubagentStart** (`subagent-guidance.mjs`): sends a **pointer** of about 3.4 KB: load the codescout tools with one `ToolSearch` call, enter the project, pick the tool by intent, read `.codescout/system-prompt.md` by path. Subagents do not receive codescout's `server_instructions` (`claude-code#29655`), so this hook is the only channel before their first tool call. **The payload size must not depend on any user file**: Claude Code cuts a hook payload of about 10 KB or more to a 2 KB preview, and `tests/test-subagent-guidance.sh` pins the cap (5000 B). Detail and measurement: memory `agent-dispatch-hooks`.
- PreToolUse: hard-blocks Read/Grep/Glob/Bash/Edit on source files (`permissionDecision: "deny"`)
- Auto-reindexing: checks index staleness at session start, triggers `codescout index` in background
- Drift warnings: surfaces high-drift files and stale docs/memories
- **Export feedback** (skill `export-feedback`): writes every box as one redacted Markdown file that a colleague sends to the maintainers. It reads boxes through the codescout CLI, never through folder paths or SQL, so it covers any box. `CS_PRIVACY` (default on, `off` = raw) changes the export only, never recording. Redaction is a blacklist: a new leak class needs a regex and a case in `export-feedback.test.sh`. Design: `docs/superpowers/specs/2026-11-24-export-feedback-design.md`.

**Dependencies:** `jq`, `sqlite3`, `git`, codescout binary on PATH or in MCP config


## buddy

**Himalayan-aesthetic companion plugin.**

Lives at `buddy/` in this repo. Provides mood-reactive statusline, 12 specialist personas (bodhisattvas), async LLM judges for plan drift and codescout tool violations, and a structured memory system mirrored across CC instances.

**What it does:**
- SessionStart: mood reset, PPID index, memory consolidation nudges; on **compact** releases summoned specialists with a re-summon notice (reconnaissance kept). Specialists are **not** auto-reloaded on resume — they're already in the restored transcript.
- PostToolUse: signal tracking, narrative accumulation, CS heuristics (sync), judge subprocess spawning
- PreToolUse: reads judge verdicts, optionally hard-blocks (`exit 2`) when `BUDDY_JUDGE_BLOCK=true`
- Statusline: mood-reactive ASCII spirit animal with specialist eye expressions

**Dependencies:** `jq`, `python3` (3.13+), `PyYAML` (hard dependency — `consolidate.py` imports it
at module level and `hook_entry.run_session_start` imports from that module unguarded, so a missing
`yaml` makes SessionStart a *silent* no-op: `hook_dispatch.main()` catches the ImportError and
returns 0, so nothing crashes and nothing is logged), `requests` (lazy, for judge only)

The CI workflow installs PyYAML explicitly in each job; the incident is in memory `gotchas` (buddy CI entry).

**Judge config:** `buddy/hooks/judge.env` is the authoritative source — do NOT put judge config in settings.json.
## cs-hint-codex (Codex only)

Lives at `cs-hint-codex/`. The `[cs-hint]` advisories of buddy as one PostToolUse hook for Codex. Design and measurements: `docs/superpowers/specs/2026-11-09-cs-hint-codex-bundle-design.md`.

- **Why it exists.** Codex runs a plugin hook only after the user approves it, and the approval is bound to a hash of the WHOLE plugin root. Installing `buddy` or `codescout-companion` gives 5 or 27 hooks that do not run until approved. Here one approval covers one hook. Measurements: the design spec above.
- **The root stays five files**: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/cs_hint.py`, `scripts/cs_heuristics.py`, `scripts/cs_tool_log.py`. No README, tests or skills inside; any file added or edited there cancels every user's approval. `tests/test-cs-hint-codex.sh` pins the layout. Tests, docs and the sync script live outside the root.
- **The two `scripts/` files are byte copies of `buddy/scripts/`** (a symlink in the root is an error for Codex). After a change to either buddy file run `scripts/sync-cs-hint-codex.sh`, bump the plugin version, and expect every Codex user to approve again. The test fails while a copy drifts.
- **Stdlib only.** Unlike `buddy` (PyYAML is a hard dependency of its SessionStart), the hook needs only `python3`.
- **Do not leave `buddy`'s PostToolUse hook active beside it in Codex**: both emit the same advisories. For new users: install `cs-hint-codex` and not `buddy` (README). On this machine `buddy` is installed too, with that one hook switched off (runtime ledger: `codescout box runtime find "Codex on this machine"`). Claude Code keeps `buddy`; do not install `cs-hint-codex` there.
- Fails silent (no output, exit 0). `CS_HINT_ENABLED=false` disables it. State: `$PLUGIN_DATA/<session>/cs_tool_log.jsonl`.

## Version Management

**Single source of truth**: each plugin's `.claude-plugin/plugin.json` is the canonical version. **marketplace.json must NOT contain version fields**: Claude Code reads the version from plugin.json at install time, and a copy drifts.

### When bumping a plugin version

**One command runs the whole dance:**

```bash
./scripts/release.sh <plugin> [patch|minor|major|X.Y.Z]   # default: patch
#   ./scripts/release.sh buddy patch                 → bumps 0.7.21 → 0.7.22
#   ./scripts/release.sh codescout-companion 1.12.0  → explicit version
```

Each step is gated and aborts on the first failure. **The `release.sh` header is the authoritative step-by-step**, with the toggles (`NO_PUSH=1` dry-runs a release, `SKIP_TESTS=1`) and the sanity loop: read and edit it there, not here.

**Two steps the script CANNOT do — you must do them after it finishes:**

1. **Refresh the codescout `version-bump-checklist` tracker** (needs the MCP tool, not bash),
   then verify every row is ✅ — any ❌ is real drift:
   ```
   doc(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)   # update params + body for the new version
   doc(action="get",    id="cc8cb9e23ab5cc67", full=true)
   ```
   It is the richer cross-check of the sanity loop's two failure classes: a missing cache dir and cross-profile `installPath` drift.
   Design: `docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

2. **Cold-restart all four Claude Code instances — a `resume` is NOT enough.** CC resolves
   hook commands + `installPath` at process launch and caches them; re-attaching with
   `source=resume` reuses the *old* in-memory hook even after the records point at the new
   version, so the bumped code never runs. Fully quit + relaunch, or run `/reload-plugins`.
   Confirm via the SessionStart payload: a true cold start reports `source=startup`, a
   re-attach reports `source=resume`. (This is the trap behind "I bumped + restarted but the
   fix still isn't live.")

**Never bump a version inline in a feature commit — use `release.sh`.** `check-versions.sh` never reads an install record, and `check-profile-parity.sh` runs only *inside* `release.sh`, so a hand bump can strand a profile with every gate green. `scripts/pre-push-guard.sh` blocks a pushed version change while parity fails; install it once per clone with `./scripts/install-hooks.sh`. The incident and the guard detail are in memory `development-commands`.

## Development

**First thing in a fresh clone — install the local git hooks:**

```bash
./scripts/install-hooks.sh
```

Git hooks live in `.git/hooks/` and are never cloned or synced, so this is opt-in per
clone. It installs a `pre-push` shim carrying two guards: force-push protection on `main`,
and version-bump parity (a bump that skipped `release.sh` cannot reach `main` while the
profiles disagree about it). `./tests/run-all.sh` prints a notice when they are
missing — a guard that is not installed is otherwise indistinguishable from a guard
finding nothing wrong.

- Hooks use `jq` for JSON parsing — required dependency
- Hook scripts use `${CLAUDE_PLUGIN_ROOT}` to reference files within the plugin install directory
- Test hooks locally: `echo '{"cwd":"/some/path"}' | node codescout-companion/hooks/session-start.mjs`

## Testing

Run before any version bump:

```bash
./tests/run-all.sh
cd buddy && pytest
```

**Write tests when you find issues.** If a design review, code review, or debugging session
reveals a bug or edge case — write a test for it before or alongside the fix. Don't rely on
manual verification for behavior that can be captured as an automated test.

**Test isolation: always clean up mutated state.** Each test that writes config, files, or
env vars must remove them before the next test runs — otherwise subsequent tests run in a
corrupted environment and produce false results. The pattern is: write config → test →
remove config. If test N establishes this pattern, make sure test N+1 doesn't silently
inherit leftover state.

## File on notice

File at once what you notice and will not fix in this session. A note in your reply is lost when the session ends.

- **A bug** goes in the bugs box. Search first: `codescout box bugs find "<words>"`. Then `codescout box bugs add --title "…"`. The box readme holds the entry rules.
- **A friction** (a hook, deny message, skill or mod that costs an agent calls, work or trust) goes in the frictions box: `codescout box frictions add`.
- **A migration lesson** (moving a tracker or a query to a box cost you a step, a citation or a surprise, or a move worked and is worth repeating) goes in the `box-migration` stream: `codescout box box-migration add --kind friction|win|residual --title "…"`. List first with `codescout box box-migration list`. Filing it is part of the move, not a later chore.
- Not here: a typo (the commit message is enough), a feature idea, a dislike.

## Git Workflow

Commit your own finished work at once; do not ask. Several sessions share this checkout, so staged or uncommitted work is swept into a peer's commit: `git add` explicit paths, never `-A`. Push only when asked. `release.sh` pushes at its last step, so run it with `NO_PUSH=1` unless the operator asked for the push.

Write trackers, issues, memories, prompts and every other text of this repository in English, whatever language the conversation uses.

## Skill layout — core in `SKILL.md`, harness specifics in `references/`

A skill whose mechanics differ by harness or operating system keeps the shared rules in `SKILL.md` and each measured pair in `references/<harness>-<os>.md`. Add a pair file only after you measure that pair. Detail: memory `conventions`.

## Session Passover

Hand a live work thread to a fresh session. Manual and selective: write one only when a session is worth resuming. The author, resume and consume steps are in memory `session-passover`; the skeleton is `docs/templates/passover-template.md`.

**Discover (incoming session):** run, early in the session —

    doc(action="find", kind="tracker",
        filter={"and":[{"tags":{"contains":"passover"}}, {"status":{"eq":"active"}}]})

**`contains`, not `in` — `in` on a tag array silently matches nothing.** A zero result needs a positive control before you trust it (memory `session-passover`).

## Plugin Install Path (directory-source gotcha)

Hooks and skills reach a session by different channels (measured 2026-09-01; the record is memory `plugin-load-channels`):

| what | resolves via | freshness |
|---|---|---|
| hooks | `CLAUDE_PLUGIN_ROOT` → repo working tree | edit is live immediately |
| skills / commands | `installPath` → versioned cache dir | needs a release + restart |

A skill or command edit is committed, not live, until `release.sh` seeds a new cache and repoints the install records. After you add a component type or bump a version, point `installPath` and `version` in `<profile>/plugins/installed_plugins.json` at the new cache entry, then restart Claude Code.

## Installing

The install commands are in `README.md`. The marketplace key is `sdd-misc-plugins`; `@claude-plugins` fails with "not found in marketplace" (verified 2026-11-09 on a clean profile).

For project-level setup, add to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "sdd-misc-plugins": {
      "source": { "source": "github", "repo": "mareurs/claude-plugins" }
    }
  },
  "enabledPlugins": {
    "codescout-companion@sdd-misc-plugins": true
  }
}
```
