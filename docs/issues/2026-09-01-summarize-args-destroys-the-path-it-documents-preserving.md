---
kind: bug
status: open
title: summarize_args destroys the path it documents preserving, because a blind 200-char tail cut lands on whichever key the caller happened to put last
opened: 2026-09-01
owner: marius
severity: med
---

## Summary

`buddy/scripts/cs_tool_log.py::summarize_args` promises, in its own docstring, *"file
paths preserved, large string values truncated."* It preserves nothing of the sort. The
function truncates each **value** to 80 characters, joins the pairs, and then applies a
blind tail cut to the joined string:

```python
for key, val in tool_input.items():          # caller's key order; path is not privileged
    if isinstance(val, str) and len(val) > 80:
        val = val[:77] + "..."
    parts.append(f"{key}={val}")
return ", ".join(parts)[:200]                # blind tail cut — mutilates whatever is last
```

Whether `path` survives is therefore decided by **where the caller's JSON happened to put
it**. An `edit_file` call written as `{path, old_string, new_string}` keeps its path; the
same call written as `{new_string, old_string, path}` loses it.

## Symptom (Effect)

Measured across this machine's 297 `cs_tool_log.jsonl` files, over the **1,920** records
whose tool is a write (`edit_file`, `edit_code`, `edit_markdown`, `create_file`, and the
legacy `replace_symbol` / `insert_code` / `remove_symbol`):

| | count | share |
|---|---:|---:|
| args hit the 200-char cap | 1,007 | 52.4% |
| carry a parseable `path=` | 1,699 | 88.5% |
| **carry no `path=` at all** | **221** | **11.5%** |
| `path=` is last key *and* args capped | 181 | 9.4% |

Of those 181, **147 name a path that does not exist on disk**, against 34 that do — and the
missing ones are unmistakably prefixes rather than deletions:

```
src/serve
src/lsp/m
docs/superpowers/specs/2026-05-08-librarian
docs/issues/2026-05-18-il3-pipe-violation-subagent
/home/marius/.claude-sdd/projects/-home-marius-work-claude-
```

So of 1,920 write records, roughly **1,518 (79%)** carry a path a consumer can trust. The
other 21% are split between *silently absent* and *silently wrong* — and the second is worse,
because `src/serve` is a well-formed string that a consumer will happily match against.

## Reproduction

```python
from scripts.cs_tool_log import summarize_args
long = "x" * 300
summarize_args({"path": "src/server.rs", "old_string": long, "new_string": long})
# -> '...new_string=xxx…, path=src/serve'   (path cut mid-token, no marker)
summarize_args({"new_string": long, "old_string": long, "path": "src/server.rs"})
# -> path absent entirely
```

## Root cause

Two independent decisions compose, and each is individually reasonable:

1. **A per-value truncation that marks itself** (`val[:77] + "..."`) — good: a consumer can
   see that a value was cut.
2. **A per-record tail cut that does not** (`[:200]`) — this one leaves no marker, cannot be
   distinguished from a genuinely short value, and lands on whichever key sorted last.

The `path` key is the one field with a downstream consumer that must be exact, and it is
the only field the function does not protect.

## Why no test caught it

`buddy/tests/test_cs_tool_log.py::test_summarize_args_truncates_long_values` covers this
function and passes:

```python
args = {"path": "a" * 200, "query": "short"}
result = summarize_args(args)
assert len(result) <= 200
```

It fails to catch the defect twice over, for two different reasons:

- **The assertion is monotone under further truncation.** `len(result) <= 200` is satisfied
  by returning `""`, by dropping `path` entirely, or by cutting it mid-token. Every
  behaviour this bug is about *passes* it. An assertion that a value got smaller cannot
  detect that the wrong value got smaller.
- **The fixture's key order is load-bearing and unmarked.** `path` is written **first**,
  which is precisely the ordering under which the bug does not fire. A tidy-up that
  reordered the dict — or a caller that does — changes what the test covers, with nothing
  to say so.

## Fix

Preserve `path` / `file_path` structurally rather than positionally:

- emit the path key first, before joining, so a tail cut can never reach it; and
- give the record-level cut the same explicit marker the value-level cut has, so a
  consumer can tell "short" from "cut".

Then the docstring becomes true, and a consumer can trust `path` unconditionally. Note the
fix helps only **future** records; the 297 logs on disk stay as measured.

## Tests to add

1. `path` survives verbatim when it is the **last** key of a dict of long values (the
   direction the current fixture cannot reach) — with the key order annotated as the point
   of the test.
2. A record-level truncation carries a marker, so absence of a marker means a whole value.
3. Both `path` and `file_path` spellings are protected.

## Impact / who is reading this field

Found while building a working-tree provenance channel for the sibling repo — a tool
answering *"is this dirty file mine?"* on a checkout shared by several sessions
(`codescout:docs/issues/2026-09-01-un-wired-function-reds-the-shared-build-with-no-author.md`).
`cs_tool_log.jsonl` was the proposed substrate and was rejected, this defect being one of
three reasons; the others (a 50-entry rolling cap, and deletion on compact) are properties
of the log's design as a *recent-activity* buffer rather than defects. This one is a defect
on its own terms, independent of that use: the function does not do what it says.
