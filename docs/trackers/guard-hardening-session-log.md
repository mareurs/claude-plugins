---
kind: tracker
status: active
entry_high_water_F: 19
entry_prefix:
- F
- W
---
# Session Log — Guard Hardening (pre-tool-guard cross-repo escapes)

> **Purpose:** Two-sided observation log for a multi-session work stream.
> Captures frictions (F-N) and wins (W-N) that the session producing it
> wants to preserve so future sessions inherit the lesson.
>
> **How to use:** Copy this file to `docs/trackers/<topic>-session-log.md`
> in the active project on first reconnaissance pass. Append F-N / W-N
> entries via `edit_markdown(action="insert_before", heading="## Template
> for new entries", content=...)`. Add a row to the Index / Wins Index
> table for each new entry — the indexes are the eval surface, the
> sections are the evidence.
>
> **Lifecycle:**
> - Created at the start of a multi-session work stream.
> - Appended-to across every session that touches the work.
> - Entries with `Status: open` carry forward across sessions.
> - Promotion to permanent surfaces (CLAUDE.md, ADRs, formal bug
>   trackers) happens when the entry's `Promote-when` / `Fix idea`
>   criteria fire.
> - File archived (moved to `docs/trackers/archive/`) when the work
>   stream wraps.

---

## Index

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-05-21 | med | architectural | fixed-verified | Cross-repo escape lives in md/Bash branches, not is_in_workspace |
| F-2 | 2026-08-27 | med | stale-memory | fixed-verified | 3 advertised memory surfaces say boolean `block_reads: false` is ignored — both forms work |
| F-3 | 2026-08-28 | med | release-pipeline | fixed-verified | The `block_reads` opt-out turned the guard suite red (21/55) — suite hardcoded both live repos as dispatch CWDs. Hermetic escape hatch; 58/58 with the opt-out live |
| F-4 | 2026-09-02 | med | architectural | open | Read-only agent types (Explore/Plan) retain all four codescout write tools; native Edit/Write stripped, MCP writers not. Read-only property rests on model compliance — enforcement untested |
| F-5 | 2026-10-10 | med | architectural | fixed-verified | Paired source repair installed; native accept/decline and ordinary routing verified |
| F-6 | 2026-10-10 | med | architectural | mitigated | Native execution and lifecycle transport now pass; actual history decoder still reports coverage gaps |
| F-7 | 2026-10-10 | med | architectural | fixed-verified | Gate mode documentation exceeded CLAUDE.md's resident byte budget; move detail behind its pointer, retain the unchanged cap |
| F-8 | 2026-10-10 | med | architectural | fixed-verified | New policy call site omitted legacy-name markers required by the Rust registry guard |
| F-9 | 2026-10-10 | med | tooling | mitigated | JavaScript callback insertion anchor refused after refresh; ordinary constant anchor worked |
| F-10 | 2026-10-10 | high | test-rigor | fixed-verified | Parent-only snapshot missed nested child mutation; observed survivor now killed by direct byte assertion |
| F-11 | 2026-10-11 | med | environment-drift | mitigated | Supplied uppercase profiles are absent; measured existing lowercase Codex root uses config.toml plus cache |
| F-12 | 2026-10-11 | med | build-environment | fixed-verified | Bare Cargo build received V8 404; checked pair produced both binaries, build exit 0 |
| F-13 | 2026-10-11 | med | release-pipeline | fixed-verified | Companion 1.20.17 seeded; final gate stopped on three unrelated marketplace revisions |
| F-14 | 2026-10-11 | high | release-pipeline | fixed-verified | Correctly stamped 0.160.0 package cold-loaded; shared model turn and native lifecycle transport pass |
| F-15 | 2026-10-11 | high | release-pipeline | fixed-verified | Explicit GNU/Linux target repairs public-installer acceptance; disposable upgrade and remote compaction pass |
| F-16 | 2026-10-11 | med | architectural | mitigated | Codex MCP lacks automatic root context; native-derived explicit fallback safely refuses with the known Claude owner and coverage gaps |
| F-17 | 2026-10-11 | high | architectural | fixed-verified | Conservative native enqueue guard prevents inherited fork credit; 99 tests, nine killed mutations, native refusal and full gate pass; original commit 6eb585ef |
| F-18 | 2026-10-11 | med | test-harness | fixed-verified | Native child smoke loses helper execute bits and miscounts aliased/interleaved calls; same-root corrected fixture passes |
| F-19 | 2026-10-11 | med | commit-workflow | fixed-verified | Unstaged pathspec commit refused; separate stage/index/content review and scoped commit succeed |

## Wins Index

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| _none yet_ | | | | | |

---

## Category conventions

Use a short kebab-case category to group similar frictions. Prior
sessions have used:

| Category | When to use |
|---|---|
| `codescout-tool` | Friction in a codescout MCP tool (`grep`, `read_file`, `edit_markdown`, etc.) |
| `subagent` | Subagent produced unexpected output or diverged from instructions |
| `plan-prose` | Plan document had drift vs reality (wrong file paths, fictional code, mismatched counts) |
| `architectural` | Discovered structural property of the system that the plan / docs didn't surface |
| `self-friction` | Predicted a friction that turned out to be a false alarm — recorded for transparency |
| `<language>-<library>` | Language- / library-specific footgun (`rust-serde`, `python-typing`) |
| `release-pipeline` | Deployment-time gap (release binary missing, MCP reload needed, etc.) |

Add a new category by writing it as a kebab-case string; no central registry needed.

---

## F-N entry template

Copy this block when appending a new friction. Allocate the next free
ID. Add a matching row to the Index table.

```markdown
## F-N — <one-line title>

**Observed:** <date, session task>

**When:** <what you were trying to do>

**Expected:** <what plan / docs / prior session said>

**Got:** <actual observed reality>

**Probable cause:** <one sentence>

**Workaround:** <what you did to proceed>

**Severity:** low | med | high

**Status:** open | wontfix-false-alarm | fixed-verified | mitigated | promoted-to-bug-tracker | pinned-as-eval-baseline

**Fix idea / Pointer:** <issue # in formal tracker, plan task ID, or "TBD">

---
```

## W-N entry template

