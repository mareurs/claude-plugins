---
id: '3252b9f3f104ea25'
kind: plan
status: active
title: Harness-neutral Session Identity Implementation Plan
tags:
- codescout-companion
- codescout
- session-identity
- provenance
- harness-compatibility
topic: harness-neutral-session-identity
approved_on: 2026-10-10
bootstrap_release: Companion 1.20.17 real clean-copy release/install complete; paired 0.160.0 host cold-loaded; all original patches applied; native source integration underway
codescout_source_head: 52be81ae78d963610cf88879cdbc41ed6323bfbc
completed_source_tasks:
- 1
- 2
- 3
- 4
- 5
- 6
- 7
execution: inline
execution_ledger: /tmp/harness-identity-20261010/claude-plugins/.superpowers/sdd/2026-10-10-harness-neutral-session-identity/progress.md
implementation_review_id: 2185a218fbd18b7f
implementation_review_pending: false
installed_companion: 1.20.17, existing lowercase Codex plus all three Claude caches, 98 source files byte-verified
installed_host: GNU/Linux 0.160.0; actual shared daemon/helper selected and six package files digest-verified
native_approval_acceptance: passed
native_capture_capability: limited; native accept/decline and resume/compact/fork transport pass, actual decoder reports opaque wrapper/token-usage/external-prefix gaps; F-6
plan_review_pending: false
plugin_source_head: 36cf947
release_commit: 4fc932622753638dbfda3448d6432fd8b0563585
source_delivery: Plugin applied; reviewed 22-file Codescout and three-file Codex patches applied on 2026-10-11, original indexes preserved
source_verification: passed
task8_completed_steps:
- 1
- 2
- 3
- 5
- 6
- 8
task8_pending_steps:
- 4
- 7
---

# Harness-neutral Session Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude Code and Codex run Codescout verification with comparable ownership protection and leased builds, including an explicit read-only path when identity is unavailable.

**Architecture:** Publish a versioned context contract and decode native hook/shell identity separately from write evidence. Normalize Claude and Codex histories before applying one ownership policy. Preserve conservative refusal and existing build leases.

**Tech Stack:** Node ES modules and standard-library Python; Bash entry points; existing Node, pytest, shell, rustfmt and Cargo checks. Add no runtime package dependency.

**Spec:** [Approved design](../specs/2026-10-10-harness-neutral-session-identity-design.md), artifact c67a8d68e01c6cf4. Written-spec approval: 2026-10-10. This implementation plan awaits user review and execution-method selection.

## Global Constraints

- schema_version: integer 1.
- harness: claude-code, codex, or manual.
- source: native-hook, native-env, or explicit.
- Context states: available, missing, conflicting or unsupported.
- The ownership principal is the tuple (harness, session_id).
- Retain MINE, PEER, SHARED, UNKNOWN and CLEAN.
- Check-only formatter exits: 0 for clean, 1 for differences, 2 for invocation/tool failure.
- Authored formatter exits: 1 for ownership refusal; 2 for unavailable/conflicting context or failed attribution.
- Python light → formatter → clippy → lean Cargo tests → default Cargo tests. Default remains last after failures.
- Build leases never depend on a session id. Preserve explicit CARGO_TARGET_DIR behavior and caller responsibility.
- Preserve commit-window, untracked-file, absorbed-write, git-clean and rustfmt child-module protection.
- Missing results and partial shell failures remain possible writes. Unknown coverage cannot authorize a dirty affected path.
- Check-only operation requires neither identity nor readable histories.
- Exclusive formatting requires --exclusive-checkout <absolute-root>, is operator-declared, and never becomes an implicit MINE verdict.
- Use release.sh in a separate release commit. Never bump versions in a feature commit.
- Profile/configuration changes cover all three local Codex profiles and all three Claude profiles where installed; every installPath stays under its owning profile.
- Support claims require capture-backed fixtures and actual Claude/Codex smoke runs. Installed versions and source inspection alone are insufficient.

## Review Focus

| Input/condition | Required behavior | Test owner |
|---|---|---|
| Spaces/colon characters in context paths, target paths and opaque IDs | Preserve literal values; no shell splitting or principal collision | Tasks 2 and 6 |
| Truncated JSONL or malformed encoded arguments | Report a relevant coverage gap instead of silently exonerating a writer | Tasks 3 and 4 |
| The same history discovered through aliases/profiles | Count the original operation once; retain distinct calls with identical inputs | Tasks 3 and 4 |
| Reused call ids in separate children or conflicting replay records | Join within producer identity; conflicting duplicates remain uncertain | Task 4 |
| Symlinks, nested repositories and linked worktrees | Compare actual canonical checkout roots, not string prefixes; refuse collateral outside the authorized checkout | Tasks 2 and 6 |

