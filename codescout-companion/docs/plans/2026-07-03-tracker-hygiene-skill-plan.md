# Tracker Hygiene Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `tracker-hygiene` skill designed in `2026-07-03-tracker-hygiene-skill-design.md` — a periodic, human-gated tracker-corpus sweep with a self-improvement ledger and a SessionStart overdue nudge.

**Architecture:** A prompt-only skill (SKILL.md + ledger template) in codescout-companion, sibling of `reconnaissance`. Detection is a declared-vs-observed diff parameterized by each project's own convention docs; six named detectors (D1–D5, D9); every fix individually gated; per-project ledger (`docs/trackers/tracker-hygiene-log.md`) records verdicts and HY-N meta-entries. One small bash addition to `session-start.sh` reads `next-sweep-due:` from that ledger and emits an overdue banner line.

**Tech Stack:** Markdown skill files, bash (SessionStart hook + its test harness), codescout MCP tools (the skill's runtime: `read_markdown`, `edit_markdown`, `artifact`, `artifact_refresh`, `run_command`).

## Global Constraints

- **Repo:** all file work in `/home/marius/work/claude/claude-plugins` (branch `main`); paths below are relative to repo root unless absolute.
- **Tooling:** native Read/Edit/Write/Bash are hook-denied in this environment — use codescout MCP tools (`create_file`, `edit_file`, `edit_markdown`, `read_file`, `run_command`) with `workspace="/home/marius/work/claude/claude-plugins"`.
- **Do not touch** `docs/trackers/version-bump-checklist.md` (librarian-managed, already dirty in the working tree with someone else's change).
- **Version:** bump `codescout-companion/.claude-plugin/plugin.json` from `1.11.17` to `1.12.0` (new feature) in the docs task, with a README changelog entry.
- **Ledger contract (used by Tasks 1, 2, 3):** per-project ledger lives at `docs/trackers/tracker-hygiene-log.md`; its YAML frontmatter carries `next-sweep-due: YYYY-MM-DD` and `sweep-interval-days: 30`.
- **Commit style:** conventional commits; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Hook tests must pass:** `bash codescout-companion/hooks/session-start.test.sh` exits 0.

---

### Task 1: Ledger template (`references/tracker-hygiene-log-template.md`)

**Files:**
- Create: `codescout-companion/skills/tracker-hygiene/references/tracker-hygiene-log-template.md`

**Interfaces:**
- Produces: the bootstrap template Task 2's SKILL.md tells agents to copy to `docs/trackers/tracker-hygiene-log.md`; frontmatter keys `next-sweep-due`, `sweep-interval-days` (consumed by Task 3's nudge); the `## Template for new entries` append anchor; HY-N verdict vocabulary.

- [ ] **Step 1: Create the template file** with exactly this content:

````markdown
# Tracker hygiene log — template

> **Bootstrap:** Copy this file to `docs/trackers/tracker-hygiene-log.md`
> in the active project on first sweep. The local copy becomes the
> project's sweep ledger + HY-N meta-ledger for the
> `codescout-companion:tracker-hygiene` skill. Set `next-sweep-due` to
> today before the first sweep. Sync mature HY-N proposals back into
> `SKILL.md` (see § How to sync).

---

```yaml
---
kind: tracker
status: active
title: Tracker hygiene log
owners: []
tags:
  - hygiene
  - skill-meta
  - lifecycle
next-sweep-due: YYYY-MM-DD
sweep-interval-days: 30
---
```

# Tracker hygiene log

Per-project ledger for the `codescout-companion:tracker-hygiene` skill.
Two kinds of entries live here:

- **Sweep entries** (`## Sweep YYYY-MM-DD`) — one per sweep: per-detector
  findings/verdicts, every reject's reason, fixes applied with commit SHA.
- **HY-N meta-entries** (`## HY-N — <title>`) — observations about the
  *skill itself*: detector hits, misses, false-positive patterns, and
  SKILL.md change proposals. Monotonic per project; never reuse an ID.

The frontmatter `next-sweep-due:` field is read by the companion's
SessionStart hook — an overdue date produces a one-line nudge at session
start. Every sweep entry ends by updating it to
`sweep date + sweep-interval-days`.

## Detector trust state

Batch-approval graduation is per detector, earned from this table.
A detector enters `batch` after **two consecutive sweeps with zero
rejects**; any reject drops it back to `individual`.

| Detector | Mode | Consecutive zero-reject sweeps | Last reject (sweep, reason) |
|----------|------|-------------------------------|------------------------------|
| D1 index-drift | individual | 0 | — |
| D2 terminal-not-archived | individual | 0 | — |
| D3 stale-active | individual | 0 | — |
| D4 frontmatter-catalog-mismatch | individual | 0 | — |
| D5 canonical-conflict | individual | 0 | — |
| D9 augmentation-stale | individual | 0 | — |

## HY-N verdict vocabulary

| Verdict | Meaning |
|---------|---------|
| `hit` | Detector caught real drift; human approved the fix. |
| `miss` | Drift found manually that no detector flagged. The most important kind — drives new detectors. |
| `false-positive-pattern` | Recurring reject reason for one detector — carries a tuning proposal. |
| `proposal` | Concrete SKILL.md change derived from the above. |
| `promoted` | Proposal landed in SKILL.md. Pin the commit SHA + skill version. |
| `wontfix` | Considered, declined — costlier than the drift it would prevent. Pin the rationale. |

## How to sync

When an HY-N proposal is confirmed across **2+ sweeps** (same shape,
either sweep in this project or a sibling project's ledger), sync it
into the skill:

1. PR against `codescout-companion/skills/tracker-hygiene/SKILL.md`,
   citing the HY-N IDs and their sweep entries.
2. On merge, set the HY-N entry to `Verdict: promoted` and pin the
   commit SHA + plugin version.

Manual flow — no automated cross-project aggregation. The skill is the
canonical destination; per-project ledgers are the substrate.

## Sweep entry template

```markdown
## Sweep YYYY-MM-DD

**Scope:** docs/trackers/ | **Files inventoried:** N | **Convention sources:** <index file, conventions doc, or "none — thin sweep">

| Detector | Findings | Approved | Rejected | Deferred |
|----------|----------|----------|----------|----------|
| D1 index-drift | 0 | 0 | 0 | 0 |
| D2 terminal-not-archived | 0 | 0 | 0 | 0 |
| D3 stale-active | 0 | 0 | 0 | 0 |
| D4 frontmatter-catalog-mismatch | 0 | 0 | 0 | 0 |
| D5 canonical-conflict | 0 | 0 | 0 | 0 |
| D9 augmentation-stale | 0 | 0 | 0 | 0 |

**Rejects (verbatim reasons — the training signal):**
- <detector>: "<finding one-line>" → rejected: <reason>

**Fixes applied:** <commit ref in the project's citation format, e.g. `(master:<sha>)`>

**Detector trust updates:** <rows changed in the trust table, or "none">

**Next sweep due:** YYYY-MM-DD (frontmatter updated in this edit)
```

## HY-N entry template

```markdown
## HY-N — <one-line title>

**Verdict:** hit | miss | false-positive-pattern | proposal | promoted | wontfix

**Sweep:** YYYY-MM-DD (this ledger) — or cite sibling project ledger.

**Observation:** <what the detector did / didn't do, and the human verdict>.

**Proposal (if any):** <the SKILL.md or detector change>.

**Promote-when:** <criterion — default: same shape confirmed across 2+ sweeps>.
```

---

## Template for new entries

<!-- Insert new sweep entries and HY-N entries above this line via:
     edit_markdown(action="insert_before",
                   heading="## Template for new entries",
                   content="## Sweep YYYY-MM-DD\n...")
     Update frontmatter in the same call:
     edit_markdown(..., frontmatter={set: {"next-sweep-due": "YYYY-MM-DD"}}) -->
````

- [ ] **Step 2: Verify structure**

Run: `run_command("grep -c 'next-sweep-due\|sweep-interval-days\|## Template for new entries\|D9 augmentation-stale' codescout-companion/skills/tracker-hygiene/references/tracker-hygiene-log-template.md", workspace="/home/marius/work/claude/claude-plugins")`
Expected: count ≥ 6 (2 frontmatter keys in yaml + prose mentions, the anchor heading, D9 rows).

- [ ] **Step 3: Commit**

```bash
git -C /home/marius/work/claude/claude-plugins add codescout-companion/skills/tracker-hygiene/references/tracker-hygiene-log-template.md
git -C /home/marius/work/claude/claude-plugins commit -m "feat(codescout-companion): tracker-hygiene ledger template

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The skill (`SKILL.md`)

**Files:**
- Create: `codescout-companion/skills/tracker-hygiene/SKILL.md`

**Interfaces:**
- Consumes: Task 1's template at `references/tracker-hygiene-log-template.md` (bootstrap copy path), its `## Template for new entries` anchor, its trust-table and entry templates.
- Produces: the skill invoked as `Skill('codescout-companion:tracker-hygiene')`; the ledger filename `docs/trackers/tracker-hygiene-log.md` that Task 3's nudge greps.

- [ ] **Step 1: Create SKILL.md** with exactly this content:

````markdown
---
name: tracker-hygiene
description: Use when asked to run a tracker hygiene sweep, audit tracker staleness or drift, clean up docs/trackers, before backlog triage or any "what's open?" report, or when the SessionStart banner says a tracker hygiene sweep is overdue. Interactive — every finding is human-gated; approved fixes apply via the librarian; each sweep appends to the project's tracker-hygiene-log.
---

# /codescout-companion:tracker-hygiene

Tracker corpora drift even after formal consolidation: index maps miss new
files, terminal trackers linger in live directories, "active" frontmatter
outlives the work. Drift is a **disagreement between three states** the
project already holds — this skill diffs them and lets a human gate every
fix.

| State | What it is | Where it lives |
|---|---|---|
| **Convention** | The local dialect: status vocabularies, archive dir, index format | `CONVENTIONS.md`, `TAXONOMY.md`, archive policy docs, `get_guide("tracker-conventions")` defaults |
| **Declared** | What the project *says* is true | index/README cluster maps, frontmatter `status:` |
| **Observed** | What *is* true | `git log -1` per file, actual directory, librarian catalog, `artifact_refresh(list_stale)` |

**REQUIRED SUB-SKILL:** None. Composes with `reconnaissance` (per-task
drift-catching; this skill is the corpus-wide periodic sweep).

## When to Use

- Explicitly invoked, or the SessionStart banner says a sweep is overdue.
- Before backlog triage or any "what's open?" report.
- When recon or any session notices corpus-level drift (orphaned trackers,
  index rows pointing nowhere).

## When NOT to Use

- Mid-task single-tracker updates — that's normal editing.
- Single-bug archive moves — the project's ship sequence covers those.
- Anything in `docs/issues/` — bug-file discipline is v2 (D8), not yet here.

## The loop — five phases

### Phase 1 — Learn

Read the project's convention surfaces to parameterize the detectors. Look
for, in order: a tracker index (`docs/trackers/README.md`, `docs/TAXONOMY.md`),
a conventions doc (`docs/trackers/CONVENTIONS.md`), an archive policy
(`docs/trackers/archive-cadence-policy.md` or equivalent). Extract: the
index format, the archive directory, status vocabularies, the staleness
threshold N (default **45 days** if none declared).

If no convention docs exist: announce it, run the **thin sweep** (D2/D3/D4/D9
only — no index to diff), and emit a synthetic finding recommending a
conventions bootstrap.

If the ledger `docs/trackers/tracker-hygiene-log.md` does not exist,
bootstrap it now: copy `references/tracker-hygiene-log-template.md` from this
skill's directory, set `next-sweep-due` to today, fill the real frontmatter
(strip the template preamble above the `---`).

### Phase 2 — Inventory

Build both states. All shell via `run_command`; never pipe unbounded output.

- **Observed dates:** `for f in $(git -C <root> ls-files 'docs/trackers/*.md'); do echo "$(git -C <root> log -1 --format=%ad --date=short -- "$f")  $f"; done`
- **Observed placement:** which files sit in the live dir vs the archive dir.
- **Observed catalog:** `artifact(action="find", kind="tracker", include_archived=true)` — note rows whose `status` or `rel_path` disagree with disk.
- **Observed augmentation freshness:** `artifact_refresh(action="list_stale", threshold_hours=168)`.
- **Declared:** parse the index file's rows (file links + claimed status); read each tracker's frontmatter `status:` via `read_markdown`.

### Phase 3 — Diff (the detectors)

Run each detector; emit findings as `(detector, evidence pair, proposed fix,
confidence)`. An evidence pair always names both sides: *"declared X;
observed Y"*.

| ID | Name | Fires when | Proposed fix | Confidence |
|---|---|---|---|---|
| **D1** | index-drift | Live file absent from the index, or index row points at a missing/moved file | add or repoint the index row | high |
| **D2** | terminal-not-archived | Frontmatter `archived`/`superseded` but file in live dir; or file in archive dir with `status: active` | `artifact(update, patch={status:...})` + `artifact(move, new_rel_path=...)` per the project's archive policy | high |
| **D3** | stale-active | `status: active` and no git touch in N days | **a question** — archive, or confirm still-live? Never presume archive | low, by design |
| **D4** | frontmatter-catalog-mismatch | Catalog row disagrees with file frontmatter, or file has no catalog row / no `kind:` | reconcile via `artifact(update)`; `librarian(action="reindex")` for orphans | high |
| **D5** | canonical-conflict | Two live trackers claim one topic (tag/topic overlap + index cluster), or a child restates its canonical's status | judgment call — merge, link, or bless the fork | low |
| **D9** | augmentation-stale | `artifact_refresh(list_stale)` returns the artifact | run gather → synthesize → `artifact(update, commit_refresh=true)`, or defer to owner | medium |

D6 (entry-level verify-open), D7 (citation format), D8 (`docs/issues/`
discipline) are **v2** — do not improvise them mid-sweep; a drift you notice
outside D1–D5/D9 is a `miss` HY-N entry, which is how v2 earns its way in.

### Phase 4 — Triage (interactive, one finding at a time)

Check the ledger's **Detector trust state** table first. For detectors in
`individual` mode (v1 default: all), present each finding as its own
`AskUserQuestion`: the evidence pair, the proposed fix, the detector name.
Verdicts:

- **approve** — fix applies in Phase 5.
- **reject** — false positive. A one-line reason is mandatory; it is the
  training signal. Record it verbatim.
- **defer** — no action; the finding recomputes and resurfaces next sweep.

For detectors that have graduated to `batch` mode (two consecutive
zero-reject sweeps, per the trust table), present all of that detector's
findings as one batch gate. **Any reject drops the detector back to
`individual`** — update the trust table in Phase 5. Auto-apply does not
exist at any trust level.

Nothing is edited before its verdict.

### Phase 5 — Apply + Log

- Apply approved fixes **through the librarian** — `artifact(update)`,
  `artifact(move)` — never bare `git mv`, which orphans the catalog row
  (`id = sha256(abs_path)`).
- Append one sweep entry to the ledger (template in the ledger file) via
  `edit_markdown(action="insert_before", heading="## Template for new entries", ...)`;
  in the same call set the frontmatter:
  `frontmatter={set: {"next-sweep-due": "<today + sweep-interval-days>"}}`.
- Update the Detector trust state table (zero-reject streaks, demotions).
- Add HY-N entries for anything meta: a `miss` (drift found outside the
  detectors), a `false-positive-pattern` (recurring reject reason), a
  `proposal`.
- One commit for the whole sweep, message referencing the sweep entry,
  SHAs cited in the project's citation format.

## Degradation rules

- **No convention docs** → thin sweep + bootstrap-recommendation finding.
- **Librarian unavailable / catalog empty** → skip D4 and D9; say so in the
  sweep entry, so the gap is visible rather than silent.
- **Interrupted sweep** → safe by construction: nothing applies ungated,
  the ledger writes at the end, findings recompute next sweep.
- **Multi-workspace sessions** → pin `workspace=` per call; never
  `activate` a foreign project mid-sweep (see `get_guide("workspace-state")`).

## Stop conditions

- The user rejects three findings in a row from the same detector — stop
  presenting that detector's findings this sweep, log a
  `false-positive-pattern` HY-N, move on.
- More than ~25 findings total — present counts per detector first and ask
  which detectors to triage this session; the rest defer.

## The ledger (per project)

`docs/trackers/tracker-hygiene-log.md`, bootstrapped from this skill's
`references/tracker-hygiene-log-template.md`. Holds sweep entries, HY-N
meta-entries, and the detector trust table. The companion's SessionStart
hook reads its `next-sweep-due:` frontmatter and nudges when overdue —
keeping that field current is part of every sweep's Phase 5.

HY-N promotion mirrors reconnaissance's R-N flow: proposals confirmed
across 2+ sweeps → PR against this SKILL.md citing the HY-N IDs → mark
`promoted` with commit SHA + plugin version.

## Growth path (so future sessions don't re-litigate)

1. **v2 detectors:** D6 entry-level verify-open, D7 citation-format,
   D8 `docs/issues/` archive discipline — added when file-level sweeps are
   trusted and `miss` entries demand them.
2. **Batch approval** per detector via the trust table (mechanical rule
   above).
3. **Substrate promotion:** when D1/D2/D4 hold sustained zero-reject
   records, their detection graduates to a Rust
   `librarian(action="audit_trackers")` beside `audit_doc_refs`; the skill
   then consumes its output and keeps only triage in skill-land.
````

- [ ] **Step 2: Verify structure**

Run: `run_command("grep -c 'D1\\|D2\\|D3\\|D4\\|D5\\|D9' codescout-companion/skills/tracker-hygiene/SKILL.md", workspace="/home/marius/work/claude/claude-plugins")`
Expected: ≥ 12 (each detector named in table + prose).

Run: `run_command("grep -n 'tracker-hygiene-log.md\\|Template for new entries\\|next-sweep-due' codescout-companion/skills/tracker-hygiene/SKILL.md", workspace=...)`
Expected: all three strings present — they are the contract with Tasks 1 and 3.

- [ ] **Step 3: Commit**

```bash
git -C /home/marius/work/claude/claude-plugins add codescout-companion/skills/tracker-hygiene/SKILL.md
git -C /home/marius/work/claude/claude-plugins commit -m "feat(codescout-companion): tracker-hygiene skill — gated corpus sweep

Six detectors (D1-D5, D9) over a declared-vs-observed diff, individually
gated fixes with per-detector batch graduation, per-project sweep ledger
with HY-N self-improvement entries. Design:
docs/plans/2026-07-03-tracker-hygiene-skill-design.md

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: SessionStart overdue nudge (TDD)

**Files:**
- Modify: `codescout-companion/hooks/session-start.sh` (insert after the `SKILLS AVAILABLE` block, before the `# Statusline marker` comment, ~line 106)
- Modify: `codescout-companion/hooks/session-start.test.sh` (insert before the final `echo`/`Total` lines)

**Interfaces:**
- Consumes: ledger path `docs/trackers/tracker-hygiene-log.md` and frontmatter key `next-sweep-due:` (Tasks 1–2 contract).
- Produces: banner line `TRACKER HYGIENE: sweep overdue (due <date>) — run /codescout-companion:tracker-hygiene` in SessionStart `additionalContext`.

- [ ] **Step 1: Write the failing tests.** In `session-start.test.sh`, insert this block immediately before the final `echo` / `echo "Total: ..."` lines:

```bash
# --- Tracker-hygiene overdue nudge ---
# Ledger absent (all earlier ctx calls ran without it): no nudge.
if echo "$STARTUP" | grep -q "TRACKER HYGIENE"; then
  fail "hygiene nudge must be silent when no ledger exists"
else
  pass "no ledger → no hygiene nudge"
fi

mkdir -p "$TMP/docs/trackers"
LEDGER="$TMP/docs/trackers/tracker-hygiene-log.md"

# Overdue date → nudge present, names the due date and the skill.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2020-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
OVERDUE=$(ctx startup)
echo "$OVERDUE" | grep -q "TRACKER HYGIENE: sweep overdue (due 2020-01-01)" \
  && pass "overdue ledger → hygiene nudge with due date" \
  || fail "overdue ledger did not produce the hygiene nudge"
echo "$OVERDUE" | grep -q "codescout-companion:tracker-hygiene" \
  && pass "nudge names the skill invocation" \
  || fail "nudge missing the skill name"

# Future date → silent.
printf -- '---\nkind: tracker\nstatus: active\ntitle: Tracker hygiene log\nnext-sweep-due: 2099-01-01\nsweep-interval-days: 30\n---\n# Tracker hygiene log\n' > "$LEDGER"
FUTURE=$(ctx startup)
if echo "$FUTURE" | grep -q "TRACKER HYGIENE"; then
  fail "future due date must not nudge"
else
  pass "future due date → silent"
fi

# Malformed date → silent (never nudge on garbage).
printf -- '---\nnext-sweep-due: soonish\n---\n' > "$LEDGER"
BAD=$(ctx startup)
if echo "$BAD" | grep -q "TRACKER HYGIENE"; then
  fail "malformed date must not nudge"
else
  pass "malformed date → silent"
fi
rm -f "$LEDGER"
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `run_command("bash codescout-companion/hooks/session-start.test.sh", workspace="/home/marius/work/claude/claude-plugins", timeout_secs=60)`
Expected: `FAIL: overdue ledger did not produce the hygiene nudge` and `FAIL: nudge missing the skill name`; the three silence tests pass vacuously; exit code 1. (If the harness prints `SKIP: codescout not configured`, the machine lacks codescout config — it doesn't; on this machine expect the FAILs.)

- [ ] **Step 3: Implement the nudge.** In `session-start.sh`, insert after the `SKILLS AVAILABLE` MSG block (after its closing `"` line, before the `# Statusline marker` comment):

```bash
# --- Tracker-hygiene overdue nudge ---
# Reads next-sweep-due from the project's hygiene ledger frontmatter (one file
# read, no git). Absent file or malformed date → silent. Contract:
# skills/tracker-hygiene/SKILL.md + references/tracker-hygiene-log-template.md.
HYGIENE_LOG="$CWD/docs/trackers/tracker-hygiene-log.md"
if [ -f "$HYGIENE_LOG" ]; then
  HYGIENE_DUE=$(grep -m1 '^next-sweep-due:' "$HYGIENE_LOG" 2>/dev/null \
    | sed 's/^next-sweep-due:[[:space:]]*//;s/[[:space:]]*$//')
  if [[ "$HYGIENE_DUE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    TODAY=$(date +%F)
    # ISO dates compare correctly as strings; due today counts as due.
    if [[ ! "$HYGIENE_DUE" > "$TODAY" ]]; then
      MSG="${MSG}TRACKER HYGIENE: sweep overdue (due ${HYGIENE_DUE}) — run /codescout-companion:tracker-hygiene

"
    fi
  fi
fi
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `run_command("bash codescout-companion/hooks/session-start.test.sh", workspace="/home/marius/work/claude/claude-plugins", timeout_secs=60)`
Expected: all PASS lines including the five new ones; `Fail: 0`; exit 0.

- [ ] **Step 5: Commit**

```bash
git -C /home/marius/work/claude/claude-plugins add codescout-companion/hooks/session-start.sh codescout-companion/hooks/session-start.test.sh
git -C /home/marius/work/claude/claude-plugins commit -m "feat(codescout-companion): SessionStart nudge when tracker-hygiene sweep overdue

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Docs + version bump

**Files:**
- Modify: `codescout-companion/README.md` (`## What It Does` bullets, `## Changelog`)
- Modify: `codescout-companion/.claude-plugin/plugin.json` (version `1.11.17` → `1.12.0`)
- Modify (cross-repo): `/home/marius/work/claude/codescout/docs/architecture/companion-plugin.md` — hook inventory line for session-start.sh

**Interfaces:**
- Consumes: shipped skill + nudge from Tasks 1–3.

- [ ] **Step 1: README "What It Does" bullet.** Via `edit_markdown` on `codescout-companion/README.md`, action=`edit`, heading=`## What It Does`, append this bullet after the `**Worktree guard**` line:

```markdown
- **Tracker hygiene** — `/codescout-companion:tracker-hygiene` runs a human-gated tracker-corpus sweep (staleness, index drift, archive discipline); SessionStart nudges when the project's ledger says a sweep is overdue
```

(Exact edit: `old_string` = the Worktree guard bullet line, `new_string` = that line + `\n` + the new bullet.)

- [ ] **Step 2: README changelog.** Insert a new subsection directly under the `## Changelog` heading (action=`insert_after`, at=`after-heading-line`):

```markdown
### 1.12.0

- New skill `tracker-hygiene`: periodic, human-gated tracker-corpus sweep — six detectors (index-drift, terminal-not-archived, stale-active, frontmatter-catalog-mismatch, canonical-conflict, augmentation-stale), per-project sweep ledger with HY-N self-improvement entries, per-detector batch-approval graduation.
- `session-start.sh`: one-line nudge when the project's `docs/trackers/tracker-hygiene-log.md` frontmatter says the next sweep is overdue.
```

- [ ] **Step 3: Bump plugin version.** `edit_file` on `codescout-companion/.claude-plugin/plugin.json`: `old_string` `"version": "1.11.17"` → `new_string` `"version": "1.12.0"`. (If the version has moved past 1.11.17 by execution time, bump minor from whatever is current instead.)

- [ ] **Step 4: Cross-repo hook inventory.** In `/home/marius/work/claude/codescout/docs/architecture/companion-plugin.md` (use `workspace="/home/marius/work/claude/codescout"`), find the session-start.sh row/section in the hook inventory and extend its purpose description with: `+ tracker-hygiene overdue nudge (reads next-sweep-due from docs/trackers/tracker-hygiene-log.md)`. Commit that repo separately — it is on branch `experiments`; verify with `git -C /home/marius/work/claude/codescout branch --show-current` first and do NOT commit if on `master`.

- [ ] **Step 5: Verify + commit (claude-plugins)**

Run: `run_command("jq -r .version codescout-companion/.claude-plugin/plugin.json", workspace="/home/marius/work/claude/claude-plugins")`
Expected: `1.12.0`

```bash
git -C /home/marius/work/claude/claude-plugins add codescout-companion/README.md codescout-companion/.claude-plugin/plugin.json
git -C /home/marius/work/claude/claude-plugins commit -m "docs(codescout-companion): README + changelog for tracker-hygiene; bump to 1.12.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

```bash
git -C /home/marius/work/claude/codescout add docs/architecture/companion-plugin.md
git -C /home/marius/work/claude/codescout commit -m "docs: companion hook inventory — tracker-hygiene overdue nudge in session-start

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Acceptance sweeps (interactive — run with the user present)

The spec's acceptance test is the first two live sweeps, with known ground
truth. **Do not run these from a subagent** — Phase 4 is interactive gating
with the human. This task is executed in a main session with the user.

**Files:**
- Create (via skill bootstrap): `/home/marius/work/mirela/backend-kotlin/docs/trackers/tracker-hygiene-log.md`
- Create (via skill bootstrap): `/home/marius/work/claude/codescout/docs/trackers/tracker-hygiene-log.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4, plugin reloaded (`/plugin` or session restart) so the new skill is loadable.

- [ ] **Step 1: Sweep backend-kotlin.** Invoke `Skill('codescout-companion:tracker-hygiene')` in a session at `/home/marius/work/mirela/backend-kotlin`.

Ground truth the sweep MUST find (D1), from the 2026-07-03 design recon: `chat-eval-session-log.md`, `iel-prod-solver-config.md`, `innovaplan-reconciliation-session-log.md`, `personalizzazione-subject-teacher-remodel.md`, `solver-trace-persistence-session-log.md`, `bulk-delete-lessons-session-log.md` — all live in `docs/trackers/` but absent from `docs/trackers/README.md`'s cluster map. If any drifted (fixed or new files added) since, the *current* declared-vs-observed diff is the ground truth — but zero D1 findings while the README still misses files is a **failed acceptance**.

Expected: D1 findings for the unmapped files; D2/D3 exercised across the ~22 live files; ledger bootstrapped; sweep entry + at least one HY-N entry written.

- [ ] **Step 2: Sweep codescout.** Invoke the skill in a session at `/home/marius/work/claude/codescout`.

Expected exercise: D2/D3 against the overdue Q2 archive-cadence pass (archive-eligible closed trackers), D9 against the augmented artifacts (`tool-usage-patterns`, `windows-platform-support`, `legibility-backlog`, ...). Ledger bootstrapped; sweep entry + HY-N entries written.

- [ ] **Step 3: Record the acceptance verdict.** In each project's ledger, the first sweep entry doubles as the acceptance record. If a detector produced zero true findings where ground truth existed, file an HY-N `miss` and fix the SKILL.md detector recipe before calling v1 shipped.

---

## Self-review notes (author)

- **Spec coverage:** template+ledger (Task 1), skill/loop/detectors/gating/graduation/degradation/stop-conditions (Task 2), nudge (Task 3), README/version/cross-repo docs (Task 4), validation runs (Task 5). Spec's "optional trigger eval" is deliberately not a task — optional in spec, deferred with the v2 items.
- **Type/contract consistency:** ledger path and `next-sweep-due:` key are identical strings in Tasks 1, 2, 3; the trust-table detector names match the SKILL.md detector table; `## Template for new entries` anchor matches between template and SKILL.md instructions.
- **Placeholder scan:** all steps carry full content; the only conditional ("if version moved past 1.11.17") is an execution-time reality guard, not a TBD.
