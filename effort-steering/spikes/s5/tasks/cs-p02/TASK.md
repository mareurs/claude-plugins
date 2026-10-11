# Task: say what was found when `[*]` is used on a value that is not an array

`json_path` addresses a part of a JSON value held in a buffered tool result. Its `[*]` segment
projects the rest of the path over every element of an array. When the value in front of `[*]` is
not an array, the call is refused with a recoverable error whose message starts
`json_path '[*]' needs an array, found <type>`. The error a caller sees is that message together
with its hint.

## Observed

- `json_path` `$[*].name` on a buffered `run_command` result (a JSON object with the keys `type`,
  `exit_code`, `output_id` and `stdout`) answers `needs an array, found object`. Nothing in the error
  tells the caller what the object holds, so the caller cannot learn that the data they wanted is
  under `stdout`. The only way forward is another failed call.
- `json_path` `$.stdout[*]` on the same result answers `needs an array, found string`. Nothing tells
  the caller what kind of thing the string is or how big it is.

## Expected

1. Object. When `[*]` meets an object, the error still starts with
   `json_path '[*]' needs an array, found object`, and its hint names the keys the object has, so the
   caller can pick one. The key list is the same list the existing "path segment ... not found" error
   gives for a missing key: same keys, same order, same text for a long list (including how a long
   list is shortened and how the number left out is stated).
2. String. When `[*]` meets a string, the error still starts with
   `json_path '[*]' needs an array, found string`, and its hint says all of these:
   - how many bytes the string has, as a decimal number (a 1,234-byte string gives `1234`);
   - that the value is text and not an array (using the word `text`);
   - that JSON stored inside a string cannot be projected by `json_path` and is parsed with a shell
     tool such as `jq`.
3. Any other type (number, boolean, null) keeps its current error.

## Constraints

- The first sentence of the message (`json_path '[*]' needs an array, found <type>`) must stay exactly
  as it is: other code classifies the error by that text.
- Every other `json_path` error and every successful `json_path` result stays as it is.
- Do not add dependencies and do not change `Cargo.lock`.
- The existing tests must still pass.

## Build and test

See `CLAUDE.md` in the repository root.
