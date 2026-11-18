# The mapping: from inventory to a file the user approves

Read this at Step 2 (queries), Step 3 (proposal screen) and when a mapping key is unclear. The mapping format is in the codescout manual page `docs/manual/src/concepts/tracker-migration.md` (§ The mapping file). Where this page and the binary differ, the binary and the manual win.

## Read the inventory through jq

Run `inventory --json` once. The output is a `@cmd_*` buffer. Query the buffer; do not print it. The replay form is `jq <filter> @cmd_xxxx` (bounded left side, no `;` or `&&` after a pipe).

Each line below is one query. Replace `@cmd_xxxx` with the buffer name of the `inventory` call.

```text
# records per source
jq '[.sources[] | {path, line_count, n: (.records|length)}]' @cmd_xxxx
# status words and counts
jq '.sources[] | {path, status_values, no_status}' @cmd_xxxx
# rows with no heading, records with no row
jq '.sources[] | {path, row_only, no_row, duplicate_rows}' @cmd_xxxx
# possible records
jq '.sources[] | {path, possibles}' @cmd_xxxx
# repeated tokens
jq '.sources[] | {path, repeats}' @cmd_xxxx
# sections that are not records
jq '.sources[] | {path, sections}' @cmd_xxxx
# body versus index disagreements
jq '.sources[] | {path, disagreements}' @cmd_xxxx
# frontmatter that will be lost
jq '.sources[] | {path, dropped_frontmatter}' @cmd_xxxx
# files that name the source
jq '.mentions.code' @cmd_xxxx
# the sidecar and its prompt
jq '.sidecar' @cmd_xxxx
# records with a stated date
jq '.sources[].records[] | select((.stated_dates|length)>0) | {token, stated_dates}' @cmd_xxxx
```

The binary at hand may report `dropped_frontmatter` as `[]` for a source that has frontmatter. When the list is not empty, show it on the proposal screen and in the review.

## From inventory key to mapping key

| Inventory shows | Mapping key that settles it |
|---|---|
| `status_values` (each raw word) | `status_map`: every word to a declared status. A `{ constant = "..." }` status source needs none. |
| `no_status > 0` | `status_none` |
| `row_only` (token with a row and no heading) | `row_title_column`, and a dated `[overrides."<token>"] created` (a row-only record states no date, and apply refuses without one). Propose the date of the commit that added the index row: find the row's line (`git grep -n '| <token> |' HEAD -- <source>`), then `git blame -L <n>,<n> --date=short -- <source>`. Never copy a date from the worked example. |
| `no_row`, `disagreements` | listed in the review; `status_source` decides, `overrides` fixes one record |
| `possibles` (a token-shaped heading that is not a definition) | nested inside a record: `[[possibles_inside]]` with `source` and `line`; a record of its own: `records_extra` with `source`, `line`, `token`; inside a non-record section: `confirm = true` on that `[[sections]]` entry |
| `repeats` | a duplicate token that does not nest needs a decision from the user; `overrides` with `slug` resolves a name collision |
| `sections` (non-record) | one `[[sections]]` entry each: `source`, `start`, `to = "readme"` or `"drop"` |
| `tables` / two index tables for one token | `index_table = { source = "...", start = N }` |
| `mentions.code` | `code_mentions`: file to `reader`, `comment` or `fixture` |
| `sidecar` | `sidecar = "retire"` or `{ keep = "<reason>" }` |
| none of the above | `hot_cap` and `stale_after` in `[schema]`, or a top-level `hot_view_none = "<reason>"` |

Pre-class `mentions.code` before you ask: a file under `tests/` or `fixtures/` gets a proposed `fixture`. Any other file you do not classify yourself: ask. A `reader` stops the tracker: the reader's own plan must switch it first, so say that and stop.

## The proposal screen: ten parts, in this order

Show one screen. Fill every part from the inventory. Put what you are unsure about in part 10, not in questions before the screen.

