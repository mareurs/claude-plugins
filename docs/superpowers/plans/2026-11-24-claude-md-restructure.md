# CLAUDE.md Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut `CLAUDE.md` from 36 KB to about 10 KB, with one owner per fact, and make `AGENTS.md` and `.codescout/system-prompt.md` pointers.

**Architecture:** Move each section to the surface its reader loads on the right trigger: codescout memory topics for facts and measurements, `CLAUDE.md` for rules and a pointer table. A new bash test fails when a `CLAUDE.md §` citation names no heading.

**Tech Stack:** markdown, bash tests (`tests/test-*.sh`), codescout `memory` tool.

**Spec:** `docs/superpowers/specs/2026-11-24-claude-md-restructure-design.md`

**Deviation from the spec:** the Session Passover procedure goes to memory topic `session-passover`, not to `docs/templates/passover-template.md`. The template is a skeleton that every passover copies, and `tests/test-passover-template.sh` pins its sections.

## Global Constraints

- Target size of `CLAUDE.md`: about 10 KB (an estimate; measure after the last task).
- No new surface, mode, box or skill. No change to hook, skill or script behaviour.
- Never run `onboarding(action="refresh_prompt")` (`RM-26`). Edit `.codescout/system-prompt.md` by hand.
- `gotchas` is a protected memory. If a write to it is refused, stop and report. Do not edit the file with `edit_file`.
- Move text verbatim. Trim only text that the destination already holds.
- Agent-facing text states the current situation only: no "moved", "was removed" or "formerly" in `CLAUDE.md`, `AGENTS.md` or `system-prompt.md`.
- Keep these `CLAUDE.md` headings, because other files cite them: `buddy`, `Plugin Install Path (directory-source gotcha)`, `Session Passover`, `Version Management`, `When bumping a plugin version`, `Testing`.
- Write all text in English. Commit after each task with explicit `git add <paths>` (never `-A`), end the message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push.
- No release: this plan edits no skill or command.

## Review Focus

- A citation in quoted form (`§ "When bumping a plugin version"`) or italic form (`§ *Session Passover*`) must still resolve. Pinned in Task 1.
- `tests/test-passover-template.sh` needs the discovery query `{"tags":{"contains":"passover"}}` and the path `docs/templates/passover-template.md` in `CLAUDE.md`. Pinned in Task 5.
- A moved fact must exist once: found in its new owner, absent from `CLAUDE.md`. Pinned by the phrase checks in Tasks 2 to 6 and 8.
- A pointer that names a memory topic that does not exist. Pinned in Task 8.
- `AGENTS.md` is read by Codex: the pointer is a plain path, with no import syntax. Pinned in Task 7.

---

### Task 1: Citation guard

**Files:**
- Create: `tests/test-claude-md-citations.sh`
- Modify: `codescout-companion/hooks/pre-edit-dirty-check.test.sh:127`

**Interfaces:**
- Produces: a test that `tests/run-all.sh` runs by glob. Later tasks keep it green.

- [ ] **Step 1: Write the test.** Follow the `ok`/`bad`/exit convention of `tests/test-passover-template.sh`. Scan these live paths for citations: `scripts`, `tests` (except this file), `.github`, `AGENTS.md`, `buddy/CLAUDE.md`, `buddy/scripts`, `buddy/pyproject.toml`, `codescout-companion/hooks`, `.codescout/memories`, `.codescout/system-prompt.md`, `docs/templates`. History (`docs/trackers`, `docs/issues`, `docs/superpowers`) stays out of scope.
  - A citation is `CLAUDE.md`, up to 12 characters that are not `§`, then `§`, then an optional run of spaces, `"`, `*` and `_`. The cited name is the following run of `[A-Za-z0-9 -]`, trimmed.
  - A citation resolves when some heading of the root `CLAUDE.md`, lowercased with markup stripped, contains the cited name, or the cited name begins with that heading's text.
  - Test names: `every CLAUDE.md § citation resolves`, and `control: a citation to a missing heading fails` (run the checker on a temp file that holds `CLAUDE.md § No Such Heading` and expect failure).
  - If `buddy/CLAUDE.md:60` cites buddy's own `CLAUDE.md`, exclude that file and say so in the test header.
- [ ] **Step 2: Run it and see it fail.** Run: `bash tests/test-claude-md-citations.sh`. Expected: FAIL on exactly one citation, `Testing Discipline`.
- [ ] **Step 3: Fix the dead citation.** In `codescout-companion/hooks/pre-edit-dirty-check.test.sh:127` drop the `CLAUDE.md § Testing Discipline:` prefix and keep the sentence. No heading of `CLAUDE.md` states that claim.
- [ ] **Step 4: Run it and see it pass.** Run: `bash tests/test-claude-md-citations.sh && bash tests/test-pre-edit-dirty-check.sh`. Expected: both exit 0.
- [ ] **Step 5: Commit** `tests/test-claude-md-citations.sh` and the edited hook test: `test(docs): a CLAUDE.md § citation must name a heading`.

