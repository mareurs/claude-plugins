# run_command must run a command even when the temporary directory is unusable

## Background

`run_command` runs a shell command in the project and returns its output (`stdout`, `stderr`,
`exit_code`, and for some commands further keys).

## Observed

When the process's temporary directory cannot be written to (the disk or tmpfs is full, out of
inodes, read-only, or the directory is missing), some commands are refused with an operating
system error and nothing runs. Commands that end in a filter stage such as `| head -1` or
`| grep hi` are refused. Commands with no filter stage still run.

Reproduction scenario:

1. Start the tool with the `TMPDIR` environment variable pointing at a directory that does not
   exist and cannot be created (for example a path below a regular file). Creating a file in it
   fails the same way as in a full or read-only directory.
2. Call `run_command` with `echo hi | head -1`. The call fails and the command does not run.
3. Call `run_command` with `echo hi`. The command runs and returns `hi`.

## Expected

Step 2 behaves like step 3: the command runs, exits with its own exit code, and its output is
returned in the usual `stdout` field. The same holds for any command that ends in a filter
stage, whatever the filter is.

With an unusable temporary directory the response may omit keys that cannot be produced
without it. The command itself must not be lost.

## Constraints

- With a usable temporary directory the behaviour does not change: every command, including one
  that ends in a filter stage, returns the same response keys as before.
- Commands with no filter stage are unaffected.
- Failures that are not about the temporary directory (a command that does not parse, a
  rejected working directory, a timeout) keep their present behaviour.
- The tool inputs and the existing response keys keep their current shape.
- Existing tests must keep passing. Do not edit or weaken existing tests to get a green run.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own. A test must not rely on
  a full disk; a missing or unwritable directory is enough.
