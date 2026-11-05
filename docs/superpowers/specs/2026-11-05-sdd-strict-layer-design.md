---
kind: spec
status: active
title: 'sdd 3.0 — a strict-SDD layer over superpowers and codescout; general pieces move to codescout-companion'
tags:
- sdd
- codescout-companion
- superpowers
- release-pipeline
- design
topic: sdd strict layer refactor
---

# sdd 3.0 — a strict-SDD layer over superpowers and codescout

## Intent

The maintainer's stack is codescout (MCP server) + codescout-companion + buddy +
superpowers + sdd. It should work as one complete stack for new projects started
from zero.

Today `sdd` (2.4.2) does not fit that stack:

- Its hooks have no effect in Claude Code (wrong output shape, see § Current state).
- Its workflow duplicates superpowers. 8 of the 10 phases of `sdd-flow` only call a
  superpowers skill (`sdd/skills/sdd-flow/SKILL.md:757-765`).
- It keeps specs in `memory/specs/`, which the codescout catalog does not classify,
  and it carries its own constitution in prose that nothing reads.
- It is installed in no profile and tested by one 14-case suite.

The goal: `sdd` becomes a thin, opt-in layer for people who want **strict** SDD.
Everything that is useful without strict SDD moves to `codescout-companion`, so
every project with superpowers + codescout gets it. `sdd` reaches the same test and
quality bar as the other plugins in this repo, and it is installed in
`~/.claude-kat` only.

## Goals

1. `sdd` hooks emit output Claude Code accepts, and they fire on the codescout write
   and shell tools as well as the native ones.
2. One place for specs and plans: superpowers' `docs/superpowers/specs/` and
   `docs/superpowers/plans/`. `sdd` adds a persisted status to them.
3. A spec ↔ code drift check, usable without `sdd`, lives in companion.
4. The SDD constitution becomes codescout constitution rules, so companion's
   existing constitution hooks deliver it.
5. Tests and CI for `sdd` at the bar of companion (§ Test and CI bar).
6. `release.sh sdd` changes only the profiles where `sdd` is installed.

## Non-goals

- No change to superpowers. Its `AGENTS.md:40,48` puts dependencies on external
  tools and workflow-specific behaviour outside core.
- No migration path. No project uses the `memory/` layout today: the plugin is
  enabled nowhere, and `backend-kotlin` has no `memory/` directory.
- No install in `~/.claude`, `~/.claude-sdd`, `~/.claude-stef`. Their old
  user-level `commands/sdd-init.md` copies stay as they are.
- No Codex-native hook registration for `sdd` (companion's own is still pending,
  `codescout-companion/docs/session-context.md`). Hooks stay portable so it can
  come later.
- No commit of plans before worktree creation as a general companion feature. Only
  the strict flow does it (§ sdd-flow).

## Anti-goals

- A strict project must never be able to write source code through a codescout
  tool when a native write to the same file would be denied.
- `sdd` must never fail closed on its own error. Every hook exits 0; denial goes
  only through `permissionDecision`.
- Companion must not gain workflow state that only strict users need (spec status
  gates, review markers).

## Current state (verified 2026-11-05)

