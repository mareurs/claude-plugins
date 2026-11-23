# Reconnaissance — routing a tool friction to the frictions inbox

> **Load when:** a gap you found cost you calls on a codescout tool, a hook or a box
> verb, and you must decide where to write it. The routing rule itself stays in
> `SKILL.md` § Phase 3 — only the details live here.
>
> Source: the frictions-box design, `docs/superpowers/specs/2026-11-21-frictions-box-design.md`
> in the codescout repo (decision D5, goal G7, § 5).

---

## The rule

| the gap is… | it goes to |
|---|---|
| plan drift: a plan, doc or memory says one thing and the code holds another | a `friction` entry in the recon box |
| a win: a pattern that prevented worse | a `win` entry in the recon box |
| a tool friction: a codescout tool, a hook or a box verb cost you calls | the frictions inbox |

Do not write a recon-box entry for a finding that you filed in the inbox. If the friction also made the
plan wrong, file the inbox entry and cite its entry key as `[[<entry key>]]` in the recon-box entry.

## The command

```bash
codescout box frictions note --title "<one line>" --tool <tool name> --body "<what you saw>"
```

- `--title` and `--tool` are required. `--body`, `--kind` and `--severity` are optional.
- The verb attaches the failed calls of your root session from the last 30 minutes
  (`--minutes`, `--rows` change the window; `--no-evidence` attaches nothing).
- It prints the new entry's key, the evidence line, and up to three candidate duplicates
  (open bugs and frictions that look like the same finding). The entry is filed either way.
- A refusal prints `NOT DONE — <reason>` and exits 2: a missing title or tool, a second
  absolute path left in the text, or a live entry with the same title.
- Run `codescout box frictions recent` first to read the failed calls of your session. It
  files nothing.
- `codescout box frictions help note` prints the full usage.

The entry starts as `inbox`. An inbox entry is cheap on purpose. The operator or a later
session verifies it with `codescout box frictions promote <key>`, which moves it to `open` and
gives it the next `FR-N`.

## When there is no frictions box

A project that has no `frictions` box (`codescout box` does not list it) has nowhere to file
the inbox entry. In that project a tool friction takes a `friction` entry in the recon box.
