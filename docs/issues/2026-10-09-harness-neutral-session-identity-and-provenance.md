---
kind: bug
status: investigating
title: Harness-neutral session identity and provenance are needed for Codex and other harnesses
tags:
- codescout-companion
- buddy
- codex
- harness-compatibility
- session-identity
- provenance
- gate
arch_package_verification: '2026-11-07: installed openai-codex 0.167.0-1 (Extra); official packaging 512c92b targets 0.167.0-2 and V8 152.2.0. Release source, complete V8 archive and generated bindings downloaded and matched recipe BLAKE2b checksums. PKGBUILD syntax and bundled voice patch dry-run passed. c4d58a767b provenance patch git apply --check fails in 10 distinct files on rust-v0.167.0; requires porting. No patched build or install performed. The older V8 150.4.0 download blocker is specific to the original development baseline, not the packaged 0.167.0 release.'
claimed_by_session: 01a12505-eb95-76a1-911a-4610c7b95ab3
codescout_native_context_commit: 18a007aacc20eef8f366aa153394f7e23ccf875b
codescout_native_history_commit: 76bfcca7d65494e90fb7c5296e69304e49388742
design_approved_on: 2026-10-10
implementation_review_id: 2185a218fbd18b7f
implementation_review_pending: false
last_observed: 2026-11-07
native_acceptance: Native Codex root/write/resume attribution and safe UNKNOWN refusal were measured. The execution-journal, stdio/gRPC receipts, dual fence and strict reader source is now applied and tested; native positive owned-formatting is still unestablished without a matching rebuilt V8 host. Kat authentication remains unavailable and was not retried.
native_claude_child: 'Native Claude main-profile child/root smoke passed: parent af8d2e22-9029-42c5-9257-d4fe124b1a43, distinct agent a21ddf668790f255e, actual child MCP writer and same-parent formatter exit 0; exact bytes, source helper bytes/modes and independent cargo fmt --check passed. Initial fixture/capture failure preserved as F-18.'
native_claude_fork: 'F-17 fixed and committed locally in original Codescout 6eb585ef9161b858316fc9ef95270b8ccaeede2e: conservative enqueue boundary, 99 focused tests, canonical leased gate all five exits 0, actual same-fork safe refusal/no false credit/unchanged bytes and independent nine-mutation review with zero final survivors. All four files match reviewed source bytes and only those four paths were committed; index empty.'
native_context_transport: 'Fixed and verified F-16: original Codescout 18a007aa, five-lane gate pass, eleven applied mutations/zero final survivors, clean server-stack release installed, fresh actual Codex root 01a12bc6-4184-7182-b87d-ae4637c3e9c9 receives automatic native-env context. Existing processes not restarted.'
native_provenance_design: Approved be871df4dc66f9a4; independently reviewed source committed locally in Codex c4d58a767b and Codescout 9cab1095e. Full standard Codescout gate and recorded Codex/module checks passed. Full matching-host native acceptance remains pending because V8 150.4.0 artifacts are unavailable.
native_provenance_plan: 46b174b8c4c5e2e2
opened: 2026-10-09
owner: marius
plan_approved_on: 2026-10-10
plan_id: 3252b9f3f104ea25
plan_review_pending: false
severity: medium
source_commits:
  native_execution_codex: c4d58a767b91b49058fc2e85b664b75209e25f6e
  native_execution_codescout: '9cab1095e55dbd9f09030caed2acd4d56caa6d86'
source_implementation: Initial implementation, F-17, F-16 and bounded F-20 repair are independently reviewed, verified and committed locally in their original repositories. Complete native code-mode owned formatting and Kat authenticated smoke remain unestablished.
spec_approved_on: 2026-10-10
spec_id: c67a8d68e01c6cf4
stock_codex_design: 9d1d3c7f58f63dad approved; source-only implementation plan 3f373e14fa311cc8 complete. Plugin 381ae57/bb8ff30 and Codescout 505e8033a/c7b38be29/f89590d31 committed; required gates, independent applied-mutation review and native stock acceptance passed. Installed Codex remains unmodified.
stock_codex_plan: 3f373e14fa311cc8
stock_codex_spike: '2026-11-08: installed Arch Codex 0.167.0, private CODEX_HOME, trusted hooks without bypass, installed Codescout behind transparent capture. Native MCP callId/sessionId/threadId match tool hooks for Code Mode writes; resume, fork, child/root and post-compaction write measured. Eight create_file requests match actual bytes; 11 MCP requests observed overall. Explicit denial blocks; timeout/exit-1 hooks permit shell effects. Interrupted MCP call wrote its start marker but not final marker and has no post hook. Direct App Server MCP client call writes without model tool hooks. Two actual Promise.all slow calls have non-overlapping hook intervals, so simultaneous execution is unestablished. Identity route needs no Codex patch; complete effect inventory/exclusive formatting remains unproved. Evidence: docs/evidence/2026-11-08-stock-codex-hooks-spike.json. No production integration or installation; temporary auth copy removed.'
unverified: Stock adapter source is implemented, independently reviewed, verified and committed. Integration and real-profile activation are not performed. Complete effect inventory, exclusive formatter authorization, host dispatch overlap and Kat authenticated smoke remain unestablished. The shared-MCP usage misattribution incident 16de4012209e895f remains open; guard ACK is not a causal fix.
---

## Stock adapter design — 2026-11-09

