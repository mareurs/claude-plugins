# A read-only project must stay read-only for calls that did not ask otherwise

## Background

The `workspace` tool with `action: "activate"` makes a project the session's active project.
Its `path` argument names the project root and `read_only` is `true` or `false`. While the
active project is read-only, every tool that writes (for example `create_file`, `edit_file`, and
`memory` with `action: "write"`) is refused, and so is every tool that grants write access. The
refusal is an error result that says "File writes are disabled" and names the
project. A project whose own `.codescout/project.toml` sets `security.file_write_enabled = false`
refuses writes in the same way for as long as the server runs.

Every tool call can also carry an optional `workspace` argument: an absolute project path. The
call then runs against that project instead of the active one. Naming a project this way is the
caller's deliberate choice. It is how a caller writes to a project that was activated read-only,
and to a project that was never activated in this session.

## Observed

A project that was activated read-only starts to accept write calls that do not carry
`workspace`. Nobody called `workspace` with `action: "activate"` for it in between, and no config
file changed. The read-only setting is simply no longer in force, with no error and no notice.

## Expected

1. A write call that carries `workspace` naming a project activated read-only is accepted, as it
   is today. So is one naming a project that was never activated.
2. A write call that does not carry `workspace`, made after such a call, is refused exactly as it
   would have been before it: the same error, the same text, still naming the project.
3. Points 1 and 2 hold for every tool that writes or grants write access.
4. A project whose own config disables file writes stays closed to write calls that name it
   through `workspace`, as today.
5. Everything else about read-only activations stays as it is today. In particular,
   `workspace` with `action: "activate"` and `read_only: false` still makes the project
   writable again, and activating a different root is not blocked by the read-only state of the
   project that was active before.

## Constraints

- Tool inputs and results keep their current shape, and so does the wording of the refusal.
- A test that asserts a behaviour this task requires to change may be changed or replaced. Every
  other existing test must keep passing. Do not edit or weaken them to get a green run.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own.
