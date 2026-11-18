---
id: '1933bca9c11eb5c7'
kind: plan
status: draft
title: Effort steering quality test (S5-lite) — implementation plan
tags:
- effort-steering
- s5
- quality-test
- plan
topic: effort-steering quality test
---

# Effort steering quality test (S5-lite) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the S5 harness (mine, build, gate, run, grade, analyze) that runs stage 1 of the quality test in Docker, so that the gated pilot, calibration and measured run can follow.

**Architecture:** Node ESM modules under `effort-steering/spikes/s5/`, one responsibility per file. One Docker image per repo plus an allowlisting proxy; a thin container wrapper that tests replace with a fake `docker`. S4 code is reused where it is exported (transcript discovery, effort guard, decision log, PRNG, permutation analysis, the committed-bytes check).

**Tech Stack:** Node 26 (host v26.10.0), git, Docker 29.8.2 (overlayfs), btrfs reflink copies on `/home`, tinyproxy, Rust 1.97.1 in the codescout image, the Claude Code 2.1.292 native binary.

**Spec:** `docs/superpowers/specs/2026-10-07-effort-steering-quality-test-design.md` (id `4ab6a0801b75e480`).

## Global Constraints

- **No model calls while implementing.** Every test that would start `claude` uses a fake binary. The pilot, calibration and measured run are operator gates after this plan (see "Runbook").
- Model `claude-sonnet-5-5`. CLI: the host binary `~/.local/share/claude/versions/2.1.292`, mounted read-only at `/opt/claude/claude`; its sha256 goes into the prereg.
- Arms (measured): A `xhigh` no steer × 3; B `xhigh` + steer × 3; C `low` no steer × 2. Calibration: A × 2, C × 1. All arms run the hook; `EFFORT_STEERING_HOLDOUT_RATE` is `'0'` for B and `'1'` for A and C.
- Margin 0.15; one-sided alpha 0.05; task-level paired lower bound; validity gate lower bound of (A − C) > 0; non-inferior iff lower bound of (B − A) > −0.15 (strict).
- **Usage rule (finding of 2026-10-07):** per `message.id`, take the record with the largest `usage.output_tokens` (ties: the last record), never the first. In this session's tool-loop subagent transcripts, 13 of 596 multi-record messages carried partial usage on early records (example: first record 3 output tokens and no thinking field, last record 4,916 with 2,756 thinking). The S4 transcripts showed 0 such messages, so S4's result stands. Count the main transcript and the subagent transcripts at `<config>/projects/<slug>/<sessionId>/subagents/agent-*.jsonl`.
- Child environment: a whitelist as in S4 (no `ANTHROPIC_*`), plus `CLAUDE_CODE_OAUTH_TOKEN`. A secret is passed to `docker` as `-e NAME` with the value in the docker process environment, never in argv, rows or logs.
- Containers carry the label `s5=1` and `s5.run=<runId>`. The runner stops or removes only containers with `s5=1`: about 20 unrelated containers run on this host.
- Work directory default: `~/work/claude/s5-work` (btrfs). Never `/tmp` for trees, targets or runs (a 24 GB tmpfs, 87 percent full).
- Model-written code runs only inside containers. **Never run `git` on an agent's tree on the host**: a `.gitattributes` filter driver in that tree would execute on the host.
- Tests: `t` from `../../core/testkit.mjs` and `node:assert/strict`, files `*.test.mjs` under `effort-steering/spikes/s5/` (found by `tests/run-all.sh`). Tests that need Docker run only when `S5_DOCKER_TESTS=1` and otherwise print one skip line.
- Shared checkout: stage explicit paths, commit by pathspec with `git commit -F <file>`, never `git add .`, never push.
- Throwaway spike code: no `plugin.json`, no marketplace entry, no README row (ES-10).

## Deviations from the spec

- **First-message check.** The spec's check "every first user message is one line" (an S4 guard against stdin eating the prompt) becomes stronger: the transcript's first user text must equal `prompt.txt` exactly. S5 prompts are paragraphs.
- **Usage rule.** The spec says usage is deduplicated by `message.id`. This plan adds which record wins (the final one), from the finding in Global Constraints. The spec did not know of it.

## Review Focus

