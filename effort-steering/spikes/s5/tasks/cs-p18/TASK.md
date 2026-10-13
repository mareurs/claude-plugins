# Two calls that report success but must be refused

Two separate defects. In both, a call goes through although it must not.

## Part 1: `edit_file` and librarian-managed artifacts

### Background

codescout's librarian keeps a catalog of markdown artifacts (trackers, bug files, plans). A
markdown file is a **librarian-managed artifact** when:

- its first line is exactly `---`, and
- before the next line that is exactly `---` there is a line `id: <value>` where `<value>`,
  trimmed, is exactly 16 characters, each one of `0-9` or `a-f` (lower case).

```
---
id: abc513d3ee0f0b50
kind: tracker
---

# Title
```

Only the content of the file decides this; its name and its location do not. Such a file is
meant to be changed through `artifact(action="update", ...)`, which records the change in the
catalog (the artifact's `updated_at` moves and a `field_patch` event is written). A write made
straight to the file skips that, and the file and the catalog then disagree. Tools that refuse
such a write do it with an error whose message reads
`'<path>' is a librarian-managed artifact — do not read or edit it directly`, followed by a hint
that points at the `artifact` tool.

### Observed

1. `doc.md` holds the frontmatter above and the body `alpha alpha`.
2. `edit_file(path="doc.md", old_string="alpha", new_string="beta", replace_all=true)` returns
   `"ok"`, and the file now reads `beta beta`.
3. The catalog is not told: the artifact's `updated_at` keeps its old value and no `field_patch`
   event is recorded.

### Expected

- An `edit_file` call that would change a librarian-managed artifact is refused with the error
  above (its text contains `librarian-managed artifact`), and the file is byte-for-byte what it
  was before the call. This holds whatever the shape of the call, for files named `*.md` and for
  files named `*.markdown`.
- Anything `edit_file` refuses today stays refused.
- A file that is not a managed artifact is edited exactly as before, in every shape of call. That
  covers a file with no frontmatter, frontmatter without an `id:` line, and an `id:` whose value
  is not 16 lower-case hex characters (wrong length, upper-case letters, other characters).

## Part 2: `update_entry`

### Background

`artifact(action="update_entry", id=..., entry_collection=..., entry_id=..., fields={...})`
patches ONE row of a tracker's entry collection in place. `fields` holds the keys to set; a
`null` value deletes the key. The sibling action `append_entry` takes the whole new row in a
parameter called `entry`.

### Observed

1. A tracker's `tasks` collection holds the rows `T-1` and `T-2`, both with `status: open`.
2. `artifact(action="update_entry", id=<tracker>, entry_collection="tasks", entry_id="T-1",
   entry={"status": "done"})` succeeds and reports `changed_fields: []`. Row `T-1` is unchanged.
3. A call with `fields={}` does the same.

Nothing tells the caller that its patch was never applied.

### Expected

- An `update_entry` call whose patch is empty (`fields` absent, or `{}`) fails with an error and
  changes nothing.
- An `update_entry` call that carries `entry` and no `fields` fails with an error and changes
  nothing. `entry` is not accepted as another spelling of `fields`.
- Every other `update_entry` call behaves as before; a patch given in `fields` is applied as
  before.

## Constraints

- Call inputs, and the result of every call that succeeds today and keeps succeeding, keep their
  current shape.
- Existing tests must keep passing. Do not delete or weaken an existing assertion. A test may be
  adjusted only so that it still compiles against your change and checks the same behaviour.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own.

## Build and test

See `CLAUDE.md` in the repository root.
