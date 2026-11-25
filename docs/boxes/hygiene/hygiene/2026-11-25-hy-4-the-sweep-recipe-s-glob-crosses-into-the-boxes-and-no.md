---
kind: entry
status: open
title: HY-4 — The sweep recipe's glob crosses into the boxes, and no detector is written for a box
created: 2026-11-25
entry_kind: meta
log:
- '2026-11-25 open created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-25
---

**Valid:** dated 2026-11-25

**Verdict:** miss

**Sweep:** 2026-11-25, second sweep of the day (this ledger).

**Observation:** `git ls-files 'docs/trackers/*.md'`, the Phase 2 recipe, returns 105 paths here. They are 22 flat live trackers, 22 archived trackers, `INDEX.md`, one template (`frictions/entry-template.md`) and 59 box files (57 under `ledgers/`, 2 under `streams/`). D1 to D11 fit the first two groups: an index row, a frontmatter `status:`, a `*session-log*` name. A box entry has none of these. Each box has its own check. This sweep ran the detectors on flat files only. Then it ran `codescout box <key> check` for the five boxes of this repository: `bugs`, `frictions`, `patterns`, `recon` and `runtime-residuals` all report no findings. The root box reports one suspect decision (anchor `CLAUDE.md#Where things live` changed) and one box candidate (`machine-linux`, 11 open entries). So the boxes are healthy by their own measure, and the gap is in the scope of the skill, not in the corpus.

**Proposal (if any):** Phase 2 scopes the file inventory to the flat files and the archive, and adds one line: for each box, run `codescout box <key> check` and relay its findings without re-deriving them. The box owns its hygiene, and the skill only reads the verdict. The same line makes room for the ledger of this skill, which cannot move into a box while the skill writes it by path.

**Promote-when:** same shape confirmed across 2+ sweeps.