[Stock Codex identity and operation observations](../superpowers/specs/2026-11-09-stock-codex-identity-observations-design.md) was approved and implemented under plan `3f373e14fa311cc8`. Source delivery is complete in isolated worktrees: plugin feature `381ae57` and documentation `bb8ff30`; Codescout support `505e8033a`, wiring `c7b38be29` and real caller tests `f89590d31`. Required gates, independent applied-mutation review, six real component cases and ten native stock acceptance routes passed. Source/spec review `57ada03063a50be6` records GO.

The design reuses native context resolution, adds bounded private observations in Codescout and the companion, and preserves formatter coverage/authorization boundaries. It requires no Codex patch or client replacement. The packaged yay/pacman Codex remains unmodified. Integration, release and live-profile activation are separate future work. Host dispatch overlap and complete effect inventory remain unverified; this source delivery does not close the broader formatter/identity issue or the separate wrong-usage-stamp incident `16de4012209e895f`.

## Stock Codex spike — 2026-11-08

The maintainer approved a throwaway experiment before maintaining a patched Codex package. The installed Arch Codex 0.167.0 was run with a private configuration, genuinely trusted hooks and an unchanged Codescout server behind a passive MCP observer. [Normalized evidence](../evidence/2026-11-08-stock-codex-hooks-spike.json) records binary hashes and measured cases without exporting prompts, reasoning or credentials.

Stock MCP metadata and tool hooks correlate root session, turn and individual call IDs. Resume retains the identity; fork obtains a distinct one; a real child carries both parent session and child thread/agent IDs. Manual compaction emitted both lifecycle hooks and a later write retained the root. The basic Code Mode case also emitted three completed MCP items on `exec --json` in this installed version. Two real `Promise.all` slow calls were observed with non-overlapping hook intervals; concurrent execution was not established.

This demonstrates an identity route without modifying Codex, not complete execution provenance. Explicit hook denial blocked the shell command, whereas timeout and exit-1 allowed writes. A genuinely interrupted MCP command produced its initial effect and no post hook. A client-initiated App Server MCP call wrote a file without model-dispatch tool hooks. Missing coverage therefore remains UNKNOWN. Owned-format success, arbitrary background process lifetime and exclusion of concurrent writers remain unverified. No production source/configuration changes or installation were made; the temporary authentication copy was removed. The patch remains a prototype, not a prerequisite for identity.

## Re-check — 2026-11-07

The commit-guard implementation described below as unmerged is now in the current codescout `experiments` history via `a6d175ee0`. Follow-up fixes include `2cdf4fca7` (resolver stdout separated from diagnostics), `8939ee5ec` (correct identity failure and no Codex-owner liveness probe) and `af0c22f2d` (qualified sentinel is never an equal principal).

Fresh verification ran `tests/publish-principal.sh`, `tests/commit-mine.sh`, `tests/git-safe-reset.sh`, `tests/mutation-probe.sh`, `tests/hooks-discrimination.sh` and `pytest tests/test_session_context.py` in the current codescout checkout; all exited 0 (the final shell suite reported 425 passed/0 failed; context pytest reported 41 passed). A separate run of `test_harness_formatter.py`, `test_harness_provenance.py`, `test_harness_history.py` and `test_codex_native_mcp_history.py` passed all 146 tests.

The native code-mode completeness boundary remains in the current `scripts/codex_history.py`: custom wrappers that are not directly interpretable add an explicit coverage gap. The approved design's Native evidence follow-up still requires complete dispatched/cancelled/unawaited execution evidence before permitting owned formatting. Removing that gap based on wrapper source text would violate that contract. Kat authenticated smoke also remains unestablished. The issue stays `investigating` for these native acceptance obligations; the already-landed guard fixes should not be reimplemented. No codescout source, shared binary or profile configuration was changed in this re-check.

## Fresh native reproduction — 2026-11-07

Current IDE root `01a1b59b-676f-7881-b7eb-4d8e1687c3f8` has native metadata `cli_version: 0.160.0`, source `vscode`, and paginated history. Calling the unchanged `session_context.py` through the real MCP `run_command` returns that same root and workspace with `source: native-env`. The separately installed CLI is 0.167.0; these are different observed processes, not a version mismatch to repair by altering context.

A fresh `codex exec --json --sandbox workspace-write` using the existing logged-in profile created native root `01a1b668-4efb-7763-a6b5-a1fef3ce4671` in disposable checkout `/tmp/native-identity-20261107-bk9tesai`. Its real MCP writer changed `src/main.rs` to the exact requested bytes. The unchanged decoder recovered one `create_file` operation under that root, with no child id, and three opaque-wrapper gaps after the first turn. Both the native operation and independent file bytes were checked.

`codex exec ... resume <that root>` retained the same root and ran exactly one real MCP `run_command` with `bash scripts/fmt-mine.sh`. Its tool result reports exit 1, `UNKNOWN src/main.rs`, opaque-wrapper and shared-workspace gaps, and `written by THIS session (codex:01a1b668)`. The two native turns completed successfully; that is not a successful formatter result. File SHA-256 stayed `76299fb39f2090cb6b6dd73984de0ef8e1e71842ef9732447f8e6f5374d2eb6a`. Every copied formatter/helper SHA remained equal to the current codescout source. After resume, the root decoder reports five opaque-wrapper gaps.

