---
id: be871df4dc66f9a4
kind: spec
status: approved
title: Native execution provenance for safe cross-harness owned formatting
tags:
- session-identity
- provenance
- codex
- design-review
---

# Native execution provenance for cross-harness formatting

## Status and intent

Approved by the maintainer on 2026-11-07 («ok, continua»). Implementation is in progress. This is the conditional producer extension left open by the [approved identity design](2026-10-10-harness-neutral-session-identity-design.md#native-evidence-follow-up--2026-10-12). Approval covers source implementation and isolated verification, not release, profile installation or a claim that native acceptance has passed.

Make ordinary Codex owned formatting usable while retaining the existing refusal of peer/shared/unknown writes. Root identity already works. The remaining problem is proving the executed operation inventory, including work hidden behind JavaScript wrappers.

## Observed baseline — 2026-11-07

- Existing IDE root: native Codex 0.160.0; automatic MCP context agrees with its actual root/workspace.
- Fresh installed CLI: 0.167.0, existing saved authentication, ordinary workspace-write sandbox and configured MCP server. A native writer produced the exact requested Rust bytes in a disposable checkout.
- The same root resumed and invoked the unchanged formatter once. The real tool exited 1/UNKNOWN, retained THIS-session attribution and preserved the file hash. The decoder sees three opaque wrappers after writing and five after resume. Neither outer turn's successful completion means formatting succeeded.
- Evidence and exact IDs are in [the issue](../../issues/2026-10-09-harness-neutral-session-identity-and-provenance.md#fresh-native-reproduction--2026-11-07). Private raw histories and scratch logs remain outside tracked documentation.
- No Kat authentication retry, credential copy, synthetic context/history/identity, exclusive declaration, trust bypass or installed-profile edit was used.

## Goals, non-goals and anti-goals

Goals: prove complete execution prefixes from the native producer; retain exact root/thread/call attribution; support owned format and mixed-host refusal; retain conservative behavior for old/partial evidence.

Non-goals: replacing session-context v1, changing Claude identity semantics, inferring execution from JavaScript, granting exclusive-checkout permission, fixing Kat authentication, or claiming support for untested host versions.

Failure even with green tests: clearing UNKNOWN from a list of some successful MCP calls; treating a cancelled outer call as proof that its inner effects stopped; counting a model-supplied claim as native evidence; attributing inherited fork writes to the new root; or allowing formatter writes from an incomplete prefix.

## Approaches considered

1. **Extend the existing native recorder with durable provenance checkpoints — recommended.** Rust Codex records the actual dispatch boundary; Python Codescout consumes a versioned proof. This covers the current Code Mode workflow but requires coordinated changes and live validation.
2. **Validate a restricted direct-tool execution mode.** This could reduce the required recorder surface but would narrow the supported workflow. It is not established by the present probe and would not repair Code Mode. No such mode is silently selected here.

A new JavaScript parser or blanket removal of coverage gaps is rejected: neither establishes which calls actually executed.

## Existing seams to reuse

The local Codex source already has `ExecutedToolCalls`, `record_nested_tool_call`, `finish_cell_recording` and `Feature::ExecutedToolCallMetadata`. Its bounded warehouse metadata is opt-in, can be truncated or shed, and is deliberately not trusted on deserialization/resume. It is not itself the required durable provenance interface.

The gRPC code-mode protocol already identifies execution, cell and invocation and supplies per-execution tool sequences plus `CellClosed.final_tool_call_sequence`. The core delegate currently receives a cell-close callback without that sequence. The rollout trace is best-effort debug recording, not a completeness guarantee. Reuse dispatch/lifecycle primitives; do not turn optional analytics into clearance.

These are inspected source seams, not claims that the installed CLI already exposes a usable journal.

## Proposed producer contract

Add a versioned native provenance stream separate from Responses warehouse metadata. Keep raw inputs/outputs private with the native history. Storage details are left to the builder; the following are required:

- Bind each stream and checkpoint to native harness, root session, executing thread, producer epoch and native history/fork/child boundaries.
- Record every supported dispatched operation before invoking its effect, with a unique call ID, exact tool identity, complete arguments or an explicit omission marker, workspace/context and the relevant cell/execution/sequence.
- Distinguish receipt, dispatch, outcome, cancellation-before-dispatch, and cancellation after dispatch. A cancelled await does not prove a dispatched tool stopped.
- Account for callbacks delivered after cell closure. Cell closure with a final sequence is not sufficient until every issued slot is accounted for or is explicitly incomplete.
- Persist failure/omission state. Once a required record is lost or truncated, no later checkpoint may certify that affected prefix as complete. A missing terminal record, sequence hole, conflicting replay, read error or crash stays unknown.
- Preserve distinct native call identity when two calls have identical arguments. Do not deduplicate by argument equality.

The format and feature are internal, versioned provenance interfaces, not additions to `InternalChatMessageMetadataPassthrough` or the public Responses schema.

## The active formatter boundary

A terminal exec output cannot certify the very wrapper that is currently calling the formatter. At the real formatter `run_command` dispatch, the host must supply a durable, caller-bound checkpoint of the relevant execution prefix.

The checkpoint identifies exactly which dispatched/pending operations precede that invocation and binds to the immutable bytes/frontiers it certifies. Later activity is outside that prefix, not proof that earlier pending work completed. Earlier in-flight work with unresolved targets/outcomes retains a gap. Do not use wall-clock order or outer-turn completion as the boundary.

Carry this optional extension through native MCP metadata and Codescout's spawned-command transport without changing session-context v1. Codescout accepts a checkpoint only when it matches the actual native root/thread/invocation and the producer stream's version, lineage and prefix integrity. A fixture path or user-supplied environment claim alone never grants clearance.

The trust model remains local native-history provenance, not protection against an OS user who deliberately rewrites both evidence and verification state.

## Formatting and concurrent writers

A checkpoint is a history observation, not write authorization that remains valid indefinitely. The selected design therefore requires a cooperative per-checkout write fence covering provenance evaluation through the formatter's last filesystem write. A checkpoint without that fence cannot enable native owned formatting.

All supported native/MCP write dispatches participating in this capability must honor the same canonical-checkout fence across roots, threads and profiles. Before evaluation, the formatter coordinator acquires it and drains or rejects unresolved earlier work. The exact formatter invocation is the sole holder allowed to proceed; its active ancestor wrappers are not blanket exemptions. Any sibling/child/later write dispatch waits or is refused until release. An unresolved earlier writer, a missing participant capability or inability to bind the fence to the actual invocation keeps UNKNOWN.

The fence must remain held for the actual formatter process lifetime, including interruption of its caller. A yielded/background job receipt, cancellation acknowledgment or dead parent alone is not proof that the process stopped. If the coordinator cannot establish safe ownership/release, it refuses rather than relying on a lease timeout. The native acceptance path must observe actual process completion.

This is a guarantee for participating supported write surfaces, not arbitrary OS users/manual editors; those remain outside the existing transcript-evidence model. The implementation plan must enumerate supported surfaces and show where their common fence is enforced. If the common boundary cannot be made enforceable for a host, that host's owned-format capability remains unsupported. Native history identity support may still be reported independently.

The concrete lock/transport/guardian mechanism is left to the builder, but whether fencing is required is not: it is mandatory. Do not implement a snapshot-only formatter or silently narrow the contract to sequential tests.

Builder ruling — 2026-11-07: independent review reproduced a supported command in checkout A writing checkout B while B's local fence remained exclusive. Cwd does not confine write targets. The implementation therefore requires an additional per-user coordination domain shared by all server instances/profiles, acquired before the canonical checkout lease: ordinary effects share it; a foreground formatter owns it exclusively. Both durable generation values bind the native snapshot and both inherited descriptors remain live through the process's final write. This deliberately prevents any participating checkout from writing during another checkout's formatting interval. Capability version 2 / coordinated-checkout-v1 rejects the incomplete checkout-only prototype. The stronger producer mode has its own default-off native_execution_provenance feature; existing warehouse metadata users do not opt into dispatch restrictions merely by enabling executed_tool_call_metadata.

Builder refinement — 2026-11-07: coordination state lives durably under the operating-system account home, `.local/state/codescout/native-provenance-v2`, resolved independently of HOME, XDG or harness profile overrides. An arbitrary shell can leave descendants after its terminal response, so each non-certified shell dispatch first persists an unresolved-shell marker. Marker presence keeps native owned formatting UNKNOWN across all participating checkouts; there is no automatic reset. Ordinary commands and peer edits remain available. Thus post-build owned formatting is not a supported positive workflow in this prototype. Only the exact shipped formatter plus its verified helper closure receives the exception, with repository Cargo executable overrides, custom Rustup toolchain paths/names and import shadowing refused, startup/helper environment overrides cleared, and Python bytecode writes disabled. Existing repository Python caches also retain UNKNOWN; no cache is deleted automatically. Installed operating-system tools and cooperating control-state owners remain trusted boundaries.

## Consumer behavior and lifecycle

The Python reader normalizes native operations and coverage evidence into the existing Operation/CoverageGap policy. A supported, fully bound checkpoint may discharge only the specific opaque wrappers/prefix it proves. All other gaps remain.

Resume must reopen verified lineage, not reconstruct completeness from warehouse metadata. Compaction must preserve a verifiable provenance prefix or mark the missing range unknown. Child streams retain the parent root and distinct thread; the parent's checkpoint must cover its registered children/pending work. A new-root fork retains original authorship before its independently recorded cutoff and starts a new producer epoch. Any unresolved relationship blocks clearance.

Keep exact existing peer/shared/refused/partial-error semantics. Missing capability means today's conservative refusal, never CLEAN-by-absence.

## Verification obligations

1. Producer tests for sequential, concurrent, yielded, unawaited, cancelled-before-dispatch, cancelled-after-dispatch, late callback, out-of-order delivery, crash, record failure, cap shedding and duplicate arguments/IDs.
2. Consumer tests for supported complete proof; missing, malformed, forged-in-result-text, wrong-root/thread/invocation/epoch, truncated, conflicting, replayed and unsupported proof; and preserving unrelated gaps.
3. A formatter test where it runs inside an active wrapper: earlier complete writes may be owned; earlier unresolved work must refuse. Apply a concurrent sibling/child write after checkpoint creation and before formatter completion: it must be fenced until formatting finishes, and an interrupted formatter retains its fence until its process is proven stopped. Test missing/nonparticipating capability and unsupported native write surfaces as refusals. Future work cannot retrospectively certify the earlier prefix.
4. Native write/resume/format, mixed Claude↔Codex peer refusal with independent byte equality, child, fork and compaction observations. Record actual host versions and actual tool exit codes.
5. Apply mutations before adding a closing test: remove root/thread discrimination, drop one execution slot, mark cancellation complete, clear an unrelated gap, deduplicate equal arguments and borrow fork ownership. Report observed survivors and rerun the exact recipes after fixes.
6. Run each repository's required gate only after source changes settle. Real-host acceptance cannot be replaced by synthetic decoder tests.



## Design review — 2026-11-07

Independent builder review found that a history checkpoint alone could race a sibling/child write before formatting. The mandatory per-checkout write fence above resolves that design question. The reviewer reported no remaining Important design blockers after rereading the revised section. This is a design review, not verification of implementation; enforcement feasibility must be demonstrated in the implementation plan, otherwise native owned formatting remains unsupported. Design approval is still pending.

## Delivery and operational constraints

Implement on isolated copies/worktrees. The codescout and Codex source checkouts are outside this session's writable roots; prepare reviewed patches and verify applicability before requesting native filesystem escalation. Do not bypass sandbox approval with MCP writes.

No profile edits, shared-binary replacement, cold restart, version bump or publication is part of design approval. Deployment requires its own concrete install/release step and applicable all-profile checks. Preserve the previous local plugin fixes.

Kat smoke remains pending under the existing no-reauthentication constraint. Do not weaken the parent issue's completion criteria to hide that limit.

## Left to the builder

Choose the minimal durable event representation, append/locking mechanism, checkpoints and source files after scouting the actual native transport. Reuse the existing recorder where its guarantees are sufficient. Do not select a particular serialization or claim a supported version range before measuring the implemented path.

The builder must make the lineage, active-prefix and loss-detection contracts explicit in the implementation plan; any discovered contradiction comes back to this design rather than being resolved by suppressing gaps.
