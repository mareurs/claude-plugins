# Base constitution: articles I to VI

`/sdd-init` files each rule below as one entry of the box `constitution` (global, no `paths`).
The JSON block lists the rules. The `## <title>` section of a rule follows its `**Rule:**`
line in the entry body.

```json
[
  {"title": "Specification first", "rule": "No source change without an approved spec in docs/superpowers/specs/ and an approved plan. The change stays inside the spec's scope."},
  {"title": "The user approves specs, plans and reviews", "rule": "Only the user's typed /sdd:approve command approves a spec, a plan or a review. Never edit status fields or approval records."},
  {"title": "Review before integration", "rule": "A feature is reviewed against this constitution and the spec-drift verdict before it is merged into the base branch. Resolve every NO-GO first."},
  {"title": "Documentation changes with the code", "rule": "Update the docs a change makes false in the same change. A stale doc is a bug."},
  {"title": "Smallest solution that meets the spec", "rule": "No speculative abstraction, no unused code, no commented-out code."},
  {"title": "Clear names and recorded rationale", "rule": "Names say what a thing is. A non-obvious decision carries its reason, and an error message says what to do."}
]
```

## Specification first

Why: code without a spec cannot be checked for drift. How: write the spec with
`superpowers:brainstorming`, get it approved, then plan. Evidence: the approved spec file.

## The user approves specs, plans and reviews

Why: approval from the agent is no approval. How: ask the user to type the command; the
hook writes the field. Evidence: `approved:` in the frontmatter, the review record.

## Review before integration

Why: the base branch is where unreviewed work does the most harm. How: run `/review`, then
ask for `/sdd:approve review <feature>`. Evidence: the report and the review record.

## Documentation changes with the code

Why: readers trust docs. How: grep the docs for what you changed. Evidence: doc changes in
the same diff.

## Smallest solution that meets the spec

Why: unrequested code is unreviewed code. How: build what the acceptance criteria name.
Evidence: no code in the diff that no criterion needs.

## Clear names and recorded rationale

Why: the next reader has only the code. How: rename before you comment; note the reason for
a surprising choice. Evidence: review of names and messages in the diff.
