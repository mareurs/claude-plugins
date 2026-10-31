---
id: af3292c4ea2d4712
kind: bug
status: investigating
title: No automated check that the tool calls a skill prescribes stay legal against the MCP server it drives
tags:
- codescout-companion
- skills
- regression-coverage
- librarian
unverified: The skill-call check runs 7 of the 10 append_entry/update calls found in five skill files. 3 calls with ellipsis placeholders are not parsed. The read-only, link, memory and workspace calls are not run. The suite SKIPs without a codescout binary, so CI does not check it; only a local run-all.sh and the release preflight do.
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

## Steps 1-3 done 2026-10-29

- **Skill prose fixed.** `reconnaissance/SKILL.md:103` no longer says a fresh template ships without `entry_prefix`. It now says a copy of `docs/templates/session-log.md` declares `entry_prefix`, so it is a ledger from its first moment and `edit_file` refuses it. The skill edit is committed, not live: skills are served from the versioned cache, so it reaches no profile until a release.
- **The INFO line is now an assertion.** `tests/lib/skill_call_legality.py` fails when the skill says a fresh template ships without `entry_prefix` and the real template declares it. The run is 7 passed, 0 failed, 0 skipped.
- **Mutation check, measured.** Mutation A put the old prose back: 1 FAIL, exit 1. Mutation B put an em-dash tail on `dated` in the skill's own `append_entry` exemplar: 2 FAIL (`is not an ISO date`), exit 1. The skill file was restored byte for byte after both.
- **Still open:** 31 of the 32 prescribed calls are not run, 20 of them in `tracker-hygiene`. The status is `investigating`, not `fixed`, for that reason. (Superseded in part by the section below.)

## Option 2 extended 2026-10-31

The maintainer chose option 2 on 2026-10-31. `tests/lib/skill_call_legality.py` now finds every `doc(action="append_entry"|"update", ...)` call in five skill files and runs the ones that carry an `anchor_heading` or a `body_edits` patch. It extracts them from the skill text, so a test cannot drift from a skill. JS-style bare keys (`patch={body_edits: [...]}`) are quoted before parsing.

Each call runs on a fresh guarded fixture ledger that declares `entry_prefix`, as the real ledgers do, and that holds the heading the shipped templates carry (`## Template for new entries`). A control runs first: the same call aimed at a heading the ledger lacks must be refused and write nothing. The ledger is dropped after each case, because the server allows one owner per `entry_prefix` in a repository.

Result: 15 PASS, 0 FAIL. Six more calls run: `tracker-hygiene/SKILL.md:397` (`body_edits` `insert_before`) and `:409` (`HY` append); `tracker-hygiene-log-template.md:137` and `:147` (the same two shapes); `reconnaissance-patterns-template.md:73` and `:128` (`R` append). The first case still covers `reconnaissance/SKILL.md:92`.

Mutation check, measured. Mutation A changed `insert_before` to `insert_sideways` in `tracker-hygiene/SKILL.md`: FAIL at `:397` with `invalid action "insert_sideways"`, exit 1. Mutation B changed the `R` call's anchor to `## Template for new entry` in `reconnaissance-patterns-template.md`: FAIL at `:73` with `heading '## Template for new entry' not found`, exit 1. Both files were restored byte for byte (`git status` showed only the runner as modified).

A first draft built the fixture heading from the call itself. That would have adopted a typo in a skill's `anchor_heading`. The fixture now holds the template's heading, and the runner asserts that both template files carry it.

### Still not checked

- Three `append_entry` / `update` calls do not parse as calls, because they use `…` placeholders: `append-entry-anchoring.md:30`, `append-entry-anchoring.md:92` and `reconnaissance/SKILL.md:103`. The runner prints their locations.
- The read-only calls (`doctor`, `link_scan`, `verify`, `list_stale`, `reindex`), the `link` call and the `memory` and `workspace` calls are not run.
- The suite SKIPs where there is no codescout binary, which includes CI. It runs only where the binary exists, so a local `run-all.sh` and the `release.sh` preflight are the gates that see it.
- A placeholder replaced by `id=` is the only substitution. A call that needs other real values would need its own case.

## Why it matters

Skills are served from a versioned cache, so a bad prescription reaches every profile at release and is found only when an agent follows it. Both archived cases were found that way.

## Possible approaches

Option 2 was chosen on 2026-10-31 and is partly built (see *Option 2 extended 2026-10-31*). Options, cheapest first:

1. Extract the fenced `doc(...)` / `memory(...)` examples from each skill and check the action names and parameter names against the server's tool schema.
2. Run each prescribed example against a scratch catalog and assert it is accepted.
3. Keep manual review, and record that as the standing policy.

## Reader and scope

Maintainers of `codescout-companion` skills. This report changes nothing.
