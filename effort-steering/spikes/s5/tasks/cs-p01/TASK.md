# Task: read_file on a JSON object with very wide keys

## Background

`read_file` called with only a `path` returns the whole file when it is small. When the file is
over the inline output limit, it returns a *summary* of the file instead, plus one buffer handle
(`@file_...`) for reading the rest in ranges. The summary shape depends on the file type
(source symbols, markdown headings, JSON keys, YAML/TOML sections, a generic head and tail).

The contract of that summary:

- the whole answer stays under the tool's inline output limit (2,500 tokens, about 10,000 bytes of
  text; `exceeds_inline_limit` in the crate is the check the existing tests use);
- a read yields exactly one buffer handle, the `@file_...` one. A second handle (`@tool_...`)
  means the answer was too large and got buffered a second time, which is a failure;
- a summary that is cut says so, and says how much: the answer contains the phrase
  `entries omitted`, and a listing that has a gap shows a line of the form
  `... N keys omitted ...` (for the symbol list it reads `... N symbols omitted (L59-L1442) ...`)
  at the point where the entries are missing;
- both ends of what is cut survive (the first and the last entries), the middle is dropped;
- a summary that already fits is returned untouched.

## Observed

A JSON file that is a valid object whose keys have very long names (for example 30 keys of 600
bytes each, so the file is about 18 KB) is read with `read_file(path)`. The answer is far over the
inline limit and carries two handles for one read: the tool's own `@file_...` and a `@tool_...`
buffer. Other large files (source files, wide YAML, wide config files, a single huge line) already
come back inline with one handle.

## Expected

For such a JSON file:

- the answer is under the inline limit and holds exactly one handle, an `@file_...` one;
- it says that entries were omitted (`entries omitted`), and the key listing shows the gap where it
  falls (`... N keys omitted ...`);
- the first keys and the last keys of the listing are kept;
- the structured summary keeps the fields the current summaries carry (for example the
  `total_...` and `..._truncated` fields next to a cut list); do not remove or rename a field that
  exists today;
- JSON files whose summary already fits, and every other file type, behave as before.

## Constraints

- Make the change in the crate's source. Do not edit existing tests to make them pass, and do not
  delete or weaken an assertion.
- Do not rename an existing function, type or constant, and do not change the signature of an
  existing one: the existing tests call them.
- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Keep the change focused on this behaviour.
