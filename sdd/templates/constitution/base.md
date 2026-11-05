# Base constitution: articles I to VI

`/sdd-init` turns this file into codescout constitution rules (ids C-1 to C-6, global, no
`paths`). The JSON block is the `rules` list of the tracker's params. Each `## C-N` section
below is copied into the tracker body.

```json
[
  {"id": "C-1", "title": "Specification first", "rule": "No source change without an approved spec in docs/superpowers/specs/ and an approved plan. The change stays inside the spec's scope.", "status": "active"},
  {"id": "C-2", "title": "The user approves specs, plans and reviews", "rule": "Only the user's typed /sdd:approve command approves a spec, a plan or a review. Never edit status fields or approval records.", "status": "active"},
  {"id": "C-3", "title": "Review before integration", "rule": "A feature is reviewed against this constitution and the spec-drift verdict before it is merged into the base branch. Resolve every NO-GO first.", "status": "active"},
  {"id": "C-4", "title": "Documentation changes with the code", "rule": "Update the docs a change makes false in the same change. A stale doc is a bug.", "status": "active"},
  {"id": "C-5", "title": "Smallest solution that meets the spec", "rule": "No speculative abstraction, no unused code, no commented-out code.", "status": "active"},
  {"id": "C-6", "title": "Clear names and recorded rationale", "rule": "Names say what a thing is. A non-obvious decision carries its reason, and an error message says what to do.", "status": "active"}
]
```

## C-1 — Specification first

Why: code without a spec cannot be checked for drift. How: write the spec with
`superpowers:brainstorming`, get it approved, then plan. Evidence: the approved spec file.

## C-2 — The user approves specs, plans and reviews

Why: approval from the agent is no approval. How: ask the user to type the command; the
hook writes the field. Evidence: `approved:` in the frontmatter, the review record.

## C-3 — Review before integration

Why: the base branch is where unreviewed work does the most harm. How: run `/review`, then
ask for `/sdd:approve review <feature>`. Evidence: the report and the review record.

## C-4 — Documentation changes with the code

Why: readers trust docs. How: grep the docs for what you changed. Evidence: doc changes in
the same diff.

## C-5 — Smallest solution that meets the spec

Why: unrequested code is unreviewed code. How: build what the acceptance criteria name.
Evidence: no code in the diff that no criterion needs.

## C-6 — Clear names and recorded rationale

Why: the next reader has only the code. How: rename before you comment; note the reason for
a surprising choice. Evidence: review of names and messages in the diff.
