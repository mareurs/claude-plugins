# A command that names a file handle must report that the file's text changed behind it

## Background

`read_file` on a large file does not return the whole text inline. It stores the text in a
server-side buffer and returns a handle such as `@file_1a2b3c4d` (the response field
`file_id`). One real file has one handle: reading the same path again returns the same
handle, and if the file changed in between, that one handle is brought up to the new text.

A caller can name a handle in a `run_command` command, for example `wc -c @file_1a2b3c4d`;
the server runs the command over the handle's text. When the file on disk has changed since
the handle's text was stored, the first command that names the handle starts its `stdout`
with this line, so the caller knows the bytes are not the ones it read before:

```
↻ @file_1a2b3c4d refreshed from disk (file changed since last read)
```

The line appears once per change, not on every later command.

## Observed

1. A large file is read by path. The response carries a handle `H`.
2. The file is edited on disk (different bytes, newer last-modified time).
3. `read_file` is called with the file's path again. It returns the same handle `H` and
   the new text.
4. A command that names `H`, such as `wc -c H`, now runs over the new text, but its
   `stdout` has no `↻ … refreshed from disk` line. The caller that kept `H` from step 1
   is never told that the text behind `H` changed. The next commands do not carry the line
   either.

## Expected

- After step 3, the first `run_command` command that names `H` starts its `stdout` with the
  `↻ H refreshed from disk …` line and runs over the new text.
- The second and later commands that name `H` do not repeat the line, until the file
  changes again.
- A path read that finds the file unchanged does not cause the line.
- The response to the path read in step 3 itself is not told about the change: it already
  contains the new text, and it does not carry a refresh notice.
- The behaviour that exists today stays: when the file changed and nobody read the path
  again, the first command that names `H` still re-reads the file and shows the line.

## Constraints

- The tool inputs and outputs keep their current shape. The text of the line stays as shown.
- Existing tests must keep passing. Do not edit or weaken existing tests to get a green run.
  The one exception: if an existing test asserts the behaviour described under Observed
  (no refresh reported when a read of the file's path was what brought new text into the
  handle), update that assertion to the expected behaviour above; do not touch any other
  assertion.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own.
