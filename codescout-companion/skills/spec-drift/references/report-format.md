# Spec drift report format

Print this after checking every criterion, before recording the verdict.

```
SPEC DRIFT: <spec title or feature slug>
Spec: <rel_path>  (id <artifact id>)
Verdict: GO | NO-GO
Implemented: X/Y   Missing: N   Divergent: M

[implemented] <criterion text>
    <file:line>
[missing]     <criterion text>
    <where you looked, or "not verifiable by reading; needs <test or run>">
[divergent]   <criterion text>
    <file:line> - <how it differs, one clause>
```

Rules:

- One block per criterion, in the spec's order, spec wording kept.
- `X + N + M` equals `Y`, the number of criteria.
- `Verdict: GO` only when `N == 0` and `M == 0`. This is the same value written to `payload.gate` (`go` / `no-go`); `payload.outcome` is `confirmed`, `partial` or `refuted` as SKILL.md Step 5 defines.
- Evidence is a `file:line` you read, never a symbol name alone. For `missing`, name the files or searches that came up empty.
- After the blocks, for a NO-GO, list the `missing` and `divergent` criteria again with the two options (change code in `<file>`, or change spec section `<heading>`).

The `criteria` array in the event payload carries the same items: `text`, `status` (`implemented` | `missing` | `divergent`), `evidence`.
