# Statusline Side-by-Side Layout — Design

Date: 2026-05-22
Scope: `buddy/scripts/statusline.py` only (no shell-layer changes)
Status: draft

## Problem

When many specialists are summoned (`active_specialists` ≥ 3) plus recon counters
plus plan/codescout verdict bubbles, the single label line beneath the buddy
ASCII art overflows the terminal width and wraps onto unpredictable extra rows.
Meanwhile the vertical column to the right of the ASCII art (~7 cols wide × 3–5
rows tall) sits empty.

Today's layout:

```
{env strip}
   .~~.
  (°‿°)
   \_/
  ~~~~~
 Owl · flow · debugging-yeti, refactoring-yak, testing-snow-leopard, … [recon] [ok] plan-text [cs!] cs-text
 ^^^^^ unbounded line, wraps unpredictably
```

## Goal

Stack label segments in the right column of the buddy ASCII art, with fixed
per-row slot assignment. Adaptive specialist display: full labels for 1–2
specialists, role names for 3+. Adaptive width: detect terminal width and
truncate the specialists segment first when the right column still overflows.

Target layout:

```
{env strip}
   .~~.   Owl · flow
  (°‿°)   architect, tester, security
   \_/    [recon F2]
  ~~~~~   [ok] plan-on-track
         [cs!] iron-law-2
```

## Non-Goals

- No change to `statusline-composed.sh` (rate-limit cache, primary fan-out,
  caveman badge layers remain unchanged).
- No change to `bodhisattvas.json` ASCII art shapes.
- No new statusline mode or env toggle. Layout becomes the default.
- No change to verdict / recon / cs-judge data sources or freshness logic.

## Architecture

Single-file change zone: `buddy/scripts/statusline.py`.

New units added inside the file:

| Unit | Purpose |
|---|---|
| `SPECIALIST_ROLE` (constant dict) | Compact role-name table used when 3+ specialists are active. |
| `_terminal_width()` | Read `COLUMNS` env, fall back to `shutil.get_terminal_size().columns`, then 80. |
| `_visible_width(s)` | Visible-char count after stripping `\x1b\[[0-9;]*m` CSI escapes. |
| `_format_specialists(active, pairs)` | Adaptive specialist text. ≤2 → comma-joined full labels. ≥3 → role names. |
| `_compose_segments(...)` | Build the ordered right-column segment list. |
| `_compose_rows(base, segments, term_w)` | Pad ASCII art to common anchor, append segment per row, truncate specialists first when right column overflows. |

`render()` is rewritten: it computes segments, composes rows, returns the
multi-row string. The old `label = " · ".join(label_parts)` /
`f"{base}\n {label}"` is replaced.

## Specialist role table

```python
SPECIALIST_ROLE = {
    "debugging-yeti": "debugger",
    "refactoring-yak": "refactorer",
    "testing-snow-leopard": "tester",
    "performance-lammergeier": "perf",
    "security-ibex": "security",
    "architecture-snow-lion": "architect",
    "planning-crane": "planner",
    "docs-lotus-frog": "docs",
    "data-leakage-snow-pheasant": "leakage",
    "ml-training-takin": "ml",
}
```

Fallback for unknown slug → `SPECIALIST_SHORT[slug]` if present, else slug
unchanged.

## Slot mapping

The right column is composed top-to-bottom in a fixed slot order. Slot index =
row offset from the env-strip row (slot 0 = env row, intentionally blank).

| Slot | Content | Present when |
|---|---|---|
| 0 | empty (env strip occupies row 0 alone) | always |
| 1 | `{form_label} · {mood}` | always |
| 2 | specialists | `state.active_specialists` non-empty |
| 3 | suggested specialist + recon badge | `derive_mood` returned a suggestion **or** recon-loaded/active marker exists. When both present, space-joined into one line. |
| 4 | plan verdict bubble | `fresh_verdict()` non-None on `verdicts.json` |
| 5 | codescout verdict bubble | `fresh_verdict()` non-None on `cs_verdicts.json` |

Trailing-empty rule: empty slots at the **end** of the list are dropped (no
blank trailing rows). Empty slots in the **middle** stay in place — they
render as the art row with an empty right column, preserving the pinned-slot
property (specialists missing → recon still appears on its row, not shifted
up). The slot-0 sentinel (env strip row) is always-empty by design and is
preserved by the trailing-empty drop's scan-from-end-stop-at-non-empty
semantics.

## ASCII art height variation

Bodhisattvas use art with 3–5 rows after the env-strip row. The renderer:

1. Splits `base` into lines.
2. Computes anchor = `max(_visible_width(row) for row in art_rows) + 2`.
3. For each row index `i` in `range(max(len(art_rows), len(segments)))`:
   - art piece = `art_rows[i]` if `i < len(art_rows)` else `""`.
   - segment = `segments[i]` if `i < len(segments)` else `""`.
   - Pad art piece with spaces to anchor; append segment.
   - If both are empty, skip the row.

Lines are joined with `\n`. Trailing `\n` is **not** emitted (matches today's
contract).

## Width budget & truncation

```
term_w = _terminal_width()
right_budget = max(term_w - anchor, 20)
```

When the longest segment's visible width exceeds `right_budget`:

1. Identify the specialists slot index. If it exceeds budget, truncate to
   `right_budget - 1` visible chars and append `…`.
2. Recompute longest segment. If it still exceeds budget, every other segment
   that exceeds budget is truncated the same way (specialists is just first
   in priority).

