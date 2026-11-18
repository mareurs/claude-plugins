---
id: c67a8d68e01c6cf4
kind: spec
status: active
title: Harness-neutral session identity and write provenance
tags:
- codescout-companion
- codescout
- session-identity
- provenance
- harness-compatibility
topic: harness-neutral-session-identity
approved_on: 2026-10-10
codescout_native_history_commit: 5ae71b35a05450d545ac355085378dfeee81a46c
implementation_plan_id: 3252b9f3f104ea25
implementation_review_id: 2185a218fbd18b7f
native_acceptance: Limited by complete code-mode execution inventory F-6 and Kat authentication; automatic native context F-16 and bounded native history reader F-20 verified.
native_automatic_context: 'F-16 source 18a007aa was built with server-stack, installed and freshly verified on 2026-10-11: all five gate lanes, seven context tests and eleven applied review mutations with zero final survivors. Native root 01a12bc6-4184-7182-b87d-ae4637c3e9c9 received matching native-env context without identity/context/history overrides. Existing processes were preserved. On 2026-10-12 the shared executable SHA changed; the cause is unknown. Subsequent native resumed acceptance uses the saved verified production artifact. Complete code-mode inventory remains F-6; Kat authentication remains pending.'
native_claude_child: 'Native Claude main-profile child/root smoke passed: parent af8d2e22-9029-42c5-9257-d4fe124b1a43, distinct agent a21ddf668790f255e, actual child MCP writer and same-parent formatter exit 0; exact bytes, source helper bytes/modes and independent cargo fmt --check passed. Initial fixture/capture failure preserved as F-18.'
native_claude_fork_followup: 'F-17 fixed and committed locally in original Codescout 6eb585ef9161b858316fc9ef95270b8ccaeede2e: conservative enqueue boundary, 99 focused tests, canonical leased gate all five exits 0, actual same-fork safe refusal/no false credit/unchanged bytes and independent nine-mutation review with zero final survivors. All four files match reviewed source bytes and only those four paths were committed; index empty.'
native_history_reader: 'F-20 fixed-verified in original commit 5ae71b35: 141 focused tests, all 25 reapplied mutations killed, five-lane gate and shell suites 245/56/88 pass. Actual native known-writer resume retains UNKNOWN and unchanged bytes; wrapper gaps remain.'
plan_review_pending: false
source_commits:
  plugin_feature: '4ce5432'
  plugin_release: f8a73ee
  codex: '5eedcdc543'
  codescout: eed25579
  codescout_fork_followup: '6eb585ef9161b858316fc9ef95270b8ccaeede2e'
source_implementation: Initial implementation, F-17, F-16 and bounded F-20 are reviewed, verified and committed locally. Approved context version 1 is unchanged; complete code-mode execution inventory remains F-6.
---

# Harness-neutral session identity and write provenance

## Intent and approval

Provide Claude Code and Codex with comparable ownership protection when they share a Codescout checkout. The caller must be able to run verification without borrowing a peer's identity, rewriting a peer's uncommitted work, or bypassing the build-target lease.

The user approved the conversational design and this written spec on 2026-10-10. The user approved the implementation plan and inline execution with independent final review on 2026-10-10.

Issue: [Harness-neutral session identity and provenance](../../issues/2026-10-09-harness-neutral-session-identity-and-provenance.md), artifact id 33de9ea8980e85c9. Its acceptance criteria remain the release criteria.

## Verified baseline and evidence limits

Source inspected on 2026-10-10:

| Repository | HEAD |
|---|---|
| claude-plugins | 82e86281b087ed45e39f523da2cb5cdd363e0f93 |
| codescout | d188fdc87d53c2c255271628ab7e61978335f43f |
| codex | 59f18e8133f2c1d3427677658752ac46697d41b7 |

Codescout's gate rejects an unset CLAUDE_CODE_SESSION_ID before acquiring a target lease. This branch was reproduced with exit 2. Its formatter performs a read-only cargo formatting check first, but reaches its explicit check-only branch only after Claude identity and provenance processing.

The existing provenance scanner reads Claude tool-use/result blocks, discovers Claude profile histories, correlates refusals by call id, and accounts for uncertain workspace activation and opaque write text. The formatter permits MINE and its existing git-proven CLEAN verdict, refuses PEER/SHARED/UNKNOWN, and checks whether rustfmt would reach a refused child module.