Each row has named assertions in the owning task below. These supplement the spec's test matrix.

## Reconnaissance and working boundary

Verified 2026-10-10: plugin HEAD 82e86281b087ed45e39f523da2cb5cdd363e0f93; Codescout HEAD d188fdc87d53c2c255271628ab7e61978335f43f; Codex HEAD 59f18e8133f2c1d3427677658752ac46697d41b7.

The existing source seams are Codescout's scripts/file-provenance.py (tool_records, refused_call_ids, session_activations, scan_with_evidence, scan and main), scripts/fmt-mine.sh and scripts/gate.sh. scan_with_evidence currently has the callers scan and main; retain its two-value return contract as a compatibility wrapper. Existing tests are tests/file-provenance.sh, tests/fmt-mine.sh, tests/gate-slot.sh and tests/test_python_runner.py.

Codex persists records through codex-rs/history/src/rollout_payload.rs::RolloutItemWire. codex-rs/history/src/lib.rs::RolloutLine carries an optional ordinal. The child-history boundary is an ordinal, not a physical line number: codex-rs/rollout/src/ordinal.rs::ordinal_state_for_rollout validates paginated history. This distinction must survive Task 4.

Plugin tests/run-all.sh discovers hook *.test.mjs and *.test.sh. Codescout scripts/python-tests.py discovers tests/test_*.py for its light lane unless classified heavy. New tests below use those existing mechanisms.

Both CLIs are present: Claude 2.1.296 and Codex 0.160.0. No capture or smoke coverage has been established for this feature. Current CLI help confirms Claude's noninteractive print mode and Codex exec's --json/--cd, resume and fork entry points. Never use Codex --ephemeral for history coverage tests.

At execution start:

- [x] Use using-git-worktrees to choose authorized isolation. The main plugin worktree contains prior issue fixes and untracked documents; inventory and preserve them.
- [x] Keep the original Codescout and Codex checkouts read-only unless native escalation has actually been approved. Use adjacent isolated copies under /tmp/harness-identity-20261010/claude-plugins and /tmp/harness-identity-20261010/codescout when parent worktree metadata cannot be written. Avoid hardlinked mutable files.
- [x] Bring the approved spec/plan into the isolated plugin copy and record the source HEADs and overlay choices. Re-scout named seams if HEADs differ.
- [x] Pin Codescout tools to each working copy. Use run_command for shell work and edit_code for structural edits.
- [x] Keep fixture checkouts outside either repository. Isolate HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_STATE_HOME and transcript overrides; clear inherited native identity variables in manual/missing-identity tests.
- [x] Choose a writable build pool outside the Codescout checkout, check available storage, and preserve the slot-pool lease. Do not allocate a build directory per session.
- [x] Commit only task-owned files in an authorized isolated copy. Main-worktree Git staging was blocked by the installed routing hook; do not bypass filesystem restrictions to stage or apply protected sibling changes.

## File map

Paths in this plan are relative to the repository named in the task.

| Repository | Files | Responsibility |
|---|---|---|
| Plugin | codescout-companion/contracts/session-context-v1.schema.json; fixtures/session-context-v1.json; fixtures/native-histories/ | Context schema, expected normalization cases and minimal capture-backed host records |
| Plugin | codescout-companion/hooks/session-context.mjs; scripts/session-context.mjs; hooks/session-context.test.mjs | Pure hook decoding plus an explicit CLI adapter and behavioral tests |
| Codescout | scripts/session-context-v1.schema.json; tests/fixtures/session-context-v1.json; tests/fixtures/native-histories/ | Versioned snapshots consumed without an installed plugin |
| Codescout | scripts/session_context.py; tests/test_session_context.py | Context resolution/validation and shell-consumer CLI |
| Codescout | scripts/provenance_records.py | Normalized evidence records and coverage gaps |
| Codescout | scripts/claude_history.py; scripts/codex_history.py; tests/test_harness_history.py | Host discovery and history decoding |
| Codescout | scripts/file-provenance.py; tests/test_harness_provenance.py; tests/file-provenance.sh | Shared targeting/ownership policy and CLI compatibility |
| Codescout | scripts/fmt-mine.sh; tests/fmt-mine.sh; tests/test_harness_formatter.py | Mode parsing, constrained writes and read-only checks |
| Codescout | scripts/gate.sh; tests/test_python_runner.py; tests/gate-slot.sh | Context snapshot, all-lane reporting and independent leasing |
| Both | Documentation specified in Task 8 | Manual invocation, capabilities, integration and live validation evidence |

Plugin fixtures/schema are authoritative for the context contract. Codescout packages snapshots; Task 8 compares both copies directly. Each language's tests also assert explicit expected values so two equally wrong validators cannot pass on agreement alone.

### Task 1: Publish the contract and verified hook adapter