| Area | Fact | Evidence |
|---|---|---|
| Hook output | `session-start.mjs:25`, `subagent-inject.mjs:75` emit `hookSpecificOutput` without `hookEventName`. Claude Code rejects that shape. | companion `f830803`: 211 rejections, 2026-10-03..10-24 |
| Hook output | `spec-guard.mjs:27`, `review-guard.mjs:26` emit a top-level `permissionDecision`; review-guard uses `message`, which is not an output field. | companion contract: `codescout-companion/hooks/lib.mjs:31-48` |
| Tests | `tests/test-sdd-hooks.sh:49,52,64` assert the wrong shape. 14 pass. | run 2026-11-05 |
| Matchers | `Write\|Edit` and `Bash` only (`sdd/hooks/hooks.json`). `mcp__codescout__edit_file`/`edit_code`/`create_file`/`run_command` bypass both guards. | — |
| Review marker | `os.tmpdir()/.sdd-reviewed-<md5(dir)>` (`sdd/hooks/lib.mjs:84-87`); nothing deletes it. | grep: no unlink in `sdd/` |
| Project root | `projectDir` uses the raw payload cwd (`sdd/hooks/lib.mjs:26-28`). Companion replaced that with `resolveProjectRoot` on 2026-08-31. | — |
| `/drift` | Reads `docs/specs/` and uses Serena (`sdd/commands/drift.md:10,21,69`); the rest of `sdd` uses `memory/specs/`. | — |
| Dead content | `bootstrap-sdd.sh` copies `sdd/.claude/commands/*.md`, which does not exist, under `set -e`. `agents/sdd-ecosystem-architect.md` refers to `/ralph-sdd` and `COMPONENT_REGISTRY.md`. `ecosystem/templates/base/skills/sdd-flow/SKILL.md` is a stale 564-line copy. `memory/constitution.md` is read by nothing. | `ls sdd` |
| Catalog | `status:` in a spec's frontmatter reaches the codescout catalog. | `2026-10-17-effort-toggle-design.md` → `doc(find)` shows `draft` |
| Catalog | The classifier maps `**/docs/superpowers/specs/*.md` → `spec`, `**/docs/superpowers/plans/*.md` → `plan`; it has no rule for `memory/specs/`. | codescout `classify.rs:144-172` |
| Constitution | Companion's `constitution-guard.mjs:30` and `constitution-brief` call bare `codescout` from PATH. On this machine `codescout` is only in `~/.cargo/bin`, which is on no `claude` process PATH, so both hooks exit silently. `detect.mjs:230` already resolves `CS_BINARY`. | `/proc/<pid>/environ` of live `claude` processes |
| superpowers | No persisted spec/plan status, no feature registry, no post-merge drift check; the SDD workspace is deleted at finish ("the git history is the record now"). | superpowers 7.0.2 `subagent-driven-development/references/final-review.md:44-46` |
| Release | `bump-cache.sh:42-50` seeds every profile; `release.sh:99-107` auto-creates the install record in every profile; parity then passes. | tracker `roster-audit-session-log` F-15 |

## Approaches

**A. Thin strict layer over superpowers' artifacts; general pieces move to
companion. — chosen by the maintainer, 2026-11-05.**
`sdd` keeps only what strict SDD needs: status gates on specs and plans, the write
and commit guards, the constitutional review, `sdd-init`. Drift and the
constitution delivery live in companion. Trade-off: `sdd` depends at runtime on
companion and superpowers (both are installed in `~/.claude-kat`), and shared hook
helpers are copied, not imported (§ Shared code).

**B. Keep `sdd`'s own `memory/` layout; fix only the bugs.** Less work, but specs
stay in two places, the catalog does not see `sdd` specs, and `sdd-flow` keeps its
798 lines of duplication. Rejected: it does not reach the quality bar asked for.

**C. Fold everything into companion behind a `strict` flag; delete `sdd`.**
Contradicts the requirement that `sdd` stays for people who want strict SDD, and
puts strict-only workflow state into companion. Rejected.

## Design

### Boundary

| Piece | Owner | Why there |
|---|---|---|
| Brainstorm → spec → plan → execute → finish | superpowers | Already owns it; `sdd` only adds gates around it |
| Spec ↔ code drift check (`spec-drift` skill) | companion | Useful to any superpowers + codescout project; needs codescout tools |
| Constitution delivery (rules → hooks) | companion + codescout | Already exists; only the binary lookup is broken |
| Persisted spec/plan status and its gates | sdd | Strict-only workflow state |
| Write guard (no source write without an approved spec) | sdd | Strict-only |
| Commit guard (no commit without a constitutional review) | sdd | Strict-only |
| `sdd-init` (config + constitution rules) | sdd | Strict-only setup |

Change scenario this boundary absorbs: a project that is not strict gets drift and
constitution rules from companion alone; turning strict on is installing `sdd` and
running `sdd-init`. A change to the strict rules (a new gate, a new status) touches
`sdd` only.

### Artifacts in a strict project

- **Spec:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, written by
  `superpowers:brainstorming`. `sdd` adds to its frontmatter:
  `kind: spec`, `status: draft | approved | implemented | superseded`,
  `feature: <slug>`, and on approval `approved: YYYY-MM-DD`. Only the user's
  `/sdd:approve` writes `status: approved` / `approved:` (§ Approval channel).