### Task 2: Machine facts to memory

**Files:**
- Create (memory): `machine-linux`, `machine-windows`
- Modify: `CLAUDE.md`

**Interfaces:**
- Produces: a `## Where things live` table in `CLAUDE.md`, placed after `## Structure`, with columns `Need | Read`. Tasks 3 to 6 add rows. Rows read like `| Release, profile or Codex work on this machine | memory topic `machine-linux` |`.

- [ ] **Step 1: Read the three sections** by heading: `This Machine — Linux workstation`, `Codex on this machine`, `The Windows work box`.
- [ ] **Step 2: Write the topics** with `memory(action="write", topic=…)`. `machine-linux` holds the first two sections verbatim. `machine-windows` holds the third, including its scope note.
- [ ] **Step 3: Edit `CLAUDE.md`.** Delete the three sections. Add the `## Where things live` table with two rows: `machine-linux`, and `machine-windows` (marked as another host).
- [ ] **Step 4: Verify.** Run: `grep -c "Arch zen kernel\|execvpe failed" CLAUDE.md` (expect 0), `grep -l "Arch zen kernel" .codescout/memories/machine-linux.md`, `grep -l "execvpe failed" .codescout/memories/machine-windows.md`, `bash tests/test-claude-md-citations.sh`.
- [ ] **Step 5: Commit** `CLAUDE.md` and the two memory files (and any `.anchors.toml` the write changed): `docs(claude-md): machine facts live in two memory topics`.

### Task 3: Plugin load channels to memory

**Files:**
- Create (memory): `plugin-load-channels`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Move the section.** Write the whole `Plugin Install Path (directory-source gotcha)` section into the topic, verbatim.
- [ ] **Step 2: Rewrite the `CLAUDE.md` section** under the same heading: the two-row table (hooks: working tree, live at once; skills and commands: versioned cache, live only after `release.sh`), one sentence that a skill edit is committed, not live, until a release, and a `Where things live` row for the topic.
- [ ] **Step 3: Verify.** `grep -c "least representative observer" CLAUDE.md` is 0, and the memory file holds it. `bash tests/test-claude-md-citations.sh` passes.
- [ ] **Step 4: Commit** the same kind of paths: `docs(claude-md): the load-channel detail lives in memory`.

### Task 4: Plugin sections

**Files:**
- Modify: `CLAUDE.md`, memories `agent-dispatch-hooks` and `gotchas`, `.github/workflows/cross-platform-hooks.yml:38`
- Check: `buddy/scripts/hook_entry.py:51`, `buddy/pyproject.toml:4`

- [ ] **Step 1: codescout-companion.** Add the SubagentStart bullet (3.4 KB pointer, the 10 KB cut measurement) and the SessionStart system-prompt parenthetical to `agent-dispatch-hooks` as one section. Skip any text that memory already holds (`grep "3.4 KB"` first). `CLAUDE.md` keeps about four lines and the cap rule: the payload size must not depend on any user file, and `tests/test-subagent-guidance.sh` pins it.
- [ ] **Step 2: buddy.** Add the "Measured 2026-09-05" CI paragraph to `gotchas` with `memory(action="add", topic="gotchas", …)`. `CLAUDE.md` keeps the dependency list (PyYAML is a hard dependency) and the `judge.env` rule. Change the comment in `cross-platform-hooks.yml:38` to `see memory gotchas (buddy CI, measured 2026-09-05)`. Read the two other cites; edit them only when they point at the moved text.
- [ ] **Step 3: cs-hint-codex.** Keep: the root stays five files, the two `scripts/` files are byte copies, stdlib only, do not run `buddy`'s PostToolUse beside it, fails silent. Cut the measurement sentences; the spec `docs/superpowers/specs/2026-11-09-cs-hint-codex-bundle-design.md` holds them and stays cited.
- [ ] **Step 4: Verify.** `grep -c "actions/setup-python" CLAUDE.md` is 0 and the memory holds it. Run `bash tests/test-cs-hint-codex.sh && bash tests/test-claude-md-citations.sh`; both pass.
- [ ] **Step 5: Commit**: `docs(claude-md): plugin detail lives in memory, rules stay`.

### Task 5: Procedures

**Files:**
- Create (memory): `session-passover`
- Modify: `CLAUDE.md`, memory `conventions`

