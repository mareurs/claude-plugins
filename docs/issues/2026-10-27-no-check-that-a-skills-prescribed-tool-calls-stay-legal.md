---
id: af3292c4ea2d4712
kind: bug
status: open
title: No automated check that the tool calls a skill prescribes stay legal against the MCP server it drives
tags:
- codescout-companion
- skills
- regression-coverage
- librarian
---

## Summary

A skill in this repo can prescribe a tool call that the MCP server it drives would reject, and nothing in `tests/run-all.sh` or the buddy pytest suite would notice. The skill text is only checked for the presence of marker strings, never for whether the calls it shows are legal.

## Evidence

Two archived bugs came from exactly this gap, and each one names it as unclosed in its `unverified:` field:

- `docs/issues/archive/2026-08-20-reconnaissance-skill-prescribes-hand-allocated-edit-markdown-appends.md` — the reconnaissance skill prescribed hand-allocated appends that the librarian refuses.
- `docs/issues/archive/2026-08-26-recon-skill-valid-exemplar-rejected-by-append-entry.md` — the skill's `**Valid:**` exemplar used a form (`dated <date> — <prose>`) that `append_entry` rejects with `is not an ISO date`.

Checked 2026-10-27: the only test that mentions the call is `tests/test-recon-skill-split.sh` (line 106). It asserts that the string `append_entry` is present in the core skill file. It does not run, parse or validate any call.

## Why it matters

Skills are served from a versioned cache, so a bad prescription reaches every profile at release and is found only when an agent follows it. Both archived cases were found that way.

## Possible approaches

Not decided. Options, cheapest first:

1. Extract the fenced `doc(...)` / `memory(...)` examples from each skill and check the action names and parameter names against the server's tool schema.
2. Run each prescribed example against a scratch catalog and assert it is accepted.
3. Keep manual review, and record that as the standing policy.

## Reader and scope

Maintainers of `codescout-companion` skills. This report changes nothing.
