---
description: Check the feature against the constitution and the spec-drift verdict, and write the GO or NO-GO report
---

# /review

Writes the review report for the feature. It does not approve anything: after a GO you ask
the user to type the approval. To find the spec id and the feature name, see
`${CLAUDE_PLUGIN_ROOT}/skills/sdd-flow/references/artifacts.md` (if `${CLAUDE_PLUGIN_ROOT}` is
still an unexpanded `${...}` placeholder, use the folder of this plugin that contains `skills/`;
sdd has no `.codex-plugin/` folder).

## 1. Read the rules

Global rules, as JSON: `codescout constitution-check --project .`. To see every rule,
path-scoped ones included:

```python
doc(action="find", kind="tracker", filter={"tags": {"contains": "constitution"}})
doc(action="get", id="<constitution id>", entry_filter={"status": {"eq": "active"}})
```

## 2. Read the drift verdict

```python
doc(action="event_list", id="<spec id>", kinds=["verdict"])
```

Take the newest verdict (`event_list` returns events newest first). Its `payload.gate` is `go` or `no-go`. Use `gate`, never `outcome`:
the server only accepts confirmed, refuted, partial and abandoned there, so the GO or NO-GO
lives in `payload.gate`. No verdict yet means no GO: run `codescout-companion:spec-drift`
first.

## 3. Judge each rule

For every active rule, look at the diff of the feature branch against the base branch and
decide: kept, violated, or not applicable. Quote the evidence for each violation. Show the
user a table: rule id, title, verdict, evidence.

`outcome` is `go` only if no rule is violated. `drift_outcome` is the verdict's
`payload.gate`.

## 4. Write the report

Find the git common directory with `git rev-parse --git-common-dir` (a read). The report is
`<git common dir>/sdd/approvals/<feature>.report.json`: under the common directory, not
under the worktree. The report lives in the main repository's git common directory, outside
the worktree, so a codescout write there may ask for an out-of-scope acknowledgement: give it
for that path only. The edit tool creates the missing directory itself; a shell `mkdir` there
is denied by the review guard. Write the file with an edit tool (Write or create_file), never
through a shell command. The review guard denies a shell
command that writes into the approvals directory, and the spec guard allows a tool write
only to `<feature>.report.json` there.

```json
{"outcome": "go", "drift_outcome": "go", "date": "YYYY-MM-DD"}
```

Both fields are `go` or `no-go`.

## 5. Hand over

- Both `go`: tell the user to read the report, then type `/sdd:approve review <feature>`.
  That typed command is the real gate; the hook refuses unless both fields are `go`.
- Any `no-go`: list what must change, and stop. Run `/review` again after the fix.
