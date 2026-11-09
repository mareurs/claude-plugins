# Stock observation applied-mutation review — 2026-11-09

Independent review ran mutations in separate source snapshots. Original implementation files and indexes were not mutated by the reviewer. Compilation failures were not counted as semantic kills.

| Seam | Applied change | Passed | Failed | Initial outcome |
|---|---|---:|---:|---|
| M1: root/thread | NativeInvocation::from_meta falls back to thread_id when session_id absent | 18 | 2 | killed |
| M2: local connection scope | LocalInvocationId.connection becomes constant "shared" | 19 | 1 | killed |
| M3: ambiguous hook pairing | accept len(candidates)>=1 rather than exactly 1 | 63 | 1 | killed |
| M4: old gap preservation | merge_scan_observations starts gaps=[] | 55 | 9 | killed |
| M5: actual parent identity | pending .is_some_and(|(a,b)|a==b) becomes .is_some_and(|(_a,_b)|true) | 20 | 0 | survived |
| M6: privacy allowlist | normalizeHookObservation includes raw_tool_input:payload.tool_input | 7 | 3 | killed |

Initial result: **5 killed, 1 survived** from 6 applied candidates.

M5 survived before its regression was written. A deterministic test now observes attempted write, renames its parent while retaining the old inode, creates a replacement parent, and observes the commit callback. It requires an uncertain target and no committed target while preserving the actual file bytes and tool success. The independent follow-up observed **1 passed / 0 failed** unmutated, then **0 passed / 1 failed** under the exact original M5 mutation (committed versus expected uncertain). The mutation was restored afterwards.

The independent source review also reproduced missing and contradictory terminal-result handling and hook capture loss from a nested working directory. New regression tests failed before those fixes. The raw cwd omission was corrected with an optional bounded `native_cwd` field separate from canonical `workspace`; old records remain accepted. Post-fix source review found no new defect in these changes. Final required repository gates are recorded separately in the acceptance evidence.

Private local logs are not shipped. SHA-256 anchors for the observed outputs:

| Log | SHA-256 |
|---|---|
| M1-thread-as-root.log | `585322eda48303ddc17a8ca89e797f20fbd230bd372eb37d1eee97932d7a744a` |
| M2-connection-collision.log | `7d32afffbafe6f62e2897f4e18ca186657d2752989698dcdc03811be8a42046a` |
| M3-ambiguous-hook.log | `26105148df455da5bde91e939321d5850cdcad91bad0ee43bef3aef919b57c0e` |
| M4-drop-old-gaps.log | `8f48313cfa2e950557a9e527b42585e0721ed730a70cf229a1d23e9a54058ec2` |
| M5-parent-inode.log | `2db610535df6ad5a36288ead45c0b19741123bcc48f18062e66ac9fc1f18f4a2` |
| M6-raw-input-leak.log | `243734da5f6d5e549d5c3c178f91b9705f799cf90de2b168c0cd68727fed4463` |
| M5-added-test-baseline.log | `98f25b9eeb59c578fb1efe9ceeb28ae99f50b8d5eea0b9e99426c0303a87a50f` |
| M5-added-test-mutated.log | `d9f29a33076eeaaca2a7a75639af9b042705f9c773d5ed27291a1260727e4985` |
