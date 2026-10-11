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
codescout_original_application: Reviewed 22-file patch applied after scoped resume on 2026-10-11; bytes match reviewed source
codescout_source_head: 52be81ae78d963610cf88879cdbc41ed6323bfbc
controller_initial_survivors: 1
independent_reviewer: /root/harness_identity_review
installed_companion: 1.20.17; four existing cache snapshots byte-verified, paired 0.160.0 host cold-loaded
mandatory_mutations: 5
mandatory_survivors: 0
native_acceptance: limited; approval and resume/compact/fork transport passed, decoder reports actual history coverage gaps
native_approval_acceptance: passed
passover_id: 40b11eb5ae97a839
plugin_source_head: 36cf947
review_model: gpt-6-astra xhigh
source_verification: passed
surviving_mutations: 0
---

# Harness-neutral session identity verification

Source implementation is complete in isolated clones. Independent review found three Important issues and one Minor issue; the controller reproduced each with a failing regression and corrected it. Final source verification passed. Plugin changes are applied to the authorized working checkout; the checked Codescout patch is saved, with protected original application blocked by native routing. Native authored/lifecycle and installed-profile acceptance remain pending, so issue [33de9ea8980e85c9](../issues/2026-10-09-harness-neutral-session-identity-and-provenance.md) remains investigating.

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
| Native successful writes, children, resume, compaction, forks and installed acceptance | Pending actual captures. Existing Claude 2.1.296 root hook/Read-refusal and Codex 0.160.0 root metadata/opaque-wrapper-refusal captures are limited. Process exit 0 did not establish requested tool execution. |
| Supported version ranges and native Windows/macOS behavior | No range claimed. Recorded versions are observations. Windows separator logic is unit-tested; native platform acceptance remains pending. |
| Codex peer contact and liveness | No available backend is claimed. Ownership can be known while contact/liveness remain unavailable; absence is not abandonment. |
| Actual operator exclusivity | --exclusive-checkout is an operator authorization precondition, not a repository fact inferred by the program. |
| Manual editors and arbitrary shell effects | Retain documented heuristic limits. Unsupported MCP calls present in decoded histories are coverage gaps, as the new regressions demonstrate. |
| Opaque wrapper effects in an unrelated recorded workspace | Preserve workspace-scoped uncertainty. Hidden cross-workspace effects cannot be inferred from an opaque record. |
| Changes concurrent with inspection/formatting | No transactional write-isolation claim. Existing checks provide no write lock. |
| Sibling-agent ownership within one root session | Intentional root-session grain; separate known issue 3d7e38fd20fac6b8 remains outside this work. |
| Full Rust, pool and profile certification | Controller owns source/pool results recorded here. Installed-profile certification remains pending; the reviewer did not duplicate it. |

## Delivery and remaining acceptance

Feature versions, installed profile caches/configuration, release and push remain untouched. Plugin feature patch ad25af0..36cf947 passed git apply --check and was applied within the authorized writable checkout. It excludes the prerequisite guard-test commit and preserves earlier dirty routing/tracker fixes. No original index staging or commit was performed. The final corrected Codescout patch is saved at docs/patches/2026-10-10-harness-neutral-codescout.patch and git apply --check passed against the protected original. It contains 22 task-owned files and excludes the original's unrelated dirty trackers/issues. The native git apply attempt with sandbox_permissions=require_escalated was blocked by the installed PreToolUse routing hook before host approval: it redirected the command to run_command as a leaner shell path. The original Codescout patch remains unapplied. Native escalation is the permitted route for protected original writes; the MCP redirect cannot carry filesystem approval and was not followed. Final isolated source heads are plugin 36cf947 and Codescout 52be81ae78d963610cf88879cdbc41ed6323bfbc. The Codescout clone is clean; the plugin clone retains only the copied untracked approved spec/plan. The final Codescout patch is generated strictly from d188fdc8..52be81ae and passes git apply --check again after regeneration. Original plugin working files and managed documentation remain uncommitted; no original index writes, release or push occurred.

After source delivery, remaining acceptance is native authored/mixed-peer smoke, lifecycle continuity, protected original application if blocked, authorized release/install across profiles, cold load and repeated live smoke. The current issue remains investigating until those criteria hold. The [active handoff](../trackers/passover-harness-neutral-session-identity-2026-10-10.md), artifact 40b11eb5ae97a839, records the exact resume state and required first verification.

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