1. **A message split over several transcript records.** The usage reader must take the final record and count subagent transcripts. Pinned in Task 2 with the real shape (3 then 313 output tokens; thinking only on the last record).
2. **A hidden test that silently does not run** (a new test file whose `mod` line lives in non-test source; a name filter that matches nothing). Gate and grade require every listed fail-to-pass and pass-to-pass name to be reported as run; a name not run is a failure. Pinned in Tasks 6 and 7.
3. **A leak path:** the copy's history, a git remote, the issue file, `.codescout/` memories or trackers that name the fix, the repo's `CLAUDE.md`, or the network. Pinned in Task 5 (tree has one commit, no remote, no scrub term) and Task 4 (the proxy refuses a host not on the list).
4. **Infrastructure failure scored as a model failure, or the reverse.** Out-of-memory kill, API error, effort mismatch, arm mismatch: infrastructure, re-run at most twice. Wall-clock timeout, broken build, hidden test not run: model failure. Pinned in Task 10.
5. **A lower bound that is too narrow at N = 32.** The simulation must hold the false non-inferiority rate at Δ = −0.15 at or below 0.065. If the percentile bootstrap fails that, the default becomes the paired t lower bound. Pinned in Task 9.

## File Structure

Create under `effort-steering/spikes/s5/`:

