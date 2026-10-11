---
id: '2185a218fbd18b7f'
kind: review
status: active
title: Harness-neutral Session Identity Verification
tags:
- session-identity
- provenance
- verification
- mutation-review
topic: harness-neutral-session-identity
additional_controller_mutations: 1
applied_mutations: 6
claude_owned_formatting: Passed in fresh main-profile native session 761aa55b-cc78-4d4d-b452-85c384949f52; actual MCP writer and formatter, exact final bytes, helpers match source and cargo fmt --check exits 0
codescout_original_application: Reviewed 22-file patch applied after scoped resume on 2026-10-11; bytes match reviewed source
codescout_source_head: 52be81ae78d963610cf88879cdbc41ed6323bfbc
cold_profiles: All three observed startup and companion 1.20.17 at canonical directory source; own-root records/source-cache bytes pass; main/SDD turns pass. Kat OAuth expired; user cannot reauthenticate now, so authenticated smoke remains pending.
controller_initial_survivors: 1
independent_reviewer: /root/harness_identity_review
installed_companion: 1.20.17; four existing cache snapshots byte-verified, paired 0.160.0 host cold-loaded
mandatory_mutations: 5
mandatory_survivors: 0
native_acceptance: limited; approval and resume/compact/fork transport plus main Claude owned formatting pass; native Codex MCP formatter safely refuses because root context is missing (F-16)
native_approval_acceptance: passed
native_claude_child: Passed native main-profile Agent child MCP write; parent root af8d2e22-9029-42c5-9257-d4fe124b1a43 retained, native agent a21ddf668790f255e distinct. Same parent formats owned child write after fixture-mode repair; exact bytes and independent fmt check pass. F-18 records initial fixture/instrument errors.
native_claude_fork_followup: 'F-17 fixed and committed locally in original Codescout 6eb585ef9161b858316fc9ef95270b8ccaeede2e: conservative enqueue boundary, 99 focused tests, canonical leased gate all five exits 0, actual same-fork safe refusal/no false credit/unchanged bytes and independent nine-mutation review with zero final survivors. All four files match reviewed source bytes and only those four paths were committed; index empty.'
native_explicit_mixed_host_refusal: 'Passed with context from actual Codex thread/start root confirmed by resume: formatter exit 1, UNKNOWN retains known Claude owner and opaque-history gaps, byte equality'
native_fork_applied_mutations: 9
native_fork_commit: 6eb585ef9161b858316fc9ef95270b8ccaeede2e
native_fork_final_survivors: 0
native_fork_gate: '@bg_0000001e exited 0, all five lane exits 0; production unchanged after Python lane, final 99 focused tests include three added CLI cases.'
native_fork_initial_survivors: 2
native_fork_reviewer: /root/claude_fork_review
original_integration: Plugin 4ce5432/f8a73ee; Codex 5eedcdc543; Codescout eed25579 plus F-17 6eb585ef9161b858316fc9ef95270b8ccaeede2e, local only
passover_id: 40b11eb5ae97a839
plugin_source_head: 36cf947
review_model: gpt-6-astra xhigh
source_verification: passed
surviving_mutations: 0
---

# Harness-neutral session identity verification

The original plugin, Codex and Codescout implementations are committed locally, companion 1.20.17 is installed, and the paired 0.160.0 native host passes approval and lifecycle transport checks. Main-profile Claude owned formatting and native-derived explicit-context mixed-host refusal pass. A real Claude fork exposed an attribution bug; its follow-up passes 99 focused tests, independent mutation review (nine killed, zero survivors) and the corrected live same-fork refusal. The four-file fix is committed in original Codescout as 6eb585ef; the canonical gate passed all five lanes. Codex automatic MCP root context, durable opaque-history coverage, complete Codex child/inherited provenance and Kat's authenticated smoke remain limited or pending. Issue [33de9ea8980e85c9](../issues/2026-10-09-harness-neutral-session-identity-and-provenance.md) stays investigating; no push occurred.