Codex source supplies root session identity in native hook requests and CODEX_SESSION_ID in shell environments. CODEX_THREAD_ID is a separate thread identity. Session metadata distinguishes session_id from thread id and includes child history boundaries. Function calls store arguments as JSON strings and correlate output through call_id; custom-tool inputs have a different shape. The installed CLI reports codex-cli 0.160.0.

These are source and version observations, not proof of running-host record coverage, continuity across resume, or supported-version ranges. Capture tests must establish those properties.

## Decision and scope

**Decision:** Separate invocation-context decoding from authored-write evidence decoding. Both feed a versioned contract; a single ownership policy consumes normalized evidence. Start with native history readers rather than a second persistent write journal.

**Alternatives considered:** An environment-variable alias does not supply write evidence. A persistent journal could provide closer execution evidence but adds concurrent append, delivery, replay, retention and deployment requirements. Revisit it if native captures cannot expose the calls, outcomes or workspaces required for conservative attribution.

**Consequences:** Native format changes stay inside their readers. Compatibility fixtures and explicit coverage reporting become required. Unsupported record forms can block authored formatting while leaving check-only verification usable.

**Change scenarios absorbed:** mixed Claude/Codex editing; a changed host record encoding; subagents inheriting context; resume and compaction; shells without host identity; manual and CI runners.

**Revisit when:** real captures lose actual inner tool calls, authoritative target resolution, outcome correlation or sufficient durable history.

**Confidence:** High in the context/evidence separation and independent build leasing. Medium in native-history coverage until capture and lifecycle tests pass.

Plugin scope: publish the contract, decode verified hook context, and document adapter capability and invocation. Codescout scope: context resolution, native history readers, ownership policy integration, gate and formatter changes. Use the existing principal-stamp boundary where applicable without silently changing the server's existing agent-ledger protocol. Existing Buddy session markers and peer transports are not authority for shell identity. Migrating all Buddy state or all MCP principal handling is separate work.

No host source change is presumed necessary: Codex source already exposes the native identities. A verified host gap requires its own explicit design decision.

## Components and dependency direction

These are proposed responsibilities, not claims that new modules already exist.

| Responsibility | Owner | Inputs and outputs |
|---|---|---|
| Context contract and hook decoding | codescout-companion | Explicit adapter origin plus native hook input → validated context |
| Invocation resolver | Codescout scripts | Explicit context or unambiguous native shell environment → one context result |
| Claude evidence reader | Codescout scripts | Existing Claude histories → normalized operations and gaps |
| Codex evidence reader | Codescout scripts | Verified Codex histories → normalized operations and gaps |
| Ownership policy | Codescout provenance | Context, operations, coverage and git state → verdicts |
| Formatting and gate | Codescout scripts | Verdicts and capability results → constrained formatting or leased checks |

Publish the version-1 schema and behavioral contract in codescout-companion. Codescout's packaged validators/readers must work without an installed plugin; share compatibility fixtures and pin the contract version in both repositories. Do not load a schema opportunistically from a running profile's plugin cache.

Host decoders know native payloads. The ownership policy knows normalized operations and git state, and must not import host storage formats. No generic adapter framework or new service is required for the two concrete readers.

## Context contract, version 1

A context is a JSON object with these fields:

| Field | Meaning |
|---|---|
| schema_version | Integer 1; other versions are rejected explicitly |
| harness | Explicit origin: claude-code, codex, or manual |
| session_id | Native logical root session id; nonempty opaque string |
| agent_id | Native child identity when available; null for a known root or unavailable agent detail |
| workspace | Absolute authoritative checkout/workspace root |
| source | Provenance of this context: native-hook, native-env, or explicit |
| harness_version | Native host version when available, otherwise null |

The ownership principal is the tuple (harness, session_id). Keep native IDs opaque; do not infer the harness from UUID shape. agent_id supports attribution and does not turn a child into an unrelated ownership session. A child inherits its root's ownership group.

Hook entry points must declare their adapter origin; overlapping Claude-compatible hook JSON does not identify the host. Validate required native fields before emitting context. In particular, hook session_id is authoritative for that invocation; use its explicit native agent field rather than an inherited shell variable.

For shells, resolve CLAUDE_CODE_SESSION_ID or CODEX_SESSION_ID only when the host source is unambiguous. CODEX_THREAD_ID alone is insufficient to infer a root. A Codex thread different from its verified root can identify a child; do not manufacture a child id for the root.

