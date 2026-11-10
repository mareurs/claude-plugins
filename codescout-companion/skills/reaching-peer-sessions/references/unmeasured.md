# Unmeasured harness and OS pairs for reaching-peer-sessions

Read this file when `SKILL.md` Step 0 gives you a harness and operating system
that have no reference file of their own. The core rules in `SKILL.md` still apply.

## What is measured

Two pairs have a reference file. Each one was measured on Linux only.

- Claude Code on Linux: `references/claude-code-linux.md`
- Codex on Linux: `references/codex-linux.md`

## What is not measured

- OpenCode, on any operating system.
- Claude Code on macOS or on Windows.
- Codex on macOS or on Windows.

## What to do

1. Stop. Do not run the Enumerate or Deliver block of a Linux reference.
2. Tell the operator which harness and operating system you run in, and that no
   measured mechanics exist for that pair.
3. Wait for the operator. Do not guess an address, a path or a socket.

Do not adapt a Linux block. Both Linux blocks read `/proc`, and the Claude Code block
also reads a socket directory under `/run/user`. Nobody ran them on macOS or Windows.
A block that finds nothing makes the core's merge block print `no live sessions found`,
and that text looks like a true count of zero.

If your harness has its own peer listing or message tool, you may use it. Report the
result as a lower bound for the one account it covers, never as the whole population.
The core's `Boundary` section applies to every reply.

## How to add a pair

1. Measure the registry, the process table and the delivery path on that operating
   system. Record the date and the harness version in the new file.
2. Write `references/<harness>-<os>.md` with the headings `## Enumerate`,
   `## Identify me` and `## Deliver`. The Enumerate block prints data rows only, in
   the seven columns of `SKILL.md` Step 1.
3. Add one pointer line to `SKILL.md` Step 0 and remove the pair from the list above.
4. For a new harness, change the merge block in `SKILL.md`. It counts only the
   harness names `claude` and `codex`, so a row of any other harness prints in the
   table but is not in the summary.
5. Run `tests/test-peer-skill-split.sh`. Never write a dollar sign followed by a digit
   in a reference file: the harness replaces it with a word of the caller's own arguments.
