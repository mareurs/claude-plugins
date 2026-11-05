---
kind: plan
status: draft
title: 'sdd 3.0 strict-SDD layer — implementation plan'
tags:
- sdd
- codescout-companion
- release-pipeline
- plan
topic: sdd strict layer refactor
---

# sdd 3.0 strict-SDD layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sdd` a thin, tested, user-gated strict-SDD layer over superpowers and codescout, move the general pieces (spec drift, constitution binary lookup) into codescout-companion, and make releases touch only profiles where a plugin is installed.

**Architecture:** Three parts, each independently testable, released in order after the branch merges: (1) release scripts skip profiles without an install record; (2) companion gets a shared codescout-binary resolver for its constitution hooks and a `spec-drift` skill; (3) `sdd` is rebuilt as Node hooks reading frontmatter status of superpowers' specs/plans, a user-only approval channel (UserPromptSubmit), and short content.

**Tech Stack:** Node ≥ 22 (ESM `.mjs`, `node:test`), bash test suites, jq, codescout 0.15 (`doc`, `constitution-check`), superpowers 7.0.2.

**Spec:** `docs/superpowers/specs/2026-11-05-sdd-strict-layer-design.md`

## Global Constraints

- Every hook exits 0 on every path; denial only via `hookSpecificOutput.permissionDecision: "deny"` with `hookEventName`.
- `hooks.json` commands are single strings: `node "${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.mjs"`.
- No plugin imports a file from another plugin; shared helpers are copied.
- Skill `SKILL.md` under 20 KB; each command file under 4 KB, no `$ARGUMENTS`, no `` !` `` exec.
- Versions change only through `./scripts/release.sh`; `sdd` goes to `3.0.0` (major), companion takes a minor bump.
- `sdd` is installed in `~/.claude-kat` only.
- Spec status values: `draft | approved | implemented | superseded`. Plan status values: `draft | approved | done`.
- Specs `docs/superpowers/specs/`, plans `docs/superpowers/plans/`, config `.sdd/config.json`, approval records `<git common dir>/sdd/approvals/`.
- Approval fields (`status: approved|implemented|done`, `approved:`) are written only by `approve-intake`.
- Each test removes the state it creates (repo rule § Test isolation).
- Code edits through codescout tools (`edit_code`, `edit_file`, `create_file`); native Edit/Write/Bash are denied in this environment.

## Review Focus

1. Payload paths with spaces or Windows backslashes (`C:\proj\src\a.ts`) — exemption and `docs/` matching must normalise separators. Test in Task 6.
2. Specs or plans saved with CRLF line endings or a UTF-8 BOM — frontmatter must still parse. Test in Task 5.
3. Two features active at once and a write from the main checkout (no branch match) — the write is allowed and subagent-inject lists both plans. Tests in Tasks 6 and 9.
4. A detached HEAD in a worktree (superpowers may create one) — `currentBranch` is `null`, no branch match, a commit there is not "on base". Tests in Tasks 5 and 7.
5. A malformed `.sdd/config.json` — hooks treat it as `warn`, never crash, and the session banner says the config is unreadable. Tests in Tasks 5 and 9.

---

## Part 1 — Release pipeline (F-15)

### Task 1: Release scripts touch only profiles where the plugin is installed

**Files:**
- Modify: `scripts/lib-profiles.sh` (add function, update the header comment)
- Modify: `scripts/bump-cache.sh:42-50`
- Create: `scripts/repoint-install-records.sh` (steps 5 and 6 moved out of `release.sh`)
- Modify: `scripts/release.sh:98-117` (call the new script)
- Modify: `tests/test-profile-list-single-source.sh` (add the new script to its list)
- Test: `tests/test-release-installed-profiles.sh`

**Interfaces:**
- Produces: `profile_has_plugin <profile_dir> <plugin> <marketplace>` (bash function in `lib-profiles.sh`) → exit 0 iff `<profile_dir>/plugins/installed_plugins.json` exists and `jq -e --arg k "<plugin>@<marketplace>" '.plugins | has($k)'` is true.
- Produces: `scripts/repoint-install-records.sh <plugin> <version>` → repoints `[0].version` / `[0].installPath` and runs the sanity loop, for installed profiles only; exit 1 on a sanity failure; prints `· skip <profile> (<plugin> not installed)` otherwise.

- [ ] **Step 1: Write the failing test** `tests/test-release-installed-profiles.sh`. Fixture: `HOME=$(mktemp -d)`, four profile dirs; only `.claude-kat` has `installed_plugins.json` with `"sdd@sdd-misc-plugins":[{"scope":"user","version":"0.0.1","installPath":"$HOME/.claude-kat/plugins/cache/sdd-misc-plugins/sdd/0.0.1"}]`; `.claude` has a record without the `sdd` key; `.claude-sdd` and `.claude-stef` have no record. Record sha256 of every record before. Cases:
  - `bump-cache.sh sdd <version from sdd/.claude-plugin/plugin.json>` → cache dir exists under `.claude-kat` only.
  - `repoint-install-records.sh sdd <same version>` → `.claude-kat` record `[0].version` equals it; `.claude` record sha256 unchanged; no `installed_plugins.json` created in the other two.
  - Plugin installed nowhere (remove kat's key first) → both scripts exit 0, print the skip line four times, change nothing.
  - Clean up `$HOME`.
- [ ] **Step 2: Run it** — `bash tests/test-release-installed-profiles.sh` → FAIL (caches seeded in four profiles; `.claude` record gains an `sdd` key).
- [ ] **Step 3: Implement** `profile_has_plugin`, use it in `bump-cache.sh` (skip with the skip line) and move `release.sh` steps 5–6 into `repoint-install-records.sh` using it. `release.sh` keeps step 6.5 (parity) unchanged.
- [ ] **Step 4: Run** the new test, `bash tests/test-profile-list-single-source.sh`, `bash tests/test-pre-push-guard.sh` → all PASS.
- [ ] **Step 5: Commit** — `fix(release): seed caches and repoint records only where the plugin is installed (F-15)`.

---

## Part 2 — codescout-companion

### Task 2: Constitution hooks find the codescout binary off PATH

**Files:**
- Create: `docs/issues/2026-11-05-constitution-hooks-cannot-find-codescout-binary.md` (`kind: bug`, `status: open`; evidence from spec § Current state, row "Constitution")
- Modify: `codescout-companion/hooks/lib.mjs` (add `resolveCodescoutBinary`)
- Modify: `codescout-companion/hooks/goal-stop-hook.mjs:40-62` (delete local `resolveCodescout`, call the lib one)
- Modify: `codescout-companion/hooks/constitution-guard.mjs:30`, `codescout-companion/hooks/constitution-brief.mjs:49`
- Test: `codescout-companion/hooks/constitution-guard.test.sh`, `codescout-companion/hooks/constitution-brief.test.sh`

**Interfaces:**
- Produces: `resolveCodescoutBinary(cwd: string) => string | null` in `lib.mjs`. Order: each PATH dir (`codescout` / `codescout.exe`, executable); `detect(cwd, home, claudeConfigDir).CS_BINARY` if executable; `<home>/.cargo/bin/codescout`; `<cwd>/target/release/codescout`; else `null`. `home` = `HOME || USERPROFILE || homedir()`.

- [ ] **Step 1: File the bug** (file above; frontmatter `kind: bug`, `status: open`, `opened: 2026-11-05`).
- [ ] **Step 2: Write the failing tests.** In each constitution test add a case "binary only in ~/.cargo/bin": `PATH` without the stub dir, `HOME=$tmp` with the existing stub copied to `$tmp/.cargo/bin/codescout`; assert the same output the PATH case asserts (guard: `"permissionDecision":"deny"` with `"hookEventName":"PreToolUse"`; brief: `"hookEventName":"UserPromptSubmit"`). Add a case "binary nowhere" → no output, exit 0.
- [ ] **Step 3: Run** both suites → the new "~/.cargo/bin" cases FAIL.
- [ ] **Step 4: Implement** `resolveCodescoutBinary` and use it in the three hooks (`null` → `process.exit(0)` as today).
- [ ] **Step 5: Run** both suites and `bash codescout-companion/hooks/goal-stop-hook.test.sh`, `bash codescout-companion/hooks/goal-stop-hook.matrix.test.sh` → PASS. Mutation check: make the lib return `null` after the PATH loop → the "~/.cargo/bin" cases FAIL; restore.
- [ ] **Step 6: Set the bug** `status: fixed`, `closed: 2026-11-05`, cite the test. **Commit** — `fix(companion): constitution hooks resolve codescout off PATH like goal-stop-hook`.

### Task 3: `spec-drift` skill

**Files:**
- Create: `codescout-companion/skills/spec-drift/SKILL.md`
- Create: `codescout-companion/skills/spec-drift/references/report-format.md`
- Test: `codescout-companion/skills/spec-drift/spec-drift.test.sh`
- Modify: `tests/lib/skill_call_legality.py` (scan `spec-drift`; add an `event_create` case)

**Interfaces:**
- Produces: the verdict event other tasks read — `doc(action="event_create", id=<spec artifact id>, event={kind: "verdict", payload: {outcome: "confirmed" | "partial" | "refuted", gate: "go" | "no-go", implemented: <int>, missing: <int>, divergent: <int>, criteria: [{text, status: "implemented"|"missing"|"divergent", evidence: "<file:line or reason>"}]}})`. `gate` is `go` iff `missing == 0 && divergent == 0`. `outcome` is `confirmed` when `gate` is `go`, `partial` when `gate` is `no-go` and `implemented > 0`, else `refuted` (the server accepts only `confirmed|refuted|partial|abandoned`, `codescout/src/librarian/tools/event_create.rs:241`). Consumers read `payload.gate`, never `payload.outcome`.
- Consumes: codescout `doc(action="find"|"get"|"event_list")`, `symbols`, `references`, `grep`, `semantic_search`.

- [ ] **Step 1: Write the failing test** `spec-drift.test.sh`: frontmatter has `name: spec-drift` and a `description` starting `Use when`; `SKILL.md` < 20480 bytes; it names `event_create`, `"verdict"` and `outcome`; it names no `read_markdown`, `edit_markdown`, `Serena`, `memory/specs`; every `references/*.md` it links exists.
- [ ] **Step 2: Run** → FAIL (no skill).
- [ ] **Step 3: Write the skill.** Core: resolve the spec (catalog id, path, or `feature:` slug via `doc(find, kind="spec")`); criteria come from a heading matching `/acceptance criteria/i`, else from `## Goals` numbered items, else ask the user to confirm an extracted list; check each criterion with codescout tools and cite `file:line`; print the report (format in the reference); record the verdict event; a `no-go` lists what to change in code or spec. Harness-neutral (no harness-specific tool names outside a pointer).
- [ ] **Step 4: Extend** `skill_call_legality.py`: scan `codescout-companion/skills/spec-drift/`; add a case that runs the skill's `event_create` call against a fixture `kind: spec` artifact in the sandbox and asserts `ok`; control: the same call with `kind: "verdikt"` is refused.
- [ ] **Step 5: Run** `bash codescout-companion/skills/spec-drift/spec-drift.test.sh` and `bash tests/test-skill-call-legality.sh` → PASS.
- [ ] **Step 6: Commit** — `feat(companion): spec-drift skill records a verdict event on the spec`.

---

## Part 3 — sdd 3.0

### Task 4: Remove the old surface

**Files:**
- Delete: `sdd/commands/{specify,plan,drift,document,bootstrap-docs}.md`, `sdd/agents/`, `sdd/bootstrap-sdd.sh`, `sdd/memory/`, `sdd/ecosystem/templates/base/skills/`, `sdd/ecosystem/templates/base/sdd-config.md.template`, `sdd/hooks/mark-reviewed.mjs`, `tests/test-sdd-hooks.sh`
- Move: `sdd/ecosystem/templates/base/constitution.md.template` → `sdd/templates/constitution/base.md`; `.../kotlin/constitution-kotlin.md` → `sdd/templates/constitution/kotlin.md`; `.../python/constitution-python.md` → `sdd/templates/constitution/python.md`; `.../base/CLAUDE.md.template` → `sdd/templates/CLAUDE.md.template`
- Test: `tests/test-sdd-content.sh` (grows in Task 10)

- [ ] **Step 1: Write the failing test** `tests/test-sdd-content.sh`: each deleted path is absent; each moved path exists; `sdd/ecosystem/` is absent; `grep -rIl` over `sdd/` finds none of `memory/specs`, `Serena`, `serena`, `read_markdown`, `edit_markdown`, `superpowers:code-reviewer`, `ralph-sdd`, `COMPONENT_REGISTRY`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Delete and move** with `git rm` / `git mv`. Strip Serena text from the moved templates (content rewrite of the articles comes in Task 10).
- [ ] **Step 4: Run** → PASS except the grep over files Task 10 rewrites (`skills/sdd-flow`, `commands/review.md`, `commands/sdd-init.md`, `README.md`): list them in the test as `PENDING_REWRITE` and skip them, with a `FAIL` if the list is non-empty after Task 10 (the assertion is turned on in Task 10, Step 1).
- [ ] **Step 5: Commit** — `refactor(sdd): remove commands, agent and layout superseded by superpowers`.

### Task 5: `sdd/hooks/lib.mjs`

**Files:**
- Rewrite: `sdd/hooks/lib.mjs`
- Test: `sdd/hooks/lib.test.mjs`
- Modify: `tests/run-all.sh:20-50` (add `SDD_HOOK_TESTS_DIR="$SCRIPT_DIR/../sdd/hooks"` and `"$SDD_HOOK_TESTS_DIR"/*.test.mjs` to `SUITES`)

**Interfaces:**
- Produces (copied byte-for-byte from `codescout-companion/hooks/lib.mjs`): `readInput() => object|null`, `emit(obj)`, `denyPreToolUse(reason: string)`, `contextPreToolUse(text: string)`, `normalizedToolName(input) => string`, `inputPath(input) => string`, `isCodescoutTool(input, names: string[]) => boolean`, `isWriteOperation(input) => boolean`.
- Produces (sdd's own):
  - `contextEvent(eventName: 'SessionStart'|'SubagentStart'|'UserPromptSubmit', text: string)` — emits `{hookSpecificOutput:{hookEventName, additionalContext}}`.
  - `mainCheckout(cwd: string) => {root: string, commonDir: string, gitDir: string} | null` — walk up to `.git`; a `.git` file → follow `gitdir:` then that dir's `commondir`; `root` = parent of the common dir. No `git` spawn.
  - `currentBranch(gitDir: string) => string | null` — `HEAD` `ref: refs/heads/<b>` → `<b>`; detached → `null`.
  - `loadConfig(root) => {enforcement: 'warn'|'strict', baseBranch: string|null, error: string|null} | null` — `null` if `.sdd/config.json` is absent; malformed JSON → `{enforcement:'warn', baseBranch:null, error:'unreadable'}`.
  - `readFrontmatter(text: string) => Record<string,string>` — first `---` block; tolerates BOM and CRLF; strips matching quotes.
  - `writeFrontmatterFields(path: string, fields: Record<string,string>)` — set/insert keys in the first block (create the block if absent), keep every other byte.
  - `listArtifacts(root, kind: 'specs'|'plans') => {path, fm, body}[]` — `*.md` in `docs/superpowers/<kind>/`.
  - `specPointer(planBody: string) => string | null` — the path after `**Spec:**`.
  - `activePlans(root) => {path, fm, specPath}[]` — plan `status: approved` and its spec pointer resolves (relative to `root`) to a spec with `status: approved`.
  - `approvalsDir(commonDir) => string` — `<commonDir>/sdd/approvals`.
  - `featureFromSpecPath(p) => string` — basename minus `YYYY-MM-DD-` prefix and `-design.md` / `.md` suffix.

- [ ] **Step 1: Write the failing tests** (`node:test`), each in a temp dir removed in `after`:
  - copy parity: for each copied name, the `export function <name>(…) { … }` text in `sdd/hooks/lib.mjs` equals the text in `codescout-companion/hooks/lib.mjs`.
  - `mainCheckout` from a `git worktree add` fixture returns the main root; from the main checkout returns itself; outside a repo returns `null`.
  - `currentBranch` on a branch and on a detached HEAD (`null`).
  - `loadConfig`: absent → `null`; `{"enforcement":"strict"}` → strict, `baseBranch:null`; `not json` → warn with `error:'unreadable'`.
  - `readFrontmatter` with LF, CRLF and BOM gives `{status:'approved'}`; `writeFrontmatterFields` changes only the named key (diff of the rest is empty) and creates a block when there is none.
  - `activePlans`: approved plan → approved spec counts; approved plan → draft spec does not; draft plan does not.
  - `featureFromSpecPath('docs/superpowers/specs/2026-11-05-auth-login-design.md') === 'auth-login'`.
- [ ] **Step 2: Run** `node sdd/hooks/lib.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `sdd/hooks/lib.mjs`; add the run-all glob.
- [ ] **Step 4: Run** `node sdd/hooks/lib.test.mjs` → PASS; `./tests/run-all.sh` lists `▶ lib.test.mjs` for sdd.
- [ ] **Step 5: Commit** — `feat(sdd): hook library with main-checkout resolution and frontmatter status`.

### Task 6: `spec-guard`

**Files:**
- Rewrite: `sdd/hooks/spec-guard.mjs`
- Test: `sdd/hooks/spec-guard.test.mjs`

**Interfaces:**
- Consumes: Task 5 lib.
- Produces: `isExempt(relPath: string) => boolean` and `touchesApprovalFields(input) => boolean`, exported from `spec-guard.mjs` for the test; hook behaviour per spec § sdd hooks.

- [ ] **Step 1: Write the failing tests** — fixture repo with `.sdd/config.json`; run the hook with `spawnSync('node', [hook], {input: JSON.stringify(payload)})`:
  - no config → empty stdout, exit 0; `not json` stdin → empty stdout, exit 0.
  - strict, no active plan, `Write` to `src/a.ts` → stdout has `hookEventName:'PreToolUse'`, `permissionDecision:'deny'`, a `permissionDecisionReason` naming `/sdd:approve`.
  - same for `Edit`, `MultiEdit`, `NotebookEdit`, `mcp__codescout__edit_file`, `mcp__codescout__edit_code`, `mcp__codescout__create_file`.
  - warn mode → `additionalContext`, no `permissionDecision`.
  - exempt: `docs/x.ts`, `.sdd/x`, `.claude/x`, `.codescout/x`, `README.md`, `a.json`, `a.yaml`, `a.yml`, `a.toml`, `a.ini`, `.env`, and `C:\\repo\\docs\\x.ts` (Review Focus 1) → empty.
  - one active plan, cwd in the main checkout → `src/a.ts` allowed (empty).
  - two active plans, main checkout → allowed (Review Focus 3).
  - worktree on branch `feat/x`, plan with `branch: feat/x` draft → deny even though another plan is active.
  - tool write to a spec adding `status: approved` (Edit `new_string` / Write `content` / codescout `edit_file` `new_string`) → deny in **warn** mode too; adding `status: draft` → allowed.
  - write targeting `<commonDir>/sdd/approvals/x` → deny.
- [ ] **Step 2: Run** `node sdd/hooks/spec-guard.test.mjs` → FAIL.
- [ ] **Step 3: Implement** `spec-guard.mjs` (path made relative to `mainCheckout(...).root` or the worktree root, separators normalised to `/`).
- [ ] **Step 4: Run** → PASS. Mutation check: drop the codescout tool names from the write check → the codescout cases FAIL; restore.
- [ ] **Step 5: Commit** — `feat(sdd): spec-guard gates source writes on an active plan, codescout tools included`.

### Task 7: `review-guard`

**Files:**
- Create: `sdd/hooks/git-intents.mjs`
- Rewrite: `sdd/hooks/review-guard.mjs`
- Test: `sdd/hooks/git-intents.test.mjs`, `sdd/hooks/review-guard.test.mjs`

**Interfaces:**
- Produces: `gitIntents(command: string) => {kind: 'commit'|'merge'|'push'|'pr-create'|'pr-merge', pushRef?: string}[]` — splits on `;`, `&&`, `||`, `|` and newlines outside quotes; skips `git` global options (`-C <dir>`, `-c <k=v>`, `--git-dir=…`); a quoted `"git commit"` argument is not an intent.
- Produces: `reviewRecordPath(commonDir, feature) => string` — `<approvalsDir>/<feature>.review.json`.
- Consumes: Task 5 lib, Task 8 writes the record.

- [ ] **Step 1: Write the failing tests.**
  - `git-intents`: `git commit -m x` → commit; `git -C ../w commit` → commit; `git -c a=b commit` → commit; `npm test && git commit -am x` → commit; `echo "git commit"` → none; `git push origin main` → push `main`; `git push origin HEAD:main` → push `main`; `gh pr create --fill` → pr-create; `gh pr merge 12` → pr-merge; `git merge feat/x` → merge.
  - `review-guard`, strict, base `main`:
    - on `feat/x` (worktree) `git commit` → empty (passes).
    - on `main` `git commit`, one active plan, no record → deny naming `/sdd:approve review <feature>`; with the record → empty.
    - on `main`, two active plans → deny asking which feature.
    - on `feat/x` `gh pr create`, plan `branch: feat/x`, no record → deny; with record → empty.
    - `git push origin main` from `feat/x` → gated; `git push` (no ref) on `feat/x` → empty.
    - detached HEAD `git commit` → empty (Review Focus 4).
    - command containing `mark-reviewed` or `sdd/approvals` → deny.
    - `mcp__codescout__run_command` with `{command}` behaves like `Bash`.
    - `baseBranch` absent: `main` exists → base is `main`; only `master` exists → `master`.
- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. Mutation check: treat a missing record as present → the deny cases FAIL; restore.
- [ ] **Step 5: Commit** — `feat(sdd): review-guard gates integration into the base branch`.

### Task 8: User-only approval — `approve-intake` and `/sdd:approve`

**Files:**
- Create: `sdd/hooks/approve-intake.mjs`, `sdd/commands/approve.md`
- Test: `sdd/hooks/approve-intake.test.mjs`

**Interfaces:**
- Produces: `parseApproval(prompt: string) => {kind: 'spec'|'plan'|'review'|'done', target: string} | null` — accepts `/sdd:approve <kind> <target>`, `/approve <kind> <target>`, `sdd approve <kind> <target>`, surrounding whitespace allowed; anything else `null`.
- Produces: review record JSON `{feature, date: 'YYYY-MM-DD', session_id, head: '<commit sha>'}` at `reviewRecordPath` (Task 7).
- Consumes: Task 5 lib; Task 7 `reviewRecordPath`. The hook makes no codescout call: it stays fast and works without the binary.

Decision for this task: the review gate reads `<approvalsDir>/<feature>.report.json` written by the `review` command (`{outcome: 'go'|'no-go', drift_outcome, date}`); `approve review` refuses unless `outcome == 'go'` and `drift_outcome == 'go'`. The hook stays free of codescout calls (fast, no binary needed). spec-guard (Task 6) therefore exempts `*.report.json` under approvals from the deny it applies to that directory — add that case to Task 6's tests in this task's Step 1.

- [ ] **Step 1: Write the failing tests:**
  - `parseApproval` on the three forms, on `please approve the spec` (`null`), on `/sdd:approve spec` without target (`null`).
  - `spec <path>`: sets `status: approved`, `approved: <today>`, `feature: <featureFromSpecPath>`, `kind: spec`; output is `hookEventName:'UserPromptSubmit'` context confirming it.
  - `spec <feature>` resolves by `feature:`; unknown → context explaining, no write.
  - `plan <feature>`: plan with `feature:` or whose `**Spec:**` points at that feature's spec → `status: approved`, `approved:`; spec not approved → refused, no write.
  - `review <feature>`: no report → refused; report `no-go` → refused; `go`/`go` → record written with `head`.
  - `done <feature>`: spec `implemented`, plan `done`.
  - any write leaves bytes outside the frontmatter unchanged.
  - (Task 6 addition) spec-guard allows a tool write to `<approvals>/<f>.report.json`, still denies `<f>.review.json`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the hook; write `commands/approve.md` (frontmatter `description`, `disable-model-invocation: true`; body explains the four forms and that the hook does the writing; no `$ARGUMENTS`; < 4 KB).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `feat(sdd): user-only approval channel through UserPromptSubmit`.

### Task 9: `session-start`, `subagent-inject`, `hooks.json`

**Files:**
- Rewrite: `sdd/hooks/session-start.mjs`, `sdd/hooks/subagent-inject.mjs`, `sdd/hooks/hooks.json`
- Test: `sdd/hooks/session-start.test.mjs`, `sdd/hooks/subagent-inject.test.mjs`

**Interfaces:**
- Consumes: Task 5 lib (`contextEvent`, `activePlans`, `loadConfig`).
- Produces: `hooks.json` entries — SessionStart (sync, `startup|resume|clear|compact`) → `session-start.mjs`; UserPromptSubmit → `approve-intake.mjs`; PreToolUse `Write|Edit|MultiEdit|NotebookEdit|mcp__codescout__edit_file|mcp__codescout__edit_code|mcp__codescout__create_file` → `spec-guard.mjs`; PreToolUse `Bash|mcp__codescout__run_command` → `review-guard.mjs`; SubagentStart → `subagent-inject.mjs`. Every command `node "${CLAUDE_PLUGIN_ROOT}/hooks/<hook>.mjs"`.

- [ ] **Step 1: Write the failing tests:**
  - session-start: no config → empty; strict with one active plan → `hookEventName:'SessionStart'`, text names the mode and the feature; malformed config → text says the config is unreadable and enforcement is `warn` (Review Focus 5).
  - subagent-inject: `general-purpose`, `Plan`, `claude` → `hookEventName:'SubagentStart'` with the active plan and spec paths; two active plans, no branch → both listed (Review Focus 3); `Explore`, `Bash` → empty; no config → empty; no tool-routing text (`symbols(` absent).
  - `hooks.json`: parses; every `command` is a single string matching `^node "\$\{CLAUDE_PLUGIN_ROOT\}/hooks/[a-z-]+\.mjs"$`; every referenced file exists; no `"async": true`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two tests and `bash tests/test-all-plugins-hooks-json-portable.sh`, `bash tests/test-hooks-json-registration.sh` → PASS.
- [ ] **Step 5: Commit** — `feat(sdd): session banner and subagent context with hookEventName; register hooks`.

### Task 10: Content — `sdd-flow`, `review`, `sdd-init`, templates, README

**Files:**
- Rewrite: `sdd/skills/sdd-flow/SKILL.md`; Create: `sdd/skills/sdd-flow/references/{gates.md,artifacts.md}`
- Rewrite: `sdd/commands/review.md`, `sdd/commands/sdd-init.md`, `sdd/README.md`, `sdd/templates/CLAUDE.md.template`, `sdd/templates/constitution/{base,kotlin,python}.md`, and the `### SDD` section of the root `README.md` (it still lists the commands Task 4 deleted)
- Modify: `tests/test-sdd-content.sh` (turn on the `PENDING_REWRITE` assertion; size checks), `tests/test-codex-convertible-commands.sh:117` (add `sdd/commands/{review,sdd-init,approve}.md` to `TARGETS`), `tests/lib/skill_call_legality.py` (scan `sdd/skills` and `sdd/commands`)

**Interfaces:**
- Consumes: Task 3 (`spec-drift` skill name and verdict shape; the review command sets `drift_outcome` from the verdict's `payload.gate`), Task 8 (`/sdd:approve` forms; `<approvals>/<feature>.report.json` shape `{outcome, drift_outcome, date}`), codescout constitution archetype (fetch `librarian(action="tracker_design", archetype="constitution")` for the exact `doc(create …)` call).

- [ ] **Step 1: Extend the test:** `PENDING_REWRITE` must be empty; `SKILL.md` < 20480 bytes; each command < 4096 bytes; every `superpowers:<name>` named in `sdd/` is one of the 15 skill directories of superpowers 7.0.2 (list pinned in the test); `sdd-flow` names `spec-drift`, `/sdd:approve spec`, `/sdd:approve plan`, `/sdd:approve review`, `/sdd:approve done`; `sdd-init.md` names `.sdd/config.json` and `constitution`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the content** per spec § sdd skills and commands:
  - `sdd-flow`: the nine steps; the two-line rule "enforcement comes from hooks; ask the user to type `/sdd:approve …`, never edit status fields"; commit spec and plan before the worktree; record `branch:` in the plan.
  - `review`: read constitution rules (`codescout constitution-check --project .` or `doc(find, tags constitution)`), the latest `spec-drift` verdict (`doc(action="event_list", id=<spec>, kinds=["verdict"])`), judge each rule, write `<approvals>/<feature>.report.json`, then ask the user to type `/sdd:approve review <feature>`.
  - `sdd-init`: ask stack and enforcement (default `strict`); write `.sdd/config.json`; create the constitution tracker with articles I–VI global (+ VII–VIII for kotlin/python) from the templates; optional CLAUDE.md section from the template; never commit.
  - README: what sdd is for, what it needs (companion, superpowers, codescout), install in one profile, the flow, the known shell-write limit.
- [ ] **Step 4: Run** `bash tests/test-sdd-content.sh`, `bash tests/test-codex-convertible-commands.sh`, `bash tests/test-skill-call-legality.sh` → PASS.
- [ ] **Step 5: Commit** — `docs(sdd): rewrite sdd-flow, review and sdd-init for the strict layer`.

### Task 11: Cross-platform smoke

**Files:**
- Modify: `tests/test-cross-platform-hooks.sh` (new check after check 5)

- [ ] **Step 1: Add the check:** temp project with `.git/`, `.sdd/config.json` `{"enforcement":"strict"}`; pipe a `Write` payload for `src/a.ts` into `node "$ROOT/sdd/hooks/spec-guard.mjs"`; `ok` when stdout contains `"hookEventName":"PreToolUse"` and `"permissionDecision":"deny"`; skip when `node` is absent (same pattern as check 5).
- [ ] **Step 2: Run** `bash tests/test-cross-platform-hooks.sh` → PASS (CI runs it on ubuntu/macos/windows).
- [ ] **Step 3: Commit** — `test(ci): sdd spec-guard in the cross-platform smoke`.

### Task 12: Integrate, release, install, smoke

- [ ] **Step 1:** `./tests/run-all.sh` and `cd buddy && python3 -m pytest -q` in the worktree → `✓ All suites passed.` and 534+ passed.
- [ ] **Step 2:** Final whole-branch review, then `superpowers:finishing-a-development-branch` (merge into `main` after the user's choice).
- [ ] **Step 3 (user confirms pushes):** on `main`: `./scripts/release.sh codescout-companion minor`; refresh tracker `cc8cb9e23ab5cc67` (`doc(action="update", id="cc8cb9e23ab5cc67", commit_refresh=true)`); `./scripts/release.sh sdd major` → `3.0.0`; expect the skip line for every profile (sdd installed nowhere yet) and parity `OK … not installed in any profile`.
- [ ] **Step 4 (user):** in a `~/.claude-kat` session run `/plugin install sdd@sdd-misc-plugins`, then `/reload-plugins`. Verify `jq '.plugins["sdd@sdd-misc-plugins"]' ~/.claude-kat/plugins/installed_plugins.json` shows `3.0.0` and the other three records have no `sdd` key.
- [ ] **Step 5 (smoke, kat session, scratch repo from zero):** `git init` → `/sdd:sdd-init` → brainstorm a tiny feature → `/sdd:approve spec <path>` (confirms `UserPromptSubmit` sees the typed text; if not, `sdd approve spec <path>`) → plan → `/sdd:approve plan <feature>` → a source write passes; before approval it was denied → `review` → `/sdd:approve review <feature>` → `git commit` on `main` passes; before the record it was denied. Record the outcome as a `W-N`/`F-N` in `docs/trackers/roster-audit-session-log.md` on `main`.
- [ ] **Step 6:** set spec `docs/superpowers/specs/2026-11-05-sdd-strict-layer-design.md` and this plan to `status: done`; mark F-15 `fixed-verified` with the test name.