Private evidence: `/tmp/native-identity-20261107-bk9tesai/native-acceptance-summary.json`, write/resume event streams, copied-helper manifest `/tmp/native-identity-20261107-manifest.json`, and the native persisted history named by the summary. No credential copying, identity/context/history override, exclusive-checkout declaration, permission/trust bypass, profile edit or shared-binary replacement was used. No Kat authentication retry was attempted.

This reproduces the remaining execution-coverage limitation on installed CLI 0.167.0 and establishes root context/write/resume attribution there. It does not establish child/fork/compaction completeness or native owned-format success. A producer-side provenance extension needs a separate design decision; normal identity transport does not need another implementation.

## Proposed next step — 2026-11-07

[Normalized native evidence](../evidence/2026-11-07-native-identity.json) preserves the measured IDs, operation/formatter results and byte/helper hashes without raw prompts, reasoning or credentials. [Native execution provenance design](../superpowers/specs/2026-11-07-native-execution-provenance-design.md) was approved by the maintainer on 2026-11-07 («ok, continua»). Reviewed source changes are committed locally in the original Codex (`c4d58a767b`) and Codescout (`9cab1095e`) checkouts. The complete standard Codescout gate passed (Python, formatting, Clippy, lean and default Rust lanes); Codex core and the protocol/MCP/module suites also passed their recorded checks. The [verification evidence](../evidence/2026-11-07-native-execution-provenance-tests.json) distinguishes these results from native acceptance. Installed binaries and profile configuration have not been changed. The [implementation plan](../superpowers/plans/2026-11-07-native-execution-provenance.md) records delivery and acceptance separately. The complete native host build is currently blocked by unavailable V8 150.4.0 artifacts, so native owned-format success is still unestablished. The exact shipped formatter is the only certifiable shell exception; any arbitrary shell creates durable uncertainty across participating checkouts, with no automatic reset. The existing recorder and host sequence/closure primitives were inspected; warehouse metadata and best-effort rollout tracing are not automatically promoted to completeness proof.

## Summary

> **Re-checked 2026-10-31 — the implementation landed; the reproduction below is outdated. The status stays `investigating`.**
>
> - **Plugin half:** `4ce5432` (2026-10-11) and `b7247bf` (2026-10-12) are on `origin/main` and in the history of the 1.20.24 bump. They add `scripts/session-context.mjs`, its hook tests and `codescout-companion/docs/session-context.md`.
> - **Codescout half:** `eed255794` (2026-10-11, pushed to `origin/experiments`) adds `scripts/session_context.py`. `gate.sh` calls it before any lane.
> - **Measured today** in the codescout checkout, with `--workspace "$PWD"`: no identity gives `missing`. `CODEX_SESSION_ID=root-1 CODEX_THREAD_ID=child-2 CODEX_VERSION=0.160.0` gives `available`, harness `codex`, session `root-1`, agent `child-2`. Both hosts' variables together give `conflicting`. I read `gate.sh` lines 85-98: a blocked context prints a notice and the remaining lanes still run. I did **not** run the gate.
> - **Not established** (spec, *Native evidence follow-up — 2026-10-12*): owned formatting and complete authored history under Codex (coverage stays UNKNOWN; the journal alternative is an open design decision), Kat authenticated smoke, and the native approval routing dependency.
> - **Out of the approved scope, still Claude-only (explorer subagent, re-read for two):** `commit-mine.sh` (exit 2), `git-safe-reset.sh` (exit 2), `mutation-probe.sh` (exit 2), `pre-commit-foreign-index.sh` (silent exit 0; `--classify` exit 2) and `post-index-change-stage-log.sh` (records owner `-`). Branch `feat/codex-publish-holds-20261027` (2 commits over `origin/experiments`, unpushed, merged nowhere) covers `hold-publish.sh`, `pre-commit-run.sh`, `pre-push-foreign-session-guard.sh`, `prepare-commit-msg-session-id.sh` and `resolve-sids.sh`. No test runs any of the five with only `CODEX_SESSION_ID` set. The native approval routing issue is `fixed`. Proposed design, not yet approved: [2026-10-31-session-identity-remaining-guards-design.md](../superpowers/specs/2026-10-31-session-identity-remaining-guards-design.md).

A Codex session in the shared codescout checkout cannot run the required development gate because it lacks CLAUDE_CODE_SESSION_ID. The gate exits 2 before any test lane. Its suggested fallback assumes that a non-Claude session is probably the only writer and sends it to the shared target directory. Harness identity does not establish exclusive checkout ownership.

Provide a harness-neutral session identity and write-provenance contract in the companion infrastructure, then integrate the codescout consumers. Codex and other supported harnesses should retain the same ownership and build-isolation protections as Claude Code.

## Reader and scope

Reader: maintainers of codescout-companion and Buddy coordinating with codescout.

Plugin work belongs here: adapt verified native session/hook context into a common session identity, register lifecycle and authored-write evidence, and document the consumer contract. Dependent gate/formatter/provenance changes belong in codescout. Fixing only this repository cannot change those scripts.

This issue requests compatibility work. It does not assume every non-Claude hook is broken, choose an unverified native environment variable, or request weakening the existing guards.

## Reproduction — observed

From codescout, run:

```sh
env -u CLAUDE_CODE_SESSION_ID ./scripts/gate.sh
```

Observed on 2026-10-09: exit 2, with:

```text
gate.sh: CLAUDE_CODE_SESSION_ID is unset. Step 1, `fmt-mine.sh`, needs it to tell your
files from a peer's, and outside a Claude session you are almost certainly the only writer
to this checkout, which is the case the shared `target/` is already correct for.
```

