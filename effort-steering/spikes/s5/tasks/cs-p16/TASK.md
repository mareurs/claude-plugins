# A buffer handle for part of a file must keep that part

## Background

The server's file-reading tools do not always return what they read inline. When the text is too large, the server keeps it in a server-side buffer and returns a handle to it. A caller then reads slices of the handle, or greps it, instead of reading the file again.

## Observed

A handle created for 12 lines of a text file later reports 41 lines and serves different text.
This happened after one line was appended to the file. The response that created the handle
had described only those 12 lines, and nothing tells the caller that the handle now means
something else. Files that are not edited do not show it.

## Expected

For every handle that covers only part of a file:

- After the file changes in any way (a line appended, lines edited, the whole file rewritten or
  replaced by a different document), the handle still resolves.
- Reading it, or slicing it, returns exactly the text it was created with: the same lines, the
  same line count, the same first line. It does not take on text from the file as it is now,
  and it does not turn into an error.

## Constraints

- A handle created by reading a whole file keeps behaving exactly as it does today, also after
  the file changes.
- The tool inputs and outputs keep their current shape.
- Existing tests must keep passing. Do not edit or weaken existing tests to get a green run.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own.
