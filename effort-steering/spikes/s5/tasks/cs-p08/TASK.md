# Task: a buffer query over a stored command result whose stderr is very large

## Background

`run_command` keeps the full result of a command it ran in a server-side buffer, behind a handle
such as `@cmd_0bdbc0aa`. The buffer holds both streams: a bare handle reads stdout and the
handle with an `.err` suffix (`@cmd_0bdbc0aa.err`) reads stderr.

A later `run_command` whose command text names such a handle is a *buffer query*, for example
`grep -c PATTERN @cmd_0bdbc0aa` or `grep PATTERN @cmd_0bdbc0aa`. A buffer query runs, answers
inline and never creates a new `@cmd_...` handle. Its response carries the query's own `stdout`
and also the *stored* stderr of the buffered command in the `stderr` field, because a query that
finds nothing (`0`) cannot otherwise tell the reader whether the command had printed to stderr.

The contract for every tool answer: the whole response must stay under the tool's inline output
limit (2,500 tokens, about 10,000 bytes of text; `exceeds_inline_limit` in the crate is the check
the existing tests use). A response over that limit is stored a second time under a `@tool_...`
handle and the reader gets only a short envelope pointing at it.

## Observed

A command is run whose stderr is one very long line (about 50 KB). Its result is buffered under
`@cmd_...`. Then:

- `grep -c NOSUCHTOKEN @cmd_...` does not answer inline. The reader gets a `@tool_...` envelope
  (about 50 KB stored behind it) with a generic field hint, and the `0` the query produced is
  hidden inside it.
- `grep out @cmd_...` on a buffer whose stdout is several thousand lines long has the same
  outcome: the response is a `@tool_...` envelope and the query's own lines are not shown.
- The same happens when the stored stderr is twenty lines of about 700 bytes each (about 14 KB)
  and the query is the `grep -c` one.

A buffer whose stderr is small or short-lined answers inline, as it should.

## Expected

For such a buffer query:

- the response stays under the inline output limit and contains no `@tool_...` handle;
- the query's own answer is still there in `stdout` (the `0` count; for the long query, its first
  lines);
- `stderr` is still a string and still begins with the first bytes of the stored stderr, so a
  reader sees what the stream starts with (any note about a cut comes after those bytes, never
  before them);
- stderr that did not fit is announced as cut, and the response names the `@cmd_...` handle of the
  buffer that was queried, so the reader can fetch the rest from it (for stderr, with the `.err`
  suffix);
- a buffer query over stored stderr of ordinary size behaves exactly as it does today, including
  every field the response carries today;
- commands that are not buffer queries behave as before.

## Constraints

- Make the change in the crate's source. Do not edit existing tests to make them pass, and do not
  delete or weaken an assertion.
- Do not rename an existing function, type or constant, and do not change the signature of an
  existing one: the existing tests call them.
- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Keep the change focused on this behaviour.