**Files (plugin):** Create all contract/fixture files in the first File-map row; create hooks/session-context.mjs, scripts/session-context.mjs and hooks/session-context.test.mjs. Read hooks/lib.mjs and hooks/principal-stamp.mjs; do not change the agent-ledger key or permission behavior.

**Interfaces:**
- Produces normalizeHookContext(harness, input, workspace, harnessVersion = null) → {state, context, reason}. harness is explicitly claude-code or codex; workspace is a caller-verified canonical checkout root.
- Produces validateContext(value, workspace) → the same result shape.
- CLI: node codescout-companion/scripts/session-context.mjs --harness <host> --workspace <absolute-root> reads one native payload from stdin and prints one JSON result. Exit 0 for available, 2 otherwise. The CLI verifies the supplied root against Git resolution of native cwd; the pure decoder receives that checked root.
- Context fields and enums are exactly those in Global Constraints and the spec.

- [x] **Step 1: Capture minimal native evidence in an isolated scratch checkout.** Observe real hook input and durable history for root calls, one child call, a refused write and a shell outcome under each CLI. Preserve record shape, native call correlation and host versions. Normalize only fixture paths/IDs in a documented consistent mapping; retain no credentials or unrelated conversation text. Save a capture manifest with commands, versions, record types and unavailable cases. If live capture is blocked, label source-derived fixtures explicitly and leave live support pending.
- [x] **Step 2: Write failing normalization tests.** Use Node assert and node:test in the discovered hook test location. Assert the full context, not only session_id:
```js
assert.deepEqual(result.context, {
  schema_version: 1, harness: 'codex', session_id: 'root-1',
  agent_id: 'child-1', workspace: fixtureRoot,
  source: 'native-hook', harness_version: '0.160.0'
});
assert.equal(normalizeHookContext(null, payload, fixtureRoot).state, 'unsupported');
assert.equal(validateContext({...expected, schema_version: 2}, fixtureRoot).state, 'unsupported');
```
Add equivalent Claude root/child cases; missing fields, wrong types, root/cwd mismatch and null agent detail. Assert no adapter output contains permissionDecision and no call argument is stamped onto a foreign MCP server. Existing principal-stamp tests continue to pin parent silence, the old key and preserved input arguments.
- [x] **Step 3: Observe red.** Run node --test codescout-companion/hooks/session-context.test.mjs. Record missing module/behavior failures; a fixture collection error is not the required behavioral red.
- [x] **Step 4: Implement the schema, pure decoder and CLI.** Use standard Node path/fs/child_process facilities; never infer origin from UUID or inherited profile variables. The adapter emits context on explicit CLI invocation, not unregistered hook stdout. No persistent session pointer or second write journal is created.
- [x] **Step 5: Verify.** Run the new Node test and bash codescout-companion/hooks/principal-stamp.test.sh. Require all assertions green. No support claim is inferred from synthetic/source-only fixtures.
- [x] **Step 6: Commit task-owned files** with message feat: publish harness-neutral session context contract.

### Task 2: Resolve shell invocation context

**Files (Codescout):** Create scripts/session_context.py, packaged schema/fixtures and tests/test_session_context.py.

**Interfaces:**
- SessionContext dataclass: schema_version:int, harness:str, session_id:str, agent_id:str|None, workspace:Path, source:str, harness_version:str|None.
- ContextResolution dataclass: state:str, context:SessionContext|None, reason:str.
- principal_key(harness:str, session_id:str) → str. Serialize as harness + ":" + the untouched id; split only the first colon when displaying. This serializes the spec's tuple without UUID assumptions.
- validate_context(value:object, workspace:Path) → ContextResolution.
- resolve_context(workspace:Path, environ:Mapping[str,str], context_path:Path|None=None) → ContextResolution.
- CLI: python3 scripts/session_context.py --workspace <absolute-root> [--context <absolute-json-path>] prints the result as JSON and exits 0 for available, 2 otherwise. Reason names the conflicting/malformed source or field.

