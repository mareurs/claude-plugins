# Task: an answer that is too large to return inline, from a tool that already stores its own result

## Background

Every tool answer is produced by `Tool::call_content`. It returns a list of content blocks; the
first block is a text (a JSON object, printed with indentation) and is what the caller reads.

The inline limit: a text is too large to return inline when `text.len() / 4 > 2_500`, that is at
10,004 bytes or more (the crate's `exceeds_inline_limit` is that check).

Normally an answer that is too large is stored in the server's output buffer and the caller
receives a short envelope instead: `output_id` (a new `@tool_...` handle), `summary`, `hint` and
`buffered_bytes`.

Some tools store their own result before they answer. `run_command` keeps the raw output of a
command behind a `@cmd_...` handle and answers with a small summary object that carries that
handle as its string field `output_id`. The caller reads the rest of the output through that
handle.

## Observed

Take a tool whose `call` returns, for example:

```json
{ "output_id": "@cmd_own1", "exit_code": 0, "diagnostic": "<40,000 bytes of text>" }
```

The serialized answer is over the inline limit, so `call_content` returns the generic envelope
with a `@tool_...` handle in place of the tool's answer. The caller now holds two handles for
one result: the tool's own handle is gone from `output_id` (at most it is named inside a summary
line), and a new handle points at a copy of an answer the caller was never shown.

## Expected

For an answer that is a JSON object with a string `output_id` and is over the inline limit:

1. **The tool's own handle is the only handle.** The first content block is the tool's own
   answer: a JSON object whose `output_id` is the tool's value, with no `buffered_bytes` key and
   no `@tool_` anywhere in its text.
2. **The answer fits.** The text of the first content block, exactly as the caller receives it
   (printed with indentation, with whatever notices the call adds, and after JSON escaping), is
   not over the inline limit. Escaping can make a string much longer than its raw length: a
   string of quote characters doubles in size.
3. **It is made to fit by shortening string fields of the top-level object**, under these rules:
   - a value that is not a string, and a string of 1,000 bytes or fewer, keeps its exact value;
   - a longer string may be shortened, but a shortened value is never under 1,000 bytes long;
     text with multi-byte characters is handled without error;
   - a shortened value still starts with the first bytes of the original, says that it was cut by
     containing the words `bytes shown` (the wording `run_command`'s summaries already use when
     they cut a stream), and contains the tool's own handle itself (its value, for example
     `@cmd_own1`, not the key name `output_id`), so that a reader who sees only that field knows
     where the rest is;
   - shorten only as much as is needed: start with the largest string, and if shortening it is
     enough for the answer to fit, every other field keeps its exact value.
4. **These stay as they are today:**
   - an answer without a string `output_id` is never shortened; when it is too large it is
     stored under a `@tool_...` handle as before;
   - an answer that is not over the inline limit is returned exactly as it is, even if it is
     close to the limit;
   - a tool whose `force_inline` returns true always gets its whole answer back inline;
   - when shortening within the rules of 3 cannot make the answer fit (for example the size is
     spread over many small fields), the answer is stored under a `@tool_...` handle as before,
     and that buffer holds the complete result as the tool returned it, not a shortened copy.

## Constraints

- Make the change in the crate's source. Do not edit existing tests to make them pass, and do not
  delete or weaken an assertion. You may add tests of your own.
- Do not rename an existing function, type or constant, and do not change the signature of an
  existing one: the existing tests call them.
- Do not add a dependency or change `Cargo.toml` or `Cargo.lock`. The network is not available.
- The tool inputs and the response keys of the existing tools keep their present shape.
- Keep the change focused on this behaviour.