- [ ] **Step 1: Session Passover.** Write Author, Consume and the positive-control paragraph into `session-passover`. `CLAUDE.md` keeps under `## Session Passover`: the Discover query `doc(action="find", kind="tracker", filter={"and":[{"tags":{"contains":"passover"}}, {"status":{"eq":"active"}}]})`, the one line that `in` on a tag array matches nothing, the path `docs/templates/passover-template.md`, and a `Where things live` row.
- [ ] **Step 2: Skill layout.** Add the section to `conventions`. `CLAUDE.md` keeps its heading and two lines: shared rules stay in `SKILL.md`, each measured harness and OS pair gets `references/<harness>-<os>.md`, and a pair file needs a measurement first.
- [ ] **Step 3: Verify.** Run `bash tests/test-passover-template.sh && bash tests/test-claude-md-citations.sh`. Expect both green.
- [ ] **Step 4: Commit**: `docs(claude-md): passover procedure and skill-layout detail live in memory`.

### Task 6: Version Management and Installing

**Files:**
- Modify: `CLAUDE.md`, memory `development-commands`

- [ ] **Step 1: Version Management.** Keep the `release.sh` command, the two manual steps, the cold-restart rule, the never-bump-inline rule and a pointer to the `release.sh` header. Add the 2026-08-28 incident, the pre-push guard detail and the sanity-loop description to `development-commands` (it already has a Version Bump section: merge, do not duplicate). Keep the headings `Version Management` and `When bumping a plugin version`.
- [ ] **Step 2: Installing.** Compare with `README.md` lines 12 to 21. Replace the section with a pointer when the README holds the install lines and the project-level `enabledPlugins` snippet. Otherwise keep the snippet.
- [ ] **Step 3: Verify.** `grep -c "stranded at" CLAUDE.md` is 0. Run `bash tests/test-pre-push-guard.sh && bash tests/test-claude-md-citations.sh`: both pass.
- [ ] **Step 4: Commit**: `docs(claude-md): release incident detail lives in memory`.

### Task 7: AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: List what only `AGENTS.md` holds.** `grep -n -i codex AGENTS.md`. A Codex fact that no `CLAUDE.md` or memory holds goes into the new file. A stale claim (for example "injects the project system-prompt verbatim") is dropped.
- [ ] **Step 2: Rewrite `AGENTS.md`** to about 15 lines: one line that repository rules are in `CLAUDE.md` (a plain path), then bullets for `cs-hint-codex` as the only hook to install, `buddy`'s PostToolUse hook kept off beside it, and no writes into `~/.codex/plugins/cache/`. Edit rules for `cs-hint-codex` stay in `CLAUDE.md`.
- [ ] **Step 3: Verify.** `wc -l AGENTS.md` is 25 or less. `grep -c "CLAUDE.md" AGENTS.md` is 1 or more. `grep -c "@CLAUDE.md" AGENTS.md` is 0. `bash tests/test-claude-md-citations.sh` passes.
- [ ] **Step 4: Commit**: `docs(agents): AGENTS.md is a pointer plus the Codex facts`.

### Task 8: system-prompt.md and final check

**Files:**
- Modify: `.codescout/system-prompt.md`

- [ ] **Step 1: Fix the stale hook line.** The `subagent-guidance.mjs` bullet says "injects system-prompt verbatim". Make it say the hook sends a pointer, and that a subagent reads this file by path.
- [ ] **Step 2: Cut the repeated rules.** For each of the six Project Rules, `grep` `CLAUDE.md` for its distinctive phrase (`version`, `profiles`, `working tree`, `matcher`, `exit 2`, `run-all`). A rule that `CLAUDE.md` holds becomes one pointer line to its `CLAUDE.md` heading. A rule that only this file holds stays.
- [ ] **Step 3: Check the stored hash.** Run `workspace(action="status")`. If it reports the prompt as changed or stale, quote the message and stop for the operator. Do not edit `project.toml` and do not run `refresh_prompt`.
- [ ] **Step 4: Final checks.**
  - `wc -c CLAUDE.md` is near 10 KB.
  - Every topic that `CLAUDE.md` names exists: `for t in machine-linux machine-windows plugin-load-channels session-passover; do test -f .codescout/memories/$t.md || echo MISSING $t; done` prints nothing.
  - Run `./tests/run-all.sh` with `run_in_background=true`, end the turn, and read the result at the wake. Expect all suites passed.
- [ ] **Step 5: Commit** `.codescout/system-prompt.md`: `docs(system-prompt): fix the SubagentStart line, point to CLAUDE.md for shared rules`.