- [x] **Step 1: Write failing tests** for every shared expected case and these shell cases:
```python
assert principal_key("codex", "same:id") != principal_key("claude-code", "same:id")
assert resolve_context(root, {}).state == "missing"
assert resolve_context(root, {"CODEX_THREAD_ID": "child"}).state == "missing"
assert resolve_context(root, both_native_ids).state == "conflicting"
assert resolve_context(root, codex_root_and_child).context.agent_id == "child"
assert resolve_context(root, codex_root_equal_thread).context.agent_id is None
```
Test explicit context versus native disagreement, two different CLI/environment context paths, schema_version 1.5, string or bool, malformed JSON, mismatched checkout, file/path spaces and a colon-containing id. In test_canonical_checkout_not_string_prefix, use a sibling with a common prefix, a nested repository and a linked worktree; only the actual checkout root matches. Integer-valued JSON 1.0 must normalize to output integer 1 consistently in both languages; nonintegral numbers, strings and booleans are unsupported. For native env, null unavailable version/agent detail is accepted without labeling an unknown agent as a known child.
- [x] **Step 2: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_session_context.py.
- [x] **Step 3: Implement the dataclasses, resolver and CLI.** The resolver receives the consumer's authoritative workspace and validates canonical equality; the CLI verifies its supplied workspace against the actual checkout. Preserve the provenance API's read-only REPO_ROOT fixture seam without weakening the formatter/gate's Git-root checks. Read CODEX_SESSION_ID separately from CODEX_THREAD_ID. Use CLAUDE_CODE_SESSION_ID for unambiguous Claude invocation. Explicit context is validated against available native evidence; both native root sources do not get guessed precedence. Preserve opaque strings and escape control characters in diagnostics.
- [x] **Step 4: Verify** the same pytest command. Also compare fixture-normalization outputs to Task 1's explicit expected objects, with workspace fixture substitution only.
- [x] **Step 5: Commit** with message feat: resolve native and explicit session context.

### Task 3: Normalize Claude history without changing its policy

**Files (Codescout):** Create scripts/provenance_records.py and scripts/claude_history.py; create tests/test_harness_history.py; adapt scripts/file-provenance.py and its existing shell tests only where namespaced ownership is exposed.

**Interfaces:**
- Operation dataclass: source_id:str, call_id:str|None, principal:str|None, agent_id:str|None, timestamp:str|None, cwd:Path|None, name:str, input:dict[str,object], outcome:str, atomic:bool, is_child:bool, raw_input:str|None.
- outcome is no-write-refused, possible-write, partial-error or missing-result.
- CoverageGap dataclass: source_id:str, reason:str, workspace:Path|None, paths:tuple[str,...]|None. paths=None means potentially workspace-wide coverage uncertainty.
- HistoryBatch dataclass: operations:list[Operation], gaps:list[CoverageGap].
- discover_claude_histories(root:Path, environ:Mapping[str,str]) → (list[Path], list[CoverageGap]).
- read_claude_history(path:Path) → HistoryBatch.
- These records carry read/activation calls too, because workspace attribution needs their timeline. Target extraction and git-based clearance remain in the shared policy.

- [x] **Step 1: Write failing adapter tests.** Assert root/child attribution, all-profile and main/worktree discovery, and exact refusal semantics:
```python
assert operation.principal == principal_key("claude-code", "root-1")
assert refused_edit.outcome == "no-write-refused"
assert failed_shell.outcome == "partial-error"
assert unpaired_edit.outcome == "missing-result"
assert undated_edit.timestamp is None
```
Add test_truncated_record_is_coverage_gap, test_unreadable_profile_not_absent and test_alias_discovery_deduplicates_source_not_equal_inputs. Assert a second genuine call with identical arguments survives. Exercise codescout ok:false and pending_ack envelopes even without is_error.
- [x] **Step 2: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_harness_history.py -k claude.
- [x] **Step 3: Implement extraction into the normalized reader.** Reuse the observed tool_records, record_session and refused_call_ids behavior. Resolve current/custom CLAUDE_CONFIG_DIR and preserve the existing FILE_PROVENANCE_ROOTS override and linked-worktree lookup. Do not treat child directories as independent root owners. Move native parsing, not targeting/absorbed-write policy.
- [x] **Step 4: Preserve compatibility wrappers** scan_with_evidence(root) → (owners,evidence) and scan(root) → owners. Route the legacy Claude scan through normalized operations, retaining workspace activation uncertainty, sticky opaque text and every missing timestamp. Namespace the current Claude caller and registry lookup keys in this task as well, so this independently testable refactor does not compare encoded owners to a bare caller id. The standard resolver and mixed-host policy arrive in Task 5. Namespaced owner strings may change continuation text; verdict/path columns and native identity details remain visible.
- [x] **Step 5: Verify** the adapter pytest cases and bash tests/file-provenance.sh. Compare behavior across the existing mention/read, refusal, commit-window, clean, absorbed-write, child and workspace cases; do not weaken expectations to get green.
- [x] **Step 6: Commit** with message refactor: decode Claude histories through normalized provenance records.

### Task 4: Decode Codex history and report incomplete coverage

**Files (Codescout):** Create scripts/codex_history.py; add captured fixtures and Codex cases to tests/test_harness_history.py. Extend shared target extraction in scripts/file-provenance.py for supported native patch operations.