Truncation strategy is byte-substring on the visible-char count. Since
specialists, recon, and verdict bubbles currently each have at most one ANSI
color span surrounding the whole segment (recon and bubbles) or none
(specialists), substring truncation cannot land inside a CSI sequence. The
`_visible_width` regex confirms the truncation cap is measured correctly. We
do not attempt to balance unclosed CSI codes — the renderer asserts that
trailing reset codes survive truncation by truncating the visible prefix
only and re-appending `RESET` when the original ended with one. Verdict
bubbles already terminate with `RESET`; specialists carry no ANSI.

## Terminal width detection

Order of precedence:

1. `os.environ.get("COLUMNS")` if int-parseable and > 0.
2. `shutil.get_terminal_size((80, 24)).columns`.
3. 80 (constant fallback for the `OSError` path).

CC sets `COLUMNS` when it invokes the statusline command, so step 1 is the
fast path. Step 2 covers manual `cat | python statusline.py` testing.

## Edge cases

| Case | Behavior |
|---|---|
| No `active_specialists` | Specialists slot empty; subsequent slots stay pinned. |
| `resolve_labels` raises | Fallback to `", ".join(active)` (today's behavior). |
| Bodhisattva form name missing in `bodhisattvas` dict | Return `f"· {name} · {mood}"` single-line (today's behavior, bypasses new layout). |
| Terminal width < anchor + 20 | `right_budget` clamped to 20; truncation aggressive. |
| ANSI codes inside segment | `_visible_width` strips CSI; truncation respects visible chars. |
| All segments empty (no specialists, no recon, no verdict, no suggestion) | Only slot 1 (form · mood) renders. Art renders alongside it. |
| Empty middle slot (e.g. no specialists, recon present) | Slot 2's art row prints with empty right column; recon still on its pinned slot-3 row. |
| Art has more rows than segments | Excess art rows render with empty right column. |
| Segments outnumber art rows | Excess segments render on bare rows (anchor padding only, no art). |

## Backward compatibility

`statusline-composed.sh` is unchanged. The contract between it and
`statusline.py` (read stdin JSON, write multi-line statusline to stdout, no
trailing newline) is unchanged. Composed output today is `primary →
buddy(2 rows) → caveman?`; after this change it is `primary →
buddy(N rows) → caveman?` where N = `max(art_rows, segment_count)`.

For the common 1–2-specialist case, N is the same as today (~5 rows). For
worst case (many specialists, recon counts, both bubbles), N is ~5–6 rows vs
today's 5 art rows + wrapped 2–3-row label = 7–8 visible rows. Net visual
height is ≤ today's, often less.

## Test plan

New file: `buddy/tests/test_statusline_layout.py`.

Test cases:

- `test_specialists_full_when_two_or_fewer` — assert full labels appear in
  the output for `len(active) ∈ {1, 2}`.
- `test_specialists_role_names_when_three_or_more` — assert role names from
  `SPECIALIST_ROLE` appear for `len(active) ≥ 3`.
- `test_segments_pin_to_fixed_rows_with_gap` — empty slot 3 with content in
  slot 4 → blank line at slot 3 preserved.
- `test_truncation_targets_specialists_first` — width forced narrow; assert
  specialists segment carries `…` while recon segment is unchanged.
- `test_truncation_ellipsis_inserted` — assert truncated string ends with
  `…` and visible width ≤ budget.
- `test_terminal_width_env_overrides_shutil` — set `COLUMNS=40`; assert
  truncation behaves at that width.
- `test_short_art_fewer_rows_than_segments` — 3-row art + 5 segments → 5
  output rows.
- `test_tall_art_fewer_segments_than_rows` — 5-row art + 2 segments → 5
  output rows, last 3 with empty right column.
- `test_fallback_no_form_returns_single_line` — `identity.form` absent from
  `bodhisattvas` → output is the single fallback line, no new layout.
- `test_ansi_visible_width_strips_csi` — `_visible_width("\x1b[31mok\x1b[0m")
  == 2`.
- `test_trailing_empty_segment_dropped` — slot 5 empty → output row count
  matches non-empty slots only.
- `test_middle_empty_segment_preserved` — slot 3 empty, slots 1, 2, 4
  populated → 4 rows of output, slot 3 row has art piece + empty right
  column.

All tests use synthetic `bodhisattvas` dicts and synthetic state. No verdict
file I/O — tests pass mock segment lists into `_compose_rows` directly where
that exercises the relevant path; the broader integration test passes a
crafted state into `render()`.

## Files touched

- `buddy/scripts/statusline.py` — render rewrite + new helpers.
- `buddy/tests/test_statusline_layout.py` — new test file.

Not touched:
- `buddy/scripts/statusline-composed.sh`
- `buddy/data/bodhisattvas.json`
- `buddy/data/environment.json`
- Any hook script

## Open questions

None at design time. Truncation priority (specialists first) was settled
during brainstorming; role-name table is exhaustive over today's specialist
roster; width-detection precedence is fixed.

## Risks

- **CC may not export `COLUMNS`.** If unset, `shutil.get_terminal_size()`
  returns terminal default; CC statusline runs in a subprocess that may have
  a different `tput cols` than the visible terminal. Mitigation: 80-col
  fallback is conservative; truncation will be eager but not break layout.
  Empirical check during implementation: read `os.environ` dump from a live
  CC session before relying on `COLUMNS`.
- **ANSI code interaction with truncation.** Specialists segment has no ANSI
  today, so truncation can't land mid-CSI. If a future segment adds ANSI
  inside the truncation target, the implementation will need a CSI-aware
  walker. Mitigation: the regex-based `_visible_width` is the foundation for
  that future walker; flagged in code comment.
