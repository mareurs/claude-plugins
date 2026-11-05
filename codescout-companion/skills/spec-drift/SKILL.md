---
name: spec-drift
description: Use when a spec has been implemented (or a branch claims to implement it) and you need to know whether the code still matches it, before finishing a branch, opening a PR, or approving work against a spec. Compares each acceptance criterion with the code and records a go/no-go verdict event on the spec.
---

# Spec drift

A spec says what was promised. After implementation nothing in the normal flow compares the two again. This skill does that comparison, prints a report, and records the result as a `verdict` event on the spec artifact so later steps (a review command, an approval gate) can read it instead of redoing the work.

Verify at the bytes. A criterion is `implemented` only if you read the code that satisfies it and can cite `file:line`. A grep hit, a function name, or a commit message is not evidence.

## Step 1 - Resolve the spec

The user gives one of: a catalog id, a file path, or a `feature:` slug.

- Id: `doc(action="get", id="<id>", full=true)`.
- Path: `doc(action="find", kind="spec", rel_path="<path or fragment>")`, then `get` the row.
- Slug: `doc(action="find", kind="spec", filter={"feature": {"eq": "<slug>"}})`. If that returns nothing, find all specs and match the `feature:` frontmatter key yourself.
- Nothing given: `doc(action="find", kind="spec")` and ask which one.

Superpowers writes specs at `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`; codescout catalogs them as `kind=spec`. Zero or several matches: stop and ask. Never pick one silently. Note the artifact `id`; the verdict is recorded against it.

A spec that is not in the catalog has no id to record against. Say so, print the report anyway, and skip Step 5.

## Step 2 - Extract the criteria

Take the first source that yields items, in this order:

1. A heading matching `/acceptance criteria/i`: each bullet or numbered item under it.
2. Else the numbered items under `## Goals`.
3. Else extract a candidate list yourself from the spec's requirements and **ask the user to confirm it** before checking anything. Do not proceed on an unconfirmed list.

One criterion is one checkable statement. Split compound items ("X and Y") into two. Keep the spec's own wording in `text`.

## Step 3 - Check each criterion against the code

For each criterion, find the code that should satisfy it and read it:

- Named symbol: `symbols(name=..., include_body=true)`.
- Concept: `semantic_search("<what it does>")`, then read the hits.
- Exact string, flag, or config key: `grep(pattern)`.
- A promised caller or wiring: `references(symbol, path)`.

Classify:

- `implemented`: the code does what the criterion says. Evidence is `file:line`.
- `missing`: you looked in the places it would live and it is not there. Evidence says where you looked.
- `divergent`: code exists but differs from the criterion (different default, different name, narrower scope, behaviour reversed). Evidence is `file:line` plus the difference in one clause.

A criterion about behaviour you cannot establish by reading (runtime, performance) is `missing` with evidence "not verifiable by reading; needs <test or run>", not `implemented`.

## Step 4 - Print the report

Use the layout in [references/report-format.md](references/report-format.md). It states the counts, one line per criterion, and the evidence.

## Step 5 - Record the verdict

The server only accepts `outcome` in `confirmed | refuted | partial | abandoned`, so the go/no-go decision is carried in a separate `gate` field:

- `gate` is `go` if and only if `missing == 0` and `divergent == 0`; otherwise `no-go`.
- `outcome` is `confirmed` when `gate` is `go`; `partial` when `gate` is `no-go` but `implemented > 0`; `refuted` when nothing is implemented.

The three counts must add up to the length of `criteria`.

```python
doc(action="event_create", id="<spec-artifact-id>", event={"kind": "verdict", "payload": {"outcome": "partial", "gate": "no-go", "implemented": 1, "missing": 1, "divergent": 0, "criteria": [{"text": "Exports a CSV on request", "status": "implemented", "evidence": "src/export.py:42"}, {"text": "Rejects files over 10 MB", "status": "missing", "evidence": "no size check in src/upload.py"}]}})
```

`verdict` requires `payload.outcome`; readers gate on `payload.gate`. Fill the id from Step 1. Read back with `doc(action="event_list", id="<id>", kinds=["verdict"])` (newest first) to confirm it landed.

Recording is the point of the skill, not a courtesy: a report that is only printed is gone by the next session. Re-run after changes and record a new event; do not edit an old one.

## Step 6 - On `no-go`, say what to change

For each `missing` or `divergent` criterion, give two options and let the user choose: change the code (name the file), or change the spec because the criterion is obsolete or the code is right (name the section). Do not edit either on your own. When the user picks the spec, edit it, then re-run this skill from Step 2.

## Rules

- Never mark `implemented` without a cited `file:line` you read.
- Never record `gate: "go"` while any criterion is `missing` or `divergent`.
- Never record a verdict on a criteria list the user has not confirmed (Step 2, case 3).
- The skill reads and reports. It changes no code and no spec unless the user directs it in Step 6.