The actual Codex session also lacked that variable and encountered this refusal during tracker-archiving design review. The forced-unset invocation above reproduces the branch without changing plugin settings, ownership state or source files.

## Evidence

Source checked at codescout HEAD 918b3d51d2a50114f5fb94b3939a0a5c26ea140e and claude-plugins HEAD fcc733cf6d819ec9d63a93d3aa9e212c940c881c:

- codescout scripts/gate.sh:46-66 checks only CLAUDE_CODE_SESSION_ID and exits before the target-slot lease. Its remedy recommends direct commands using shared target.
- codescout scripts/fmt-mine.sh:106-117 independently refuses a missing Claude session ID when formatting changes require ownership attribution. Running the printed formatter command does not supply a session identity.
- codescout scripts/file-provenance.py, main beginning at line 1098, sets its current-session identity from CLAUDE_CODE_SESSION_ID. profile_dirs at lines 305-323 discovers .claude and .claude-* directories. These defaults require an explicit adaptation for other harnesses; changing one gate environment check is insufficient.
- codescout-companion/hooks/principal-stamp.mjs:53-81 consumes session_id and agent_id from hook input and stamps the composed principal. This is an existing useful context seam, but it does not by itself provide shell consumers with portable session identity or authored-write evidence.

Evidence boundary: the gate result is observed; the formatter/provenance contracts and principal-stamp fields were inspected in source. No mixed-harness formatting or native transcript ingestion experiment was run. No successful cross-harness ownership attribution is claimed.

## Requested behavior

1. Define a common context carrying harness, session identity, optional agent identity and authoritative checkout/workspace. Specify identity lifetime across resume, compaction, subprocesses and subagents.
2. Adapt each supported harness from verified native payloads/session sources. Preserve Claude compatibility. Permit explicit context for other runners, and make conflicting or missing identity actionable. Do not fabricate a Claude ID, use a process ID as durable identity, or adopt a last-writer session pointer that may name a peer.
3. Make authored-write provenance comparable across harnesses. A mixed Claude/Codex checkout must retain peer/shared/unknown distinctions. Normalize actual write outcomes and tool payloads; environment-variable renaming alone is not provenance support.
4. Integrate the gate, formatter and provenance consumers in codescout. Keep the leased build target independent of host identity. A missing identity must not imply exclusive ownership or recommend bypassing build isolation.
5. Define a safe identity-unavailable path: an explicit check-only formatter can report formatting problems without rewriting files, while isolated verification lanes can still run and report their individual results. Formatting writes require established ownership or an explicit exclusive-checkout contract.
6. Document adapter capabilities, supported versions and manual/CI invocation. Unsupported hosts should receive a precise capability result and usable read-only verification path.

## Acceptance criteria

- Real Claude Code and Codex smoke runs execute the documented verification entry point without borrowing another session's identity.
- A fixture for each additional supported adapter demonstrates context normalization from its actual host payload. Do not claim support for an untested host.
- Mixed-harness tests cover own, peer, shared and unknown writes; a peer-owned unformatted file is byte-identical after a refused format attempt.
- Resume, compaction and subagent tests establish intended identity continuity and parent/agent separation.
- Missing or conflicting identity produces actionable output, performs no formatting write, and retains isolated build targets.
- Gate tests observe the Python, formatter, clippy, lean and default lane outcomes and their required order, including failure paths.
- Native approval requests remain reachable; use the separate routing issue linked below for that dependency.
- Release and installation checks cover all three local Codex profiles and all three local Claude profiles when their settings/install records change. Each installPath remains under its owning profile root.

## Related issues

- [Codex native escalation is blocked by companion routing](2026-10-09-companion-routing-blocks-codex-native-escalation.md): a separate, already-filed host-compatibility problem. This issue concerns session identity and provenance, rather than approval routing.
- [Fixed Codex hook manifest argument transport incident](archive/2026-09-12-codex-plugin-runner-drops-buddy-hook-args.md): prior adapter evidence; this request does not reopen that fixed manifest problem.

## Status

Investigating. On 2026-10-10, `env -u CLAUDE_CODE_SESSION_ID ./scripts/gate.sh` again exited 2 before any lane on Codescout HEAD `d188fdc87d53c2c255271628ab7e61978335f43f`. No borrowed identity or build-isolation bypass was used.

Codex source at HEAD `59f18e8133f2c1d3427677658752ac46697d41b7` supplies the shared root identity through `Session::session_id()` to its normal hook requests. PreToolUse/PostToolUse command inputs carry `session_id`, optional `agent_id`, `cwd`, `tool_use_id`, and native tool input/result. `thread_spawn_subagent_hook_context` separates a child by its thread id. `exec_env::inject_session_env` supplies `CODEX_SESSION_ID` and `CODEX_VERSION` to shell environments; `create_env` supplies `CODEX_THREAD_ID` separately. The installed CLI reports `codex-cli 0.160.0`. These are source/version observations, not a lifecycle or running-host capture test.

At the pre-implementation baseline, the formatter's `--check` branch is reached only after its Claude identity/provenance logic. `file-provenance.py::tool_records` accepts Claude-style `tool_use` blocks, `record_session` uses Claude-style record session fields, and `scan_with_evidence` joins write requests with refusal results while tracking workspace uncertainty. Native session-id acceptance alone would leave Codex write evidence unconsumed. Existing `principal-stamp.mjs` composes hook session/agent ids for Codescout calls, but does not provide the shell-consumer or authored-write contract.