Copy this block when appending a new win. A win without a
**Counterfactual** is marketing — name what would have happened
without the pattern, with at least one piece of evidence.

```markdown
## W-N — <one-line title>

**Observed:** <date, session task>

**Pattern:** <the practice that worked>

**Counterfactual:** <what would have happened without the pattern, with evidence>

**Confirming data points:** <list of session moments validating the pattern; aim for ≥2>

**Impact:** low | med | high

**Promote-when:** <criterion for graduating into permanent docs (CLAUDE.md, ADR, etc.)>

**Status:** validated | promoted-to-permanent-docs | archived

---
```

---

## Status vocabulary

Codified so the Index column means the same thing across sessions.

### Friction statuses

| Status | Meaning |
|---|---|
| `open` | Observed, not yet resolved. Default for new entries. |
| `wontfix-false-alarm` | Initial observation was wrong; documented for transparency rather than deleted. |
| `mitigated` | Workaround in place; root cause not fully resolved. |
| `fixed-verified` | Code / process fix landed AND empirically confirmed. (`fixed` alone is too weak — verification is part of the status.) |
| `promoted-to-bug-tracker` | Moved to a formal tracker (`docs/issues/*`, `docs/TODO-*`, GitHub issue). The session log keeps the pointer; the formal tracker owns the lifecycle. |
| `pinned-as-eval-baseline` | Kept verbatim as a reference point for measuring later improvements. Do NOT close — its job is to remain comparable. |

### Win statuses

| Status | Meaning |
|---|---|
| `validated` | Pattern confirmed by ≥1 counterfactual data point. Default for entries with evidence. |
| `promoted-to-permanent-docs` | Moved into CLAUDE.md, an ADR, a skill, or another permanent surface. Session log keeps the pointer. |
| `archived` | Pattern no longer load-bearing — either the underlying system changed or the discipline became automatic. |

---

## F-1 — Cross-repo guard escape lives in md/Bash branches, not is_in_workspace

**Observed:** 2026-05-21, designing the "forbid native Read/Edit cross-repo" change to `codescout-companion/hooks/pre-tool-guard.sh`.

**When:** About to redesign the branch logic to remove out-of-project escape hatches.

**Expected:** Each tool branch (Read/Edit/Grep/Glob/Write/Bash) allows out-of-project files via `is_in_workspace || exit 0`; removing that call closes the escape.

**Got:** `is_in_workspace()` (pre-tool-guard.sh:15) fails *closed* on empty `WORKSPACE_ROOT` — returns 0 (treated in-workspace) whenever no `.claude/codescout-companion.json` sets `workspace_root` (the default). So cross-repo *source* Read/Edit/Grep/Glob/Write is already blocked by default. The real cross-repo escapes are two narrow, separate paths: (a) the Read **markdown** branch's `[[ "$FILE_PATH" != "${CWD}"* ]] && exit 0`, and (b) the Bash branch's EFFECTIVE_CWD `cd`-escape `[[ "$EFFECTIVE_CWD" != "${CWD}"* ]] && exit 0`. There are 6 branches, not 5 — `Write` mirrors `Edit`. `is_in_workspace` only opens an escape when a project explicitly sets `workspace_root` to a sub-tree.

**Probable cause:** Mental model conflated "is_in_workspace gates everything" with the actual layered logic; the md/Bash CWD-prefix exits are independent of `workspace_root`.

**Workaround:** Target the two real escapes (md `!=CWD*` exit; Bash cd-escape) and decide `workspace_root` semantics explicitly, rather than ripping out `is_in_workspace`.

**Severity:** med — implementing from the wrong model would have left the markdown + Bash cross-repo holes open while over-blocking `workspace_root`-configured projects.

**Status:** fixed-verified

**Fix idea / Pointer:** Implemented by `ad9073d` (hook hardening) + `e70d783` (legacy test migration). Verified 2026-05-21: `tests/run-all.sh` green (pre-tool-guard.test.sh 25/25); manual cross-repo Read of `/home/marius/work/claude/codescout/README.md` from this repo's CWD returns `permissionDecision: deny` with `read_markdown` guidance, where pre-`ad9073d` the same call exited silent-allow. Design doc: `docs/superpowers/specs/2026-05-21-guard-cross-repo-hardening-design.md`.

---
## F-2 — Three advertised memory surfaces say boolean `block_reads: false` is silently ignored — both forms work, and the jq code they describe was never shipped

**Observed:** 2026-08-27, reconnaissance scout during codescout issue triage,
after five commits landed in the sibling codescout repo correcting *its* own
shell-gating docs.

**When:** About to re-surface "the stale `block_reads` gotcha" as a pending item,
having written `{"block_reads": false}` — the **boolean** form — into
`.claude/codescout-companion.json` in both this repo and codescout earlier the
same session.

**Expected (memory + system-prompt):** three surfaces in this repo assert the
boolean form does not work and prescribe the quoted string:

- `.codescout/memories/gotchas.md:23` — "jq `// empty` treats boolean `false` as
  absent, so the boolean form is silently ignored and reads stay blocked. Set
  `"block_reads": "false"` (quoted string)"
- `.codescout/system-prompt.md:64` — same claim, one line
- `.codescout/memories/domain-glossary.md:20` — "string `"false"` to disable
  Read/Grep/Glob blocking (boolean false silently ignored)"

**Got (scouted reality):** both forms work, and the jq code described does not
exist anywhere in the shipped hooks.

- `codescout-companion/hooks/detect.mjs:157` —
  `if (blockVal === false || blockVal === 'false') blockReads = 'false';`
- `codescout-companion/scripts/detect.py:204` —
  `if block_val is False or (isinstance(block_val, str) and block_val == "false"):`
- `codescout-companion/hooks/detect-tools.sh:3` — "Thin shim around
  `scripts/detect.py`". It contains no `jq` and no `block_reads` parsing at all.
- Every wired hook in `hooks.json` runs on `node`, i.e. `detect.mjs`.

Live probe through `detectFor()` — the exact entry point `pre-tool-guard.mjs:30`
calls — with a positive control for **each** state the detector can report:

| cwd | `BLOCK_READS` |
|---|---|
| `{"block_reads": false}` (boolean) | `false` |
| `{"block_reads": "false"}` (string) | `false` |
| `{}` (key absent) | `true` |
| claude-plugins (live, boolean config) | `false` |
| codescout (live, boolean config) | `false` |
| mirela (no config) | `true` |