- **Plan:** `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, written by
  `superpowers:writing-plans`, which already carries a `**Spec:**` pointer. `sdd`
  adds `kind: plan`, `status: draft | approved | done`, `feature: <slug>`, and
  `branch: <name>` once the feature branch exists. A plan is **active** when it is
  `approved` and its `**Spec:**` pointer names an `approved` spec.
- **Feature registry:** none as a file. The registry is the catalog query
  `doc(action="find", kind="spec", filter={"tags":{"contains":"sdd"}})`; `sdd` tags
  its specs `sdd`. (Builder's call; see § Calls made.)
- **Config:** `.sdd/config.json`, e.g. `{"enforcement": "strict"}`. Its presence
  marks the project as an SDD project for every `sdd` hook. JSON, so hooks parse it
  without a YAML reader.
- **Constitution:** codescout constitution rules (an active `kind=tracker`
  artifact tagged `constitution`, `entry_collection="rules"`, rows `C-N`), written
  by `sdd-init` from `sdd/templates/constitution/{base,kotlin,python}.md`. Articles
  I–VI become global rules (no `paths`); stack articles VII–VIII may carry `paths`.

### sdd hooks

All hooks: Node, exit 0 always, output through helpers copied from companion
(`denyPreToolUse`, `contextPreToolUse`, a SessionStart/SubagentStart/UserPromptSubmit
context helper that sets `hookEventName`), tool name and path through copied
`normalizedToolName` / `inputPath` / `isWriteOperation`. No hook acts when
`.sdd/config.json` is absent.

**Project root resolves to the main checkout.** From the payload cwd, find the
nearest `.git`; if it is a file (a linked worktree), follow `gitdir:` and that
directory's `commondir` to the main repository and use its working tree. Read the
files, do not spawn `git`. So `.sdd/config.json`, specs and plans are read from the
main checkout even while execution runs in `.worktrees/<branch>`, and the review
record is keyed the same way from both. This helper is `sdd`'s own (companion's
`resolveProjectRoot` stops at the worktree), so it is outside the byte-identical
copy test.

- **spec-guard** (PreToolUse). Matchers: `Write|Edit|MultiEdit|NotebookEdit` and
  `mcp__codescout__(edit_file|edit_code|create_file)`.
  - Exempt targets: anything under `docs/`, `.sdd/`, `.claude/`, `.codescout/`, and
    `*.md`, `*.json`, `*.yaml`, `*.yml`, `*.toml`, `*.ini`, `*.env` (the current
    exemption list, `sdd/hooks/spec-guard.mjs:19`, plus the new directories).
  - **Per feature.** A write to any other path needs an **active** plan. If the
    current branch (read from the worktree's `HEAD` file) equals some plan's
    `branch:`, that plan must be active; otherwise any active plan suffices. After
    finish (`done`), the next source write needs a new approved spec and plan.
  - **Approval fields are user-only.** Any write by a tool to a spec or plan that
    adds or changes `status: approved`, `status: implemented`, `status: done` or
    `approved:` is denied, in every mode, with a pointer to `/sdd:approve`. Same for
    writes under the approval-record directory, except the `review` command's
    `<feature>.report.json`.
  - Strict → deny with the reason; warn → context.
- **review-guard** (PreToolUse). Matchers: `Bash` and `mcp__codescout__run_command`.
  **Gates integration into the base branch only.** It parses the command (handles
  `git -C <dir>`, `git -c k=v`, chained commands; ignores text inside quotes) and
  acts on:
  - `git commit` while the current branch is the base branch
    (`baseBranch` in config, default `main`, then `master`);
  - `git merge` while on the base branch; `git push` whose target is the base
    branch;
  - `gh pr create` and `gh pr merge`.
  Each needs a review approval record for the feature: the plan whose `branch:` is
  the source branch, or, for a direct commit on the base branch, the single active
  plan (more than one active plan → deny and ask which). Commits on a feature
  branch, including superpowers' per-task commits, pass. It also denies a command
  that runs `mark-reviewed` or writes the approval-record directory.
- **approve-intake** (UserPromptSubmit) — the approval channel, § Approval channel.
- **session-start** (SessionStart, sync, matcher `startup|resume|clear|compact`).
  One short banner: enforcement mode, active feature(s), the next gate.
- **subagent-inject** (SubagentStart). `general-purpose`, `Plan` and `claude`
  agents get the active plan and spec paths (for the current branch, else all
  active ones) and "stay inside the spec". Tool-routing text is dropped: companion's
  `subagent-guidance` owns it.
- `hooks.json`: `"node \"${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.mjs\""` (quoted, single
  string, per `tests/test-all-plugins-hooks-json-portable.sh`).

**Known limit (maintainer accepted, 2026-11-05):** writes through a shell command
(`sed -i`, `>`, `tee`, via `Bash` or `run_command`) are not detected by spec-guard,
and a deliberate shell write can forge an approval record. The guards stop edits
through edit tools and self-unblocking through `mark-reviewed`; they are not a
sandbox. Companion's guards have the same limit.

### Approval channel

Approval must come from the user, not from the agent (maintainer decision,
2026-11-05). A UserPromptSubmit hook fires only on text the user submits, so the
model cannot trigger it.

- The user types `/sdd:approve spec <feature>`, `/sdd:approve plan <feature>` or
  `/sdd:approve review <feature>`.
- `approve-intake` recognises the prompt, and itself:
  - for `spec`/`plan`: sets `status: approved` and `approved: <date>` in the
    file's frontmatter (refuses if the spec is missing, or if the plan's `Spec:`
    is not approved);
  - for `review`: writes the review approval record for the feature (refuses
    unless `<approvals>/<feature>.report.json`, written by the `review` command,
    has `outcome: go` and `drift_outcome: go`);
  - injects a one-line confirmation as context. It makes no codescout call; the
    `sdd-flow` guide records a `doc` event on the spec after each approval.
- Records live under `<main repo>/.git/sdd/approvals/` (not in the tree, not
  committed): `<feature>.review.json` with date, session id and HEAD commit.
- `commands/approve.md` exists so the command shows in the slash menu and
  explains itself; its frontmatter sets `disable-model-invocation: true`. The
  command body does no writing: the hook does.
- Finish: `/sdd:approve done <feature>` sets spec `implemented`, plan `done`.

To verify first (plan task 1): that UserPromptSubmit receives the typed
`/sdd:approve …` text in Claude Code, and that `disable-model-invocation` applies
to plugin commands. If either fails, the fallback is a plain-text trigger
(`sdd approve spec <feature>`) recognised by the same hook.

### sdd skills and commands

**Enforcement comes from the hooks, not from skill order.** superpowers'
brainstorming ends with "invoke superpowers:writing-plans and no other skill"
(`skills/brainstorming/SKILL.md:281-282`), so an `sdd` skill cannot sit between
its steps. The gates still hold: brainstorming already stops for the user's
approval of the design doc, which is where the user types `/sdd:approve spec`,
and spec-guard denies source writes until `/sdd:approve plan`. `sdd-init` adds a
CLAUDE.md section naming the strict flow; superpowers gives instruction files
precedence over skills (`using-superpowers/SKILL.md:63-65`).

- **`sdd-flow` skill**, rewritten as a guide to that flow. Target under 20 KB,
  core in `SKILL.md`, detail in `references/` (repo rule § Skill layout). Steps:
  1. Resume: find the feature's spec and plan through the catalog.
  2. Design: call `superpowers:brainstorming`.
  3. Gate 1: ask the user to type `/sdd:approve spec <feature>`.
  4. Plan: call `superpowers:writing-plans`.
  5. Gate 2: ask the user to type `/sdd:approve plan <feature>`; commit spec and
     plan before any worktree (superpowers' worktree starts from HEAD and would
     not contain them); record `branch:` in the plan.
  6. Execute: `superpowers:subagent-driven-development` or `executing-plans`.
  7. Drift: companion's `spec-drift` skill; a Missing or Divergent criterion stops
     the flow until code or spec changes.
  8. Review: the `review` command below; on GO, ask the user to type
     `/sdd:approve review <feature>`.
  9. Finish: `superpowers:finishing-a-development-branch` (its merge or PR is
     what review-guard gates); then ask for `/sdd:approve done <feature>`, and add
     a `doc` event on the spec that records the merge commit or PR.
- **Commands:** `sdd-init`, `review`, `approve` (new, user-only, see § Approval
  channel). Each under 4 KB and without
  `$ARGUMENTS`, so Codex can convert it (`tests/test-codex-convertible-commands.sh`).
  - `review`: checks each constitution rule (read through `codescout
    constitution-check` or `doc`) and the latest `spec-drift` result for the
    feature, and writes a GO / NO-GO report for the feature. It does not write the
    approval record; `hooks/mark-reviewed.mjs` is deleted.
  - `sdd-init`: writes `.sdd/config.json`, the constitution rules, an optional
    CLAUDE.md section; never commits.
- **Deleted:** commands `specify`, `plan`, `drift`, `document`, `bootstrap-docs`;
  `agents/sdd-ecosystem-architect.md`; `bootstrap-sdd.sh`; `memory/`;
  `ecosystem/templates/base/skills/`; `ecosystem/templates/base/sdd-config.md.template`.
  Constitution templates move to `sdd/templates/constitution/`.

### companion additions

1. **`spec-drift` skill** (`codescout-companion/skills/spec-drift/`). Input: a spec
   (catalog id, path, or feature slug). It extracts the acceptance criteria and
   checks each one against code with codescout tools (`symbols`, `references`,
   `grep`, `semantic_search`). Output: Implemented / Missing / Divergent per
   criterion, with `file:line`. It records the result as a `verdict` event on the
   spec (`doc(action="event_create")`), so a later `review` can read it. Harness
   detail, if any, in `references/`.
2. **Binary lookup for the constitution hooks.** `constitution-guard.mjs` and
   `constitution-brief.mjs` use `detect()`'s `CS_BINARY` (falls back to PATH), the
   way `session-start.mjs:259-277` does. Filed first as a companion bug with a
   failing test.

### Release pipeline (F-15)

`bump-cache.sh` and `release.sh` steps 4–6 skip a profile whose
`installed_plugins.json` has no `<plugin>@<marketplace>` key, and print the skip.
`check-profile-parity.sh` is unchanged. First install in `~/.claude-kat` is a
manual `/plugin install sdd@sdd-misc-plugins` there; every later release touches
that profile only.

### Shared code

No plugin imports another plugin's file: caches are seeded per plugin
(`scripts/bump-cache.sh:43`), so a relative path into a sibling breaks in the cache
layout. `sdd/hooks/lib.mjs` copies the helpers it needs from
`codescout-companion/hooks/lib.mjs`, minus anything that imports `detect.mjs`. A
test asserts the copied functions stay byte-identical to companion's, so drift is
loud.

## Test and CI bar

- Colocated `sdd/hooks/*.test.mjs` (`node --test`); `tests/run-all.sh` discovers
  `sdd/hooks/*.test.mjs`. `tests/test-sdd-hooks.sh` is replaced, not kept.
- Every hook: exact output shape (`hookEventName`, nesting, `permissionDecisionReason`),
  malformed stdin → exit 0 and no output, no `.sdd/config.json` → no output.
- spec-guard: each matcher (native and codescout), each exemption, no active
  plan vs an active plan, branch-matched plan inactive vs active, warn vs strict,
  and a tool write that sets `status: approved` (denied in every mode).
- review-guard: on a feature branch `git commit` passes; on the base branch
  `git commit`, `git -C x commit`, `git -c a=b commit`, chained commands, `git merge`,
  `git push origin main`, `gh pr create`, `gh pr merge` need the record; quoted
  text must not match; a command running `mark-reviewed` or writing
  `.git/sdd/approvals/` is denied.
- approve-intake: each `/sdd:approve` form writes exactly its fields or record;
  refusals (missing spec, plan whose spec is not approved, review without a GO);
  any other prompt is a no-op.
- Root resolution: a hook run from a linked worktree reads `.sdd/config.json` and
  specs from the main checkout (fixture with `git worktree add`).
- Mutation check on the guards: remove the codescout matcher → a test fails;
  accept a missing approval record → a test fails; let a tool write
  `status: approved` → a test fails.
- `test-cross-platform-hooks.sh` runs one `sdd` hook per OS in the CI matrix.
- `tests/lib/skill_call_legality.py` also scans `sdd/` and the new `spec-drift`
  skill for `doc(...)` calls.
- Release: a three-profile fixture where the plugin is installed in one profile;
  the other two records and caches stay byte-identical (F-15).
- companion: a failing test first for the constitution binary lookup (PATH without
  `codescout`, `CS_BINARY` set) and tests for `spec-drift` per the skill test
  conventions.

## Delivery order

1. F-15 release fix + test (unblocks a kat-only release; also fixes `statusline`).
2. companion: constitution binary lookup (bug + test + fix); `spec-drift` skill;
   companion release.
3. sdd: `lib.mjs` + hooks + tests; skill and commands; templates; README; CI.
4. `release.sh sdd major` → 3.0.0; manual install in `~/.claude-kat`; smoke on a new
   scratch project from zero (init → spec → approve → plan → write → commit).

## Calls made (builder's, for the maintainer to check)

- No `FEATURES.md`: the catalog query is the registry.
- Config in `.sdd/config.json`, not `memory/sdd-config.md`.
- Project root resolves to the main checkout through the git common dir, so
  enforcement holds inside worktrees.
- Shell writes stay outside spec-guard (documented limit).
- Approval records in `.git/sdd/approvals/`, outside the tree.
- `session-start` becomes sync, so the banner arrives before the first prompt.
- Major version (3.0.0): the on-disk layout changes.

## Open questions

Answered by the maintainer, 2026-11-05, after the builder check:

1. **Which commits does review-guard block?** Integration into the base branch
   only (commit on base, merge into base, push to base, `gh pr create|merge`).
   Feature-branch commits pass.
2. **Must the gates hold against the agent?** Yes: only the user approves
   (§ Approval channel).
3. **What does a source write depend on?** An active plan, per feature, with the
   config-file exemptions kept (§ sdd hooks).

None open.

## Left to the builder

- Exact wording of hook messages and the session banner.
- How `spec-drift` extracts criteria from a spec that has no "Acceptance criteria"
  heading (brainstorming's design docs do not require one).
- Test file split inside `sdd/hooks/`.
