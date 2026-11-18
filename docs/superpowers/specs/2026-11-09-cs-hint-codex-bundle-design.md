# cs-hint for Codex: a small hook bundle that needs one approval

Date: 2026-11-09. Status: first version built and measured (see Results). Codex 0.167.0.

## Problem

Codex runs a plugin hook only after the user has approved it, and the approval is bound to the plugin's content. A new user who installs `buddy` or `codescout-companion` gets 5 or 27 hooks in state `untrusted`: no hook runs and no `[cs-hint]` reaches the model. Headless runs (`codex exec`, an app-server client) show no error and no prompt. The interactive TUI asks at its next start ("Hooks need review", measured 2026-11-10, see Results). Measured 2026-11-09 on a clean `CODEX_HOME` (`codex plugin add buddy@sdd-misc-plugins`: 5 hooks `untrusted`, 0 hook runs, turn completed).

Facts this design rests on (Codex source at rust-v0.167.0 read by a subagent, plus the plugin docs; memory `research/hint-visibility-channels-20261109`):

- The content hash covers the whole plugin root: relative paths, lengths and bytes. Only `__pycache__`, `.venv`, `*.pyc` and `*.egg-info` are skipped. A README, a test or a skill inside the root invalidates every approval of that plugin when it changes. A symlink in the root is an error.
- Installing or enabling a plugin does not trust its hooks. Plugin hooks are never managed, no `plugin.json` field grants trust, and the only exemptions found are an internal builtin allowlist and the dangerous `--dangerously-bypass-hook-trust`. A plugin must not approve itself.
- A hook with no approval record is never loaded. A hook whose content changed fails right before it runs (`plugin contents changed; hook approval required`). What that failure does to the tool call was not read.

## Decision

Ship the `[cs-hint]` advisories to Codex as a separate plugin, `cs-hint-codex`, whose root holds only what the hook needs:

```
cs-hint-codex/
  .claude-plugin/plugin.json
  hooks/hooks.json          one PostToolUse entry, matcher Bash|mcp__codescout__.*
  hooks/cs_hint.py          reads the event, prints additionalContext
  scripts/cs_heuristics.py  byte copy of buddy/scripts/cs_heuristics.py
  scripts/cs_tool_log.py    byte copy of buddy/scripts/cs_tool_log.py
```

- One hook to review, not 27. The approval survives edits to docs, skills and tests, because none of them is inside the root. Only a change to the five files asks for a new approval.
- Same advisories as in Claude Code: the heuristics are the buddy modules, unchanged. Claude Code keeps `buddy`; this plugin is for Codex only and must not be installed beside `buddy` in Claude Code (the advisories would double).
- Copies, not symlinks, because the fingerprint refuses a symlink. `tests/test-cs-hint-codex.sh` fails when a copy drifts; `scripts/sync-cs-hint-codex.sh` refreshes them. A refresh changes the hash, so the Codex approval must be renewed afterwards.
- State lives outside the root, in `$PLUGIN_DATA` (Codex sets it) or `~/.cache/cs-hint-codex`: one rolling log per session, as buddy keeps one under `.buddy/<sid>/`.
- Every failure is silent (no output, exit 0), as in buddy. `CS_HINT_ENABLED=false` disables it.
- Tests, this document and the sync script live outside the root, in `tests/`, `docs/` and `scripts/`.

## Not decided here

- No automatic approval. A new user approves once with `/hooks` in Codex. An opt-in helper that lists the hook and writes the approval after a confirmation is possible but depends on the undocumented `declaration/content` form of `currentHash`.
- Hints that need no hook: the `hint` and `advice` fields the codescout server already puts in its own results reach every harness without any approval. Which advisories could move there is a separate decision.
- The heuristics are copied as they are. Their own quality is tracked in `docs/issues/` (for example the grep-for-concept heuristic) and a fix in `buddy` reaches this plugin through the sync script, not automatically.
- Not read in the Codex source: the event parsers (what a trust error does to a tool call), the MCP hook runner, and the builtin allowlist.

## Change scenarios absorbed

