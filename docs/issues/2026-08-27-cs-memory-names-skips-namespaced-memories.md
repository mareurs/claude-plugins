---
id: '38a6b165e6ab7578'
kind: bug
status: open
title: 'BUG: CS_MEMORY_NAMES enumerates only the top level, so every namespaced memory is invisible to the SessionStart banner and to every dispatched subagent'
tags:
- codescout-companion
- session-start
- subagent-dispatch
- memory
closed: null
opened: 2026-08-27
owner: marius
severity: med
---

## Summary

`CS_MEMORY_NAMES` enumerates `.codescout/memories/` with a **non-recursive** read plus an
explicit is-a-file guard, so every memory in a namespace subdirectory is skipped. On this
machine's codescout project that is 5 of 23. The SessionStart banner and the subagent
briefing both report the smaller number as if it were the whole set.

Not cosmetic: this is the surface the activation bootstrap's Phase 0 ("load what the
project already knows") points at, and the same variable is what tells every dispatched
subagent which topics exist.

## Symptom (Effect)

Same session, minutes apart, two enumerations of one thing:

```
SessionStart banner:  codescout MEMORIES: architecture cargo-test-lib-skips-integration
                      … worktree-macro-catalog-reconciliation          (18 topics)

workspace(activate):  "memories": [ …, "infra/friction-measurement",
                      "infra/headroom-trial-and-langfuse",
                      "research/agent-memory-frameworks",
                      "research/loadbearing-mcp-guidance",
                      "research/sakana-fugu-integration", … ]          (23 topics)
```

The five missing are exactly the namespaced ones. Nothing reports a count, a truncation
flag, or a discrepancy — 18 reads as complete.

## Reproduction

No spend, on any project with a namespaced memory:

```bash
ls ~/work/claude/codescout/.codescout/memories/          # 18 *.md + infra/ + research/
ls ~/work/claude/codescout/.codescout/memories/infra/    # friction-measurement.md, …

node codescout-companion/hooks/detect.mjs                # CS_MEMORY_NAMES → 18 names
python3 codescout-companion/scripts/detect.py            # same 18
```

Then compare against `memory(action="list")` (23) or `workspace(action="activate")`'s
`memories` array (23).

## Environment

- claude-plugins @ current `codescout-companion`
- codescout `b10725ed`; `memory(list)` returns all 23 as of `codescout:020ea69a`
- Observed live in a working session, not constructed

## Root cause

Both implementations of `detect` walk one level and discard directories.

`codescout-companion/hooks/detect.mjs:166-175`:

```js
if (isDir(memoriesDir)) {
    for (const name of readdirSync(memoriesDir).sort()) {
        if (isFile(join(memoriesDir, name)) && name.endsWith('.md') && name.length > 3) {
            memoryNames += `${name.slice(0, -3)} `;
```

`codescout-companion/scripts/detect.py:175-179`:

```python
if memories_dir.is_dir():
    for entry in sorted(memories_dir.iterdir()):
        if entry.is_file() and entry.suffix == ".md":
            memory_names += f"{entry.stem} "
```

`readdirSync` / `iterdir()` are non-recursive, and the `isFile` / `is_file()` guard then
drops `infra/` and `research/` — along with everything inside them. The guard is correct in
isolation (it excludes a stray directory named `foo.md`); the missing half is that a
directory is also a *namespace* the memory tool supports.

The two are twins by design — `detect.mjs` carries a comment asserting "parity with
detect.py" — so the defect is symmetric and a fix must land in both or they diverge.

## Evidence

- The two code paths above, read at the bytes.
- Ground truth: `.codescout/memories/infra/friction-measurement.md` exists and is 12,728
  bytes; `memory(action="read", topic="infra/friction-measurement")` returns 169 lines.
- The plan doc already described the shape without flagging it as a limit:
  *"`CS_MEMORY_NAMES` is a space-separated list of `.md` **basenames**"*
  (`docs/superpowers/plans/2026-07-28-subagent-bootstrap-injection.md:397`).

### What it cost, measured once

