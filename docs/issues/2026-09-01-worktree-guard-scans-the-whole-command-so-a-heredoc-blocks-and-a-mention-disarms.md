---
kind: bug
status: open
title: git-worktree-guard regexes the whole command string, so a heredoc body blocks and a mentioned escape disarms
opened: 2026-09-01
owner: marius
severity: med
---

## Summary

`codescout-companion/hooks/git-worktree-guard.mjs` decides whether a Bash call is a
worktree-ambiguous git mutation by running four regexes over
`input.tool_input.command` **as one undifferentiated string**. It never tokenises, so it
cannot tell a command from data that looks like one, and it cannot tell *which* of several
commands an escape belongs to.

That yields two failures in opposite directions from a single root, both verified against
the real hook:

- **No escape.** A command whose *content* contains `git commit` — writing a shell script,
  a test fixture, a doc example — is blocked, though the only git verb in it is text being
  written to a file.
- **The escape is over-broad and disarms the guard.** Any substring matching
  `git -C <path> <verb>` exits the hook 0 for the **entire** call, so a bare `git commit`
  alongside it runs unguarded. A mere *mention* inside an `echo` string is enough.

The second is the serious one: the guard's own documented workaround, appearing anywhere in
a command, silently turns the guard off for everything else in that command.

## Symptom (Effect)

Blocked while writing a test file for `codescout:tests/hooks-discrimination.sh` — a suite
that necessarily contains `git commit`, `git add` and `git reset` as **fixture content**.
The heredoc carrying the file body was scanned as if it were the command:

```
⛔ Worktree-ambiguous git mutation. BLOCKED.
Command: cat > /tmp/.../section.sh <<'OUTER'
         ... git commit -qm base ...
```

There is no way to write that file through Bash. The only workarounds are to use a
non-Bash write tool, or to obfuscate the literal — i.e. to corrupt the artifact to satisfy
the scanner.

## Reproduction

Verified 2026-09-01 by driving the hook directly, in a checkout with ≥2 worktrees.
**Positive control first, because three earlier probe attempts returned a uniform `pass`
for unrelated reasons** — the hook requires `tool_name == "Bash"`, requires `cwd` (the
single-worktree carve-out silently exits when `git worktree list` fails), and signals a
denial on **stdout** while always exiting `0`. Any probe missing one of those reads
"allowed" for every input, which is indistinguishable from a guard that does nothing.

```bash
G=codescout-companion/hooks/git-worktree-guard.mjs
R=/path/to/a/repo/with/two/worktrees
probe() { printf '%s' "$2" | node "$G" 2>/dev/null | grep -c BLOCKED; }

# controls — the instrument must be able to say both words
probe c1 "{\"tool_name\":\"Bash\",\"cwd\":\"$R\",\"tool_input\":{\"command\":\"git commit -m x\"}}"
#   -> 1  BLOCK   (correct)
probe c2 "{\"tool_name\":\"Bash\",\"cwd\":\"$R\",\"tool_input\":{\"command\":\"git -C $R commit -m x\"}}"
#   -> 0  pass    (correct)

# (a) no escape: the verb is DATA being written to a file
probe a "{\"tool_name\":\"Bash\",\"cwd\":\"$R\",\"tool_input\":{\"command\":\"cat > t.sh <<EOF\ngit commit -qm base\nEOF\"}}"
#   -> 1  BLOCK   (wrong)

# (b) over-broad escape: the bare commit runs unguarded
probe b "{\"tool_name\":\"Bash\",\"cwd\":\"$R\",\"tool_input\":{\"command\":\"git -C $R commit -m a && git commit -m b\"}}"
#   -> 0  pass    (wrong)

# (c) worse: a STRING mentioning the escape is enough
probe c "{\"tool_name\":\"Bash\",\"cwd\":\"$R\",\"tool_input\":{\"command\":\"echo 'see git -C x commit' ; git commit -m b\"}}"
#   -> 0  pass    (wrong)
```