Conversational design approved on 2026-10-10: define a versioned context with harness, root session identity, optional agent identity and authoritative checkout/workspace; normalize verified Claude/Codex inputs and authored-write outcomes into common evidence, retaining the Claude reader; preserve own/peer/shared/unknown distinctions and explicit unsupported/uncertain coverage; adapt gate/formatter/provenance together. Missing or conflicting identity enables an explicit check-only formatting path and leased verification lanes with individual results, without inferring exclusive ownership. Additional hosts use explicit context and only receive capabilities actually exercised by fixtures.

Rejected shortcut: accepting a Codex environment variable only, which cannot establish mixed-harness ownership. The agreed initial approach uses native history readers behind normalized evidence, keeping host decoding inside adapters and preserving existing Claude evidence. Revisit a persistent write journal if real captures show that native histories cannot provide the required calls, outcomes or workspace information.

Written spec: [Harness-neutral session identity and write provenance](../superpowers/specs/2026-10-10-harness-neutral-session-identity-design.md), artifact c67a8d68e01c6cf4. Self-review clarified standalone formatter versus gate context requirements and unavailable agent detail. Local Markdown links resolve and whitespace/placeholder checks passed. The installed PreToolUse routing hook blocked the native git staging command before approval, leaving the spec uncommitted. The written spec was approved on 2026-10-10. The [implementation plan](../superpowers/plans/2026-10-10-harness-neutral-session-identity.md), artifact 3252b9f3f104ea25, has been written and self-reviewed against current source and test entry points. It covers contract/hook decoding, shell context, Claude and Codex history, mixed ownership, formatter modes, leased gate behavior, and coordinated review/delivery/live validation. Self-review captured ordinal-versus-line boundaries, producer-scoped replay, namespace conversion, root authority and gate test-stub delegation. Both local CLIs are present (Claude 2.1.296; Codex 0.160.0); this is version availability, not host-support evidence. The user approved the plan and inline execution with an independent mutation-applying final review. Source implementation and review have now run in isolated clones; see Implementation progress and the verification report for current results. Configuration, installed caches, versions and release state remain unchanged. The native-approval installation blocker remains tracked separately. GitHub issue access previously returned 401 Unauthorized; this is the repository backing-store issue.


## Implementation progress — 2026-10-10

The user approved the plan and inline execution with independent final review. Source Tasks 1–7 are implemented in isolated plugin/Codescout clones; the tested plugin feature patch is also applied to the authorized working checkout. Feature versions and installed profiles remain untouched. After review corrections, combined focused pytest: 168 passed; Node context: 11 passed. Legacy provenance: 245 assertions passed; formatter: 56; leased pool: 88. Contract copies agree on four complete expected objects and invalid explicit consumer paths are rejected. The plugin full suite passed in both the isolated clone and the original checkout with the preserved earlier fixes. The corrected full leased Codescout check gate exited 0, with Python, formatting, clippy, lean and default codes all 0. Independent review reproduced three Important and one Minor issue, all corrected with failing-then-passing regressions. Five mandatory reviewer mutations were applied and killed. An additional controller mutation initially survived a parent-only file snapshot; it was killed after adding a direct nested-child byte assertion. Six candidates were exercised overall, with zero surviving the final tests. See the [verification record](../reviews/2026-10-10-harness-neutral-session-identity.md) for exact results and scope rulings. These results do not establish native authored or installed support.

Native capture evidence is limited: Claude Code 2.1.296 root hook/Read refusal and Codex 0.160.0 root metadata/opaque exec hook refusal. Process exits were 0 while requested tools were blocked or unavailable. Successful writes, children, resume, compaction, fork and installed-hook acceptance remain pending. The native-approval routing blocker is tracked separately. Plugin source changes preserve earlier dirty issue fixes. The final [Codescout patch](../patches/2026-10-10-harness-neutral-codescout.patch), generated from d188fdc8..52be81ae, passes git apply --check against the protected original. Native escalation to apply it was blocked by the installed PreToolUse routing hook before host approval; the MCP redirect was not followed. Protected source application and live/install acceptance remain pending. The [handoff](../trackers/passover-harness-neutral-session-identity-2026-10-10.md) records the exact resume state.

## Source delivery — 2026-10-11

The user resumed with working-file permission for both original source checkouts and installed-profile directories. The reviewed Codescout patch passed a fresh applicability check and was applied with exit 0, preserving unrelated changes and the original index. The paired Codex patch was applied likewise. The plugin's original .git is still read-only and its working tree contains unrelated effort-steering work; a clean independent copy at HEAD 61608048 is used for the authorized local bootstrap release. Full source evidence remains in the implementation review. Live acceptance remains pending and this issue stays investigating.

## Installation checkpoint — 2026-10-11

Companion 1.20.17 was locally released in an independent clean copy through release.sh. All plugin suites and 528 buddy pytest tests passed. The initial unrelated marketplace skew was repaired with preserved directory backups and local-file hashes; the repeated full profile-parity and version checks passed. The real release's version-file changes were delivered to canonical working files; original indexes are unchanged. Local feature/release commits e75ce39/4fc9326 are preserved in .codescout/harness-neutral-release-20261011.bundle, without a push.