1. **Target:** collection key, lifecycle (`ledgers`, `streams` or `temp`), `archived`, `existing`.
2. **Schema:** entry kinds, declared statuses with their class, `initial_status`, `hot_cap`, `stale_after` (or `hot_view_none`), with a one-line reason for each number.
3. **Status table:** raw value, declared status, class, count. Every `status_values` word has a row. Then `status_none` and how many records it covers.
4. **Overrides:** each record that gets a status, date or slug of its own, with the value and why. A row-only record's `created` is labelled "from blame of row line N" with the blame date.
5. **Possible records:** each `possibles` entry, the line, and the proposed handling.
6. **Sections:** each non-record section by start line, and `readme` or `drop`.
7. **Code mentions:** each `mentions.code` file with its proposed class. A `reader` is flagged.
8. **Sidecar:** its path and the proposed fate.
9. **Mapping path:** `$(git rev-parse --absolute-git-dir)/tracker-migration/<key>.toml`, and that it is never committed.
10. **Unsure:** what you could not settle, each as one line with your default. Then ask for approval.

## Worked example

The fixture `tests/lib/tracker-migration-fixture.sh` builds `docs/trackers/demo-log.md`: records `D-1`, `D-2`, the row-only `D-3`, a possible record `D-2b` nested in `D-2`, and a template section. Read the mapping below against the parts above:

- `status_map` covers both words the inventory reports (`open`, `fixed-verified`). `fixed-verified` maps to the declared status `fixed`.
- `D-3` has an index row and no heading, so it needs `row_title_column`, and it states no date, so `[overrides."D-3"]` sets `created`. The fixture's `2026-01-12` is only the blame date of the fixture's own D-3 row (line 17, the fixture commit is pinned to that date); a real tracker takes its own date from blame.
- `D-2b` (line 33) sits inside `D-2`, so `[[possibles_inside]]` keeps it there. It is not a `sections` entry.
- Four `sections` entries. The inventory lists the blank lead-in at line 6 (after the source frontmatter) as a section of its own, and the three headings that are not records: `# Demo log` (line 7), `## Index` (line 11) and `## Template for new entries` (line 37). Line 6 and the index table (line 11; its rows are carried as `**Index row:**` lines) are dropped. The sections that carry text (lines 7 and 37) go to `to = "readme"`, so apply copies them; you do not retype them.
- `readme_body` is one purpose sentence that you write. Never paste a source section into it.
- `scripts/demo-reader.json` is outside `tests/` and `fixtures/`, so the skill asks; the user answered `fixture`. The sidecar is retired.

The test `migrating-trackers.test.sh` extracts the fence between the markers and runs it against a fresh fixture: `apply` exits 0 and `check` is clean.

<!-- example-mapping:start -->
```toml
readme_body = "Findings of the demo log."
status_source = "body_label"
status_none = "open"
entry_kind = "finding"
row_title_column = "title"
sidecar = "retire"

[[sources]]
path = "docs/trackers/demo-log.md"
kind = "file"

[target]
lifecycle = "ledgers"

[schema]
entry_kinds = ["finding"]
initial_status = "open"
hot_cap = 10
stale_after = "30d"

[schema.statuses]
open = "open"
fixed = "terminal"

[status_map]
open = "open"
fixed-verified = "fixed"

[[possibles_inside]]
source = "docs/trackers/demo-log.md"
line = 33

[[sections]]
source = "docs/trackers/demo-log.md"
start = 6
to = "drop"

[[sections]]
source = "docs/trackers/demo-log.md"
start = 7
to = "readme"

[[sections]]
source = "docs/trackers/demo-log.md"
start = 11
to = "drop"

[[sections]]
source = "docs/trackers/demo-log.md"
start = 37
to = "readme"

[code_mentions]
"scripts/demo-reader.json" = "fixture"

[overrides."D-3"]
created = "2026-01-12"
```
<!-- example-mapping:end -->
