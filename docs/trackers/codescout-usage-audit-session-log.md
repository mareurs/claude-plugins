# Session Log — codescout-usage-audit

> **Purpose:** Two-sided observation log for the codescout tool-call usage
> audit (Pika + Dzo over `.codescout/usage.db`). Captures Pika usage
> frictions (U-N), reconnaissance frictions (F-N), and wins (W-N).
>
> **Scope note:** The Pika SKILL nominally splits U-N / H-N into
> `codescout-usage-frictions.md` / `codescout-usage-hookify.md`, but
> explicitly permits appending to a recon session-log location instead —
> done here, per INDEX.md's "fewer files" rule. One work stream, one file.

---

## Recorder reliability caveat (read before trusting any query)

`.codescout/usage.db` `tool_calls` has 17 columns, but four diagnostic
ones are **un-backfilled** and near-useless on this DB (captured as F-1):

| Column | Populated | Verdict |
|---|---|---|
| `err_family` | 1 / 362 errors | dead — do not group by it |
| `project_root` | null on 5377 / 5961 | DB-level project scoping unreliable; foreign `codescout`-repo reads interleave |
| `overflow_tokens` | 4 rows | sparse |
| `friction_target` | ~15 rows | sparse |
| `overflowed` | present | unreliable (Dzo SKILL already warns) |

**Reliable friction signal:** `outcome`, `error_msg` text, and
`output_json LIKE '%truncat%'` / `LIKE '%stored in @%'`. Every entry below
is sourced from those, not the dead columns.

---

## Pika Usage-Frictions Index (U-N)

| ID | Iron Law | Tool called | Should have called | Count (lifetime) | Severity | Status |
|----|----------|-------------|--------------------|-----------------:|----------|--------|
| U-1 | IL1 | `read_file` on source | `symbols(name=…, include_body=true)` | 45 rejections | med | open |
| U-2 | IL4 | `read_file` on markdown | `read_markdown` | 39 rejections | med | open |
| U-3 | IL5 | `edit_file` on markdown | `edit_markdown` | 29 rejections | med | open |
| U-4 | IL2 | `edit_file` with `def`/structural | `edit_code` | 22 rejections | med | open |
| U-5 | (search routing) | `grep` for concept lookup | `semantic_search` | 355 : 6 lifetime (156 : 3 last 7d) | low | open |

## Reconnaissance Frictions Index (F-N)

| ID | Date | Severity | Category | Status | Title |
|----|------|---------:|----------|--------|-------|
| F-1 | 2026-06-14 | med | codescout-tool | promoted-to-bug-tracker | `usage.db` diagnostic columns un-backfilled — mislead any tool that trusts `project_root`/`err_family` for scoping/classification |

## Wins Index (W-N)

| ID | Date | Impact | Pattern | Counterfactual | Status |
|----|------|-------:|---------|----------------|--------|
| W-1 | 2026-06-14 | high | Dzo re-read before acting on a recorded target | survey-skipping splits a clean cohesive file | validated |

---

## U-1 — `read_file` on source files (45×) — Iron Law 1

**When:** recurring across the 2026-05-15 → 06-14 window (whole-DB audit).
**Iron Law / pattern:** IL1 — source navigation is `symbols`, not raw reads.
**Tool called:** `read_file` on `.py`/`.rs`/… source overlapping a named symbol.
**Should have called:** `symbols(name=<sym>, include_body=true)`.
**Evidence:** 45 of 91 `read_file` errors are server rejections
`"source range overlaps named symbol(s): 'main' / 'parse_judge_output' /
'enforce' / 'guard_input' — hint: Use symbols(...)"`.
**Whistle delivered:** yes (server-side, every time).
**Recurrence:** 3rd+ (sustained habit over a month).
**Severity:** med — habit-forming, but self-correcting (server hint re-routes).
**Status:** open — see Hookify assessment (no client hook warranted).

## U-2 — `read_file` on markdown (39×) — Iron Law 4

**When:** same window.
**Iron Law / pattern:** IL4 — markdown reads go through `read_markdown`.
**Tool called:** `read_file` on `.md`.
**Should have called:** `read_markdown` (heading-addressed, size-adaptive).
**Evidence:** 39 of 91 `read_file` errors = `"Use read_markdown for markdown files"`.
**Whistle delivered:** yes (server-side).
**Recurrence:** 3rd+.
**Severity:** med.
**Status:** open.

## U-3 — `edit_file` on markdown (29×) — Iron Law 5

**When:** same window.
**Iron Law / pattern:** IL5 — markdown edits go through `edit_markdown`.
**Tool called:** `edit_file` on `.md`.
**Should have called:** `edit_markdown` (heading-addressed, batchable).
**Evidence:** 29 of 65 `edit_file` errors = `"Use edit_markdown for markdown files"`.
**Whistle delivered:** yes (server-side).
**Recurrence:** 3rd+.
**Severity:** med.
**Status:** open.

## U-4 — `edit_file` carrying a definition (22×) — Iron Law 2

**When:** same window.
**Iron Law / pattern:** IL2 — structural edits go through `edit_code` (LSP-aware).
**Tool called:** `edit_file` whose body contained `def `/`fn `/`class `.
**Should have called:** `edit_code(symbol, path, action=…)`.
**Evidence:** 22 of 65 `edit_file` errors = `"edit contains a symbol definition
("def ") — use symbol tools for structural changes — hint: edit_code(...)"`.
(8 more `edit_file` errors are `old_string not found` — a stale-match failure,
NOT wrong-tool; not counted here.)
**Whistle delivered:** yes (server-side).
**Recurrence:** 3rd+.
**Severity:** med.
**Status:** open.