All 98 companion source files compare equal in the measured existing lowercase Codex profile and all three Claude profile caches. Codex's generated command migration was checked against its source, with runtime state excluded explicitly. The host candidate remains unselected and the daemon still reports 0.159.2. Run the prepared .codescout/cold-load-native-approval-20261011.sh outside this active session to select the verified dev package and resume with the scoped roots. That restart must precede actual native acceptance; issues and capabilities remain pending.

## Live host checkpoint — 2026-10-11

The corrected public installer selected/pinned the GNU/Linux 0.160.0 paired host. Both live daemon/helper paths belong to the installed candidate; all six package files match the versioned digest manifest. The root session resumed after the cold load and survived a subsequent daemon recovery. Native require_escalated wrote a temporary ref in the protected canonical .git directory; its value was observed and cleanup verified. Ordinary shell work still redirects through the installed hook. The requested interactive rejection probe was approved and executed, so rejection is not inferred from it. Evidence is .codescout/native-approval-live-check-20261011.json.

These are host installation/routing observations. They do not establish authored formatting, mixed-host peer refusal or parent/child and inherited-history provenance. The issue remains investigating with those real-host criteria pending.

## Original integration and cold profiles — 2026-10-11

All reviewed original source files are now committed locally through native escalation: plugin feature 4ce5432 and separate real-release-output commit f8a73ee; Codex 5eedcdc543; Codescout eed25579 on experiments. Source bytes match the reviewed copies. Explicit task pathspecs preserve unrelated work. Original indexes were empty after integration and no push occurred. The Codescout pre-commit checks passed.

The installed native app-server accept/decline smoke passed with independent marker existence/absence. Resume across a new process, remote compaction, a following turn and fork transport passed. Running the actual source decoder against those durable histories returned no operations and explicit gaps for opaque wrappers, token-usage envelopes and external fork history; this is a limited provenance result.

Fresh Claude Code 2.1.296 processes observed startup and companion 1.20.17 in every existing profile. Each own-root install record/cache passed, and the runtime loaded the byte-matching canonical directory source. Main/SDD model turns passed; Kat failed with expired OAuth that could not refresh. Its authenticated smoke remains pending. Evidence: .codescout/source-integration-result-20261011.json, .codescout/native-history-decoder-20261011.json and .codescout/cold-claude-profile-assessment-20261011.json.

## Native owned-formatting checkpoint — 2026-10-11

Main-profile native Claude session 761aa55b-cc78-4d4d-b452-85c384949f52 wrote a Rust file through the actual Codescout MCP writer and formatted it with bash scripts/fmt-mine.sh. The formatter exited 0 and the independently read final bytes match the expected formatted file. All eight scratch helpers match the reviewed source; cargo fmt --check exited 0. No synthetic identity/history/context override or permission bypass was used. Evidence: .codescout/native-claude-authored-v2-result-20261011.json and verification 2185a218fbd18b7f.

This establishes native main-profile Claude owned formatting. Claude then resumed the same root and wrote an unformatted edit for a mixed-host probe. Native Codex ran the actual formatter, which safely refused with exit 2 because no root context reached the MCP command; the file remained byte-identical. Peer classification was not reached. F-16 records the missing automatic transport. The native-derived explicit-context fallback then reached provenance and safely refused with exit 1, preserving the known Claude owner, UNKNOWN coverage gaps and exact file bytes. Codex owned formatting and complete child/inherited-history provenance remain pending. Kat's authenticated turn remains blocked by its expired OAuth. The user clarified that reauthentication is unavailable now, so this profile remains pending without another login attempt.

## Native fork follow-up — 2026-10-11

The real Claude fork smoke exposed an attribution bug, F-17. The fork called only the formatter, yet inherited create_file calls were attributed to its new root. Live peer/gap evidence kept bytes safe; an isolated fork-only regression then reproduced MINE clearance and actual formatter writes. Native records preserve copied UUID/call IDs/timestamps but rewrite sessionId.

The isolated fix marks calls older than a native root's first enqueue as unverified inherited history, with explicit coverage gaps rather than invented original ownership. Decoder, CLI and formatter regressions were observed failing before implementation; the final focused suite passes 99 tests, and the actual native fork decoder no longer credits either copied write to the fork. Independent review applied nine mutations; two initially surviving mutations were killed after three new CLI cases, leaving zero survivors. The same real native fork's corrected formatter refuses with unchanged bytes, the original owner and inherited gaps, without crediting copied writes to the fork. The canonical leased gate passed all five lanes with exit 0, and original Codescout commit 6eb585ef9161b858316fc9ef95270b8ccaeede2e contains exactly the four reviewed paths. Committed bytes match the reviewed source and the shared index is empty. Evidence: .codescout/native-fork-gate-result-20261011.json and .codescout/native-fork-integration-result-20261011.json. See verification 2185a218fbd18b7f and .codescout/native-claude-fork-decoder-after-20261011.json. This issue remains investigating.

## Native Claude child/root checkpoint — 2026-10-11

Main-profile native parent af8d2e22-9029-42c5-9257-d4fe124b1a43 spawned one general-purpose Sonnet child, which wrote valid unformatted Rust through the actual Codescout MCP writer. Its saved native history retains that root principal and distinct agent a21ddf668790f255e. After restoring helper executable bits lost by the test fixture, the same parent formatted the child-authored file with exit 0. Exact formatted bytes, source helper bytes/modes and independent cargo fmt --check passed. F-18 preserves the initial fixture/capture error; it is not counted as a product failure. Evidence: .codescout/native-claude-child-fixed-result-20261011.json and verification 2185a218fbd18b7f. This is an observed Claude child/root result; complete Codex child/inherited-history coverage remains pending.