Expose explicit context through --context <absolute-json-path> on the gate, formatter and provenance entry points, with CODESCOUT_CONTEXT_FILE as an inherited equivalent. CLI and environment paths may agree; different simultaneous paths are a conflict. Validate explicit context against available native evidence. A contradictory root, harness or workspace blocks authored writes; explicit context never silently wins a conflict.

Resolve the checkout from the actual invocation. A context workspace must match that checkout after canonical path resolution. Explicit tool workspace and per-call native cwd remain separate evidence for where a particular operation wrote. A single startup cwd must not override later tool-specific cwd or shared MCP activation uncertainty.

Return context states available, missing, conflicting or unsupported, plus an actionable reason. Missing identity suggests explicit context or check-only invocation. A malformed object, wrong version or wrong root names the offending field. Never substitute PID, a peer's marker, or a globally last-written session file.

### Identity lifetime

| Event | Required behavior |
|---|---|
| New native root conversation | Follow the new native root identity |
| Resume or compaction of that root | Preserve root identity; do not rotate it for a context window |
| Ordinary subprocess | Inherit the caller's context; validate its checkout |
| Child agent | Preserve root, retain separate native child identity |
| Fork into another logical root | Follow native root metadata; inherited history is not new authorship |
| Missing or ambiguous native root | Report uncertainty; do not infer continuity |

Capture-backed fixtures must establish these behaviors for each claimed host version.

## Normalized write evidence

Normalize history into operation records and coverage gaps. Required semantics are:

- Ownership principal and optional agent id.
- Stable source locator and native call id, with replay/deduplication identity scoped to the original producer. Do not deduplicate unrelated calls merely because tool inputs match.
- Timestamp, or explicit absence; missing dates must not disappear from the ownership window.
- Native tool identity and decoded input, target paths or an unresolved-target reason.
- Authoritative per-call workspace/cwd where available.
- Outcome: confirmed no-write refusal, successful possible write, partial/error with possible writes, or missing result.
- Atomicity, and known text written to an individually attributable path or opaque evidence.
- Coverage gaps scoped to affected paths where possible, otherwise to the potentially affected workspace.

Correlate results by native call id rather than record order. Exclude only a confirmed refusal of an operation known to be all-or-nothing. A shell command that fails may already have written; a missing result is not a refusal. One opaque write keeps the corresponding evidence opaque even when another write's text is known.

Claude's existing reader behavior remains the compatibility baseline. Codex decoding must exercise actual function-call, custom-tool, shell and MCP forms observed in supported captures. Executable wrappers or orchestration code are not proof that every nested call ran: report unknown coverage if actual nested operations cannot be recovered.

Process each native record according to its history boundary. Copied parent context and inherited child prefixes retain original authorship and must not become child write events. If attribution or replay boundaries cannot be verified, keep a coverage gap rather than guessing. Do not execute recorded code while decoding history.

Unknown coverage prevents a dirty affected path from receiving an authored-write clearance. Preserve existing commit-window, untracked-file, absorbed-write and git-clean behavior; adding a host is not an opportunity to weaken those rules.

Coverage describes the discoverable configured host histories and recognized operations. It is not a claim that manual editors or all possible shell writes are observable. Preserve that limitation in user-facing diagnostics.

### Discovery and profiles

Preserve existing Claude profile, subagent and linked-worktree discovery, plus its test overrides. Resolve custom Claude configuration through CLAUDE_CONFIG_DIR.

The Codex reader must include the active CODEX_HOME and discoverable default/profile directories, including this machine's .Codex, .Codex-sdd and .Codex-kat. Permit additional explicit history roots for custom installs and isolated tests. Verify native history layout from captures; filter individual records by authoritative workspace instead of assuming filename location equals target checkout.

Scan all discoverable relevant profiles, not only the active profile. A missing directory is distinct from an existing unreadable one. Unreadable or unsupported relevant histories produce coverage gaps, never silent completeness.

Do not assume a Claude peer socket exists for a Codex writer. Report ownership separately from contact availability and verified liveness. Unknown contact/liveness does not mean abandoned work. PID may support liveness checks but cannot become durable identity or permission to format.

## Provenance and formatter behavior

Retain the existing textual verdict vocabulary for consumers: MINE, PEER, SHARED, UNKNOWN and CLEAN. Display harness-qualified owners to prevent same-string ID collisions across hosts. Keep agent detail separate.

