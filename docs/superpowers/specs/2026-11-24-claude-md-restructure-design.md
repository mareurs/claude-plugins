# CLAUDE.md restructure — sort by read trigger

Status: approved 2026-11-24. Size: small change (documents only, no product code).

## Intent

`CLAUDE.md` is 36 KB (478 lines, 19 sections) and a Claude Code session loads all of it. About half is machine facts, measurements and incident history that a session needs only for one kind of task. `AGENTS.md` (16 KB) and `.codescout/system-prompt.md` (4 KB) restate parts of it and have drifted. The aim: each fact lives once, in the place its reader loads on the right trigger, and the other places point to it.

## Goals

- `CLAUDE.md` holds only what a session needs before it opens anything else. Target about 10 KB (an estimate; measure after the edit).
- One owner per fact. A copy elsewhere becomes a pointer.
- Every `CLAUDE.md §` citation in the repository resolves to a heading that exists.

## Non-goals and anti-goals

- No new surface, mode or box type (IRON LAW 1: one model, one method).
- No change to hook, skill or script behaviour.
- Do not run `onboarding(action="refresh_prompt")`. It regenerates from templates and may flatten the curated file (`RM-26`, unsettled).
- Do not move a fact so deep that the session that needs it never meets a pointer to it.

## Approaches

1. **Sort by read trigger (chosen).** `CLAUDE.md` keeps rules and a pointer table. Machine facts and measurements go to codescout memory topics, which SessionStart already lists by name. Procedures go to templates or skills.
2. Boxes for facts. `**Valid:**` fits "verified on a date", but facts never close, and a box adds statuses and a hot view they do not need. Rejected: a second way to store a fact.
3. Cut only (drop Windows, shrink `AGENTS.md`). Fast, but about 25 KB of restated text stays. Rejected.

## Design

### Where each section goes

| Section (bytes) | Destination |
|---|---|
| This Machine (4.8 K) + Codex on this machine (1.6 K) | memory `machine-linux`; `CLAUDE.md` keeps one pointer line. The profile list is `PROFILES` in `scripts/lib-profiles.sh`: reference it, do not restate it. |
| The Windows work box (3.3 K) | memory `machine-windows`; one pointer line. |
| Plugin Install Path (3.1 K) | memory `plugin-load-channels`. `CLAUDE.md` keeps the two-row table (hooks: working tree, live; skills and commands: versioned cache, needs a release) and a pointer. |
| codescout-companion (3.2 K) | The SubagentStart paragraph moves into memory `agent-dispatch-hooks` (check overlap first). `CLAUDE.md` keeps a 4-line summary and the cap rule (payload size independent of any user file; `tests/test-subagent-guidance.sh` pins it). |
| buddy (2.0 K) | The CI incident goes to memory `gotchas`. `CLAUDE.md` keeps the dependency list (PyYAML is a hard dependency) and `judge.env` is authoritative. |
| cs-hint-codex (2.0 K) | Stays near whole: "the root stays five files" and "byte copies of buddy scripts" are edit-time rules. Trimmed of measurements. |
| Version Management (4.3 K) | Keep the rule (use `release.sh`, never bump inline), the two manual steps and the cold-restart rule. Point to the `release.sh` header for the step list. Incident detail goes to memory `development-commands`. |
| Session Passover (2.8 K) | The procedure moves into `docs/templates/passover-template.md`. `CLAUDE.md` keeps the discovery query, the `contains` warning and the template pointer, because `tests/test-passover-template.sh` pins them. |
| Skill layout (2.4 K) | Memory `conventions`; `CLAUDE.md` keeps the two-line rule. |
| IRON LAW, What belongs, Structure, Config Dir Resolution, Active Development Focus, Git Workflow, Testing, Development, Installing | Stay. Installing shrinks to a pointer if `README.md` carries the same lines (verify). |

### The other two surfaces

- **`AGENTS.md`** becomes about 15 lines: a pointer to `CLAUDE.md` for repository rules, plus what a Codex session needs: `cs-hint-codex` is the only hook to install, `buddy`'s PostToolUse hook must not run beside it, and nothing writes into `~/.codex/plugins/cache/`. The `cs-hint-codex` edit rules stay in `CLAUDE.md` (my call: one owner).
- **`.codescout/system-prompt.md`** is edited by hand. The SubagentStart line is fixed (it says "injects system-prompt verbatim"; the hook sends a pointer). The four Project Rules that repeat `CLAUDE.md` become one pointer line. The two rules found only here stay: the `"matcher": "Agent"` rule and the exit-code rule (my call: they describe code a subagent edits).

### Citations and a guard

- Update every `CLAUDE.md §` citation that a move breaks: `scripts/release.sh`, `buddy/scripts/hook_entry.py`, `.github/workflows/cross-platform-hooks.yml`, `scripts/lib-copy-plugin.sh`, `tests/test-copy-plugin-tree.sh`, memories `gotchas` and `development-commands`.
- Fix the dead citation "§ Testing Discipline" in `codescout-companion/hooks/pre-edit-dirty-check.test.sh`.
- Add `tests/test-claude-md-citations.sh`: each `CLAUDE.md § X` in the repository must match a heading (my call: a citation that points at nothing is how the dead one survived).

## Constraints

- Hooks read from the working tree here, but skills and commands read from the versioned cache. This work edits no skill, so no release is needed. Memory edits are live at once.
- `gotchas` is a protected memory (`project.toml [memory] protected`): the builder must check how a write behaves.
- `system_prompt_sha256` in `project.toml` may need a refresh after a hand edit. The builder measures it; it is not assumed.
- Write all text in English.

## Done when

- `wc -c CLAUDE.md` is near 10 KB and no section was dropped without a pointer.
- `./tests/run-all.sh` is green, including the new citation test.
- Each moved fact is found once, in its new owner (`grep` for a distinctive phrase of each).
- `AGENTS.md` and `system-prompt.md` carry no copy of a `CLAUDE.md` rule.

## Left to the builder

Exact memory topic text, section order inside `CLAUDE.md`, whether `Installing` shrinks, and the order of the commits (memories first, then `CLAUDE.md`, then citations and the test).