## Automatic native Codex context installed — 2026-10-11

Codescout source 18a007aacc20eef8f366aa153394f7e23ccf875b repairs F-16 using the already-present native MCP sessionId/threadId, scoped to individual spawned commands. The corrected canonical gate passed all five lanes; independent review applied eleven mutations with zero final survivors after closing three observed cleanup gaps. A clean release with server-stack was installed atomically and its hash verified. Fresh native root 01a12bc6-4184-7182-b87d-ae4637c3e9c9 then returned matching native-env context without identity/context/history overrides. Evidence: native-context-installed-smoke-result-20261011.json. Existing running servers keep their loaded executable until reconnect; no peer was restarted.

F-20 is the remaining history boundary: actual durable MCP events exist and a native child's parent-copy boundary differs from a new-root fork cutoff. The isolated reader repair preserves unresolved wrapper gaps. This issue remains investigating; Kat login is still unavailable.

## Native history reader delivered — 2026-10-12

F-20's bounded decoder repair is committed in original Codescout as 5ae71b35a05450d545ac355085378dfeee81a46c. **Rebased since: on 2026-10-27 that hash is no longer reachable from any branch; the same commit is `76bfcca7d65494e90fb7c5296e69304e49388742` on `experiments`.** Verified by `git cat-file` (the old object still exists), `merge-base --is-ancestor` (exit 1 for the old hash, exit 0 for the other three codescout commits recorded here) and an empty `git diff 5ae71b35 HEAD` over the three owned paths. Other documents that quote 5ae71b35 are historical records and were left as written. It recovers actual paginated MCP end items with native root/thread/call identity, argument objects, outcomes and current cwd; verified child copies use their child-specific boundary. Unknown effects/statuses and opaque wrappers retain coverage gaps.

Verification includes 141 focused tests, all five canonical gate lanes, shell suites (245 provenance, 56 formatter, 88 lease checks), and independent reapplication of all 25 review mutations with zero final survivors. Exactly three owned source/test/document paths were committed; index bytes matched the reviewed manifest and unrelated files were preserved. Review and integration evidence: native-history-delivered-20261012.json, native-history-independent-review-v2-evidence-20261012.json and native-history-integrated-read-20261012.json under .codescout.

Actual authored root 01a12f3a-ae7e-7882-87e8-8b6e4eb81706 resumes under its same root. The ordinary formatter retains the known writer, reports UNKNOWN/exit 1 and leaves exact bytes unchanged because complete wrapper coverage is not established. This proves known native ownership and safe refusal. Successful Codex owned formatting remains limited under F-6; no journal is introduced. Kat authentication remains pending. The issue therefore stays investigating.

The saved verified 18a server-stack artifact was used for resumed acceptance after the shared installed executable's observed SHA changed. That drift's cause is not established, and this repair neither overwrites the shared executable nor restarts peers. The Python reader is loaded from source on invocation; no Rust rebuild was required for F-20.


## Commit guards accept Codex — 2026-10-31

Source only; nothing pushed, merged or released. Codescout branch `feat/neutral-commit-guards-20261031` (worktree `codescout.worktrees/neutral-commit-guards`, upstream removed) stacks on `origin/experiments` `ea3c12600` plus cherry-picks `3cfce2978` and `200f6a7e1` of the unlanded Codex hold branch `feat/codex-publish-holds-20261027`. Rebase with `git rebase --onto origin/experiments 200f6a7e1` once that branch lands. HEAD `09280e6e5`.

The five remaining guards now resolve a Claude or Codex identity through `scripts/publish-identity.sh`: `1cc743f13` helper and `publish_principal_equal`, `4d2fe3f13` stage-log hook, `a1f1160e3` foreign-index guard, `5f992bdda` `commit-mine.sh`, `3e2763a84` `git-safe-reset.sh`, `99c582635` `mutation-probe.sh`, fix wave `eeabc4538`..`d51008e2e` (eight commits), docs `09280e6e5`. Owner format: bare id for Claude, `codex:<root id>` for Codex, `-` when missing, conflicting or invalid. Every comparison goes through `publish_principal_equal`, because `usage.db` stores bare ids for both hosts. Design: [remaining-guards spec](../superpowers/specs/2026-10-31-session-identity-remaining-guards-design.md); plan: [remaining-guards plan](../superpowers/plans/2026-10-31-session-identity-remaining-guards.md).

Suites at the fix-wave HEAD, each alone: publish-principal 22, hooks-discrimination 374 (also with ambient Codex variables), commit-mine 79, git-safe-reset 59, mutation-probe 92, hold-publish 91, pre-push guard 412, prepare-commit-msg 21, pytest 95. Mutations on the settled tree: M1, M2, M4, M5 and M6 each turn their named tests red. M3 (drop `|| exit 2` in `commit-mine.sh`) stays green, because the downstream foreign-index guard also exits 2 on a conflicting identity; the line is untested defence in depth.

