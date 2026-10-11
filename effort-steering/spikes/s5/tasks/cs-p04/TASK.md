# A buffer handle must follow edits to its file

## Background

`read_file` on a large file does not return the whole text inline. It stores the text in a
server-side buffer and returns a handle such as `@file_1a2b3c4d`. A caller then reads
slices of the file through that handle (for example `read_file` with `path` set to the handle
plus `start_line` and `end_line`). One real file has one handle.

The design promise: a handle never serves text that is older than the file on disk. When the
file has changed since the text was stored, the next read through the handle returns the
current file content, without the caller having to read the file's path again.

## Observed

For some files, a read through the handle keeps returning the text from before an edit. The
caller gets no notice that anything changed, and the stale text is served until somebody
reads the file's path again. Most files behave correctly.

What the reports share: the affected files did not originate on this machine. They were
unpacked from an archive built on another host, or synced from a host whose clock is not in
step with this one, and then edited here in the ordinary way. Files created and edited only
on this machine have not shown the problem.

## Expected

After an ordinary edit (one that leaves the file's last-modified time at the current time),
the next read through the handle returns the edited text. This holds whatever last-modified
time the file carried when the handle took its text, and whichever read gave the handle that
text: the first read of the path, a later read of the path, or a read of the handle that
picked up an earlier change.

## Constraints

- The behaviour the buffer already has for files with ordinary timestamps must not change.
  In particular a handle still never regresses to older text because of a slow, late reader
  of an earlier version of the file, and a holder of a handle is still told once when a
  path read changed what the handle holds.
- The tool inputs and outputs keep their current shape.
- Existing tests must keep passing. Do not edit or weaken existing tests to get a green run.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own.