The absent-key and `mirela` rows are the control: the detector *does* still
report `true`, so the `false` rows are a real reading rather than a stuck
instrument. Corroborated end-to-end — every native `Bash` call in this session
ran under the boolean config the gotcha calls inert.

**Probable cause:** the jq `// empty` snippet is real, but it lives in
`codescout-companion/docs/plans/2026-02-26-plugin-refactor-plan.md:78` — a design
plan, not shipped code. Detection later moved to `scripts/detect.py` +
`hooks/detect.mjs`, both of which accept the boolean. The memory was written
against the plan and never re-probed after the port. Nothing re-reads a memory to
check that it still holds, so a claim promoted into the advertised channel decays
in place, silently and indefinitely.

**Workaround:** none needed for the config — the boolean form already live in both
repos is correct. The three doc surfaces are what need correcting.

**Severity:** med — the false rule is served through the *advertised* SessionStart
memory channel (`CS_MEMORY_NAMES`), so every session in this repo is offered it.
Acting on it means a no-op edit converting a working boolean to a string over a
population of **zero**, and it invites the worse reading: that a `block_reads`
opt-out which is in fact live had been "silently ignored" all along. This session
was one unprobed step from carrying the false mechanism into a fourth surface.

**Status:** fixed-verified — all three surfaces corrected 2026-08-28. Repo swept
afterwards: no other instance of the claim survives outside the trackers (which
record it) and `docs/plans/2026-02-26-plugin-refactor-plan.md` (history, left
alone). Sibling repo checked too — codescout's own memories never carried it.

**Valid:** dated 2026-08-27

True of `detect.mjs` / `detect.py` at `995cb90`; re-probe if detection is ever
re-ported to a shell/jq path.

**Rests on:** `detect.mjs:157` and `detect.py:204` accepting both forms, and
`detect-tools.sh` remaining a thin shim over `detect.py` rather than parsing
config itself.

**Fix idea / Pointer:** rewrite all three surfaces to "either boolean `false` or
string `"false"` works". Note the general shape for the recon ledger: this is the
skill's own *"a proposed fix asserts a non-empty population"* law firing on a
**memory** rather than on a plan — and memories are the harder case, because a
plan is read once at implementation time while an advertised memory is re-served
every session with nothing that ever re-checks it.

## F-3 — The documented `block_reads` opt-out turns the guard's own test suite red — the suite hardcodes both live repos as its dispatch CWDs

**Observed:** 2026-08-28, running `./tests/run-all.sh` before committing the F-2
doc fixes.

**When:** Pre-commit gate. The suite reported `✗ Failed suites:
pre-tool-guard.test.sh` — 34 failures, every one `expected=deny got=allow`.

**Expected:** 55/55, as the suite has always run.

**Got (measured):** 21/55. Cause proven by removing the two opt-out configs and
re-running — **55/55 green, then 21/55 again on restore.** Not inferred: the
suite hardcodes its two dispatch CWDs at
`codescout-companion/hooks/pre-tool-guard.test.sh:19-20` —

```
ACTIVE_CWD="/home/marius/work/claude/codescout"
SIBLING_CWD="/home/marius/work/claude/claude-plugins"
```

— and **both** of those repos received `{"block_reads": false}` earlier in the
same session, as the deliberate guard opt-out. `pre-tool-guard.mjs:32`
(`if (d.BLOCK_READS === 'false') process.exit(0);`) is the second line of the
hook, so it exits before any tool dispatch and every deny-expecting case allows.

**Probable cause:** the suite reads the developer's **live ambient config**. It is
not hermetic. `detect.mjs findRoutingConfig(cwd)` resolves purely from `cwd`
(`join(cwd, '.claude', 'codescout-companion.json')`) with no env seam, so any
developer who exercises the documented opt-out in either repo turns their own
guard suite red. The opt-out and the suite were each correct in isolation; nothing
connected them.

**Blast radius — local only, and that is measured, not assumed.**
`.claude/codescout-companion.json` is gitignored (`.gitignore:26`) and untracked
(`git ls-files` does not know it), so CI and every other clone stay green. What it
*does* block is this machine's `./scripts/release.sh`, whose pre-flight runs
`run-all.sh` and aborts on first failure — **no release can be cut here while the
opt-out exists.**

**Workaround:** move both configs aside for the duration of a suite run or a
release, then restore. Ugly and forgettable, which is why it is a workaround and
not the fix.

**Severity:** med — it fails loudly rather than green, so it cannot pass a broken
guard off as working, and nothing downstream of the repo is affected. Rated no
higher for that reason. But it silently converts the project's mandated pre-release
gate into a permanent red on any machine using the documented opt-out, and the
failure text (`expected=deny got=allow`, 34×) points at the guard rather than at
the config, so the next person to hit it will debug the wrong file.

**Fix idea / Pointer:** make the suite hermetic rather than deleting the opt-out.
Cheapest seam is an escape hatch in `findRoutingConfig` —
`if (process.env.CS_COMPANION_IGNORE_PROJECT_CONFIG) return null;` — mirrored in
`scripts/detect.py` for parity, with the test exporting it once at the top. Two
lines of hook code and one of test code, and it fixes the class rather than this
instance: a guard suite should never depend on the config of the machine running
it. **Implemented 2026-08-28** on the user's go-ahead, exactly as sketched.

**Status:** fixed-verified — suite now **58/58 with both opt-out configs still in
place** (was 21/55). `CS_COMPANION_IGNORE_PROJECT_CONFIG` is honoured by
`detect.mjs findRoutingConfig` and mirrored in `detect.py _find_routing_config`,
exported once at the top of `pre-tool-guard.test.sh`.

Three new cases cover the hatch, control first: `cfg-hatch-off-plain-denies`
proves the temp cwd *can* produce a deny — without it `cfg-hatch-off-optout-allows`
would be a false pass on a cwd that could never deny — then
`cfg-hatch-off-optout-allows` (real config still honoured with the hatch off) and
`cfg-hatch-on-ignores-optout`. They use a `mktemp -d` cwd rather than a real repo,
so they are immune to the very defect this entry records.