Gate on `09280e6e5`: first run `PYTHON_LIGHT=0 FMT=0 CLIPPY=0 LEAN=101 DEFAULT=0 FMT_STATE=passed`. The LEAN red was two `attribution` tests (`the_same_red_at_exit_zero_still_answers`, `a_module_planted_beside_the_entry_does_not_run_through_the_shipped_path`). The branch changes no Rust file. Those tests passed alone (33/33) and the whole LEAN lane passed on rerun (5370/0). The cause of the first red is not established, and no single run had every lane green.

Open: the foreign-index guard captures the resolver with `2>&1` and takes the last line as identity, so a stderr warning can be adopted as identity (it fails conservatively: refuse, or label `theirs`). Codex writers found through the write record are described with the Claude liveness text. No live Codex run covered these guards. Status stays `investigating`.

## Architectural design review — 2026-10-10

Conversational design approved by the user on 2026-10-10. Reviewed with the Architecture Snow Lion skill. The [written spec](../superpowers/specs/2026-10-10-harness-neutral-session-identity-design.md), artifact c67a8d68e01c6cf4, was approved on 2026-10-10. The [implementation plan](../superpowers/plans/2026-10-10-harness-neutral-session-identity.md), artifact 3252b9f3f104ea25, was approved for inline execution with an independent final review. This decision record is not a claim of running-host support.

**Decision:** Keep host decoding at two adapter boundaries: current invocation context and authored-write evidence. Gate and formatter consume normalized context and ownership results; host storage formats stay inside their evidence readers.

**Context:** Codescout's `scripts/file-provenance.py::tool_records` reads Claude `tool_use` blocks, and `scan_with_evidence` combines calls, refusal results, workspace activation and opaque write evidence. Codex's `codex-rs/protocol/src/protocol.rs::SessionMeta` has separate root `session_id` and thread `id`, plus `parent_thread_id` and `subagent_history_start_ordinal`. Its `TurnContextItem` carries per-turn cwd. `codex-rs/protocol/src/models.rs::ResponseItem` represents function-call arguments as JSON strings and joins results by `call_id`; custom tools have separate input/output variants. These are verified source shapes at Codex HEAD `59f18e8133f2c1d3427677658752ac46697d41b7`, not live capture or lifetime tests.

The context carries a schema version, explicit harness, native root session id, optional agent/thread id, authoritative workspace and source/capability information. An ownership principal is the harness plus root session id; agent identity remains separate for attribution. Invocation context does not by itself prove authored writes. Conflicting native sources produce a context-conflict result rather than guessed precedence. Resume and compaction must preserve the native logical root; child agents retain that root and their distinct native agent id. Tests must establish those lifetimes before the adapter is advertised as supported.

Evidence normalization preserves request/result correlation, target resolution, timestamp uncertainty, actual outcome, atomicity, known write text and coverage gaps. Confirmed all-or-nothing refusals may be excluded; missing results, shell partial failures and opaque writes remain potential writes. Inherited/replayed history must not be reattributed to a child. A workspace or tool form that cannot be resolved yields unknown coverage and cannot authorize formatting. Host adapters perform native decoding; the existing provenance policy retains own, peer, shared and unknown distinctions.

**Alternatives considered:**

- Environment-variable alias only: small change, but supplies no Codex authored-write evidence and cannot meet mixed-harness ownership requirements.
- Native history readers behind a normalized contract: recommended first. Retains Claude history and adds Codex decoding without duplicating ownership policy or introducing another persistent store. Actual host captures must verify tool-form coverage; source schemas alone are insufficient.
- Hook-produced persistent write journal: can record normalized events closer to execution, but introduces concurrent append, missing-hook, replay/deduplication, retention and deployment obligations. Reconsider if native captures cannot expose the calls or authoritative outcomes required for safe attribution.

**Consequences:**

- Now easier: a host record-format change stays in its adapter; ownership rules and build-target leasing remain independent of the host.
- Now harder: historical formats, child history boundaries and incomplete transcript coverage require explicit compatibility fixtures. An unsupported or opaque tool form can force check-only verification.
- Gate behavior: ordinary invocation with missing/conflicting identity marks the formatting lane blocked, performs no formatting write, continues leased verification lanes, and returns a failing aggregate result. An explicit check-only gate mode runs read-only formatting intentionally. Both report Python, formatting, clippy, lean and default outcomes in their existing order, including after lane failures. Default remains last. Build leases never depend on a session id.
- Manual context can identify the caller, but cannot manufacture write ownership. A separate explicit exclusive-checkout contract is the only proposed override for formatting without attribution; missing identity never activates it.

**Change scenarios absorbed:** a Codex rollout payload changes; a Claude result encoding changes; both hosts edit one checkout; a child inherits parent tool history; a shell loses session environment; an unsupported runner needs read-only checks. These changes affect the corresponding decoder or capability result rather than the ownership policy or target-pool implementation.

**Revisit-when:** real host captures omit inner tool calls, lose authoritative workspace/outcome information, or fail to retain enough history for conservative provenance. Evaluate a journal then; do not describe native-history coverage as complete beforehand.

**Confidence:** High in separating invocation identity from write evidence and leaving build leases independent. Medium in native-history readers as the initial evidence source until actual Claude/Codex captures and lifecycle fixtures confirm coverage. Support claims require fixtures plus the issue's real-host smoke criteria.

**Validation required:** mixed-harness own/peer/shared/unknown cases; refused/partial/missing outcomes; inherited history; native root/agent continuity; conflicting context; unsupported tool forms; byte-identical peer files after refused formatting; leased lane order and individual failures. Preserve the existing Claude formatter and provenance regression behavior.
