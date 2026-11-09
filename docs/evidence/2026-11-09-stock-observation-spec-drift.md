---
id: '57ada03063a50be6'
kind: report
status: done
title: Stock Codex observations implementation/spec drift review
tags:
- codex
- observations
- spec-drift
topic: stock-codex-observations
---

# Stock Codex observations — implementation/spec drift review

Verdict: **GO for source delivery**. All 37 explicitly split checks below are implemented within the approved source-only boundary. No missing or divergent item remains. This does not approve or claim live-profile deployment, host-dispatch overlap, complete execution coverage or new formatter permission.

Compared approved spec `9d1d3c7f58f63dad` and plan `3f373e14fa311cc8` with the final isolated sources, independent source review and fresh runtime evidence. `CS:` denotes the Codescout repository; plugin paths are relative to this repository. The original 13 acceptance criteria are split into the checks below; this row count is not a count of tests.

| Check | Requirement | Source/evidence anchor | Verification |
|---|---|---|---|
| 1a | Packaged Codex and Code Mode unchanged | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Native acceptance package/version and both binary SHA-256 values; installed_binary_replaced=false. |
| 1b | Normal package route preserved | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Source-only delivery and unchanged package hashes; no Codex/package/profile/release edits. |
| 2a | Existing native identity resolver reused | `CS:src/tools/invocation_context.rs:21` | CS:src/tools/invocation_context.rs:21 (codex_fields), :97 (from_meta); M1 observed semantic kill. |
| 2b | Session-context v1 and Claude paths preserved | `CS:src/tools/invocation_context.rs:21` | codescout-companion/hooks/session-context.mjs unchanged; context fixtures and full plugin gate pass. |
| 2c | Missing/competing/duplicated contexts exercised | `CS:src/tools/invocation_context.rs:21` | Rust native-context tests, shared contract negative cases, actual thread-only API acceptance. |
| 3a | Root and resume retain identity | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Native routes untrusted_hooks and resume_nested_code_mode; completed native exec/output keys recorded. |
| 3b | New-root fork distinct | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Native fork route records a distinct root/principal. |
| 3c | Child identity explicit | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Native child route records parent root plus distinct executing thread. |
| 3d | Compaction and later write retain identity | `docs/evidence/2026-11-09-stock-observation-acceptance.json:1` | Native compaction route waits for completed turn and observes subsequent write plus lifecycle hooks. |
| 4a | Hookless API actual write observed | `CS:src/observations/server.rs:60` | Native direct_api route and real component test; CS:src/observations/server.rs:269, :390. |
| 4b | Thread-only API root remains unknown | `CS:src/observations/server.rs:60` | Native direct_api root=null/thread retained; M1 kill and actual wire regression. |
| 5a | Repeated calls and transport scope remain distinct | `CS:scripts/operation_observations.py:37` | CS:src/observations/server.rs:29 LocalInvocationId; M2 constant-connection mutation killed. |
| 5b | Replay/conflict/storage discontinuity explicit | `CS:scripts/operation_observations.py:37` | Store and Python replay/checksum/sequence/registry tests; no unique-write count inferred. |
| 5c | Missing child and ambiguous hooks cannot join unsafely | `CS:scripts/operation_observations.py:37` | CS:scripts/operation_observations.py:37, :50, :124; M3 ambiguous-pair mutation killed. |
| 6a | Genuine controlled dispatch overlap isolates contexts | `CS:src/observations/server_tests.rs:260` | overlapping_dispatches_keep_context_connection_and_targets_separate uses two handler barriers; M2 killed. |
| 6b | Concurrent append integrity exercised | `CS:src/observations/server_tests.rs:260` | 16 store tests include two barrier-synchronized subprocess writers and abrupt exit; parent invokes the ignored child fixture. |
| 6c | Host overlap limit reported | `CS:src/observations/server_tests.rs:260` | Acceptance host_dispatch_overlap explicitly unverified; native Promise.all is not concurrency proof. |
| 7a | Native and arbitrary MCP shell remain opaque | `CS:scripts/operation_observations.py:84` | Native native_shell effect/hook-only route plus real effect=read MCP shell integration; no enumerated shell targets. |
| 7b | Semantic refusal preserves bytes | `CS:scripts/operation_observations.py:84` | Actual wire/component refusal and native refusal route; raw result decoded before truncation. |
| 7c | Partial error/cancellation/missing terminal retain uncertainty | `CS:scripts/operation_observations.py:84` | CS:scripts/operation_observations.py:84, :101; source regressions RED→GREEN, both cancellation arms and native partial effect. |
| 8a | Hook timeout/crash/disabled/untrusted are neutral | `CS:src/observations/store.rs:486` | Adapter deadlines/neutral output tests; native untrusted_hooks and crashed_hook routes, real disabled adapter case. |
| 8b | Unavailable/full stores preserve original tool effects | `CS:src/observations/store.rs:486` | Actual observer failure/full-store component tests; capture fail-open and reader diagnostics. |
| 8c | Torn/dead/reset/deleted capture remains uncertain | `CS:src/observations/store.rs:486` | Store and Python reader regressions include empty shard, whole-producer deletion, abrupt exit and immutable per-checkout reset latch. |
| 8d | Uncertain observations do not authorize formatting | `CS:src/observations/store.rs:486` | Actual formatter refusal/unchanged-byte regressions and M4 old-gap mutation kill. |
| 9a | Targets bind to reached checkout | `CS:src/observations/server.rs:390` | CS:src/observations/server.rs:390 observe_write and src/util/fs.rs atomic replacement callbacks; actual create/edit/wire tests. |
| 9b | Symlink and linked checkout storage separation exercised | `CS:src/observations/server.rs:390` | No-follow/private store tests and per-checkout Git-dir policy marker cases. |
| 9c | Parent inode replacement cannot become committed fact | `CS:src/observations/server.rs:390` | replaced_parent_between_attempt_and_commit_is_uncertain; observed initial M5 survivor, then exact mutation semantic kill. |
| 10a | Privacy allowlist excludes canary bodies | `codescout-companion/hooks/observation-contract.mjs:35` | Rust/JS/Python contract, adapter and native component canaries; M6 raw-input leak mutation killed. |
| 10b | Malformed/oversized data and raw cwd bounded | `codescout-companion/hooks/observation-contract.mjs:35` | Adapter 4MiB/64KiB/deadline tests; optional native_cwd absolute/path-bound tests in all three languages. |
| 11a | Rich history remains separate and preserved | `CS:scripts/operation_observations.py:162` | CS:scripts/operation_observations.py:130, :162; alias/index/body-preservation tests. |
| 11b | Replay/fork boundaries retain explicit native scope | `CS:scripts/operation_observations.py:162` | Full native keys and fingerprint domains; rich history/fork regression suite and M3. |
| 11c | Existing gaps/evidence and formatter bytes preserved | `CS:scripts/operation_observations.py:162` | CS:scripts/operation_observations.py:167 and real formatter checks; M4 observed UNKNOWN→MINE failure caught by tests. |
| 12a | Cross-repository schema/fixture bytes match | `docs/evidence/2026-11-09-stock-observation-mutations.md:1` | cmp of both schema files and fixture corpora exits0; contract vectors pass Rust/JS/Python. |
| 12b | Required repository gates verified | `docs/evidence/2026-11-09-stock-observation-mutations.md:1` | Plugin run-all passed; Codescout FMT/CLIPPY/LEAN/DEFAULT/PYTHON_LIGHT all0; buddy534 passed; six explicit native component tests passed. |
| 12c | Applied mutation review performed and survivor closed | `docs/evidence/2026-11-09-stock-observation-mutations.md:1` | 2026-11-09-stock-observation-mutations.md records 6 initial candidates, 5 killed/1 survived, then exact survivor killed after regression. |
| 13a | Per-profile future activation documented | `codescout-companion/docs/session-context.md:76` | codescout-companion/docs/session-context.md:76; renderer fixtures cover independent cache roots, absent/case-distinct profiles, no trust/profile writes. |
| 13b | Source acceptance separated from installation | `codescout-companion/docs/session-context.md:76` | Acceptance live_profiles_modified=false and installed_binary_replaced=false; future reload/event acceptance explicitly required. |

Fresh verification: plugin `./tests/run-all.sh` passed; Codescout `scripts/gate.sh --check` exited with FMT/CLIPPY/LEAN/DEFAULT/PYTHON_LIGHT all 0; explicit real component suite 6 passed; formatter 56 checks passed; buddy pytest 534 passed. Native acceptance repeated against the final adapter and rebuilt Codescout: all ten exercised routes passed and temporary auth copies were removed. Shared schema/fixture comparisons and both diff whitespace checks passed.

The six mutation candidates initially produced 5 kills and 1 survivor. The sole survivor was observed before adding its regression, then killed by reapplying the exact mutation; the restored focused review suite passed 21 tests. The independent reviewer found no outstanding findings after the terminal-result, nested-cwd and raw-cwd fixes.

Earlier /tmp quota failures were excluded from usable baselines. An unsuitable disk temporary directory inside Git also invalidated fixtures and was replaced. One disk-backed store stress run returned unavailable under concurrent capture; no causation or code fix is claimed from that observation. Final required Codescout checks used the gate's supported tmpfs substrate at /dev/shm with available quota. Earlier s4 test failures passed in isolation and in the final complete plugin gate; their cause remains unproved. Required gate scope does not include heavy Python, server-stack or local-ONNX runtime acceptance.
