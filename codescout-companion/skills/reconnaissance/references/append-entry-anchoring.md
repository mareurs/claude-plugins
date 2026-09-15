# Reconnaissance — `append_entry` index-row anchoring and the ledger guard

> **Load when:** you are about to write an F-N / W-N entry into a ledger whose
> index table you have not written to before, or `append_entry` refused your
> call and you need to know which of its several refusals you hit. The call
> itself, the severity rubric and the status vocabulary all stay in `SKILL.md`
> § Phase 3 — only the anchoring case law lives here.
>
> Split out of `SKILL.md` 2026-09-15, after verifying every claim against
> codescout's source rather than against the previous wording — three of the
> claims as written were wrong. Source citations are to the codescout repo.

---

## A row needs an anchor from somewhere

`index_row` is written in the same `fs::write` as the section, with `{id}`
replaced by the id just allocated (`augmentation.rs:1796`), so the section, the
high-water mark and the Index row land together. That is what "one call" means.
Omitting the two parameters silently gives you the two-call form instead.

But a row must be *placed*, and the placement anchor has two possible sources.

### Declared `snapshot_anchor` — prefer this

Declare it once in the ledger's own frontmatter, naming the index table's header
line verbatim:

```python
doc(action="update", id=…,
    patch={"extra": {"snapshot_anchor": "| ID | Date | … |"}})
```

From then on `index_row` **alone** lands every row at the anchored block's
**tail** — after the last existing row, not under the header
(`resolve_row_anchor`, `augmentation.rs:1481-1486`; `snapshot_block_last_line`,
`augmentation.rs:1221-1224`). Tail suits a newest-last ledger and not a
newest-first one; the ledger you are writing decides.

**It is also the safer source.** A declared anchor that matches more than one
line is **refused by name** (`augmentation.rs:1524-1537`, test
`snapshot_block_last_line_refuses_a_duplicate_anchor`). The per-call parameter
has no such protection — see below.

### Per-call `index_after_line` — wins when passed, but one failure is silent

It inserts after the **first** line equal to what you pass, whitespace-trimmed
(`insert_index_row`, `augmentation.rs:1454-1477`). Its two failures are not
alike, and the difference is the whole reason to read the table first:

| you pass | what happens | loud? |
|---|---|---|
| a line matching **several** rows | row lands after the **first** match — i.e. under the wrong table | **no — silent** |
| a line matching **nothing** | refused by name; ledger byte-identical; **no id consumed** | yes |

The silent case is deliberate, not a bug. The in-source comment says it: a table
separator is not unique across a ledger with several tables, and "silently
filling every one of them would be a worse outcome than refusing; the caller
picks the table by naming a line inside it."

So **never anchor on the `|---|---|` separator** — it repeats 9 times in one
live codescout ledger. If you must use the per-call form, name the target
table's **last existing row**, which is unique by construction since ids are.

The loud case is guaranteed, not best-effort: the error names the anchor and
states that "no id was allocated and nothing was written"
(`augmentation.rs:1802-1812`), because the `?` propagates before both the
`fs::write` and the transaction commit, and the reservation `INSERT` sits in an
`IMMEDIATE` transaction that rolls back on drop.

### The refusals, so you can tell them apart

- `index_after_line` with **no** `index_row` → refused: "there is no row to
  place" (`append_entry.rs:180-195`).
- `index_row` with **neither** anchor source → refused **by name**, naming
  `snapshot_anchor` (`augmentation.rs:1499-1508`).
- `index_row` with **no section** (`title` + `body` + `anchor_heading` absent) →
  refused: "`index_row` needs a section" (`append_entry.rs:150-160`).

## What `entry_prefix` actually locks

Declaring `entry_prefix` makes the librarian guard refuse `edit_file` on the
ledger across **every** grammar — heading, `old_string`/`new_string`, `insert`,
`edits[]` (`librarian_guard.rs:136-163`; `edit_file/mod.rs:807`). A fresh copy
of the template ships *without* it, which is why direct editing appears to work
right up until the ledger is guarded.

What that makes `append_entry` is the sole **id allocator** — not the sole
writer. The section body is written either by `append_entry` itself (pass
`title` + `body` + `anchor_heading` together) or, after a reserve-only call that
returns "the entry itself is yours to write", by
`doc(action="update", patch={body_edits: […]})` — which is also the path for
prose sections and index-table touch-ups (`librarian_guard.rs:192-199`).

## The definition shape `link_scan` accepts

`<ID>` + whitespace + a dash (`—`, `–`, or `-`) + whitespace + title, as a
heading's **first inline text** (`link_scan/extract.rs:319-322`).

Two consequences the old wording got wrong:

- **Heading level is not part of the rule.** There is no level predicate in the
  filter; `#### F-3 — x` defines exactly as well as `## F-3 — x`. The server
  writes at the ledger's own observed level (`augmentation.rs:1420-1421`) as a
  courtesy, not because `link_scan` requires it.
- **The token must come first.** A code-first heading — `` ### `F-3` — x `` —
  defines nothing (`extract.rs:388-393`). Table rows never define
  (`extract.rs:316-318`).