**Interfaces:**
- discover_codex_histories(root:Path, environ:Mapping[str,str]) → (list[Path], list[CoverageGap]).
- read_codex_history(path:Path) → HistoryBatch.
- Explicit history-root override FILE_PROVENANCE_CODEX_ROOTS_JSON is a JSON array of absolute paths, including [] for a fully isolated empty fixture corpus. Do not reuse a colon-separated path list for Codex.
- Canonicalize verified exec-command calls into the shared Bash input shape, retaining authoritative workdir/cwd and non-atomic status. Canonicalize recognized MCP calls to existing mcp__server__tool names. Keep unknown wrappers opaque.
- patch_write_targets(patch:str) → list[str] extracts verified Add/Update/Delete/Move targets. Native patch writes remain non-atomic until capture/source establishes a stronger guarantee.

- [x] **Step 1: Write failing Codex reader tests** from captures. Assert decoded JSON-string function arguments, structured/string outputs, custom-tool input, shell cwd and native root/child identity:
```python
assert child_edit.principal == principal_key("codex", "root-1")
assert child_edit.agent_id == "child-1"
assert captured_mcp.name == "mcp__codescout__edit_file"
assert failed_shell.atomic is False
assert {op.call_id for op in inherited_batch.operations} == {"child-write"}
assert opaque_batch.gaps
```
Use actual ordinals different from JSONL line numbers. Test a child with an incomplete inherited prefix or missing required ordinal: it yields a gap rather than guessed attribution.
- [x] **Step 2: Add discrimination cases.** test_results_join_within_producer covers equal call ids in two child threads and reordered outputs; test_conflicting_replay_is_unknown covers differing payloads under one producer/call id. Test truncation, invalid JSON arguments, unsupported metadata/root identity, absent results, timestamp absence, duplicate history discovery, and a wrapper mentioning a write that never exposes executed inner calls. For patch targets assert both sides of a move and literal paths with spaces; include a patch-shaped string inside a read/message and assert it creates no operation.
- [x] **Step 3: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_harness_history.py -k codex.
- [x] **Step 4: Implement native decoding.** Use verified type/payload envelopes from RolloutItemWire; preserve raw arguments and numeric fidelity where JSON decoding matters. Use explicit root metadata and verified child-source metadata/history boundaries; a different thread id alone must not classify copied fork context as child authorship. Deduplicate by original producer/event identity, not input equality or physical line index. Never execute recorded code.
- [x] **Step 5: Implement discovery.** Include CODEX_HOME, existing .codex/.Codex/.Codex-* defaults and configured overrides; inspect native records to determine checkout relevance. Canonicalize aliases, preserve unreadable relevant histories as gaps, and keep contact/liveness unknown when no verified transport exists.
- [x] **Step 6: Verify** all tests/test_harness_history.py cases and bash tests/file-provenance.sh. If capture coverage cannot expose actual operations, record the adapter's limited capability and stop authored-support rollout for the affected form; do not silently add a journal under this task.
- [x] **Step 7: Commit** with message feat: decode Codex write history with coverage gaps.

### Task 5: Apply one ownership policy to both hosts

**Files (Codescout):** Modify scripts/file-provenance.py; create tests/test_harness_provenance.py; retain the legacy shell matrix.

**Interfaces:**
- ProvenanceScan dataclass in provenance_records.py: owners:dict[str,list[tuple[str,str|None]]], evidence:dict[tuple[str,str,str|None],list[str]|None], gaps:list[CoverageGap].
- merge_history_batches(batches:Iterable[HistoryBatch]) → HistoryBatch.
- scan_provenance(root:Path, environ:Mapping[str,str]) → ProvenanceScan.
- main accepts --context <absolute-json-path> alongside existing --since/--all/-- paths. It resolves one caller context, compares namespaced principals and retains verdict tokens.
- scan_with_evidence and scan keep the Task 3 compatibility signatures and delegate to scan_provenance.

- [x] **Step 1: Write CLI-level failing tests** using a real dirty scratch Git checkout and both native fixture corpora:
```python
assert verdict("own.rs") == "MINE"
assert verdict("peer.rs") == "PEER"
assert verdict("shared.rs") == "SHARED"
assert verdict("uncovered.rs") == "UNKNOWN"
assert verdict("same-native-id-other-host.rs") == "PEER"
assert verdict("dirty-path-with-known-own-and-gap.rs") == "UNKNOWN"
```
Test known SHARED evidence plus an additional gap retains SHARED with its caveat. A confirmed atomic refusal cannot add peer ownership; a failed or unpaired shell call still can. Verify hidden/absorbed writes across both namespaces and that unreadable Codex evidence cannot disappear behind a successful Claude scan.
- [x] **Step 2: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_harness_provenance.py.
- [x] **Step 3: Implement merging and policy integration.** Reuse existing write_targets, write_base, write_texts and absorbed_writes semantics. Aggregate shared MCP activation uncertainty across root/child timelines regardless of host. Resolve explicit absolute workspace pins before an uncertain relative base. Scope gaps to known targets where possible; otherwise taint potentially affected dirty workspace paths.
- [x] **Step 4: Adapt display and liveness.** Print harness and native id distinctly; do not truncate every owner to the identical harness prefix. Namespace Claude registry keys at the boundary. Keep unknown contact/liveness separate from ownership and retain native Claude socket details when verified. No PID or unreachable peer provides clearance.
- [x] **Step 5: Verify** the new pytest suite and bash tests/file-provenance.sh. Assert exact first-column verdicts, actionable context errors and preserved native owner details.
- [x] **Step 6: Commit** with message feat: preserve mixed-harness ownership in file provenance.

