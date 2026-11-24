---
kind: entry
status: open
title: 'tracker-hygiene: no detector measures tracker size, so a 1.66 MB session log stayed active and open-ended'
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 open created codescout:be5c3984-2bd4-45c8-897a-3b17ba6e951e'
status_since: 2026-11-24
---

**Summary:** The tracker-hygiene skill (D1-D11) has no size or entry-age detector. D3 and D10 test only the last git touch, so a tracker that is touched often never reaches them, however large it grows. In codescout, `docs/trackers/bug-fix-session-log.md` reached 1,661,589 B (417 entries, 18,710 lines) and stayed `status: active`, `time_scope: open-ended`. Every codescout agent that searches the tracker corpus pays for it.

**Symptom:** On 2026-11-24 the file was 1.66 MB with 430 commits (51 in the last 30 days). Its last entry is dated 2026-11-20 and the recon box replaced the log on 2026-11-23, but no sweep proposed archiving it. The hygiene sweep of 2026-11-24 archived 35 other trackers and did not flag it. In the semantic index it holds 1,070 of 54,510 chunks (2.0%) and 1.65 MB (3.8% of bytes). A second file, `reconnaissance-patterns.md` (764 KB), has the same exposure.

**Reproduction:** In a codescout checkout (`git rev-parse HEAD` at filing time: use the experiments branch head of 2026-11-24):
1. `ls -l docs/trackers/bug-fix-session-log.md` shows 1,661,589 B.
2. `git log --oneline -- docs/trackers/bug-fix-session-log.md | wc -l` shows 430; `git log --since='30 days ago' --oneline -- <file> | wc -l` shows 51.
3. Run the tracker-hygiene skill: D3 (no git touch in N days) and D10 (`*session-log*`, no touch in 21 days) cannot fire.

**Root cause:** `skills/tracker-hygiene/SKILL.md` defines D3 and D10 on git touch alone, and no detector reads size or entry count.
- The longest gap between touches of this file was 18 days; D10 needs 21 (measured from `git log` dates).
- Many of the 51 recent commits are bulk citation repoints and sweeps, not appends. A hygiene sweep itself touches the file and resets the clock.
- D10 matches the name `*session-log*`; `reconnaissance-patterns.md` does not match it and has 7 commits in 30 days.
- The design assumed a work stream wraps ("archived when the work stream wraps"). This one was open-ended. The old reconnaissance skill said "one topic = one work stream... if the file exists, append" and no template or policy carried a size cap or rotation rule.
- Each entry is stored twice: 410 Index rows use 256,857 B beside 413 entries of 1.39 MB (median 2,980 B). Code blocks are 0.6% of bytes, so the bulk is prose.
- Growth (bytes at each month's last commit): 74 KB May, 139 KB June, 221 KB July, 660 KB August, 1.50 MB September, 1.55 MB October, 1.66 MB November.
- Archiving does not remove a file from the semantic index. `semantic_search` in its default mode `code` returns no markdown, so a tracker reaches an agent through mode `full`, `doc find`, `grep` or a named read. In mode `full` the files under `docs/trackers/archive/` are returned: 101 archived files hold 2,527 of 54,560 chunks (4.6%, 2,538,109 B) in codescout's `.codescout/derived.db`. So D10 step 4 (compact) does not lower the retrieval cost of a log.

**Evidence:** Live trackers in codescout `docs/trackers/*.md`: 601 files, p50 3 KB, p90 25 KB, p99 173 KB; nine exceed 150 KB and three exceed 400 KB. Nothing reads the body at run time: the code cites the stem only in fixtures (`src/librarian/tools/link_scan/resolve.rs`, `scripts/probe-chunk-drift-by-root.py`, `tc-suites/artifact-entries.json`). The hot view and the SessionStart hook do not carry it (no `hot_cap`). Source: two read-only investigations of 2026-11-24 in codescout session be5c3984.

**Fix:** Proposed, not implemented.
- **D12 oversized-tracker.** Fires at 150 KB or 300 entries on a live tracker. Evidence pair: "declared: active, open-ended; observed: N KB, M entries, K chunks". Fix: distill-then-archive by the D10 procedure, or rotate to a successor file. Confidence low, a question for the owner.
- **D10 gate.** Key on size or entry age, and ignore commits that only repoint citations; do not key on the last git touch.
- **Surfacing.** Treat an archive candidate as archived for the hot view, `doc find` and the chunk index. The archive step adds the archive path to the project's `[ignored_paths]` patterns in `.codescout/project.toml`. A repo-level default is unsafe: `default_ignored_patterns` in codescout's `src/config/project.rs` may only name a directory that cannot hold hand-written source.

**Tests added:** none.

**Resume:** Implement D12 in `skills/tracker-hygiene/SKILL.md` with a fixture of one oversized active tracker and one small one. Not verified: the cost of `doctor`, `link_scan` and `librarian(action="context")` on the file, and how often an agent reads it whole (81 of 104 codescout transcripts name the stem; that counts mentions only).
