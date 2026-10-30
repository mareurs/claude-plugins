# Cross-harness wake implementation and review — 2026-10-30

The implementation is in the claude-plugins feature branch feat/cross-harness-background-wake-20261030. It is opt in, with no installed profile changes, release bump, push or daemon restart. Operational instructions and the measured support matrix are in [background-wake.md](../background-wake.md).

## Execution rulings

- Use one manually created isolated companion worktree because the native worktree API targets the Codescout repository. Preserve both shared checkouts and their unrelated changes.
- Actual source and CI supersede stale memories describing Bash-only hooks and absent CI. The existing runtime is Node hooks with Node 24/Python 3.13 CI.
- Native envelope capture uses a deterministic MCP provider with synthetic tool outcomes and real native host calls. Label those independently; a captured hook does not prove a real job or complete delivery.
- Keep the approved design/plan in Codescout and the execution ledger/task bases in the companion worktree. Task commit ranges must identify the repository being changed.
- Test recursive discovery using an exact runner copy in a minimal private sandbox. An unsupported --list once executed the sentinel; remove only verified owned residue and retain the corrected bounded regression.
- Retain completed as well as unresolved receipt IDs, immutable watch registrations and persistent locks. This preserves deduplication and costs continuing local state growth; deletion-based compaction is not specified.
- Pass attemptId and handleValid as delivery context without changing persisted v1 identity hashing.
- Extend the receipt protocol with decline, inspect, explicit operator acknowledge and pre-send-only operator recovery. Do not fabricate send intent or host acceptance for a policy refusal.
- Persist at most four send permits per event, covering the initial attempt and three definite pre-send retries. A new watcher cannot reset that budget.
- Run task verification through the Codescout command environment when the native shell sandbox obscures child-test diagnostics. Record the actual test output rather than treating a wrapper exit as proof.
- Persist immutable per-record engine/target ownership. Preserve legacy raw maps, including heartbeat maps without a live marker, so migration cannot silently adopt old jobs. Rollback cannot adopt v1 jobs.
- Require explicit host/profile/environment/generation metadata; never register a target from model prose or guess another daemon.
- Existing Claude hooks.json already invokes the compatibility wrapper. Preserve its legacy registration instead of adding a duplicate.
- Codex's measured hook schema uses a command entry. A detached Node launcher supplies asynchronous watching without assuming an unmeasured asyncRewake flag or native Windows shell syntax.
- Reconcile is explicitly observation-only in v1. An operator acknowledgement records a decision while preserving delivery uncertainty; it does not become host evidence or resend.
- Bind each private state root to its canonical profile and refuse another profile's reuse. Per-profile caches and configuration remain independent.
- Use TMPDIR=/var/tmp for this machine's companion suite. An unrelated /tmp/.git changes older fixture root discovery; /dev/shm fixes those fixtures but falls outside the older foreign-path detector's allowlist. Do not delete unrelated repositories or modify those hooks merely to make this feature's checks pass.
- Keep unavailable native Windows/macOS host paths disabled and unverified. Portable CI jobs and a PowerShell CLI step are implementation coverage, not evidence that a native run occurred.
- For reused handles, preserve generation-specific registrations and serialize updates to the current handle index with the existing OS-lock helper. Retire old generations to prevent a delayed known replay rolling the index back.
- Recover durable terminal snapshots before observing a missing server record. Verify handle usability separately from the stored outcome and omit stale handle-read advice.

## Independent core review

The Tasks 1–3 review found two Important defects: stored target identity was not revalidated, and filesystem support checks inspected the profile rather than actual storage. Both reproduced RED before fixes and passed afterward.

Its four applied mutants initially survived: recomputed identity comparison, evidence event ID, expired renewal and attempt-ID ownership. Each was reapplied against a new negative regression and failed; restoration passed 22 storage/platform cases. The filesystem reproduction was instrumented, not a native NFS mount measurement.

## Final whole-change review

The independent review of e7b05fa..b6fbf46 found no Critical findings and three Important runtime defects:

- A new server reusing a handle could not register in the same target.
- The Codex adapter checked daemon-versus-config identity without checking the supplied event's full target binding.
- A durable terminal snapshot could be ignored in favor of an unknown tracking-loss message.

Each defect was reproduced RED and corrected. New tests observe server restart/rearm, retired replay suppression, each target dimension, and known terminal recovery without stale handle advice. Two actual child processes register competing generations, and an independently held native OS lock proves registration cannot bypass the index lock.

The six review mutations produced three killed and three survived:

| Mutation | Observed result before new regressions |
|---|---|
| Remove config environment discrimination | Killed |
| Remove recovery live-lease guard | Survived: 44 tests passed |
| Accept host evidence without prior send intent | Survived: 37 tests passed |
| Remove per-record target ownership comparison | Survived: 111 tests passed |
| Remove matching Codex output event marker | Killed |
| Remove loaded-thread guard before attach | Killed |

The three survivors were reapplied one at a time after adding the precise negative cases. Each then failed, and all three regressions passed after restoration. During the final fix pass, removing the new map lock, removing retired-generation fencing and dropping handle-validity delivery context each caused its targeted regression to fail. All mutations were restored.

No second independent review pass was run after fixes. Final verification runs against the corrected tree. There are no deferred Minor review findings.

## Scope rulings on declined behaviors

- Native Windows/macOS host execution and Windows-specific storage behavior: unavailable locally; remain explicit future native verification gates.
- Full automatic native registration, complete Claude v1 parity and Codex same-active-turn completion: local protocol fixtures cannot establish them. Retain the measured limits and conservative accepted/unknown states.
- Installed-profile deployment and release: outside this task; provide concrete preparation/migration commands for later authorization.
- Observation-only reconcile and indefinite identity/lock retention: evaluated and retained as documented v1 decisions, rather than dropped requirements.

## Validation evidence

The corrected feature/capability command passed 120 Node tests. Discovery and the copied-cache dependency smoke passed. The legacy wrapper retains 59 assertions. The corrected-tree full companion runner passed without exclusions using TMPDIR=/var/tmp (background job @bg_0000003e, exited 0, All suites passed). An injected missing-ws resolution failure also returned unsupported with a visible dependency reason and zero daemon requests; this was an injected failure, not a missing installed dependency.

Codescout's isolated documentation worktree passed ./scripts/gate.sh --check with FMT=0, CLIPPY=0, LEAN=0, DEFAULT=0 and PYTHON_LIGHT=0. Its documentation commit is 9249f773b. The gate's standard heavy Python/server-stack/local ONNX exclusions remain outside this result.

Native evidence is scoped to Claude 2.1.312 and Codex CLI 0.165.0 hook envelopes, plus separate daemon 0.160.0 secondary-client probes on Linux. The model was requested as gpt-6.1-sol; served-model identity was not independently verified. See the [dated capability report](2026-10-30-background-wake-capabilities.md) for callback counts, real-job outcomes, successful idle/reconnect controls and the same-turn completion limit.