| File | Responsibility |
|---|---|
| `git.mjs` | hardened `git` spawn for a repo directory (the env scrub of `s4-prereg.mjs`'s `runGit`) |
| `mine.mjs` | candidate fix commits |
| `task-def.mjs` | `task.json` schema: validate and load |
| `build-task.mjs` | task tree, hidden files, manifest with hashes; `reflinkCopy` |
| `docker.mjs` | container launch: labels, limits, mounts, network, wall-clock kill, OOM detection |
| `gate-task.mjs` | warm build, two-sided gate, flaky check, "fails by assertion" check |
| `grade.mjs` | graft hidden tests, run, parse results, diff stats in the container |
| `usage.mjs` | transcripts to usage, efforts, API errors, tests-before-done |
| `hook-copy.mjs` | the hook scratch copy and settings for the container path |
| `run.mjs` | run plan, one run, batch with resume and stop rule, smoke mode |
| `prereg.mjs` | the S5 registration loader |
| `analyze.mjs` | per-task scores, lower bounds, verdict, calibration drop rule, mechanism check, secondaries, simulation |
| `s5.mjs` | the CLI |
| `images/` | `codescout.Dockerfile`, `plugins.Dockerfile`, `proxy.Dockerfile`, `tinyproxy.conf.tmpl`, `build.sh` |
| `tasks/` | committed task definitions: `candidates.json`; per task `task.json`, `TASK.md`, `prompt.txt` |
| `fixtures/` | test helpers (`make-repo.mjs`, fake `docker`, fake `claude`) and transcript fixtures |
| `README.md` | the runbook and the instrument rules |

Modify: `effort-steering/spikes/s4-prereg.mjs` (export `requireCommitted`, Task 8).

---

### Task 1: `git.mjs` and `mine.mjs`

**Files:** Create `git.mjs`, `mine.mjs`, `mine.test.mjs`, `fixtures/make-repo.mjs`.

**Interfaces:**
- Produces: `git(dir: string, args: string[], opts?: { input?: Buffer }) -> { status: number, stdout: Buffer, stderr: Buffer }`. The environment scrub, `--no-replace-objects`, `-c core.fsmonitor=false`, `GIT_TERMINAL_PROMPT=0` of `runGit`, but `-C dir`.
- Produces: `makeRepo(commits: { label, subject, date, files: Record<path, string|null> }[]) -> { dir, shas: Record<label, sha> }` (null deletes a file; `{ cherryOf: label }` re-applies a commit's patch).
- Produces: `mineCommits(repoDir, { since, refs, excludePrefixes, maxPerSubsystem, minFiles, minLines }) -> Candidate[]`, where `Candidate = { repo, fix, parent, subject, date, subsystem, patchId, testFiles, sourceFiles, sourceLinesChanged }`.

Rules: subject matches `^fix`; non-merge; author date after `since`; at least one test file and one non-test file changed; `sourceFiles.length >= minFiles` (2) or `sourceLinesChanged >= minLines` (40); excluded if any changed path starts with an exclude prefix (`effort-steering/`); dedupe by `git patch-id --stable`, keeping the earliest; subsystem = the conventional-commit scope, else the parent directory of the most-changed non-test file; at most `maxPerSubsystem` (4) per subsystem, keeping the earliest. Output sorted by date, then sha. Test-file patterns: `(^|/)tests?/`, `_tests?\.rs$`, `(^|/)tests\.rs$`, `\.test\.(mjs|js|ts)$`, `(^|/)test-[^/]*\.sh$`, `(^|/)test_[^/]*\.py$`, `_test\.py$`.

- [ ] **Step 1: Write the failing tests** in `mine.test.mjs`:
  - `keeps a fix that changes 2 source files and 1 test file`
  - `drops: a merge; a 'feat' subject; docs only; tests only; source only; 1 source file with 39 lines; a date before since`
  - `keeps 1 source file with 40 changed lines`
  - `drops a commit that touches effort-steering/ even when its other files qualify`
  - `dedupes a cherry-pick by patch-id and keeps the earliest`
  - `caps subsystem 'read_file' at 4, keeping the 4 earliest`
  - `uses the parent directory of the most-changed source file when the subject has no scope`
- [ ] **Step 2: Run** `node effort-steering/spikes/s5/mine.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `git` and `mineCommits`.
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `git.mjs`, `mine.mjs`, `mine.test.mjs`, `fixtures/make-repo.mjs`.

### Task 2: `usage.mjs` (load-bearing: Opus review with a mutation lens)

**Files:** Create `usage.mjs`, `usage.test.mjs`, `fixtures/transcripts/`.

**Interfaces:**
- Consumes: `findTranscripts`, `effortsFromTranscript`, `hasApiError` from `../s4-rows.mjs`.
- Produces: `messageUsages(text) -> Map<messageId, usage>` (final-record rule; API-error records skipped; the record filter of S4's `countedAssistantRecords`).
- Produces: `totals(usages) -> { input_total, cache_creation, cache_read, output, thinking, messages, thinkingFieldMissing }`.
- Produces: `readRunUsage(configDir, sessionId) -> { main, subagents, total, subagentFiles, efforts, subagentEfforts, apiError, subagentApiErrors, transcriptPath, reason }`, with `reason` one of `null`, `'no_transcript'`, `'ambiguous_transcript'`.
- Produces: `firstUserText(text) -> string|null`; `testsRunBeforeDone(text, patterns: string[]) -> boolean` (a Bash `tool_use` whose command contains a pattern, before the last assistant text block); `finalTextTail(text, n = 300) -> string`.

The effort guard reads `efforts` from the main transcript only. Subagent efforts are recorded, not guarded.

- [ ] **Step 1: Write the failing tests:**
  - `final-record rule: one id with records (3 out, no thinking) then (313 out, 40 thinking) gives output 313 and thinking 40` (fails if the first record is kept)
  - `a tie on output_tokens keeps the last record`
  - `API-error records are not counted`
  - `subagent transcripts add to subagents and total, never to main`
  - `no transcript gives reason no_transcript; two give ambiguous_transcript`
  - `testsRunBeforeDone: true when 'cargo test' runs before the final text; false when it runs only after it or never`
  - `firstUserText returns the prompt exactly, newlines included`
- [ ] **Step 2: Run** `node effort-steering/spikes/s5/usage.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: `docker.mjs`

**Files:** Create `docker.mjs`, `docker.test.mjs`, `fixtures/fake-docker.mjs` (records argv and environment names to a log; scripted exit, sleep and OOM).

**Interfaces:**
- Produces: `dockerRun({ image, name, labels, cpus, memoryGb, network, mounts: [{ host, container, readOnly }], env: Record<string,string>, workdir, user, cmd: string[], timeoutMs, stdin: 'null' }, { dockerBin? }) -> Promise<{ status, stdout, stderr, timedOut, oomKilled, wallMs }>`. Runs without `--rm`; on a timeout runs `docker kill <name>`; afterwards reads `.State.OOMKilled` with `docker inspect`, then `docker rm <name>`.
- Produces: `removeLabeled(label = 's5=1', { dockerBin? }) -> number`.

- [ ] **Step 1: Write the failing tests:**
  - `argv carries --label s5=1, --label s5.run=<name>, --cpus, --memory <n>g, --network, and :ro on read-only mounts`
  - `env values never appear in argv; names appear as -e NAME`
  - `a timeout kills the container by name and reports timedOut`
  - `OOMKilled true from inspect is reported`
  - `removeLabeled filters on the label s5=1 only`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: Images, proxy and network

**Files:** Create `images/codescout.Dockerfile`, `images/plugins.Dockerfile`, `images/proxy.Dockerfile`, `images/tinyproxy.conf.tmpl`, `images/build.sh`, `images.test.mjs`.

Decisions:
- codescout image: the official `rust:1.97.1` image plus components `rustfmt clippy rust-analyzer`, Node 26, Python 3, git, curl, ca-certificates; user `agent` with uid 1000; `CARGO_HOME=/cargo` (mounted read-only from `<workRoot>/cargo-home`), `CARGO_NET_OFFLINE=true`.
- plugins image: Node 26, bash, jq, Python 3, git; user `agent` with uid 1000.
- Proxy: tinyproxy on port 8888; `FilterDefaultDeny Yes` with a filter file in `allowlist` mode; a separate `log-all` mode logs every CONNECT host (pilot discovery only).
- Network: `docker network create --internal s5-internal`. The proxy container joins `s5-internal` and the default bridge; agent containers join `s5-internal` only, with `HTTPS_PROXY=http://s5-proxy:8888`. Grade containers use `--network none`.
- `build.sh` builds `s5/codescout`, `s5/plugins` and `s5/proxy` and writes their digests to `images/digests.json`.

- [ ] **Step 1: Write the failing tests** (only with `S5_DOCKER_TESTS=1`):
  - `codescout image: rustc --version prints 1.97.1; node --version starts with v26; the mounted /opt/claude/claude --version prints '2.1.292 (Claude Code)'` (no model call)
  - `a container on s5-internal cannot reach https://github.com directly`
  - `in allowlist mode with [api.anthropic.com]: CONNECT github.com:443 is refused and api.anthropic.com:443 connects` (a TLS handshake, no API request)
- [ ] **Step 2: Run** `S5_DOCKER_TESTS=1 node effort-steering/spikes/s5/images.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write** the Dockerfiles, the template and `build.sh`; run `images/build.sh`.
- [ ] **Step 4: Run** the tests again. Expected: PASS. Run `node effort-steering/spikes/s5/images.test.mjs` without the variable. Expected: one skip line, exit 0.
- [ ] **Step 5: Commit** (not `digests.json`; it is generated).

### Task 5: `task-def.mjs` and `build-task.mjs`

**Files:** Create `task-def.mjs`, `build-task.mjs`, `build-task.test.mjs`.

**Interfaces:**
- Produces: `loadTaskDef(taskDir) -> TaskDef`. Schema of `task.json`: `{ id: /^[a-z0-9-]+$/, repo: 'codescout'|'claude-plugins', repoPath, fix, parent, subsystem, testRunner: 'cargo'|'node'|'sh', hidden: { files: string[], extra?: string[], graftLines?: [{ file, line }] }, buildCommand: string[], f2p: { command: string[], names: string[] }, p2p: { command: string[], names: string[] }, testPatterns: string[], scrub: { removePaths: string[], terms: string[] }, timeoutsSec: { build, test } }`; `TASK.md` and `prompt.txt` sit beside it. It rejects absolute paths, `..` segments, empty `f2p.names` and unknown runners, each by name.
- Produces: `buildTask(taskDir, { workRoot }) -> Manifest`. It writes `<workRoot>/tasks/<id>/tree/`, `hidden/` and `manifest.json` `{ id, repo, fix, parent, treeHash, hiddenHash, promptHash, taskMdHash, def }`.
- Produces: `reflinkCopy(src, dst)` (`cp -a --reflink=always`; it throws rather than falling back to a full copy).

Tree: `git archive <parent>` unpacked; remove `scrub.removePaths`, every `CLAUDE.md`, `AGENTS.md`, `.claude/` and `.codescout/`; write a task `CLAUDE.md` from a template that names `buildCommand` and how to run the tests; write `TASK.md`; `git init`, one commit `task <id>` by `s5 <s5@localhost>`, no remote. Then search the tree for each scrub term (fixed string) and throw, naming the file, if one is found. `hidden/` holds the fix commit's version of each `hidden.files` path, plus every file of the task's own `extra-tests/` directory (authored behaviour-preservation tests, listed in `hidden.extra`, their names in `p2p.names`). Hashes: sha256 over the sorted (path, bytes) pairs, `.git` excluded.

- [ ] **Step 1: Write the failing tests** (fixture repo):
  - `the tree has the parent's content, exactly one commit and no remote`
  - `hidden/ holds the fix commit's version of each hidden file and the task's extra-tests/ files`
  - `CLAUDE.md, AGENTS.md, .claude/ and .codescout/ are removed and the task CLAUDE.md is written`
  - `a scrub term left in the tree throws and names the file`
  - `treeHash changes when TASK.md changes by one byte; hiddenHash changes when a hidden file changes by one byte`
  - `loadTaskDef rejects an absolute hidden path, a '..' path, empty f2p.names and runner 'pytest', each by name`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 6: `grade.mjs` (load-bearing: Opus review with a mutation lens)

**Files:** Create `grade.mjs`, `grade.test.mjs`, `fixtures/test-output/` (recorded cargo, `node --test` and shell outputs).

**Interfaces:**
- Consumes: `dockerRun`, `reflinkCopy`, `Manifest`.
- Produces: `graftHidden(treeDir, manifest)`: overwrite each hidden file with the `hidden/` version; append each `graftLines` line once (idempotent).
- Produces: `parseCargo(stdout) -> { results: Map<name, 'ok'|'FAILED'|'ignored'>, compileError: boolean }`; `parseNodeTest(stdout) -> { results, nonAssertionFailures: string[] }`; `parseSh(status) -> { results }`.
- Produces: `gradeTree(manifest, agentTreeDir, { workRoot, image, timeouts }) -> Promise<{ build: 'ok'|'failed'|'timeout', f2p: { passed, failed, notRun }, p2p: { passed, failed, notRun }, pass: boolean, diff: { files, insertions, deletions } }>`.

The grade runs in a fresh container with `--network none` on a reflink copy of the agent tree plus the task's warm target. Pass = build `ok` and every F2P and P2P name passed; a name not run counts as failed. The diff stats come from `git diff --shortstat` run **inside** the grade container.

- [ ] **Step 1: Write the failing tests:**
  - `parseCargo reads ok, FAILED and ignored lines, and flags error[E0425] as a compile error`
  - `parseNodeTest separates assertion failures from a ReferenceError`
  - `pass is false when a listed F2P name is missing from the output`
  - `pass is false when the build failed, even if no test reports a failure`
  - `graftHidden overwrites the agent's edit to a hidden file; graftLines are appended once on a second graft`
  - `git diff runs in the container: the fake docker sees it and no host git process gets the agent tree`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 7: `gate-task.mjs`

**Files:** Create `gate-task.mjs`, `gate-task.test.mjs`.

**Interfaces:**
- Consumes: `gradeTree` internals (`graftHidden`, the parsers), `dockerRun`, `reflinkCopy`.
- Produces: `warmTask(manifest, { workRoot, baseTarget? })`: for cargo tasks, run `cargo fetch` for the parent's `Cargo.lock` into `<workRoot>/cargo-home` in a networked container (no model), then reflink the base target (if given) into `<workRoot>/tasks/<id>/target` and run the task's `buildCommand` there (it builds the tests without running them, for example `cargo test --no-run`).
- Produces: `gateTask(manifest, { workRoot }) -> Promise<{ ok, reasons: string[], atParent, atFix: [runs] }>`.

Reasons: `compile_at_parent` (the hidden tests do not compile at P: they name a symbol P lacks); `f2p_passes_at_parent`; `non_assertion_failure`; `hidden_test_not_run`; `p2p_fails_at_parent`; `fails_at_fix`; `flaky_at_fix` (any failure in 3 consecutive runs at the fix). A `sh` runner cannot tell an assertion from another failure, so it adds `manual_review_needed` without failing the gate.

- [ ] **Step 1: Write the failing tests** (fake docker with scripted outputs per phase): one test per reason, plus `ok is true when F2P fails by assertion at P and everything passes 3 times at C`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: `prereg.mjs` (load-bearing: Opus review with a mutation lens)

**Files:** Modify `effort-steering/spikes/s4-prereg.mjs` (export `requireCommitted`; no behaviour change). Create `prereg.mjs`, `prereg.test.mjs`.

**Interfaces:**
- Consumes: `requireCommitted(file, bytes)` from `../s4-prereg.mjs`.
- Produces: `loadS5Prereg(file) -> Prereg`, validating then requiring the committed bytes. Fields: `{ model, cli: { version, sha256 }, arms: { A: { effort, steer: false, runs }, B: { effort, steer: true, runs }, C: { effort, steer: false, runs } }, tasks: [{ id, treeHash, hiddenHash, promptHash }], margin, alpha, bound: { method: 'percentile'|'paired-t', resamples, seed }, orderSeed, mechanism: { alpha, permutations, seed, effectSizeThinkingTokens }, limits: { timeoutMinutes, cpus, memoryGb, concurrency, infraRetries }, images: { codescout, 'claude-plugins', proxy }, proxyAllowlist: string[], stopAtCostUsd }`.
- Produces: `checkTasksMatch(prereg, workRoot) -> string[]` (ids whose manifest hashes differ).

Checks, each refused by name: `A.effort === B.effort`; the steer flags exactly as listed; C's effort strictly below A's in `low < medium < high < xhigh < max`; `runs` safe integers with A and B ≥ 2 and C ≥ 1; at least 8 tasks with unique ids and 64-hex hashes; `0 < margin < 1`; `0 < alpha <= 0.1`; `resamples >= 2000` for `percentile`; `mechanism.permutations >= ceil(1 / mechanism.alpha) - 1`; `1 <= timeoutMinutes <= 240`; `concurrency >= 1`; `infraRetries` between 0 and 5; digests match `^sha256:[0-9a-f]{64}$`; a non-empty allowlist of hostnames; `stopAtCostUsd > 0`.

- [ ] **Step 1: Write the failing tests:** one refusal test per check; `a committed valid file loads`; `a valid file that differs from HEAD is refused` (temp git repo, as in `s4-prereg.test.mjs`); `checkTasksMatch names a task whose manifest treeHash differs`.
- [ ] **Step 2: Run** `node effort-steering/spikes/s5/prereg.test.mjs` and `node effort-steering/spikes/s4-prereg.test.mjs`. Expected: S5 FAIL, S4 PASS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 9: `analyze.mjs` (load-bearing: Opus review with a mutation lens)

**Files:** Create `analyze.mjs`, `analyze.test.mjs`, `analyze.sim.test.mjs`.

**Interfaces:**
- Consumes: `makeRng` from `../s4-prng.mjs`; `analyzeArms` from `../s4-analyze.mjs`.
- Produces: `perTaskScores(rows) -> { scores: Map<taskId, { A, B, C, nA, nB, nC }>, excluded: { taskId, reason }[] }`. Only final model rows count (graded, or a model failure such as a timeout); infrastructure rows never count. A task without at least one counted run in every arm is excluded and listed.
- Produces: `pairedLowerBound(diffs, { method, resamples, seed, alpha }) -> { mean, lower }`. `percentile`: resample tasks with replacement using `makeRng(seed, 7)`, lower = the `alpha` quantile. `paired-t`: `mean - t(1 - alpha, n - 1) * sd / sqrt(n)`.
- Produces: `verdict({ gateLower, niLower, margin }) -> 'uninformative'|'non_inferior'|'not_shown_safe'`.
- Produces: `selectCalibrated(rows) -> { kept: taskId[], dropped: { taskId, reason: 'never_solved'|'effort_idle' }[] }`. Drop when A passes 0 of its runs, or when A passes all and C passes all.
- Produces: `mechanism(rows, prereg)`: maps B to `treated` and A to `holdout`, the task index to `promptIndex`, `usage.main.thinking` to `thinking_tokens`, and calls `analyzeArms` with `{ direction: 'down', effectSizeThinkingTokens, minPerArm: <included task count>, alpha, permutations, seed }`. It reports the same for `usage.main.output` and, descriptively, for `usage.total`.
- Produces: `secondaries(rows)`: cost per resolved task per arm (failures counted); pass^3 per arm (per task `C(c,3)/C(n,3)`, mean over tasks); counts of timeouts, `testsRunBeforeDone === false` and infrastructure exclusions; the discordant tasks; per-task log-ratio of mean output and thinking (B over A) with a percentile interval.
- Produces: `analyzeS5(rows, prereg) -> Report`; `simulate({ nTasks, runs, pA: [lo, hi], deltaB, deltaC, trials, seed, method, resamples }) -> { niRate, gateRate }`. Task pass rates are drawn uniformly from `pA`; B and C are shifted by `deltaB` and `deltaC`.

- [ ] **Step 1: Write the failing tests** in `analyze.test.mjs`:
  - `verdict: a gate lower bound of 0 gives uninformative whatever the NI bound`
  - `verdict: gate ok and NI lower -0.149 gives non_inferior; -0.15 gives not_shown_safe`
  - `pairedLowerBound is deterministic for a seed; [0,0,0] gives mean 0 and lower 0`
  - `paired-t lower bound of a fixed vector equals the hand value` (t(0.95, 31) = 1.6955)
  - `infrastructure rows never count; a task with no counted C run is excluded and listed`
  - `pass^3: 2 of 3 gives 0, 3 of 3 gives 1`
  - `selectCalibrated drops A 0/2 as never_solved and A 2/2 with C 1/1 as effort_idle, and keeps A 1/2`
  - `mutation guard: swapping arms A and B flips the sign of the mean difference`
  - `mutation guard: pooling runs instead of task means changes the result on a task with 3 runs against one with 1`
- [ ] **Step 2: Write the failing simulation tests** in `analyze.sim.test.mjs` (32 tasks, runs A 3, B 3, C 2, `pA` [0.3, 0.95], 1,000 trials, 1,000 resamples):
  - `at deltaB -0.15 the NI rate is at most 0.065`
  - `at deltaB 0 the NI rate is at least 0.6`
  - `at deltaC 0 the gate rate is at most 0.065`

  Run both methods. The module's default `method` is the one that passes; if both pass, `percentile`. Record the measured rates in the commit message.
- [ ] **Step 3: Run** both files. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit.**

### Task 10: `hook-copy.mjs` and `run.mjs` (load-bearing: Opus review with a mutation lens)

**Files:** Create `hook-copy.mjs`, `run.mjs`, `run.test.mjs`, `fixtures/fake-claude.mjs` (writes a scripted transcript, a decision-log line and `--output-format json` stdout into the mounted directories).

**Interfaces:**
- Produces: `writeHookCopy(root, esRoot) -> { copyDir, settingsFile }`. Copies `bin/`, `core/` and `adapter/` without `*.test.mjs`; `core/rules.json` holds one rule `{ id: 's5-all', level: 'shallow', confidence: 'high', reason: 's5', when: { minChars: 0 } }`; the settings register `node /opt/es/adapter/claude-code/user-prompt-submit.mjs` as the `UserPromptSubmit` command (the container path).
- Produces: `planRunsS5(prereg, { mode: 'measure'|'calibrate'|'pilot'|'smoke', taskIds? }) -> Run[]` with `Run = { runId, taskId, taskIndex, arm, effort, steer, rep, round }`. Each task's arm-reps are shuffled with `makeRng(orderSeed, 11 + taskIndex)`; the plan iterates rounds, and within a round the tasks in registered order.
- Produces: `runOne(run, ctx) -> Promise<Row>`. Reflink copies of the tree and warm target; per-run config and state directories; the hook copy and settings mounted read-only at `/opt/es`; environment `CLAUDE_CONFIG_DIR=/run/config`, `XDG_STATE_HOME=/run/state`, `EFFORT_STEERING_HOLDOUT_RATE` (`'0'` for B, `'1'` otherwise), `HTTPS_PROXY`, `CLAUDE_CODE_OAUTH_TOKEN` (by name); the spec's invocation with stdin from `/dev/null` and cwd `/work`. After the exit: `readRunUsage`; decision log (B steered, A and C not) else infrastructure `arm_mismatch`; efforts equal `[effort]` else infrastructure `effort_mismatch`; API error or OOM is infrastructure; a timeout is the model failure `timeout`; then `gradeTree`; cost and turns from the JSON stdout. `Row = { runId, taskId, taskIndex, arm, effort, rep, round, sessionId, startedAt, wallMs, exit, infra, final, decision, usage, efforts, costUsd, numTurns, firstUserTextOk, testsRunBeforeDone, finalTextTail, grade }`.
- Produces: `runBatch(prereg, { mode, workRoot, rowsFile, concurrency, stopAtCostUsd, taskIds? }) -> Promise<Summary>`. Before `measure`: `checkTasksMatch` empty, image digests and the CLI sha256 equal the prereg, else refuse. Resume skips runs whose row is final; an infrastructure row is re-run up to `infraRetries`, then written as `infra_exhausted`. When the summed `costUsd` reaches `stopAtCostUsd`, no new run starts, in-flight runs finish, and a `stopped` line is written. `smoke` mode runs one run per arm on one task and checks: `firstUserText` equals `prompt.txt`, a decision-log line exists in every arm, B is steered.

- [ ] **Step 1: Write the failing tests:**
  - `writeHookCopy: the settings command uses /opt/es; rules.json holds the one shallow rule; no *.test.mjs is copied`
  - `B sets holdout rate '0'; A and C set '1'`
  - `the token value appears in neither argv nor any row`
  - `an effort mismatch gives an infrastructure row and a re-run, at most infraRetries times, then infra_exhausted`
  - `a timeout gives a final model-failure row with pass false and no re-run`
  - `resume skips final rows and re-runs an interrupted run`
  - `the stop rule starts no run after the summed cost reaches the limit and writes a stopped line`
  - `the order is deterministic for a seed, differs for another seed, and contains each task's arm-reps exactly once`
  - `measure mode refuses to start when a manifest hash differs from the prereg`
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 11: `s5.mjs` CLI and `README.md`

**Files:** Create `s5.mjs`, `s5.test.mjs`, `README.md`.

**Interfaces:** subcommands `mine`, `build <taskDir>`, `warm <taskId>`, `gate <taskId>`, `images`, `proxy up|down|log`, `run --mode <m> --prereg <file> [--tasks <ids>]`, `grade <runId>`, `select --rows <file>`, `analyze --prereg <file> --rows <file>`, `simulate`. A usage error exits 64, as `effort-policy` does.

`README.md` holds the runbook below and the instrument rules (from the spec, memory `research/effort-steering`, and the usage rule of this plan).

- [ ] **Step 1: Write the failing tests:** `--help lists every subcommand`; `an unknown subcommand exits 64`; `run without --prereg exits 64`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the S5 tests and `./tests/run-all.sh`. Expected: all PASS.
- [ ] **Step 5: Commit.**

---

## Runbook after the plan (operator gates; not SDD tasks)

0. **Token.** The operator runs `claude setup-token` and stores the token in `~/.config/s5/token` (mode 600). The runner reads it into the docker process environment only.
1. **Mine** both repos into `tasks/candidates.json`; commit.
2. **Pilot tasks.** A Sonnet subagent drafts about 8 task definitions (`task.json`, `TASK.md`, `prompt.txt`); an Opus review checks each for leaks and unfair tests; `build`, `warm`, `gate`.
3. **Pilot gate** (about 13 runs, operator approval). Proxy control: one task, arm A, 2 runs on the open bridge network and 2 through the proxy in `log-all` mode. The first request's input size must match exactly (the wire recorder doubled it once), and thinking and output must agree within run-to-run spread. The proxy log gives the allowlist. Then 3 tasks × A, B, C × 1 run. Measure the client cost estimate per run, the plan usage (the operator reads the usage page before and after), run time (sets T), grade time and disk per run.
4. **Authoring** of the remaining tasks to about 50 candidates; Opus review; `build`, `warm`, `gate`.
5. **Calibration gate** (about 150 runs). `select` applies the drop rule. If fewer than 32 tasks survive, the operator chooses more curation or a wider margin.
6. **Registration gate.** Commit `s5-prereg.json`. Attach the `simulate` output for the registered numbers to the commit message.
7. **Measured-run gate** (about 256 runs).
8. `analyze`; write the result into ES-22; the operator rules on G4.