## Scope and review method

Approved [spec](../superpowers/specs/2026-10-10-harness-neutral-session-identity-design.md) and [plan](../superpowers/plans/2026-10-10-harness-neutral-session-identity.md). Baselines: plugin 82e86281b087ed45e39f523da2cb5cdd363e0f93; Codescout d188fdc87d53c2c255271628ab7e61978335f43f; inspected Codex 59f18e8133f2c1d3427677658752ac46697d41b7.

Implementation used independent clones at /tmp/harness-identity-20261010/{claude-plugins,codescout}. The final independent reviewer was /root/harness_identity_review, gpt-6-astra at xhigh, reviewing plugin c1021c4 and Codescout 44a465ff in private copies /tmp/harness-identity-review-20261010-a/{claude-plugins,codescout}. It applied mutations before reporting results and restored each mutation. The review's original verdict was not ready until the three Important findings were fixed; the controller performed one correction pass rather than redispatching a full review.

## Findings and controller corrections

| Finding | Observed failure before correction | Correction and observed result |
|---|---|---|
| Important: formatter confinement ignored nested Git checkouts | Exclusive outer checkout formatted a nested checkout. Two formatted/unformatted nested-descendant cases failed. | Resolve each target's Git top level and require the invocation checkout before writes. Formatter suite: 24 passed, including both new byte-equality refusals. |
| Important: unverified Codex fork boundaries could disappear without a coverage gap | Legacy/missing-ordinal/incomplete-prefix fork cases failed; an end-to-end fork peer left sole-own clearance. | Require a paginated, nonnegative ordinal boundary with sufficient observed prefix; otherwise retain an explicit fork gap. Selected fork cases passed, and mixed provenance becomes UNKNOWN. |
| Important: unsupported MCP writers were decoded but ignored | Filesystem write_file and a future Codescout writer left a Claude sole-own file as MINE; both CLI cases failed. | Unknown/foreign MCP operations become explicit coverage gaps. History/provenance suites: 58 passed, including the two UNKNOWN regressions. |
| Minor: pure native hook adapter hardcoded POSIX parent separator | Production normalization evaluated with Windows path dependencies returned available for an outside path. New regression failed. | Use node:path.sep. Node context suite: 11 passed. This exercises Windows path semantics on this Linux host, not a native Windows installation. |

Two full-gate integration failures were also corrected: resident CLAUDE.md exceeded its unchanged 5600-byte budget (6160 initially, 5572 after correction), and a copied policy call site omitted line-local legacy markers required by the existing Rust tool-registry guard. See guard-hardening-session-log:F-7 and F-8. The first full gate failed: LEAN 4470 passed/1 failed/7 ignored; DEFAULT 6742 passed/2 failed/8 ignored. Python, formatting and clippy passed, and later lanes ran despite earlier failures. That failed run is retained as evidence, not reported as a passing gate.

## Applied mutation evidence

All five mandatory mutations were actually applied in the reviewer's private copies, tested, and restored. Five applied, zero surviving. These counts measure the five selected mutations only.

| Mutation | Observed result | Suite |
|---|---|---|
| Codex principal namespace changed to Claude | exit 1; 9 failed, 43 passed | history + provenance |
| Codex child principal changed from root to child ID | exit 1; 1 failed, 51 passed | history + provenance |
| Confirmed atomic refusal counted as a write | exit 1; 1 failed, 11 passed | provenance |
| Coverage gaps removed from policy return | exit 1; 3 failed, 9 passed | provenance |
| DEFAULT skipped after a failed LEAN lane | exit 1; 3 failed, 42 passed | Python runner/gate |

Commands were python3 -m pytest -p no:cacheprovider -q with tests/test_harness_history.py tests/test_harness_provenance.py for the first two, tests/test_harness_provenance.py for the next two, and tests/test_python_runner.py for the last. Baselines in those copies passed; restored tracked sources had no mutation diff. The mutation exercise did not substitute for the independent edge review, which found the four issues above.