### Task 6: Implement read-only and exclusive formatter modes safely

**Files (Codescout):** Modify scripts/fmt-mine.sh and tests/fmt-mine.sh; create tests/test_harness_formatter.py.

**Interfaces:**
- fmt-mine.sh accepts --check, --context <path>, --exclusive-checkout <root>; reject unknown/repeated conflicting mode arguments and --check combined with exclusive declaration with exit 2.
- Normal mode resolves Task 2 context only after the cheap check finds differences, then consumes Task 5 provenance.
- Exclusive declaration authorizes only its matching checkout without changing provenance labels. It still rejects conflicting context and paths/collateral outside that checkout.
- Existing FMT_MINE_PROVENANCE remains the test seam. Pass validated context via inherited CODESCOUT_CONTEXT_FILE when applicable so path-only provenance stubs do not accidentally consume flags as filenames. Set the provenance subprocess's REPO_ROOT to the formatter's actual Git root; an inherited foreign REPO_ROOT must not redirect its attribution scan.

- [x] **Step 1: Write failing behavioral tests.** Use real rustfmt and before/after bytes:
```python
assert check_without_identity.returncode == 1
assert before == after_check
assert peer_before == peer_after_refusal
assert own_before != own_after_mixed_format
assert peer_before == peer_after_mixed_format
assert module_root_before == module_root_after_collateral_refusal
```
Require --check to bypass a provenance stub that would fail if invoked. Include clean/diff/unparseable formatting, missing/conflicting context, ordinary clean early-exit, unknown coverage, native Codex own writes, both directions of mixed-host peer ownership, and an untracked peer file.
- [x] **Step 2: Pin exclusive and literal-path behavior.** Test matching root plus missing identity formats only inside that checkout and prints operator-declared authorization. Wrong root, conflicting context and --check/exclusive combination write nothing and exit 2. test_paths_with_spaces_are_literal formats a permitted Rust file with spaces while leaving its peer counterpart byte-identical. test_symlink_or_module_cannot_escape_authorized_checkout rejects outside-root reach before any formatting write. test_inherited_foreign_repo_root_cannot_redirect_attribution sets a second repository with an identically named file and verifies the formatter still uses its actual checkout.
- [x] **Step 3: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_harness_formatter.py and the newly added cases in bash tests/fmt-mine.sh.
- [x] **Step 4: Implement mode handling and constrained formatting.** Place --check handling immediately after the cargo check result, ahead of attribution. Use literal path arrays rather than whitespace splitting. Preserve own/CLEAN versus refused partitioning and child-module reach checks; reject an unrepresentable/ambiguous target rather than guessing.
- [x] **Step 5: Verify** both formatter suites and Task 5's mixed-harness integration tests. Assert return code, byte equality and the remedy text, not just whether rustfmt ran.
- [x] **Step 6: Commit** with message feat: add safe harness-neutral formatter modes.

### Task 7: Continue the leased gate without identity and report each lane

**Files (Codescout):** Modify scripts/gate.sh, tests/test_python_runner.py and tests/gate-slot.sh.

**Interfaces:**
- Gate accepts the Task 6 modes/options. Ordinary mode resolves context once for the run, even on a clean tree; check-only skips ownership resolution.
- Available context is written to a unique private temporary snapshot outside the checkout and passed to the formatter/provenance via CODESCOUT_CONTEXT_FILE. Forward the selected formatter mode/exclusive root, but do not also forward the original --context argument: it would conflict with the new snapshot path. Clean the snapshot on every exit. Never publish a shared last-writer pointer.
- Keep PYTHON_LIGHT, FMT, CLIPPY, LEAN and DEFAULT summary fields. Add FMT_STATE with passed, differences, ownership-refused, context-blocked or tool-error.
- Determine formatter state from selected mode, the gate's context result and formatter exit: check/1=differences; authored/1=ownership-refused; preflight context block/2=context-blocked; other nonzero tool failure=tool-error. Preserve FMT's actual code. Aggregate gate exit is 1 for any completed-lane failure, 2 for entry-point/lease failure.