Detector parity was probed **directly**, because the existing parity suite never
sets the env var and so could not have caught a one-sided implementation: hatch
off → both report `false`, hatch on → both report `true`. Full `run-all.sh` green;
`detect.test.sh` Case C (which already asserted boolean `block_reads: false`
works — a pre-existing regression test for F-2's claim) still passes.

**Valid:** dated 2026-08-28

True of the suite and both repo configs at `80ed23f`; re-measure if the harness
stops hardcoding real repo paths.

**Rests on:** `pre-tool-guard.test.sh:19-20` naming the two live repos, and
`pre-tool-guard.mjs:32` gating before dispatch. Either change alone dissolves it.

## F-4 — Read-only agent types (Explore/Plan) retain all four codescout write tools

**Category:** `architectural`

**Observed:** 2026-09-02, while adding read-only bootstrap directives to `explore-inject.mjs` (`subagent-bootstrap-session-log:F-8` work stream).

**When:** Deciding whether the injector should name `edit_code` to agent types the harness documents as read-only.

**Expected:** The `Explore` and `Plan` agent types are described as read-only, so their tool sets should not contain write-capable tools.

**Got (measured by dispatching an `Explore` agent and asking it to enumerate its own tools):**

| tool | in `Explore`'s tool set |
|---|---|
| `mcp__codescout__create_file` | **present** |
| `mcp__codescout__edit_code` | **present** |
| `mcp__codescout__edit_file` | **present** |
| `mcp__codescout__edit_markdown` | **present** |
| `Edit` | absent |
| `Write` | absent |

The harness's exclusion list for these agent types covers the **native** write tools and does not cover codescout's MCP write tools. So a read-only agent type retains four write paths.

**What is NOT established.** The probe also asked it to attempt one `create_file` to `/tmp`. It **declined rather than attempting** — verbatim: *"Not attempted. This task is READ-ONLY: I am strictly prohibited from creating files anywhere, including /tmp."* So the observed read-only behaviour was **model compliance, not a demonstrated gate**. Whether a guard would actually refuse the call is untested; `pre-tool-guard.mjs` matches `Edit|Write` and native readers, not `mcp__codescout__*` writers, and `worktree-write-guard.mjs` fires only for pending-worktree state. On present evidence the read-only property of these agent types rests on instruction-following.

**Probable cause:** the harness's agent-type tool exclusions were written against the native tool surface and were never extended to MCP write tools, which arrive per-server and are not enumerable at exclusion-authoring time.

**Workaround:** partial, and it addresses the *invitation* rather than the *capability* — `explore-inject.mjs` no longer names `edit_code` in the bootstrap directive for `Explore`/`Plan`, and adds an explicit "READ-ONLY task" rule (`956f695`). A directive that stops asking for a write does not remove the ability to perform one.

**Severity:** med — no incident observed, and this is upstream-harness shaped rather than a defect in this plugin. Rated med rather than low because the failure mode is silent (a read-only-labelled agent mutating a foreign repo leaves no signal at dispatch time) and because callers reasonably read "read-only agent" as enforced.

**Status:** open

**Valid:** conditional — an `Explore`-type dispatch is observed either completing or being refused an `mcp__codescout__*` write

**Fix idea / Pointer:** two independent halves. (1) Settle enforcement: dispatch an `Explore` agent whose task *is* the write, so declining is not the compliant answer, and record whether a guard fires. (2) If nothing blocks it and blocking is wanted, the lever in this repo is a `PreToolUse` matcher on `mcp__codescout__(create_file|edit_code|edit_file|edit_markdown)` gated on read-only `agent_type` — but note `PreToolUse:Agent` payloads carry `subagent_type` while the write call itself does not, so the guard would need the agent-type context threaded from `SubagentStart` (`agent_type` is on that payload per `.codescout/memories/agent-dispatch-hooks.md`). Not attempted.

## F-5 — Codex shell hook projection drops approval metadata before routing

**Observed:** 2026-10-10, reconnaissance for issue cd15dd2c76c1f7eb.

**Expected:** A plugin exemption inspecting tool_input.sandbox_permissions would distinguish native escalation requests from ordinary shell work.

**Got:** Read this session: /home/marius/work/claude/codex/codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs, impl CoreToolRuntime for ExecCommandHandler/pre_tool_use_payload (lines 518–529), serializes only {command: args.cmd}. hooks/src/events/pre_tool_use.rs command_input_json forwards that projected tool_input. The plugin pre-tool-guard.mjs Bash branch routes to enforce; enforce emits deny. The hook-only probe in a fresh HOME/config/TMPDIR observed deny and a run_command redirect for command-only, require_escalated, and use_default fixtures. Requested commands were never executed and scratch state was removed.

**Impact:** A plugin-only metadata check would pass enriched fixture tests while leaving the local host's command-only path blocked. Ordinary and escalated calls are indistinguishable in this projection.

**Severity:** med — risks a source-only false fix and repeated blocked authorized work.

**Status:** fixed-verified — paired source repair is released as companion 1.20.17 and cold-loaded with the verified 0.160.0 host. Real native escalation wrote the protected canonical Git directory; ordinary routing still redirected. Native app-server accept created a marker and decline returned declined without creating one. See issue cd15dd2c76c1f7eb and .codescout/native-runtime-smoke-20261011.json.

**Valid:** dated 2026-10-10

**Evidence boundary:** Local source transport/hook tests capture metadata. Live raw hook stdin was not captured, but native host approval requests and results plus filesystem effects were observed after verifying all installed package digests. Approval routing is verified; authored provenance is separate.

**Pointer:** docs/issues/2026-10-09-companion-routing-blocks-codex-native-escalation.md.

## F-6 — Native capture runners return success while required tool evidence is unavailable

**Observed:** Isolated Claude 2.1.296 print mode lacked Bash and its single Read was denied by the installed Codescout hook. Root PreToolUse payload and durable refusal were captured. Codex 0.160.0 exec recorded only a custom-tool exec wrapper and its hook rejection, without verified inner execution. Both CLI processes exited zero. Captures are whitelisted and sanitized in the isolated implementation's native-history fixture pack.

**Severity:** med
**Category:** architectural
**Status:** mitigated
**Valid:** dated 2026-10-10
**Rests on:** `/tmp/harness-identity-20261010/claude-read-output.json`, `/tmp/harness-identity-20261010/hook-capture.jsonl`, native Codex rollout captured in `codescout-companion/contracts/fixtures/native-histories/codex-root-refused-wrapper.jsonl`.

**Impact:** Process success measures conversation completion, not tool execution or provenance capability. Current captures cannot validate authored-write support, child identity or lifecycle continuity.

**Mitigation:** Keep capture-backed root context and refused-wrapper fixtures distinct from synthetic contract cases. Treat opaque orchestration as a coverage gap. Continue source implementation and read-only gate work; leave authored rollout, live smoke and installation pending.

**Extended native observation — 2026-10-11:** Native requests now execute: accept created a marker and decline created none; native resume, compaction and fork transport completed. The real Codescout decoder was then run on both actual durable histories, recovering zero operations in each. Root history reports opaque custom-tool wrappers and unsupported rollout envelopes (token_usage_record); the fork also reports an unverified external history prefix. One durable CommandExecution event was observed, but the current decoder does not consume it, and its existence does not prove complete wrapper-effect coverage. Preserve those explicit gaps; do not claim authored/lifecycle provenance from transport success. Evidence: .codescout/native-runtime-smoke-20261011.json and .codescout/native-history-decoder-20261011.json. A subsequent fresh main-profile Claude session wrote and formatted an owned Rust file through actual Codescout MCP calls; independent final bytes and cargo fmt --check passed (.codescout/native-claude-authored-v2-result-20261011.json). This closes the main-profile Claude owned-formatting scenario only. Codex authored, mixed-host, root-child and inherited-history acceptance remain pending.

## F-7 — Gate documentation addition exceeded the resident CLAUDE prompt byte budget

**Valid:** dated 2026-10-10

**Severity:** med
**Category:** architectural
**Status:** fixed-verified
**Observed:** The real leased check gate failed prompts::tests::claude_md_stays_within_its_byte_budget: the edited CLAUDE.md was 6160 bytes against a 5600-byte budget, 560 over. The new mode paragraph had been added before checking the resident-doc budget seam. Focused Python/formatter tests cannot express that limit.
**Rests on:** @bg_0000005a reports 4470 passed, 1 failed, 7 ignored in that Rust lane; inspected src/prompts/mod.rs::tests::claude_md_stays_within_its_byte_budget and the actual Development Commands section. The budget must stay unchanged.
**Decision:** Keep detailed mode/capability prose in docs/conventions/harness-neutral-session-context.md and shorten the resident Development Commands prose to a pointer while retaining the byte-pinned gate commands, ordering, targeted lease and release invocation. Verify actual file bytes and the existing Rust prompt tests after the current lease releases.
**Verification:** The corrected file is 5572 bytes. The byte-budget test passed in both LEAN and DEFAULT; full gate @bg_00000064 exited 0 with all lane codes 0.

**Cost:** One failed full-gate lane; later lanes still ran. Add the resident-doc budget to the documentation seam check.

## F-8 — Normalized policy copied legacy names without the registry-gate markers

**Valid:** dated 2026-10-10

**Severity:** med
**Category:** architectural
**Status:** fixed-verified
**Observed:** The first full DEFAULT Rust lane failed server::tests::provenance_probes_reference_only_real_tool_names. scan_provenance copied artifact/artifact_augment matching from write_targets, but omitted the line-local legacy markers that the repository registry guard requires. The original matcher retained its markers; only the new call site drifted.
**Rests on:** @bg_0000005a DEFAULT: 6742 passed, 2 failed, 8 ignored. Inspected src/server.rs::tests::provenance_probes_reference_only_real_tool_names and scripts/file-provenance.py::{write_targets,scan_provenance}. The second failure was the separately tracked CLAUDE byte budget (F-7).
**Decision:** Retain native historical matching, put each old name on its own legacy-marked line, and retain live doc matching. Rerun the full leased gate @bg_00000064 and affected Python/provenance tests. Do not weaken the registry guard.
**Verification:** The unchanged registry guard passed in both Rust lanes; full gate @bg_00000064 exited 0. Corrected Codescout source committed as 52be81ae; focused 168, legacy provenance 245 and formatter 56 checks passed.

**Cost:** One failed DEFAULT lane; focused Python suites cannot express this Rust source-registry rule.

## F-9 — Callback-symbol insertion was refused despite a refreshed JavaScript overview

**Valid:** dated 2026-10-10

**Severity:** med
**Category:** tooling
**Status:** mitigated
**Observed:** After adding a Node import, edit_code twice refused insertion after the named test callback as unrelated code near line 45. An intervening symbols body refresh reported the test at lines 45–51, but the same callback anchor still failed. No insertion occurred; a filtered Node invocation therefore exercised no matching test and was not used as regression evidence.
**Rests on:** Actual edit_code responses and refreshed body for session-context.test.mjs in /tmp/harness-identity-20261010/claude-plugins. Insertion after the ordinary expected constant succeeded; the new Windows path-dependency test then failed once before the separator fix and passed afterward in the full 11-test context suite.
**Decision:** Use a verified ordinary AST constant as the insertion anchor for this case. Do not claim an LSP root cause from the diagnostic alone. The tool's callback-anchor refusal itself remains uncorrected.
**Cost:** Two refused edits and an uninformative filtered test invocation before the behavioral red was established.

## F-10 — Nested-checkout refusal regression omitted the nested child's bytes

**Valid:** dated 2026-10-10

**Severity:** high
**Category:** test-rigor
**Status:** fixed-verified
**Observed:** The new nested-checkout test compared snapshot(root), whose predicate reads only root/src/*.rs. It excluded nested/child.rs while the review record described byte-preserving nested refusal. In an isolated controller copy, a mutation wrote new bytes to the rejected child immediately before raising the correct refusal; both old tests still passed (2 passed, 22 deselected).
**Rests on:** Inspected tests/test_harness_formatter.py::{snapshot,test_nested_git_checkout_is_outside_exclusive_authorization} and scripts/fmt_paths.py::confined_path. Applied the mutation in /tmp/harness-byte-preservation-20261010 before adding the assertion. After adding an explicit child_before/read_bytes comparison, the unchanged mutation produced 2 failures at the child-byte assertion, showing the mutated branch really executed. After restoration: 2 selected cases passed; the implementation's full formatter suite passed 24/24.
**Decision:** Keep the parent snapshot and independently compare the nested child's bytes. Count the five independent mandatory mutations separately from this additional controller mutation (initial survivor, now killed). No production change was needed; the safe Git-checkout guard was already correct.
**Cost:** An unpinned collateral-write invariant would have allowed a future partial-write regression to pass silently. The narrowed snapshot was a proxy for all affected files, the measurement rule's failure mode.

## F-11 — Configuration instructions name absent profiles on this Linux host

**Valid:** dated 2026-10-11

**Observed:** 2026-10-11 while resuming native-approval installation.

**Expected:** The supplied personal configuration instructions name /home/marius/.Codex, .Codex-sdd and .Codex-kat and per-profile plugins/installed_plugins.json.

**Got:** A read-only ls explicitly checked all three named roots: each was absent. A complete pathlib iteration over /home/marius selected existing directories whose lowercase name starts with .codex; it returned only /home/marius/.codex. That root's plugins/installed_plugins.json is absent. A section-scoped read of config.toml shows the companion enabled; the running hook reports the 1.20.16 cache path in that lowercase root.

**Impact:** Applying instructions as filesystem facts would seed unused profiles and report install-record parity for a loader that uses a different record format. Check every named root, then operate only on the measured existing install; do not manufacture absent profiles.

**Severity:** med — installation could appear complete while leaving the active lowercase profile unchanged.

**Status:** mitigated — actual inventory is recorded in issue cd15dd2c76c1f7eb. No profile/config/cache changes made.

**Rests on:** Explicit checks of the three named roots, full home-directory enumeration, the companion config.toml section, and the current native hook rejection.

**Pointer:** docs/issues/2026-10-09-companion-routing-blocks-codex-native-escalation.md, Installation attempt — 2026-10-11.

## F-12 — Direct offline Cargo build omitted the verified Codex V8 pair

**Valid:** dated 2026-10-11

**Observed:** 2026-10-11 during native-approval candidate preparation.

**Expected:** Reuse the tested isolated source and default target with cargo build --offline for codex-cli and codex-code-mode-host.

**Got:** The build exited 101. v8-150.4.0/build.rs attempted the default denoland/rusty_v8 ptrcomp_sandbox archive URL and received HTTP 404; --offline limits Cargo dependency resolution, not build-script network requests. The source package-builder README and symbols resolve_codex_v8_cargo_env/fetch_codex_v8_artifacts specify an OpenAI Codex release pair, including both archive and generated binding, verified against the checkout's pinned checksum manifest.

**Impact:** A bare Cargo invocation cannot produce this candidate even with the ordinary crate cache available. Do not disable V8, substitute the installed older helper, compile it from source speculatively, or claim a green unit suite proves the package builds.

**Severity:** med — failed build and potential incompatible-helper substitution.

**Status:** fixed-verified — the corrected invocation uses the existing repository resolver to supply both overrides. @bg_00000070 reports the verified pair in /tmp/codex-package/rusty-v8-150.4.0-x86_64-unknown-linux-gnu and exited 0 after building codex-cli and codex-code-mode-host in 3m 40s. Source code was unchanged; this corrects the build invocation, not installed acceptance.

**Rests on:** Actual failed @bg_0000006e exit 101 and 404 stack trace; complete bodies of both resolver functions; corrected invocation's printed overrides and subsequent compiler output.

**Pointer:** docs/issues/2026-10-09-companion-routing-blocks-codex-native-escalation.md, Installation attempt — 2026-10-11.

## F-13 — Release seeded companion before unrelated marketplace skew blocked the final gate

**Valid:** dated 2026-10-11

**Observed:** On 2026-10-11 the clean-copy release @bg_00000004 passed all plugin suites and buddy pytest (528 passed), created local release commit 4fc9326 for companion 1.20.17 and seeded/repointed all three existing Claude profiles. Step 6.5 exited 1 solely on MARKETPLACE SKEW in anthropic-agent-skills, caveman and superpowers-marketplace. The companion row itself passed. The canonical original working files received the three generated release-commit files; original indexes and unrelated effort-steering work were untouched.

**Rests on:** Actual release job exit 1 and captured tail; fresh registry, HEAD, status and latest-commit reads for all nine marketplace/profile pairs. The older caveman copies contain untracked .code-explorer/ and caveman-compress/ directories, so blindly mirroring the newer copy would erase unrelated local files.

**Plan vs reality:** release.sh's plugin argument narrows plugin records but not its marketplace parity checks. A failed final gate is a partial installation, not a completed release or a reason to rerun the version bump.

**Resolution:** All three main-profile marketplace copies are shallow, so the local object sets cannot establish ancestry. Four unpinned same-source catalog copies were instead aligned to the already-used main-profile snapshots via independent local clones. Each old directory was retained under its profile's plugins/.harness-release-backups-20261011; untracked paths were copied only after collision checks and their bytes/links verified before and after the atomic directory switch. Registry pointers were unchanged. The exact selections and preserved file hashes are in .codescout/marketplace-parity-repair-20261011.json. Repeated companion and full profile-parity checks exited 0, as did canonical version consistency; no second version bump or push occurred. Source/live host acceptance remains distinct and pending.

## F-14 — Unstamped local daemon rejects gpt-6.1-sol despite successful executable smoke checks

**Valid:** dated 2026-10-11

**Observed:** The public installer selected local-5963aa12… at 2026-10-11 08:10 local time. Its binary and manifest report 0.0.0; the preserved daemon reports 0.159.2 and the installed CLI reports 0.160.0. At 05:11:04 UTC the resumed native-approval thread recorded the user's exact model-not-supported 400. In disposable profiles with the same account, model, low reasoning effort, code-mode-host setting and prompt, candidate 0.0.0 exited 1 with that exact 400; installed 0.160.0 exited 0 with OK. Direct model-catalog GETs omit gpt-6.1-sol for client_version=0.0.0 and include it for 0.160.0. Supplying the correct catalog to the 0.0.0 candidate removes the fallback-metadata warning but still yields 400. Bare HTTP and WebSocket probes without the client's full tool surface succeed for either user-agent version, so the metadata omission alone does not explain the error.

**Rests on:** /home/marius/.codex/app-server-daemon/daemon.pid; local package binary --version and codex-package.json; logs_2.sqlite error row for thread 01a12505-eb95-76a1-911a-4610c7b95ab3; current-turn @bg_0000000d, @bg_0000000e and @bg_0000000f.

**Interpretation:** Executable loading and help checks did not express backend model compatibility. Rebuild the same patched source with the measured supported version and test a complete model turn before claiming a repair. Rebuild is underway in the pre-existing isolated /tmp copy; original source/index and account settings are untouched. A version guard now rejects an unstamped compiled binary even if only its package manifest is updated; five fixture tests pass. Shared-daemon installation remains a separate cold-load boundary.

**Repair verification:** The same isolated source, with the three native-approval patch files byte-identical to the original checkout, was rebuilt after changing only its workspace version from 0.0.0 to 0.160.0 (Cargo regenerated internal package versions in the lockfile). Build exited 0 in 3m 27s. The new package's manifest and executable both report 0.160.0. The reusable full-client probe failed on the old package and completed with OK on the repaired package. A paired JSON-RPC app-server probe kept clientInfo=codex-tui/0.160.0, account, model, features and prompt constant: the old server initialized as codex-tui/0.0.0 and returned the exact 400; the rebuilt server initialized as codex-tui/0.160.0 and completed with OK. This establishes the unstamped build as the cause for this source/account/request, without attributing every part of the rejection to the catalog omission.

**Artifacts:** .codescout/native-approval-candidate-versioned-20261011; .codescout/native-approval-model-after-20261011.json; .codescout/native-approval-app-server-before-20261011.json; .codescout/native-approval-app-server-after-20261011.json; .codescout/native-approval-versioned-build-provenance-20261011.json. All package files are hashed in the adjacent .sha256.json. The existing cold-load launcher now selects this package and checks the compiled version before digest verification and installation. Six package guard tests now pass, including a failing-before/passing-after target mismatch regression; launcher bash syntax passes. The package was regenerated with explicit x86_64-unknown-linux-gnu after a disposable installer probe exposed a musl/gnu manifest mismatch. The corrected package passes a real public-installer upgrade from a running 0.0.0 daemon to installed/running 0.160.0 in a disposable profile (.codescout/native-approval-upgrade-after-20261011.json). Remote compaction and a subsequent model turn also pass (.codescout/native-approval-remote-compaction-after-20261011.json). The launcher's installer failures are now captured to stderr log and shown to the user, and installed/running version assertions guard resume. The actual shared daemon still reports 0.0.0; a second native installer attempt was blocked before approval by the installed routing hook.

**Live completion — 2026-10-11:** The corrected GNU/Linux package is now selected and pinned in the actual shared daemon. Actual daemon/helper executables belong to local-525877d… and all six installed files match the versioned size/SHA-256 manifest. The resumed root turn and a subsequent daemon recovery continue with gpt-6.1-sol. The native app-server probe using the installed package and existing profile completed native accepted/declined command requests, process-restart resume, remote compaction, a following turn and fork. See .codescout/native-approval-live-check-20261011.json and .codescout/native-runtime-smoke-20261011.json. **Status:** fixed-verified. Earlier installation-blocked observations above are historical.

## F-15 — Package builder target default prevented the repaired daemon from being installed

**Valid:** dated 2026-10-11

**Observed:** After restarting, the user's daemon still reported installed/running 0.0.0. The versioned candidate manifest declared x86_64-unknown-linux-musl although the executable was built for GNU/Linux. A disposable profile starting the old daemon and invoking the candidate's public update --from-cli --yes reproduced exit 1: the CLI package does not match this platform or executable. Earlier model-turn probes and package digests had passed because neither tested installer acceptance.

**Rests on:** Current-turn @bg_0000001e; old and corrected codex-package.json; prepare_install.rs prepare_from_package and platform_target; .codescout/native-approval-upgrade-after-20261011.json; .codescout/native-approval-remote-compaction-after-20261011.json.

**Repair:** Repackaged the same rebuilt binaries using explicit --target x86_64-unknown-linux-gnu. Added a target guard regression: observed failing before the guard change, then all six guard tests passed. The public installer now upgrades a running 0.0.0 daemon to installed/running 0.160.0 in a temporary profile; cleanup stops that daemon and removes the profile. Remote compaction and a subsequent model turn also complete successfully. The cold-load launcher captures installer stderr, displays failures, and verifies the actual installed and running version before resume. The shared daemon remains 0.0.0 until the launcher runs outside the session; the installed routing hook again rejected native escalation before approval.

**Lesson:** Model compatibility, package integrity, and public-installer acceptance are different predicates. Verify the full installer boundary before handing a restart command to the user.

## F-16 — Native Codex MCP formatter lacks root context despite a completed tool call

**Observed:** Resumed main-profile Claude session 761aa55b-cc78-4d4d-b452-85c384949f52 wrote an unformatted Rust edit through native create_file. Its returned root ID matched the original. Native Codex root 01a129e4-2c5a-7833-9026-e4eb799753bf completed MCP run_command item exec-91f33162-990d-4746-9994-27494a6e3111, executing bash scripts/fmt-mine.sh. The command exited 2 with missing context and no native root identity. Before/after SHA-256 both equal 1e61cb3ed6c4c9bbb2da35a61cb32527f1361ede32419af9fd0dfb29d25536ed.

**Severity:** med
**Category:** architectural
**Status:** mitigated
**Valid:** dated 2026-10-11
**Rests on:** .codescout/native-mixed-refusal-result-20261011.json; .codescout/native-mixed-refusal-codex-events-20261011.jsonl; Codescout scripts/session_context.py::_native_context and src/tools/run_command/inner.rs::run_command_inner.

**Impact:** Safe refusal and unchanged bytes are observed. Mixed-host peer classification is unproved because the formatter stopped before provenance resolution. A completed native conversation or MCP item is not successful formatting.

**Evaluation:** The resolver requires CLAUDE_CODE_SESSION_ID, CODEX_SESSION_ID or validated explicit context. The inspected shell launch has no per-call root-context export. The approved contract deliberately refuses CODEX_THREAD_ID alone because it does not identify a logical root. Keep that rule; do not infer a root, borrow a marker or set synthetic identity to turn this smoke green.

**Verified fallback:** A context derived from actual thread/start metadata and confirmed by thread/resume reached provenance. Native MCP item exec-5f558737-ed09-49dd-ab2b-832473ac7bf5 ran fmt-mine.sh --context and exited 1. It refused UNKNOWN src/main.rs, retaining the known Claude owner and opaque-history gaps; the file's before/after SHA-256 remained identical. Evidence: .codescout/native-mixed-explicit-context-result-20261011.json. This establishes safe mixed-host refusal through the documented explicit fallback. Automatic MCP root-context transport and complete Codex coverage remain separate pending capabilities.

## F-17 — Native Claude fork rewrites inherited session IDs and falsely claims old writes

**Observed:** Claude Code 2.1.296 --resume 761aa55b-cc78-4d4d-b452-85c384949f52 --fork-session created native root c54e9b99-48dd-4589-b931-b6b24066fb4e. The fork called only fmt-mine.sh. Its actual output claimed SHARED src/main.rs and "written by THIS session (claude-code:c54e9b99)", despite no new writer call. The formatter safely refused exit 1 and bytes stayed equal.

**Severity:** high
**Category:** architectural
**Status:** fixed-verified
**Valid:** dated 2026-10-11
**Rests on:** .codescout/native-claude-fork-result-20261011.json; the actual root/fork JSONL histories under ~/.claude/projects/-tmp-native-claude-authored-v2-20261011-w0qmj698; Codescout scripts/claude_history.py::read_claude_history.

**Evaluation:** Both inherited create_file calls preserve their native UUID, tool-use ID and timestamp in the fork, while sessionId is rewritten to the new root. No explicit fork-origin field appears among the observed top-level fields. The reader uses that rewritten sessionId both for ownership and its producer-scoped source ID, so it manufactures new authorship rather than deduplicating or reporting uncertainty. The visible first native enqueue is later than the copied calls; inspect and pin that evidence boundary before implementing a conservative guard. Do not pick an original owner from file order, mtime or input equality.

**Impact:** Existing peer evidence and Codex coverage gaps prevented a write in this live scenario. Those protections do not make the new-root authorship claim true. Capture a regression that observes attribution directly, including a fork-only history population, before fixing this reader.

**Resolution — 2026-10-11:** The actual decoder, fork-only CLI and real formatter byte-preservation regressions were observed failing before implementation. The guard retains an inherited-history gap instead of crediting pre-enqueue calls, uses timezone-aware earliest same-root boundaries and preserves child identity. Focused suite: 99 passed. Independent review applied nine mutations; two first survived, three new CLI cases then killed both, leaving zero survivors. The same native fork's corrected formatter refuses exit 1 with exact unchanged bytes, original owner and inherited gaps, without false THIS-session credit. Canonical gate @bg_0000001e exited 0: PYTHON_LIGHT=0, FMT=0, CLIPPY=0, LEAN=0, DEFAULT=0. Original Codescout commit 6eb585ef9161b858316fc9ef95270b8ccaeede2e contains only the four reviewed source/test paths, with byte equality and empty index verified. This guards the observed native form conservatively; it does not recover original fork ownership or establish general fork support. Evidence: .codescout/native-claude-fork-fixed-result-20261011.json, .codescout/native-fork-gate-result-20261011.json and .codescout/native-fork-integration-result-20261011.json.

## F-18 — Native child smoke requires executable helper modes and producer-aware stream capture

**Observed:** The first native child/root formatter fixture copied eight helper byte bodies with shutil.copyfile, losing the source file-provenance.py executable mode (0755 became 0644). The actual child wrote valid Rust through MCP and retained the parent root with a distinct agent ID, but the parent formatter exited 2 before attribution because executing the helper failed with 126/Permission denied. The startup tool list said Task while the executed spawn appeared as Agent; the stream also included child tool calls with parent_tool_use_id. A Task-only count therefore did not measure native child creation.

**Severity:** med
**Category:** test-harness
**Status:** fixed-verified
**Valid:** dated 2026-10-11
**Rests on:** .codescout/native-claude-child-result-20261011.json; .codescout/assess-native-child-fixture-20261011.py; .codescout/native-claude-child-fixed-result-20261011.json.

**Correction:** Restored source helper modes in only the retained scratch checkout and resumed the same native parent, without another child/write or any identity/history override. Captured root calls by parent_tool_use_id and recognized the observed Agent/Task spawn forms. The parent formatter then exited 0; exact formatted bytes and independent cargo fmt --check passed. Source bytes and modes match for every helper. The actual child write has principal claude-code:af8d2e22-9029-42c5-9257-d4fe124b1a43 and agent a21ddf668790f255e. The failed fixture/capture result remains preserved, not counted as a product failure or successful formatting.

## F-19 — Unstaged pathspec commit is refused by the shared-checkout guard

**Observed:** An attempted native git commit --only over the four F-17 paths was refused because they had not been staged. No commit occurred. The existing source hook printed its committed stage/read/commit sequence; this is a KNOWN workflow protection, not a new product defect.

**Severity:** med
**Category:** commit-workflow
**Status:** fixed-verified
**Valid:** dated 2026-10-11
**Rests on:** Codescout docs/conventions/shared-checkout-commit-sequence.md (fa4a13f40ea82465); the native pre-commit refusal; original commit 6eb585ef9161b858316fc9ef95270b8ccaeede2e; .codescout/native-fork-integration-result-20261011.json.

**Correction:** Enumerated live sessions without inferring occupancy or authorship, then ran native scoped git add, staged-path read, staged-content read, working/index equality check, and explicit-path commit in separate calls. Added the actual controller Session-Id trailer. All applicable pre-commit checks passed; exactly the four reviewed paths landed, source bytes match and the shared index is empty. No hook/permission bypass or reset/amend was used. Use this staged sequence for the remaining documentation commit as well.

## Template for new entries

<!-- Insert new F-N / W-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## F-N — title\n...")
     Also update the matching Index / Wins Index table row at the top. -->