### Additional controller byte-preservation mutation

After review, the controller inspected snapshot(root) and found that it reads only root/src/*.rs, excluding the nested child. In a separate copy at /tmp/harness-byte-preservation-20261010, a mutation wrote to the rejected nested child immediately before the existing refusal. Before any new assertion, both selected tests passed (2 passed, 22 deselected): one observed surviving mutation. An explicit child byte comparison then caused that same mutation to fail both cases at the byte assertion. After restoring production code, the two cases passed; the full implementation formatter suite passed 24 tests. See guard-hardening-session-log:F-10. This additional mutation is separate from the five mandatory reviewer mutations; six candidates were exercised overall, with zero surviving the final tests.

## Source verification

After the review corrections and final nested-child byte assertion, the required focused command passed again: 168 tests in 18.77 seconds across test_session_context.py, test_harness_history.py, test_harness_provenance.py, test_harness_formatter.py and test_python_runner.py. Node context: 11 passed. Updated legacy provenance: 245 assertions passed; legacy formatter: 56 passed; plugin full suite: all suites passed in both the isolated implementation and the original checkout with the preserved earlier fixes. The leased Codescout --check gate exited 0: PYTHON_LIGHT=0, FMT=0, CLIPPY=0, LEAN=0, DEFAULT=0, FMT_STATE=passed. The lean library suite reported 4471 passed/0 failed/7 ignored (105.33 seconds); the default library suite reported 6744 passed/0 failed/8 ignored (1698.91 seconds). Other workspace/integration suites also completed under those zero lane exits. These are separate suite counts, not a deduplicated aggregate. The unchanged pool suite previously passed 88 assertions. Shared contract comparison pins version 1, byte-identical schemas/case packs and four complete expected Python objects; automatically absent consumers are explicitly skipped, while invalid explicit roots fail.

The gate's Python lane ran before the final extra child-byte assertions; the full focused command reran after those assertions, with production code unchanged. Gate caveats remain: heavy Python, server-stack and local ONNX weight acceptance are separate; librarian coverage runs in DEFAULT. The final measured pool size was 20G.

The Codescout gate uses the existing bounded pool at /home/marius/work/claude/claude-plugins/.codescout/harness-identity-pool. It runs Python, read-only formatting, clippy, lean and default lanes, with individual exit codes. This source verification does not claim that an executor is a natively supported authored writer. Plugin full-suite fixtures use a private TMPDIR directly under /tmp and an explicit CODESCOUT_CONTRACT_ROOT.

## Limits and declined-to-judge rulings

The reviewer declined to certify the following scopes. Controller rulings preserve the boundary rather than infer support:

| Scope | Controller ruling |
|---|---|
| Native successful writes, children, resume, compaction, forks and installed acceptance | Claude 2.1.296 main-profile actual writer/formatter and same-root resume/write passed. The corrected same-fork formatter refuses safely without false inherited credit. Native Codex 0.160.0 approval and resume/compact/fork transport passed; explicit native-derived context reaches a safe mixed-host refusal. Automatic Codex MCP context and durable opaque-history coverage remain limited; the observed Claude child/root native write and parent formatting passed, while complete Codex child/inherited-history provenance remains pending. Kat startup loaded, but its authenticated turn remains pending because reauthentication is unavailable. |
| Supported version ranges and native Windows/macOS behavior | No range claimed. Recorded versions are observations. Windows separator logic is unit-tested; native platform acceptance remains pending. |
| Codex peer contact and liveness | No available backend is claimed. Ownership can be known while contact/liveness remain unavailable; absence is not abandonment. |
| Actual operator exclusivity | --exclusive-checkout is an operator authorization precondition, not a repository fact inferred by the program. |
| Manual editors and arbitrary shell effects | Retain documented heuristic limits. Unsupported MCP calls present in decoded histories are coverage gaps, as the new regressions demonstrate. |
| Opaque wrapper effects in an unrelated recorded workspace | Preserve workspace-scoped uncertainty. Hidden cross-workspace effects cannot be inferred from an opaque record. |
| Changes concurrent with inspection/formatting | No transactional write-isolation claim. Existing checks provide no write lock. |
| Sibling-agent ownership within one root session | Intentional root-session grain; separate known issue 3d7e38fd20fac6b8 remains outside this work. |
| Full Rust, pool and profile certification | Controller owns source/pool results recorded here. All measured installed companion source/cache paths and own-profile install records passed. Fresh main/SDD authenticated turns passed; Kat authenticated smoke remains pending. The reviewer did not duplicate controller host/pool checks. |

## Delivery and remaining acceptance

Reviewed original source delivery is complete: plugin feature 4ce5432 and separate real-release-output f8a73ee, Codex 5eedcdc543, and Codescout eed25579 on experiments. Native approval routing is fixed; original protected Git writes use native escalation. Companion 1.20.17 is installed and byte-verified across every measured existing profile, and the correctly versioned paired GNU/Linux 0.160.0 host is running. No push occurred. The earlier saved 22-file source patch and clean-release bundle remain historical delivery evidence.

The F-17 follow-up changes exactly scripts/claude_history.py and its three history/provenance/formatter test files. Its original patch check and application passed, with unrelated work preserved. Independent review, focused/native checks and the canonical five-lane gate pass. Original Codescout commit 6eb585ef contains exactly the four reviewed paths; their source bytes and empty index were independently verified. Remaining acceptance covers automatic Codex MCP root-context delivery, complete durable write/child/inherited-history evidence, and Kat's authenticated smoke after authentication becomes available. Successful transport/startup does not clear those provenance criteria. Keep the issue investigating and the [active handoff](../trackers/passover-harness-neutral-session-identity-2026-10-10.md), artifact 40b11eb5ae97a839, active.

## Delivery and installation checkpoint — 2026-10-11

Fresh applicability checks passed for the saved Codescout and Codex patches, and both were applied to original working trees with exit 0. All 22 Codescout patch paths and three Codex patch paths compare byte-equal against their reviewed copies; unrelated changes and original indexes were preserved.

The clean local release copy at original plugin base 61608048 committed feature e75ce39 and companion 1.20.17 release 4fc9326. Its full plugin suite and 528 buddy pytest tests passed. After preserving-backup repair of unrelated marketplace skew, repeated full profile parity and canonical version checks exited 0. The actual release's three version-file changes were copied to canonical working files. A verified bundle preserves both local commits; NO_PUSH=1 and no push occurred.

The public Codex plugin installer exited 0. All 98 released companion source files compare equal in the existing lowercase Codex profile and all three Claude caches. Runtime .codescout state is excluded explicitly; Codex's generated migrated dashboard command is checked against its source body. The version-bump-checklist is refreshed; unrelated Legible unreleased source/cache differences remain visible.

The complete new native approval package is built and all package digests reverified, but the selected/running daemon remains 0.159.2. The candidate reports local dev 0.0.0. A syntax-checked outside-session launcher invokes the public from-cli installer then resumes this session with the granted roots; a rollback launcher reselects the preserved original package. The other active task reached a safe checkpoint and was observed idle. No host restart occurred. Actual native approval, authored/mixed-peer and lifecycle acceptance remain pending; no source/copy/probe result substitutes for those observations.

## Native acceptance checkpoint — 2026-10-11

The shared daemon/helper run the pinned GNU/Linux 0.160.0 package, and every installed manifest file matches its size/SHA-256. The canonical protected Git directory accepted a real native escalated ref write; its value and cleanup were independently observed. Ordinary native shell routing still redirected through the installed hook.

The installed app-server, existing authenticated profile and on-request/workspace-write policy then completed an actual native accept/decline pair. Accept returned a completed command item with exit 0 and an existing marker; decline returned a declined item and no marker. No credentials were copied and no permissions bypass or session/persistent grant was used. Across a new server process, resume retained the root ID; compaction emitted one completed item and a following turn completed; fork returned a distinct root ID and completed another turn. The scratch directory was removed after observation. Native-routing issue cd15dd2c76c1f7eb is fixed.

The source decoder was separately run on both resulting durable native histories. Each returned zero operations and explicit coverage gaps: opaque custom-tool wrappers, token-usage rollout envelopes and, for fork, an external history prefix. This verifies the limited capability result. Authored formatting, mixed-host peer refusal, child/root and inherited-history attribution, and cold Claude acceptance remain pending in 33de9ea8980e85c9.

Evidence: .codescout/native-approval-live-check-20261011.json, .codescout/native-runtime-smoke-20261011.json and .codescout/native-history-decoder-20261011.json.

## Original commits and cold-profile observations — 2026-10-11

Native Git integration completed on explicit task paths: plugin 4ce5432/f8a73ee, Codex 5eedcdc543 and Codescout eed25579. Both source patches and the plugin production/test paths match the previously reviewed/tested copies; no production change triggered another full gate run. Codescout's original pre-commit checks passed. Source whitespace checks passed; the saved unified-patch artifacts retain required blank context-line markers and are explicitly excluded from the plugin diff whitespace check. Unrelated original changes remain and all original indexes were empty after source integration. No push occurred.

Fresh main, SDD and Kat Claude processes each observed SessionStart startup and companion 1.20.17 at this machine's canonical directory source. Their install records remain under the owning profile cache; every released source/cache file compares equal. The initial instrument's runtime-path prefix predicate did not measure install-record ownership, so its false values are preserved and assessed separately in .codescout/cold-claude-profile-assessment-20261011.json. Main/SDD authenticated turns passed. Kat loaded startup but failed because OAuth expired and could not refresh; no bypass/retry or auth/profile change was attempted. Authored and full lifecycle provenance remain pending.

## Native Claude owned formatting — 2026-10-11

Fresh main-profile Claude session 761aa55b-cc78-4d4d-b452-85c384949f52 wrote src/main.rs through mcp__codescout__create_file (toolu_016Vb9d5aBbace6TDDiizVcy), then ran bash scripts/fmt-mine.sh through mcp__codescout__run_command (toolu_01M5egatYG7xj4E6zwWWHA31). The formatter exited 0 and reported one owned file, with a fixed point after one pass. No synthetic session ID, context override, credential copy, exclusive-checkout declaration or permission bypass was used.

Independent before/after reads observed the expected formatted bytes. SHA-256 changed from 475120d5e28812ecb4a79b0b42785f0793a06e25084e7bc151fc0b4165681e3a to f4e85f0cb566638632f5d02f2255a0de4008671953f7bbe55c89c69e8591a6f7. All eight copied helpers match the reviewed source byte for byte; an independent cargo fmt --check exited 0. Evidence: .codescout/native-claude-authored-v2-result-20261011.json. The scratch checkout /tmp/native-claude-authored-v2-20261011-w0qmj698 is retained for further native ownership checks.

The first probe failed because the minimal scratch fixture omitted file-provenance.py; the native writer had succeeded. Its separate evidence remains in .codescout/native-claude-authored-result-20261011.json. The corrected fixture passed without production changes. This result establishes main-profile Claude owned formatting only. Native Codex authored formatting, mixed-host peer refusal, child/inherited-history provenance and Kat's authenticated smoke remain pending.

## Native mixed-host attempt — 2026-10-11

Claude resumed the same native root 761aa55b-cc78-4d4d-b452-85c384949f52 and wrote a new unformatted src/main.rs through create_file, call toolu_01T2TLyjqGnuoDtq1hkYXCP8. The returned root ID matched the original, and the expected unformatted bytes were independently read. Native Codex root 01a129e4-2c5a-7833-9026-e4eb799753bf then completed actual MCP run_command item exec-91f33162-990d-4746-9994-27494a6e3111 with bash scripts/fmt-mine.sh.

The command exited 2 because native root context was missing. It wrote nothing: before/after SHA-256 both equal 1e61cb3ed6c4c9bbb2da35a61cb32527f1361ede32419af9fd0dfb29d25536ed. This proves safe refusal and Claude root continuity across resume; it does not prove peer classification, since provenance resolution was not reached. Conversation completion and unchanged bytes alone were not counted as a passing formatter.

The inspected Codescout shell launch has no per-call root-context export. The approved resolver requires an authoritative native root or validated explicit context; CODEX_THREAD_ID alone remains insufficient. No production change or synthetic identity was introduced. Evidence: .codescout/native-mixed-refusal-result-20261011.json and guard-hardening-session-log:F-16.

## Explicit native context and mixed-host refusal — 2026-10-11

The next call exercised the documented --context fallback. Its context names Codex root 01a129e4-2c5a-7833-9026-e4eb799753bf, obtained from actual thread/start metadata and confirmed by thread/resume. It is source explicit, with the actual scratch root and host version; no fake ID, environment override, history override, permission bypass or exclusive declaration was used.

Native MCP item exec-5f558737-ed09-49dd-ab2b-832473ac7bf5 completed bash scripts/fmt-mine.sh --context /tmp/native-claude-authored-v2-20261011-w0qmj698/.codescout/native-api-context-20261011.json. The command exited 1 and refused UNKNOWN src/main.rs, retaining both the known Claude owner and opaque-wrapper/unsupported-envelope coverage gaps. Its stderr explicitly says unavailable contact does not establish abandoned work. The file stayed byte-identical, with SHA-256 1e61cb3ed6c4c9bbb2da35a61cb32527f1361ede32419af9fd0dfb29d25536ed.

This passes safe mixed-host refusal with a native-derived explicit context and incomplete coverage. It does not establish complete Codex provenance, automatic MCP context transport or Codex owned formatting. Evidence: .codescout/native-mixed-explicit-context-result-20261011.json; the structured actual formatter result and independent hashes are retained there. No green full suite was repeated, because production source did not change.

## Native Claude fork attribution regression — 2026-10-11

Native --resume --fork-session produced root c54e9b99-48dd-4589-b931-b6b24066fb4e. It called only the formatter, which safely refused with exit 1 and preserved bytes, but attributed the two original create_file calls to the fork as new authorship. The native files preserve their UUIDs, call IDs and timestamps while rewriting sessionId; no explicit fork-origin field was observed. F-17 records the bug.

The first native enqueue in the fork is 2026-10-11T07:45:37.860Z; its copied writes are timestamped 07:26:09.667Z and 07:36:15.141Z. Three regressions failed before implementation: decoded operations falsely retained a copied write; the fork-only provenance CLI returned MINE instead of UNKNOWN; and the formatter actually changed both files when peer/gap evidence was absent. These failures distinguish the attribution bug from the safe live refusal that initially masked it.

The isolated guard excludes root calls earlier than the first native enqueue and keeps a coverage gap, including when the original transcript is absent. It uses the earliest same-root enqueue across resume, compares timezone-aware instants, preserves child identity, and requires a usable boundary/call timestamp when native enqueue metadata exists. A per-call Codescout workspace pin scopes its gap; otherwise the gap remains unscoped. Missing enqueue metadata retains the legacy path, so this is a measured conservative guard for the observed native form, not universal fork support.

The final focused history/provenance/formatter suite passed 99 tests. Running the new reader on the actual saved fork history removes both false inherited write credits, retains the new formatter call and records three inherited-history gaps. Independent reviewer claude_fork_review applied nine mutations: seven were killed and two initially survived all 96 tests. Three CLI regression cases were added only after observing those survivors. Fresh isolated reruns kill workspace-to-startup-cwd substitution (2 failed, 1 passed) and ignoring a malformed enqueue after a valid marker (1 failed, 2 passed); restored cases pass. Final observed review result: nine killed, zero surviving, no outstanding findings.

The existing native fork was resumed with only the reviewed candidate helper copied into its retained scratch fixture. Actual MCP call toolu_014YHEcnmX5sk8f7VoF6jhM9 ran fmt-mine.sh and returned exit 1 with UNKNOWN, inherited-boundary gaps and the original Claude owner. It no longer printed written by THIS session for copied writes. Native root was unchanged, there were no identity/history/context overrides, and before/after SHA-256 remained 1e61cb3ed6c4c9bbb2da35a61cb32527f1361ede32419af9fd0dfb29d25536ed. Evidence: .codescout/native-claude-fork-result-20261011.json, .codescout/native-claude-fork-decoder-after-20261011.json and .codescout/native-claude-fork-fixed-result-20261011.json. The canonical leased gate exited 0 with all five lanes passing. The four-path patch check/application, staged index/content review and native original commit 6eb585ef9161b858316fc9ef95270b8ccaeede2e passed; committed bytes match the reviewed source and the index is empty. F-19 records the initial unstaged-pathspec refusal and corrected commit sequence.

## Native Claude child/root authorship — 2026-10-11

The actual main-profile native parent af8d2e22-9029-42c5-9257-d4fe124b1a43 spawned one general-purpose Sonnet child through Agent (toolu_01UaPJfZuyEnjryGuPLnfEnf). Child MCP writer toolu_015QH9LgFRgs4EmjS9dJB583 authored unformatted src/main.rs. Its saved native subagent history decodes to the parent root principal and separate native agent a21ddf668790f255e, with is_child=true.

The first parent formatter could not execute the copied helper because the scratch fixture lost its executable mode; F-18 records this setup and capture error. Source helper modes were restored, and the same native parent was resumed without another writer/child. Actual MCP formatter toolu_01W8DszcZExVBRoNm4BGqTaQ exited 0, reporting one owned file. Independent exact-byte comparison and cargo fmt --check passed; all eight helper bytes and modes match original source. SHA-256 changed from 716956f802f76803e589a89d01f88fe82cc7cd2d374b9b20d8e3d7b577860571 to 86a8bf5592107d22186c50e5dbc99dd05314d4052a35702daa23a62d5d453016. No synthetic identity, history/context override, exclusivity, credential copy or native permissions bypass was used.

Evidence: .codescout/native-claude-child-result-20261011.json and .codescout/native-claude-child-fixed-result-20261011.json. This establishes the observed Claude child/root attribution and root-owned formatting, not Codex child/inherited-history coverage or isolation between sibling agents within one root.

## F-17 broad gate and original integration — 2026-10-11

The canonical command CODESCOUT_GATE_POOL=/home/marius/work/claude/claude-plugins/.codescout/harness-identity-pool ./scripts/gate.sh --check completed as @bg_0000001e with exit 0. PYTHON_LIGHT=0, FMT=0, CLIPPY=0, LEAN=0, DEFAULT=0 and FMT_STATE=passed. Python light reported 1174 passed plus 421 passing subtests in 45.47 seconds. Lean library: 4471 passed/0 failed/7 ignored in 113.50 seconds. Default library: 6744 passed/0 failed/8 ignored in 1452.35 seconds. Remaining workspace/integration/doc-test results completed under the same zero lane exits. These are separate observed suite counts, not a deduplicated aggregate.

Three CLI cases were added after the gate's Python lane; the final 99-test focused suite passed in 14.21 seconds with production unchanged. Heavy Python, server-stack and local ONNX weight acceptance remain excluded; librarian coverage runs in DEFAULT. The final bounded pool measured 20G.

The reviewed original patch was applied and committed through native approval in Codescout 6eb585ef9161b858316fc9ef95270b8ccaeede2e on experiments. A first unstaged-pathspec attempt was refused without a commit; F-19 records the required separate staging and actual index review. Post-commit checks verified exactly the four owned paths, full-byte equality with the reviewed clone/prepared digests, an empty index, and preserved unrelated dirty files. No push occurred. Evidence: .codescout/native-fork-gate-result-20261011.json and .codescout/native-fork-integration-result-20261011.json.