- [x] **Step 1: Extend the existing parameterized gate test** to cover none/python/fmt/clippy/lean/default failures under Claude, Codex and explicit check-only invocation. Initialize gate fixture checkouts as Git repositories and include session_context.py plus its packaged schema in both gate test fixtures. Their fake python3 currently stubs every invocation; only stub the Python test lane and delegate context resolution to a saved real interpreter.
- [x] **Step 2: Write missing/conflicting identity tests** which observe the actual lane trace:
```python
assert calls == ["python-light", "clippy", "lean", "default"]
assert gate.returncode == 1
assert "FMT=2" in summary and "FMT_STATE=context-blocked" in summary
assert format_write_marker.exists() is False
assert all(target == leased_target for target in cargo_targets)
```
For check-only with no identity, include fmt --check between Python and clippy; assert differences produce FMT_STATE=differences. test_explicit_context_gate_forwards_snapshot_only asserts that --context input does not become a false child-path conflict. A valid exclusive declaration can run the formatting lane with missing identity; conflicting or unsupported context still blocks it.
- [x] **Step 3: Observe red.** Run python3 -m pytest -p no:cacheprovider -q tests/test_python_runner.py and the new cases in bash tests/gate-slot.sh.
- [x] **Step 4: Implement the gate.** Remove the host-specific early refusal and shared-target remedy. Acquire the existing lease independently, resolve/snapshot context as needed, and preserve the established command arguments/order. A blocked formatter is a reported lane outcome, not a reason to skip Cargo.
- [x] **Step 5: Verify concurrency and cleanup.** Extend the existing two-run hold/release test to one no-identity check-only run and one Codex run; both must use distinct simultaneously held slots. Observe the lock still held during the default lane, and released after each run. Check cleanup after an interrupted run and that a supplied CARGO_TARGET_DIR remains honored.
- [x] **Step 6: Run verification** with the full test_python_runner.py and gate-slot.sh suites. Require exact lane ordering, all exit codes and unchanged existing target-pool bounds/eviction behavior.
- [x] **Step 7: Commit** with message fix: keep verification leased when session identity is unavailable.

### Task 8: Review, document capabilities and deliver coordinated changes

**Files (plugin):** Modify codescout-companion/README.md; create codescout-companion/docs/session-context.md, tests/test-session-context-contract.sh and tests/scenarios/harness-neutral-session-identity-smoke.md. Update the backing-store issue/spec/plan through doc.
**Files (Codescout):** Update CLAUDE.md's canonical gate invocation and docs/conventions/gate-ordering.md; create docs/conventions/harness-neutral-session-context.md. Adjust source-pinned gate wording tests in src/prompts/mod.rs only for intended wording changes.
**Conditional delivery:** Create docs/patches/2026-10-10-harness-neutral-codescout.patch in the plugin repository if applying the Codescout change to its original protected checkout remains unavailable.

**Interfaces:** Document the exact Task 2/5/6/7 CLI and environment names; publish separate context, history coverage, lifecycle and peer-contact capabilities. Preserve a limited capability result until its native evidence exists.