## Root cause

`git-worktree-guard.mjs:13-26`, four whole-string tests against one flat `cmd`:

```js
const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/git\s+(commit|push|reset\s+--hard|rebase|merge|checkout\s+-b)\b/.test(cmd)) process.exit(0);
if (/git\s+-C\s+\S+\s+(commit|push|reset|rebase|merge|checkout)\b/.test(cmd))     process.exit(0);
if (/(^|;|&&|\|\|)\s*cd\s+\S+\s*&&\s*git\b/.test(cmd))                            process.exit(0);
```

`.test()` asks *"does this string contain…"*. The guard needs *"is this **command**…"*.
Line 20 finds the trigger anywhere, including inside quoted data; lines 23 and 26 find the
exemption anywhere, including in a different command from the one that triggered it. The
trigger and its exemption are evaluated against **different commands** with nothing
noticing.

Note line 26 (`cd X && git`) is anchored on `^|;|&&|\|\|` and so is closer to correct — it
at least requires the `cd` to begin a command. Line 23 has no anchor at all. That the
author anchored one and not the other is the tell that the model here is *ad-hoc string
shape*, not *command structure*.

## Class

`codescout:docs/trackers/issue-clusters.md` **IC-6** — *Parsers Over a Namespace: owe an
escape and a disambiguator*. codescout's `CLAUDE.md` records the heredoc tell explicitly:

> Four independent shell gates — IL-3's pipe limiter, the dangerous-command gate, the
> source-file gate, and `run_command`'s pipe instrumentation — each separately decided a
> heredoc body was command text, and each was fixed separately. A construct that exists
> *precisely* to mean "this is data, not syntax" will be misread by every scanner in the
> process, on its own schedule.

This is a **fifth** instance, and the first outside codescout's Rust — a different repo, a
different language, a different author. The prediction that every scanner in the process
makes this mistake independently now holds across two codebases.

It also carries **both halves** the cluster demands, which the four Rust instances did not:
no escape (a) *and* a broken disambiguator (b/c). The second half is what makes this a
safety bug rather than an annoyance.

## Fix

Split on command separators before testing, and evaluate each segment independently:

- Strip heredoc bodies first — from `<<[-]?['"]?WORD` to the terminator line — since their
  content is by definition data. Same for `$(...)`-free single-quoted strings if cheap.
- Split the remainder on `;`, `&&`, `||`, `|`, and newlines.
- Apply the trigger and both exemptions **per segment**. A segment that triggers and is not
  itself exempt is a violation, regardless of its neighbours.

Then (a) stops blocking, because a heredoc body is no longer command text, and (b)/(c) stop
passing, because the exemption no longer travels between commands.

**Do not fix (a) alone.** Loosening the trigger without anchoring the exemption leaves the
disarm intact and looks like a fix — and the disarm is the half with a security cost.

## Tests to add

`tests/test-git-worktree-guard.sh` exists; it has no case for either half.

1. A heredoc whose body contains `git commit` → **allowed** (the escape).
2. `git -C <p> commit && git commit` → **blocked** (the disambiguator).
3. `echo "git -C x commit"; git commit` → **blocked** (exemption from a string).
4. Existing behaviour unchanged: bare `git commit` blocked, `git -C <p> commit` alone allowed.

Each fixture must assert on **stdout containing `BLOCKED`**, never on the exit code — the
hook always exits `0`, so an exit-code assertion passes for every input and is unable to
fail. Fixtures must also set `tool_name` and `cwd`, or the hook short-circuits before
reaching any of this.

## Impact

Found while writing regression tests for
`codescout:docs/issues/2026-09-01-git-apply-cached-stages-but-records-no-owner.md`. The
irony is worth recording: a suite testing a *staging-attribution* guard could not be written
through Bash because a *worktree* guard read its fixture content as commands — two guards on
the same class of risk, one blocking work on the other.