A whole working session ran Phase 0 against the 18-item view. One of the five invisible
memories, `infra/friction-measurement`, carries an instrument table whose `cc.py` row names
the same `~/.claude`-vs-`CLAUDE_CONFIG_DIR` defect that was re-derived from scratch the
same day and filed as
`prompt-engineering:docs/issues/2026-08-27-integration-test-plants-transcript-in-the-wrong-claude-home.md`.
Having it would have made that a known class with a shipped one-line fix rather than a
novel finding.

Recorded as `codescout:reconnaissance-patterns:R-119`, which frames the general form: two
enumerations of one thing, disagreeing, both sitting in the transcript, and nothing flags a
disagreement — only reading them against each other does.

**The subagent channel is the sharper half.** `codescout-companion/hooks/subagent-guidance.mjs:29-35`
feeds the same `CS_MEMORY_NAMES` into the exploration protocol's Phase 0, *replacing* its
`memory(action="list")` instruction. So a subagent is handed the short list **instead of**
the call that would have returned the full one — it cannot discover a namespaced memory by
any route. Iron Law 6 calls a subagent re-discovering what the parent knew a dispatch
defect; here the dispatch surface makes it undiscoverable.

## Hypotheses tried

1. **`codescout:76e2d6cd` already fixed it** — refuted. That commit fixes
   `Agent::project_status`, a *fourth* server-side reader, where activate's JSON array and
   the Project Status block contradicted each other **inside one message**. The banner is a
   plugin surface with its own enumeration and is untouched.
2. **`codescout:020ea69a` caused it** — refuted. That fixed `memory(list)` (18 → 23) and
   made the divergence *visible*; `detect` has always read one level.

## Fix

Not implemented. Recurse one level and join with `/`, in both twins, so the name matches the
topic key `memory(action="read", topic=…)` expects:

```js
// detect.mjs — namespaced topics live one directory down and are addressed "ns/name"
for (const name of readdirSync(memoriesDir).sort()) {
    const p = join(memoriesDir, name);
    if (isFile(p) && name.endsWith('.md') && name.length > 3) {
        memoryNames += `${name.slice(0, -3)} `;
    } else if (isDir(p)) {
        for (const sub of readdirSync(p).sort()) {
            if (isFile(join(p, sub)) && sub.endsWith('.md') && sub.length > 3) {
                memoryNames += `${name}/${sub.slice(0, -3)} `;
            }
        }
    }
}
```

Two things to decide rather than assume, and neither is obvious from here:

- **Depth.** One level matches every namespace in use today. Arbitrary depth is barely more
  code but changes what a "topic" is; check what `memory()` itself accepts before going
  deeper than the observed shape.
- **Budget.** These names ship in the SessionStart injection, whose size is governed by
  `docs/superpowers/specs/2026-05-19-injection-budget-design.md`. Five extra names is
  ~150 bytes here, but a project with many namespaced memories could move a budget the
  design pins — worth a number before merging, not after.

Fix SHA + `git patch-id --stable`: *not yet fixed.*

## Tests added

None — not fixed. `tests/test_detect.py::test_memories_collected_with_trailing_space` and
`tests/test-detect-tools.sh` both exercise the flat case only; a fixture with
`memories/ns/topic.md` asserting `ns/topic ∈ CS_MEMORY_NAMES` fails today. Add it to **both**
suites — a fix landing in one twin and not the other is the failure mode the parity comment
exists to prevent, and no test currently compares them.

## Workarounds

- Call `memory(action="list")` explicitly rather than trusting the banner; it returns all 23.
- When dispatching a subagent that may need project memory, name the namespaced topics in
  the prompt — the injected list will not mention them.

## References

- `codescout-companion/hooks/detect.mjs:164-178`
- `codescout-companion/scripts/detect.py:173-179`
- `codescout-companion/hooks/session-start.mjs:192` — the banner
- `codescout-companion/hooks/subagent-guidance.mjs:29-35` — the subagent channel
- `codescout:docs/trackers/reconnaissance-patterns.md` — `R-119`