- [x] **Step 1: Pin contract agreement.** Add tests/test-session-context-contract.sh, using CODESCOUT_CONTRACT_ROOT to select the explicit Codescout working copy, to compare packaged schema/normalization snapshots. Assert the contract version and full expected cases locally. An automatically absent sibling is reported as skipped, never counted as compatibility passed; an explicitly supplied missing/invalid CODESCOUT_CONTRACT_ROOT is an error. Confirm the new pytest files appear in the existing light-lane inventory.
- [x] **Step 2: Run focused and complete source verification once changes settle.** Plugin: node --test codescout-companion/hooks/session-context.test.mjs, principal-stamp tests, and tests/run-all.sh using TMPDIR outside the repository. Codescout: python3 -m pytest -p no:cacheprovider -q tests/test_session_context.py tests/test_harness_history.py tests/test_harness_provenance.py tests/test_harness_formatter.py tests/test_python_runner.py; then run the existing file-provenance.sh, fmt-mine.sh and gate-slot.sh suites as separate commands; then ./scripts/gate.sh --check in a leased pool. This plan requires read-only formatting for verification because executor ownership is not yet a live supported-host claim. Address actual failures; do not repeat green suites without new changes.
- [x] **Step 3: Request independent implementation review** under requesting-code-review and the AGENTS.md model floor/review escalation rule. Ask the reviewer to APPLY at least five candidate mutations in task-owned isolated copies: remove harness namespace, replace root with child id, count a confirmed refusal as a write, clear unknown coverage, and skip the default lane after an earlier failure. Run the relevant suite for each and report observed applied/surviving counts. Apply before writing any new test for a claimed survivor; restore each copy, fix demonstrated gaps, and rerun affected suites.
- [ ] **Step 4: Run real-host smoke scenarios.** For each host, observe the caller's own normalized identity and actual history, run the documented gate entry point, and record all lane outcomes. Exercise own-format plus mixed-host peer refusal and byte equality in a scratch checkout; then resume, compaction, child and fork continuity. Use existing authenticated native profiles without copying credentials into fixtures. Do not alter installed profiles/caches or use permission/trust-bypass flags to make a blocked run look supported. If authentication, installation or native approval routing blocks a scenario, record the specific blocker and leave that capability pending.
- [x] **Step 5: Document actual versions and limits.** Record smoke results rather than a guessed minimum/range. Explain --check, --context, CODESCOUT_CONTEXT_FILE, explicit history-root configuration, --exclusive-checkout, missing/conflicting identity remedies and contact-unavailable ownership. Keep limitations about manual editors and shell heuristics visible.
- [x] **Step 6: Deliver reviewable repository changes.** Inspect exact task-owned diffs. Apply plugin changes only within authorized writable files; for protected Codescout changes, supply an inspected patch and verify git apply --check against the original current source. Request native escalation only once the concrete patch exists if original-checkout application is required. Do not bypass filesystem approval with MCP writes. Feature commits exclude version bumps and unrelated earlier issue fixes.
- [ ] **Step 7: Release/install only when authorized and preconditions hold.** Use release.sh for the plugin after clean-tree preflight and required tests. Cover all three Codex and all installed Claude profiles with own-root cache/installPath checks, cold-load the new hooks and repeat the relevant live smoke. Keep push/publication subject to actual user authorization. Update the version-bump-checklist through doc when a release occurs.
- [x] **Step 8: Record final status.** Source-only verification or an unapplied patch is investigating with explicit remaining work, not a fixed/live result. Close the issue only after its real-host and installation criteria are fulfilled. Link review/mutation evidence and the final support matrix. Commit task-owned documentation with message docs: document harness-neutral verification capabilities.


## Source-delivery checkpoint — 2026-10-10

Source Tasks 1–7 and Task 8's contract, verification, independent review, capability documentation and reviewable delivery steps are complete. [Verification record](../../reviews/2026-10-10-harness-neutral-session-identity.md), artifact 2185a218fbd18b7f: focused 168 passed; plugin full suites passed in isolated and original checkouts; legacy provenance 245, formatter 56, pool 88; full Codescout gate exited 0 with all lane codes 0. Five mandatory reviewer mutations were killed; one additional controller mutation initially survived and was killed after a direct nested-child byte assertion.

Plugin source at 36cf947 is applied to the writable original, preserving earlier dirty work. Codescout source at 52be81ae is clean in its isolated clone; the 22-file coordinated patch passes git apply --check against the protected original. Native escalation to apply it was rejected by the installed routing hook before host approval. Original source application remains pending; no MCP approval bypass was used.

Step 4 remains open for actual native authored/mixed-peer/lifecycle acceptance after the native routing/install blocker is repaired. Limited root/refusal captures and exact versions are already documented. Step 7 is conditional on authorization and release/install preconditions, which do not yet hold; no configuration, caches, versions, release or push changed. The issue remains investigating.

## Coverage map

| Spec requirement | Task |
|---|---|
| Context schema, explicit hook origin, no fabricated identity | 1–2 |
| Resume/compaction/subprocess/root-child semantics | 1–2 fixture coverage; 4 historical boundaries; 8 real smoke |
| Native and manual invocation; actionable conflicts | 2, 5–7 |
| Claude compatibility and all-profile/worktree discovery | 3, 5 |
| Codex native write outcomes, opaque wrappers and history coverage | 4–5 |
| Own/peer/shared/unknown/CLEAN and safe formatter bytes | 5–6 |
| Explicit check-only and exclusive-checkout contract | 6–7 |
| Independent build leasing and all five lane outcomes | 7 |
| Capability/version/manual documentation | 8 |
| Mutation-tested review, real hosts, approval dependency and profile release | 8 |

## Plan self-review and handoff

Self-review completed against the approved spec: all requirements map to tasks, each Review Focus row has named tests, and record/context signatures agree across dependencies. The review clarified namespace conversion during the Claude-only refactor, JSON integer normalization across languages, the read-only REPO_ROOT test seam versus formatter authority, producer-scoped replay, and real-interpreter delegation in gate fixtures. Local links, whitespace and placeholder checks passed. The implementations above are proposed files; existing seams and test runners were read before planning. Re-scout if source changes.

Recommended execution: inline/native using executing-plans. The tasks share normalized record types and one provenance state machine, so keeping the implementer context together reduces interface drift; an independent final reviewer applies the required mutations. Subagent-driven execution remains available if the user prefers fresh task-level reviews.

Next step: user reviews this written plan and selects the execution method. No implementation, host capture, profile configuration or release is authorized by the plan document alone.
