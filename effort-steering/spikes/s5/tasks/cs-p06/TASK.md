# Task: read_file offers a line range for omitted TOML keys that cannot be read

## Background

`read_file` called with only a `path` returns the whole file when it is small. When the file is
over the inline output limit, it returns a *summary* of the file instead, plus one buffer handle
(`@file_...`) for reading the rest in ranges. The summary shape depends on the file type. For a
TOML file with no table headers the summary lists the top-level keys, each with its line number.

When a listing of the summary is too long for the inline limit, its middle is cut. The answer then:

- says that entries were omitted (the phrase `entries omitted`) and shows the gap in the listing
  as a line of the form `... N keys omitted ...`;
- tells the caller how to read what was cut. That is either a ready-made range with real line
  numbers, which appears in up to three places: in the gap line as `(L<a>-L<b>)`, in the note as
  `(lines <a>-<b>)` and in the call `read_file(path="@file_...", start_line=<a>, end_line=<b>)`; or
  the generic form with placeholders, `start_line=N, end_line=M`, which carries no numbers.

The contract of a ready-made range with real numbers: it is a range (`a <= b`), `read_file` on the
`@file_...` handle accepts it, and the lines it returns are the omitted entries (every one of
them, and none of the entries the listing already shows).

## Observed

1. A TOML file of 20 flat keys, each 600 characters long (`kkk...k00 = 1`, `kkk...k01 = 1`, and
   so on), written from the last key to the first, is read with `read_file(path)`. The listing is
   cut and the answer offers a ready-made range whose start is greater than its end (around lines
   14 and 5). Calling `read_file` with that range fails with an "invalid line range" error.
2. The same file written with its keys in order at both ends but with the block in the middle
   written backwards (first six keys ascending, the next eight descending, the last six ascending)
   offers a range that is a valid range, but reading it returns only one of the eight omitted keys.

## Expected

- Every ready-made range with real numbers that an answer offers satisfies the contract above.
- When the omitted entries cannot be read as one block of lines, the answer carries no made-up
  numbers: it still says that entries were omitted, still shows the gap in the listing, and the
  generic form (`start_line=N, end_line=M`) remains available. Reading the file in ranges from its
  `@file_...` handle works as it always did.
- When the omitted keys are one block of lines (for example in a file written first key to last),
  the answer keeps offering the exact ready-made range for that block: its first line is the
  first omitted key and its last line is the last omitted key.
- Everything else is unchanged: the answer stays under the inline limit, holds exactly one buffer
  handle, keeps both ends of the listing, and keeps every structured field the summaries carry
  today (do not remove or rename a field). Other file types behave as before.

## Constraints

- Make the change in the crate's source. Do not edit existing tests to make them pass, and do not
  delete or weaken an assertion.
- Do not rename an existing function, type or constant, and do not change the signature of an
  existing one: the existing tests call them.
- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Keep the change focused on this behaviour.
