# S5 pilot tasks: review notes (2026-10-11)

Not read by the agent under test (this file is outside every task tree). One line per task:
Opus verdict, edits applied, residual exposure, difficulty. Gate = `s5 gate <id> --cpus 4 --memory-gb 8`
(draft limits; every task is re-gated after the pilot with the final limits, README gate 3).

| Task | Fix (candidate) | Opus verdict | Gate | Residual p2p exposure (names in the fix's own file) | Difficulty (Opus) |
|---|---|---|---|---|---|
| cs-p01 | 522d2961 (22) read_file JSON summary key list | ACCEPT. Authored tests; a compile error (`GuideLedger::mid_session` is `#[cfg(test)]`) was missed by the review and found by the cs-p08 review; fixed, task rebuilt | ok | 7 names in `src/tools/read_file.rs` | moderate-low |
| cs-p02 | 53bab804 (24) json_path `[*]` | REWRITE, 2 TASK.md edits applied (drop design-prescribing sentence; require the word `text`) | ok | 0 | easy; expect `effort_idle` at calibration |
| cs-p03 | b88fadce (13) | DROP (confirmed by a second Opus): root cause named in source comments and an archived issue that the scrub cannot remove; a fair TASK.md would state the fix | n/a | n/a | n/a |
| cs-p04 | 12aaf8b4 (47) buffer future mtime | REWRITE, 3 edits applied (TASK.md no longer gives the trigger; two authored tests for the other stamp routes; 23 inline p2p names) | ok (the authored tests compile at P) | 23 names in `src/tools/output_buffer.rs` (accepted: without them two wrong designs are not graded) | easy as first written; after the rewrite a real inference problem |
| cs-p05 | c410a275 (5) run_command tee capture | REWRITE, 5 edits applied (TMPDIR below a regular file; TASK.md no longer names the extra buffer; untested sentence deleted) | ok | 0 (optional edit 6, seven inline p2p names, not taken) | easy: the cause is near the symptom |
| cs-p06 | c1948fe5 (28) file_summary line route | ACCEPT | ok | 0 | moderate-easy |
| cs-p07 | 2ad3d950 (46) buffer refresh notice | REWRITE, 2 TASK.md edits applied (consume-once sentence deleted; unit-test exception reworded, then reworded again because the scrub refused "path read changed") | ok | 0 | moderate |
| cs-p08 | 8bd5f6f0 (20) buffer query stderr | REWRITE, compile fix and 2 TASK.md edits applied | ok | 0 | easy-moderate |

Known noise that is the same in every arm:
- cs-p05 removes `docs/trackers/issue-clusters.md` and `docs/evals/data/2026-09-24-rule-tell` for the scrub, so
  `tests/issue_clusters.rs` and some Python tests are red in its tree. None is in any listed command.
- Authored tests (cs-p01, cs-p04, cs-p05, cs-p06, cs-p08) were never compiled before the gate; the gate has now compiled them at P and C.

Not verified by anyone: the tasks have not been run by a model. Calibration (A twice, C once) decides which are too easy or too hard.