| Path condition | Verdict |
|---|---|
| Attributed only to this root, without a relevant detected coverage gap | MINE |
| Attributed only to another root, without a relevant detected coverage gap | PEER |
| Attributed to this root and another root | SHARED |
| Relevant unresolved ownership/coverage | UNKNOWN; retain any known owner details |
| Existing independent git-clean clearance | Preserve existing CLEAN semantics |

An unresolved scan must not erase known peer evidence or convert it to MINE. Keep SHARED when established, with coverage caveats; otherwise use UNKNOWN when uncertainty could change ownership.

Default formatting performs the cheap read-only check first. A clean tree can return 0 without attribution because no formatting write is needed. When differences exist, require valid context and usable evidence before authorizing writes. Format permitted own/CLEAN paths and report refused paths, preserving the existing mixed-scan behavior. Preserve rustfmt child-module reach checks so a permitted root cannot rewrite a refused descendant.

Move the explicit --check exit path ahead of identity and provenance requirements. It prints formatting differences, writes no files, and returns 0 for clean, 1 for differences, 2 for invocation/tool failure. Authored mode uses 1 for ownership refusal and 2 for unavailable/conflicting context or failed attribution; diagnostics distinguish them.

An explicit --exclusive-checkout <absolute-root> is a separate operator declaration for formatting without attribution, including manual/CI invocation. Validate that root against the actual checkout, print that authorization is operator-declared, and constrain writes to that checkout. It is never inferred from missing identity, lack of a reachable peer, or an empty scan. It does not relabel provenance as MINE. Reject a conflicting context or a mismatched root; --check combined with this declaration is a usage error. This is the explicitly approved exclusive-checkout contract, not a generic force flag.

## Gate behavior and invocation

Proposed entry points:

```sh
./scripts/gate.sh
./scripts/gate.sh --check
./scripts/gate.sh --context /absolute/path/context.json
./scripts/gate.sh --exclusive-checkout /absolute/checkout
./scripts/fmt-mine.sh --check
```

Native sessions can use the default entry point when their context and evidence capabilities are established. Manual and CI runners can use --check without session identity. Supplying manual context identifies a caller; it does not create authored-write evidence.

Acquire the existing target-slot lease independently of identity before running build lanes. Preserve the existing explicit CARGO_TARGET_DIR behavior and documented caller responsibility; never recommend using the shared target as a missing-identity remedy. Do not reuse a slot path outside its lease.

Run and record outcomes in this order:

1. Python light lane.
2. Formatter, in the selected mode.
3. Clippy with the existing arguments.
4. Lean Cargo test lane.
5. Default Cargo test lane, last.

The ordinary gate resolves context once and requires it for its formatting lane, even if a standalone formatter could exit early on a clean tree. Unavailable/conflicting identity marks the formatter blocked, performs no formatting write, and continues all subsequent lanes. The aggregate result is nonzero even if those lanes pass. Explicit --check mode is intentionally read-only and reports that mode in the summary. A valid --exclusive-checkout declaration permits the formatter lane with missing identity; conflicting context still blocks it.

Retain individual native exit codes and distinguish formatter passed, differences, ownership-refused, context-blocked and tool-error. Preserve the existing summary fields consumed by tests; extend diagnostics rather than silently changing their meaning. Aggregate exit is 0 only when every requested lane passes.

A lane failure must not short-circuit later lanes. Invalid CLI syntax, unavailable tools needed to start the gate, or failed target leasing may prevent lanes from starting; report that as an entry-point error rather than pretending all lanes ran.

## Capabilities, rollout and support claims

Report context decoding, write-evidence coverage, lifecycle validation and peer-contact support separately. Recognizing a host's session id is not full provenance support.

The initial targets are Claude Code and Codex. Their tested versions are recorded from actual smoke runs; no supported range is invented from the source HEAD or installed CLI version. Additional runners begin as explicit manual-context/check-only users and gain authored-write support only with verified native fixtures and smoke evidence.

Release gates include real Claude and Codex runs, mixed-harness checks, and native approval reachability. The separate [native approval routing issue](../../issues/2026-10-09-companion-routing-blocks-codex-native-escalation.md) remains a dependency for live installation; source fixtures cannot close a live-host blocker.

If capture tests show insufficient native history, stop authored-support rollout and review the journal alternative. Check-only operation may still be documented with its actual capability result.