## U-5 — `grep` used for concept search instead of `semantic_search`

**When:** same window; ratio holds in the last 7d (156 grep : 3 semantic).
**Iron Law / pattern:** search routing — "know concept → `semantic_search`".
**Tool called:** `grep` with guessed identifiers / alternations for intent lookup.
**Should have called:** `semantic_search(query)` for concept queries (grep stays
for exact strings/regex).
**Evidence:** lifetime `grep` 355 vs `semantic_search` 6. Not all 355 greps are
misroutes (many are legit exact-string searches), so severity is low and this is
a *judgment* nudge, not a hard rule — `semantic_search` being summoned only 6×
in a month is the smell.
**Whistle delivered:** advisory only (grep is a legitimate tool; no server reject).
**Recurrence:** sustained.
**Severity:** low.
**Status:** open.

## Hookify assessment (why no H-N graduated)

U-1..U-4 are **already enforced server-side** — the 135 rejections above ARE
codescout's enforcement, each carrying the corrective hint that re-routes the
next call. The `codescout-companion` guard deliberately scopes itself to
**native** tools (`Read`/`Grep`/`Edit`/`Bash`), leaving codescout's own
`read_file`/`edit_file` to self-enforce. A client-side hook duplicating that
would only save one round-trip per slip and risks double-whistling. **No
hookify recommended** (status would be `deferred — rejected by design`).
U-5 cannot be a `deny` hook (grep is legitimate); only a soft session-start
nudge could help, which is below the bar.

## F-1 — `usage.db` diagnostic columns un-backfilled

**Observed:** 2026-06-14, Pika+Dzo audit of `.codescout/usage.db`.
**When:** scoping the audit to this project — assumed `project_root` would filter.
**Expected:** `project_root`, `err_family`, `overflow_tokens`, `friction_target`
populated enough to group/scope on.
**Got:** `project_root` null on 5377/5961 (90%); `err_family` 1/362 errors;
`overflow_tokens` 4 rows; `friction_target` ~15 rows. The columns were added
after most rows were written and never backfilled. Scoping by `project_root`
silently drops 90% of rows; grouping errors by `err_family` shows one family.
**Probable cause:** schema migration added columns with defaults; no backfill
job; population is best-effort on new writes only. This is a **codescout-side**
data issue — the fix lives in the codescout Rust repo, not here.
**Workaround:** scope/classify via `output_json LIKE`, `error_msg` text, and
`outcome`. Treat the four columns as advisory-only until a codescout backfill ships.
**Severity:** med — misleads any consumer that trusts the columns (incl. a future
Pika/Dzo run); does not block, because reliable signals exist.
**Status:** promoted-to-bug-tracker — dealt with in the codescout repo (owning substrate), 2026-06-14. claude-plugins cannot verify the codescout-side fix from here; treat the four columns as advisory until a re-indexed `usage.db` confirms population on new rows.
**Fix idea / Pointer:** codescout repo `/home/marius/work/claude/codescout` — backfill
on index, or document the columns as new-rows-only.

## W-1 — Dzo re-read refuted a stale recorded target before any edit

**Observed:** 2026-06-14, Dzo half of the audit.
**Pattern:** Before reshaping a target the recorder flags, take a FRESH
`symbols`/`include_body` reading — never act on the logged truncation alone.
**Counterfactual:** `usage.db` showed `buddy/scripts/statusline.py` →
`_compose_rows`/`_truncate_visible` bodies truncating *repeatedly* across
sessions (the textbook over-budget-body signal, Heuristic 1). Acting on the log
would have split the file. The fresh read showed the bodies return **whole**
today (`_compose_rows` 46 lines, cohesive; file already decomposed into ~10
small functions since those rows were written). Only the file *overview* still
truncates, driven by codescout enumerating every local variable — a tool-output
verbosity artifact, not a code-shape defect. **Dzo verdict: no move.** A split
would have been Self-Trap 1 (Goodharting the overview) + Self-Trap 4 (acting on
a recalled reading) — churn on clean code.
**Confirming data points:**
1. Log: ≥6 `symbols(name=_compose_rows, include_body=true)` calls, each truncated.
2. Fresh read 2026-06-14: same body returns whole, 46 lines.
**Impact:** high — prevented a behavior-risking refactor of a cohesive file on
stale evidence.
**Promote-when:** a 2nd stale-recorder target is caught by a fresh re-read.
Then promote to the Dzo's Heuristics / a `legibility` memory:
"a logged truncation is not a live defect — re-read before reshaping."
**Status:** validated.

---

## Live state

```yaml
topic: codescout-usage-audit
status: open
opened: 2026-06-14
last_touched: 2026-06-14
counters: { U: 5, F: 1, W: 1, H: 0 }
done_condition: >
  Closes when U-1..U-5 land (whistle acknowledged / habit stops) AND F-1 is
  either fixed in codescout or promoted to a codescout issue. W-1 promotes on
  a 2nd datapoint.
```

## History

- 2026-06-14 — F-1 handed off and dealt with in the codescout repo (column population fixed at the source). Marked promoted-to-bug-tracker; not verifiable from claude-plugins.
- 2026-06-14 — Created. Pika+Dzo audit of `.codescout/usage.db` (5961 calls,
  2026-05-15 → 06-14). Captured U-1..U-5 (wrong-tool routing, server-enforced),
  F-1 (un-backfilled columns), W-1 (Dzo re-read refuted a stale statusline.py
  target). Hookify assessment: none warranted (server self-enforces).

## Template for new entries

(Copy a U-N / F-N / W-N block above; allocate the next monotonic ID; add the
Index row. U-N and F-N/W-N keep separate counters.)
