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

## Measurements 2026-10-29

Measured by reading the skills and the live tool schemas. No call was run.

- The report's claim holds. `tests/test-recon-skill-split.sh:106` loops over `'append_entry' 'Severity rubric' …` and tests each with `grep -qF`. No test runs, parses or validates a call.
- The corpus is small. 32 calls with `action="…"` appear in 8 files under `codescout-companion/skills/`. `tracker-hygiene` holds 20 of them. `reconnaissance` and its references hold 8. No `buddy` skill holds one.
- Every `doc`, `librarian`, `memory` and `workspace` action name that a skill prescribes is in the live tool enum.
- One name is not in the enum: `librarian(action="audit_trackers")` at `tracker-hygiene/SKILL.md:476`. The sentence says a future Rust check graduates to it, so it is a roadmap note and not a prescribed call.
- The four `append_entry` calls and the `update` call use only parameter names that exist in the schema.
- The skills now show only `**Valid:** dated 2026-05-18`, with no em-dash tail. The two archived failures are not present today.

What this does not show: the second archived bug used legal parameter names and failed on a value at runtime. A check of names against the schema (option 1) would not have caught it. Only option 2 would. This measurement shows no current defect, so the risk is future drift.

## Option 2 prototype 2026-10-29

Files (uncommitted when written): `tests/test-skill-call-legality.sh`, `tests/lib/skill_call_legality.py`, `tests/lib/cs_isolated.py`. `tests/run-all.sh` discovers the wrapper by its `test-*.sh` glob.

How it works: the runner extracts the `append_entry` call from `reconnaissance/SKILL.md`, so the test cannot drift from the skill. It starts `codescout start` in a sandbox with a clean environment, and a `HOME` and `CODESCOUT_SQLITE_DIR` under the sandbox. It runs a known-bad control first. It then runs the call against a fixture ledger. It last runs the call on a fresh copy of the real `docs/templates/session-log.md` from the codescout repo.

Result: 6 PASS, 0 FAIL. The call is accepted and allocates `F-1`. The section, the Index row and the `**Valid:** dated <ISO date>` stamp all land. The control (an em-dash tail on `dated`) is refused with `is not an ISO date`, which is the error text of the second archived bug. With `CODESCOUT_BIN=/bin/false` the wrapper exits 1.

Traps for anyone extending it:

- A refused call returns `isError: false` with `"ok": false` in the JSON text. Test the JSON, not `isError`.
- The reply carries guide text after the JSON. Decode with `raw_decode`.
- The server refuses to catalogue artifacts under the system temp dir unless `CODESCOUT_ALLOW_TEMP_WORKSPACE=1` is set.
- A ledger must declare `entry_prefix`. A fixture without it makes the valid call and the control fail identically, so the run says nothing.
- A missing binary SKIPs and passes. CI has no binary, so a skip there means "not checked".

### Finding: SKILL.md line 103 contradicts the real template

`reconnaissance/SKILL.md:103` says that a fresh template ships without `entry_prefix` and is directly editable. The real template declares `entry_prefix: [F, W]` in its frontmatter (line 2; commit `cedbd0fe0` in the codescout repo). Run on a fresh copy, `edit_file` was refused: `a librarian-managed artifact (a ledger — it declares an entry_prefix …`. The template's own text says a copy is a ledger from its first moment. The runner records this as an INFO line, not a FAIL, so no suite goes red. The sentence at `reconnaissance-patterns-template.md:79` is a different case: that template has no frontmatter, so its claim is true.

### Limits

- One call is covered. The other `doc(...)` and `librarian(...)` examples in the skills are not run.
- The control proves the harness can see a rejection. It does not prove that every bad call is rejected.
- I did not mutate the skill text to confirm that the test then fails. The extractor ties the test to the skill, and the control ties it to the server.
- The fresh-copy case needs the codescout repo as a sibling directory, or `CODESCOUT_REPO`. Without it the case SKIPs.
- I verified isolation by confirming that the scratch trackers are absent from the real catalog, and by `git status`. I did not locate the isolated database file.

## Why it matters

Skills are served from a versioned cache, so a bad prescription reaches every profile at release and is found only when an agent follows it. Both archived cases were found that way.

## Possible approaches

Not decided. Options, cheapest first:

1. Extract the fenced `doc(...)` / `memory(...)` examples from each skill and check the action names and parameter names against the server's tool schema.
2. Run each prescribed example against a scratch catalog and assert it is accepted.
3. Keep manual review, and record that as the standing policy.

## Reader and scope

Maintainers of `codescout-companion` skills. This report changes nothing.