Plugin release uses release.sh in a separate release commit. Installation/configuration changes must cover all three local Codex profiles and all three Claude profiles where installed. Verify each installPath belongs to its own profile root, cache contents match the released version, and running hosts load the new snapshot. An unmodified profile or absent host must be reported accurately. Writing this spec does not authorize editing protected sibling repositories, installed caches or configurations.

## Validation and review obligations

Tests must exercise observable outcomes, not only internal decoder return values.

| Property | Required evidence |
|---|---|
| Native context | Actual host-payload fixtures for both hosts; explicit origin and schema validation |
| Lifetimes | Root continuity across resume/compaction; subprocess inheritance; separate child identity |
| Mixed ownership | Own, peer, shared, unknown and same native ID under different harnesses |
| Outcomes | Refusal, reordered results, missing result, successful write and partial shell failure |
| History | Inherited child prefix, fork/replay, duplicate discovery and opaque nested calls |
| Coverage | Unreadable relevant profile, unsupported payload, missing date and ambiguous workspace |
| Workspace | Linked worktree, per-call cwd, explicit workspace pin, conflicting context and relative MCP activation |
| Formatting safety | Peer and unknown file hashes unchanged after refusal; child-module collateral refused; own files formatted in mixed scan |
| Read-only operation | No identity or readable histories needed for --check; clean/diff/tool-error distinguished |
| Exclusive declaration | Correct/mismatched root, missing identity, context conflict and no implicit activation |
| Gate | Lease held independently of identity; all five lane outcomes and order under individual failures |
| Compatibility | Existing Claude provenance/window/formatter regressions stay green |
| Live operation | Actual documented entry point under Claude and Codex; capability/version output captured |

Use isolated temporary homes, transcripts and checkouts outside the main repository. Tests must not borrow real session identity, alter live profile state or place fixture checkouts inside the working repository.

For load-bearing implementation review, apply candidate mutations to principal namespace, root/agent separation, refusal handling, unknown coverage and gate continuation. Run the relevant suites for each and report observed survivor counts. Fix demonstrated survivors with behavioral tests; a reasoned coverage argument alone is insufficient.

## Written-spec review boundary

The user approved this document on 2026-10-10. The [implementation plan](../plans/2026-10-10-harness-neutral-session-identity.md), artifact 3252b9f3f104ea25, has been written and self-reviewed. The user approved that plan and selected inline execution with independent final review on 2026-10-10. The plan must re-scout actual source and test seams, use an authorized isolated workspace for sibling-repository changes, and separate source verification from release and live-host validation.


## Implementation verification — 2026-10-10

The approved plan has been executed in isolated clones, with independent implementation review and five applied mutation checks. The [verification record](../../reviews/2026-10-10-harness-neutral-session-identity.md), artifact 2185a218fbd18b7f, records the corrections, measured source checks and exhaustive review-scope rulings. Required source checks passed, including the full leased gate. Plugin changes are applied and the coordinated Codescout patch is checked; protected original application is blocked by native routing. Native authored/lifecycle and installed acceptance remain pending; this record does not extend the supported-host claims beyond observed captures.

## Native evidence follow-up — 2026-10-12

The approved context version remains 1. Native context transport is verified separately from ownership coverage: the F-16 native MCP sessionId/threadId fix was committed as 18a007aa and freshly installed/observed on 2026-10-11. Later shared executable drift is a dated deployment observation; the resumed check uses the saved verified production artifact.

The F-20 repair normalizes actual paginated MCP end items and verifies native child boundaries independently from new-root forks. Known root/thread/call identity, argument objects, result outcomes and turn cwd are preserved. Unsupported effects/statuses, malformed/conflicting evidence and opaque wrappers still add gaps. Tests pin the observed mutations: the initial 25-recipe review found 11 survivors; after additions the independent recheck killed all 25 recipes, with 141 tests passing after byte restoration. The reviewer approved the bounded repair and capability guide. Original commit 5ae71b35 contains the verified three-path delivery, and all five canonical gate lanes and shell suites passed.

Actual native authored root 01a12f3a-ae7e-7882-87e8-8b6e4eb81706 and same-root resume recover the writer but retain UNKNOWN coverage and unchanged formatter bytes. Complete code-mode execution inventory and owned formatting remain unestablished; a new journal remains a conditional design decision, not an implemented capability. Kat authenticated smoke is pending because reauthentication is unavailable. The issue therefore stays investigating.
