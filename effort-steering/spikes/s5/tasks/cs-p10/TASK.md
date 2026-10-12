# run_command must not hand a credential to its caller

## Background

`run_command` runs a shell command in the project and returns its output (`stdout`, `stderr`,
`exit_code`, and for some commands further keys). Output that is too large to return inline is
kept in a session buffer, and the response carries a handle for it (`output_id`, for example
`@cmd_1a2b3c4d`). A later `run_command` call reads the buffer back by naming the handle in a
command (`grep -n FAILED @cmd_1a2b3c4d`), and the server's other tools (`read_file`, `grep`) read
the same buffer directly by its handle, without running a command. A command run with
`run_in_background` returns a handle
(`@bg_...`) at once, and its output is read back later with a command such as `cat @bg_...`.

The tool is used by a language model. Everything `run_command` returns goes into that model's
context and into a plaintext transcript of the session.

## Observed

The tool returns exactly what the command printed. When the server's own environment holds a
secret, a command that prints it (`env`, `printenv GITHUB_TOKEN`) returns the secret in `stdout`.
The same happens for any command that prints a secret, on `stdout` or on `stderr`, and for output
the caller reads back later.

## Expected

Values of the four formats below are credentials. No part of one may appear in anything
`run_command` returns or keeps for the caller to read back later: the fields of the response, the
text stored in the buffers behind the handles it returns, and the output of a background job when it is read back
through `run_command`. This holds for `stdout` and `stderr`, for small output and for output large
enough to be buffered, for a command that ends in a filter stage (`| grep x`, `| head -1`) and one
that does not, and for foreground and background commands.

A value is the whole run of characters that has the format:

- GitHub token: `ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_` followed by 36 or more ASCII letters and
  digits.
- GitHub fine-grained token: `github_pat_` followed by 50 or more ASCII letters, digits and
  underscores.
- Secret API key: `sk-` at the start of a word (not directly after a letter, digit or
  underscore), followed by 20 or more ASCII letters, digits, underscores and hyphens. A key such
  as `sk-ant-api03-...` is one value.
- AWS access key id: `AKIA` or `ASIA` followed by 16 uppercase ASCII letters and digits.

Each value is replaced, as a whole, by a short placeholder of your choice that is not itself a
value of one of these formats. No part of the replaced value may remain: not a shortened form, and
not a tail left over from a value longer than the minimum. Everything else is returned exactly as
the command printed it: the text before and after the value on its line, the other lines, the
number of lines, and `exit_code`.

The command still runs. It is not refused, and it is not held back for confirmation, because of
what it prints.

## Constraints

- Output that holds no value of these formats is returned exactly as it is today: the same fields
  with the same values.
- Only these formats are credentials for this task. Text that is not one of them comes back
  untouched: a value one character short of a minimum, a prefix that is not listed (`ghx_...`),
  `sk-` inside a word such as `task-force-...` or `risk-assessment-...`, an assignment such as
  `PASSWORD=hunter2`, and a variable that merely has `TOKEN` in its name. A name never makes a value
  a credential; only the formats above do.
- Failures that are not about a credential (a command that does not parse, a rejected working
  directory, a timeout) keep their present behaviour.
- The tool inputs and the existing response keys keep their current shape. Whether the response
  also tells the caller that something was replaced is up to you.
- Out of scope: interactive mode (`interactive: true`, which needs an MCP client that answers
  prompts), and the background job's own log file on disk. Only what `run_command` returns when it
  reads that output back is in scope.
- Tests call the tool's own `call` method directly (`RunCommand.call(...)`), as the existing tests
  do. The result of that call must already be clean; a change that only filters what the MCP
  server layer sends further up does not satisfy this task.
- Existing tests must keep passing. Do not edit or weaken existing tests to get a green run.
- No new dependencies, and no change to `Cargo.toml` or `Cargo.lock`. The network is not
  available.
- The change belongs in production code. You may add tests of your own. A test must not contain a
  real secret or a secret-shaped literal: build the value when the test runs.
