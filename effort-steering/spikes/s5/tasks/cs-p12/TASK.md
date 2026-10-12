# Task: read_file on a large file must answer with one buffer handle, whatever the file type

## Background

`read_file` called with only a `path` returns the whole file when it is small. When the file is
over the inline output limit, it returns a *summary* of the file instead, plus one buffer handle
(`@file_...`) that holds the whole file, so the rest can be read in line ranges with
`read_file(path="@file_...", start_line=N, end_line=M)`. The summary shape depends on the file type:
a symbol list for source files, headings for markdown, keys for JSON, sections for YAML and TOML,
a preview for config-style files (`.ini`, `.cfg`, `.xml`, ...), a head and a tail for everything else.

The answer of a tool call has an inline limit of 2,500 tokens, about 10,000 bytes of text
(`exceeds_inline_limit` in the crate is true when `text.len() / 4 > 2_500`). "The answer" below is
the text of the first content block that `ReadFile::call_content` returns.

Buffer handles come in kinds. `@file_...` is the handle of a real file's contents. `@tool_...` is a
handle the tool layer mints for a tool result; a read of a file should not need one.

## Observed

`read_file(path)` on a source file with a very large number of small functions (for example a
generated file with 1,500 one-line functions, about 21 KB) does not come back as an outline.
The answer names two buffer handles for the one read: the file's own `@file_...` and a `@tool_...`
one. Its hint tells the caller to extract a field of the `@tool_...` buffer with
`json_path="$.field"`, which reaches nothing.

The same happens for other large files, for example: a text file of a dozen lines that are several
thousand characters wide, an `.ini` file of 40 lines of 700 characters, a `.yaml` file with 30
top-level keys of 600 characters, a `.json` file that is not valid JSON and sits on one huge line.
Many other large files come back as one answer with one handle.

## Expected

For a source file, a plain-text file, a config-style file, a YAML file and a JSON file that does not parse, a read of a file over the inline limit returns an answer that:

- is under the inline limit;
- names exactly one buffer handle, the `@file_...` one, and no `@tool_...` handle;
- still describes the file. When part of a listing (symbols, headings, keys, sections) has to be
  cut to fit, the answer says so with the phrase `entries omitted`, and it keeps the first entries
  and the last entries of the listing: the middle is what is dropped. A listing is cut by dropping
  whole entries; an entry is never shortened;
- when a text field of the summary (the head, the tail, the preview of a config file) has to be
  shortened to fit, says so with the phrase `bytes shown`, and keeps the beginning and the end
  of that text: the middle is what is dropped;
- leaves the `@file_...` handle as it is: it holds the whole file, and reading line ranges from it
  returns the lines the summary left out.

A file whose summary already fits is answered exactly as before: every entry is listed and nothing
is reported as omitted. A file under the inline limit is read as before.

## Constraints

- Make the change in the crate's source. Do not edit existing tests to make them pass, and do not
  delete or weaken an assertion. You may add tests of your own.
- Do not rename an existing function, type or constant, and do not change the signature of an
  existing one: the existing tests call them.
- Do not remove or rename a field of the structured summaries that exists today (for example
  `symbols`, `line_count`, `file_id`, `overflow`).
- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Markdown files, which `read_file` reads through a separate path, and valid JSON files are outside
  this task: you need not change how they are read.
- Keep the change focused on this behaviour.
