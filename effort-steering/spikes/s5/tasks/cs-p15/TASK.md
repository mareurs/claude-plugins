# Task: a code block that shows another code block must stay one block

## Background

The server reads and edits Markdown files by heading.

- `read_markdown` returns the headings of a file and, given `heading`, one section. The headings
  also appear in the `Available headings:` list of a heading-not-found error.
- `edit_markdown` edits one section named by its heading: `replace`, `insert_before`,
  `insert_after`, `remove`, and `edit`, which swaps `old_string` for `new_string` only inside that
  section.
- A section runs from its heading line up to, not including, the next heading of the same or a
  higher level (the same number of `#`, or fewer).
- `replace` on a section that has sub-headings is refused unless `include_subsections` is set, and
  the refusal lists the sub-headings that the replace would remove.

A line that starts with `#` is a heading only when it is not inside a fenced code block, so a `#`
comment in a code sample is not a heading. A code fence that is opened and never closed is treated
as plain text, so that a half-written fence does not hide the headings after it.

## Observed

Take this document (every line of it is shown indented by eight spaces; remove them to get the file):

        ## Task

        ````markdown
        # Page Title

        ```toml
        # settings.toml
        ```
        ````

        Prose after the sample.

        ### Real Child

        ## Next
        next body

The `## Task` section holds a code block, and the sample inside that block has code blocks of its
own. Everything from the line that opens the outer block (the one that says `markdown`) to the line
that closes it is code.

- The headings the tools report for this document include `# settings.toml`, a comment line of the
  sample.
- `read_markdown` with `heading` set to `## Task` returns the section only up to just before that
  line. `Prose after the sample.` and `### Real Child` are missing from it.
- `edit_markdown` with `action` `edit` on `## Task` and an `old_string` taken from
  `Prose after the sample.` fails with `old_string not found in section '## Task'`, although the
  text is in the file and in that section.
- `replace` on `## Task` is not refused, although `### Real Child` is a sub-heading of it. It
  deletes only the part before `# settings.toml` and leaves the rest of the code block behind.
- Headings inside a block fenced with `~~~` are reported as headings.

## Expected

1. For the document above the headings are `## Task`, `### Real Child` and `## Next`, and only
   those.
2. `## Task` is the section from its heading to the line before `## Next`. It holds the whole code
   block, `Prose after the sample.` and `### Real Child`.
3. `edit` on `## Task` with `old_string` `Prose after the sample.` replaces that text, leaves the
   code block byte for byte as it was, and leaves `## Next` and `next body` alone.
4. `replace` on `## Task` without `include_subsections` is refused, and the refusal lists exactly
   one nested heading, `### Real Child`. No line of a code block is ever listed as a nested
   heading, and a section whose only `#` lines are inside code blocks has no nested headings.
5. A block fenced with tildes is a code block too. In

        # Guide
        ~~~sh
        ```
        ## shown inside
        ~~~
        ## Usage

   the headings are `# Guide` and `## Usage`: the line of backticks is part of the tilde block, and
   `## shown inside` is not a heading.

## Constraints

- A document without nested or tilde blocks gives the same headings, sections and edits as it does
  today.
- A fence that is opened and never closed keeps its present behaviour: it is plain text, and the
  headings after it stay visible and addressable.
- Do not edit or weaken existing tests; they must keep passing. You may add tests of your own.
- Do not add dependencies and do not change `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code.

## Build and test

See `CLAUDE.md` in the repository root.