- A skill, test or README edit in the repository does not touch the installed root, so it cannot invalidate the approval. (On 2026-11-09 two skill files changed in the Codex cache and 22 hooks failed.)
- A fix to a heuristic in `buddy`: run the sync script, bump the version, renew the approval. One hook, one hash.
- A third harness with the same hook JSON: install the same plugin.

## Results (2026-11-09)

Instrument: a clean `CODEX_HOME` (auth.json symlink, `codex plugin marketplace add` of this repository, `codex plugin add cs-hint-codex@sdd-misc-plugins`), a `codex app-server` thread with one `head -3 src/main.rs` call in the codescout checkout, read-only sandbox. The probe lists `hooks/list` trust and records every `hook/completed` entry. The "approval" step wrote the two halves of the hook's `currentHash` (`declaration/content`) into that home's `config.toml`, standing in for the user's `/hooks` review. Scripts: `codex_fresh.py`, `approve_fresh.py` in the session scratchpad, not kept.

| Step | hooks/list | hook runs | `[cs-hint]` to the model |
|---|---|---|---|
| A: new user, no approval | 1 `untrusted` (buddy: 5, buddy and companion: 27) | 0 | no |
| B: after approval | 1 `trusted` | 1 `completed` | yes: `postToolUse` entry `context`, "Use `read_file` or `symbols` — Bash on source files bypasses codescout's LSP index." |
| C1: `codex plugin add` again, same source | 1 `trusted` | 1 `completed` | yes |
| C2: one comment line appended inside the installed root | 1 `modified` | 1 `failed`: "plugin contents changed; hook approval required" | no; the command still ran and the turn finished |

What this shows, and what it does not:
- The surface to approve shrinks from 27 hooks to 1, and the approval survived a reinstall of the same bytes. One edit inside the root cancels it, as the source says.
- A trust error on a `PostToolUse` hook did not stop the tool call here (n = 1). `PreToolUse` guard hooks were not measured; their behaviour on a trust error is not known.
- Codex expanded `${CLAUDE_PLUGIN_ROOT}` in the hook command.
- Tested later: the `mcp__codescout__.*` half of the matcher on a clean `CODEX_HOME` with `codex mcp add codescout` (2 MCP calls, 2 hook runs, one `[cs-hint]`; local-path and GitHub marketplace), and the real approval in the interactive TUI (below).
- Not tested: the Windows launcher, a second approval after a `scripts/sync-cs-hint-codex.sh` refresh, the `/hooks` command typed by hand. One earlier step-A run did not complete within 300 s with 0 hook runs; the repeat completed in 6 s and the cause was not found.
- The hint text is whatever `buddy` has at the time of the sync. At the first measurement a peer had just changed several heuristics in `buddy`; this bundle carries that newer version, while the Codex cache of `buddy` itself is still on the older one.


### Interactive TUI check (2026-11-10)

A clean `CODEX_HOME` (GitHub marketplace, `codex plugin add cs-hint-codex@sdd-misc-plugins`), Codex 0.167.0 started in a `tmux` pane (`codex --no-alt-screen`, scratch directory), screen read with `tmux capture-pane`.

- First screen at start: "Hooks need review. 1 hook is new or changed. Hooks can run outside the sandbox after you trust them." with three choices: 1 Review hooks, 2 Trust all and continue, 3 Continue without trusting (hooks won't run). So an interactive user is asked, unlike a headless run.
- "Review hooks" opens the Hooks screen, a table by event: `PostToolUse  Installed 1  Active 0  Review 1`, footer "t trust all · enter review · esc close". After `t`: `Installed 1  Active 1`.
- `config.toml` then held `[hooks.state."cs-hint-codex@sdd-misc-plugins:hooks/hooks.json:post_tool_use:0:0"]` with `trusted_hash` and `trusted_content_hash`, the same form the scripted approval wrote.
- A prompt asking for `head -3 src/main.rs`: the command ran and the answer came back. The session file holds a `developer` message `[cs-hint] Use read_file or symbols — Bash on source files bypasses codescout's LSP index.` Nothing about the hint appears on screen: the model gets it, the user does not see it.
- Not exercised: choices 2 and 3, the `/hooks` command typed by hand, other Codex versions. One run.
