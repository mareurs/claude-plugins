# Consolidation Protocol

You are about to perform memory consolidation on your own POV. The candidate
brief and the full body of every referenced entry have been provided. Apply
your method, not generic editorial reflex, and emit a YAML plan.

## Three rules

1. **Voice preservation.** When merging or summarizing, the new body must read
   as a single coherent lesson in your voice. If the originals disagree on
   substance, you cannot merge — you must reconcile (write a new entry that
   supersedes both) or `defer` to the user.
2. **No silent loss.** Every entry that disappears from the active set must
   be either merged into a successor (cite by slug in the new body's
   `**Supersedes:**` line) or archived (which keeps the file readable). Never
   delete.
3. **Doubt → defer.** If you cannot confidently decide, mark `defer` with a
   one-line reason. The user will judge.

## Required output schema

Emit YAML between fenced code blocks tagged `yaml`. The script parses the
first such block. Anything outside the block is ignored.

```yaml
plan_version: 1
specialist: <directory>
channel: <global|project>
generated: <ISO8601>
operations:
  - op: merge
    inputs: [slug-a, slug-b]
    output:
      slug: <new-or-kept-slug>
      tags: [...]
      body: |
        **Lesson:** ...
        **Why:** ...
        **How to apply:** ...
        **Supersedes:** slug-a, slug-b
    reason: <one line — why merge is safe>

  - op: archive
    slug: <slug>
    reason: <one line — why no longer load-bearing>

  - op: summarize
    inputs: [slug-x, slug-y, slug-z]
    output:
      slug: <new-slug>
      tags: [...]
      body: |
        ...
    reason: ...

  - op: keep_all
    slugs: [...]
    reason: <why the rules-shortlist was wrong>

  - op: defer
    target: <slug or group descriptor>
    reason: <what the user must decide>
```

## Notes

- `op: keep_all` is for cases where the rules surfaced a candidate but you
  judge them distinct lessons. Always include a `reason`.
- `op: defer` is the safety valve. Use it freely. Better deferred than
  mistakenly merged.
- For merges, prefer the older slug as `output.slug` unless the newer slug
  reads more clearly.
- Tag union is automatic — emit your preferred tag list; the apply phase
  unions inputs anyway.
- Do not refer to entries that were not in the candidate brief. The brief is
  the closed set.
