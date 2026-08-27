---
id: 1a7795fef9df3084
kind: bug
status: fixed
title: 'BUG: CS_MEMORY_NAMES enumerates only the top level, so every namespaced memory is invisible to the SessionStart banner and to every dispatched subagent'
tags:
- codescout-companion
- session-start
- subagent-dispatch
- memory
closed: 2026-08-27
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

**LANDED 2026-08-27** — `b305b1b5` / patch-id `8ad092d340072855b0175f82bb2d6d05b223c655`.

Both twins now recurse and name each topic by its path. **The two "decisions" this issue
flagged were not decisions**, and posing them as such was the filing's own error:

- **Depth.** This section proposed one level and asked someone to "check what `memory()`
  accepts before going deeper". Checked: `MemoryStore::list` (codescout
  `src/memory/mod.rs:114`) walks with `walkdir` at **arbitrary** depth and keys each topic
  by its relative path with the extension stripped and separators normalised to `/`. That
  string is the topic key, so any depth short of walkdir's advertises nothing for topics
  that exist. Matching the server exactly is the only shape correct by construction — and
  it is *simpler* than the one-level special case this issue drafted.
- **Budget.** Measured instead of weighed: **+161 bytes** on this project (496 total, 23
  topics). Negligible against the SessionStart injection budget. A project would need
  hundreds of namespaced memories to approach it.

Two implementation points that are load-bearing rather than incidental:

- **`withFileTypes`/`Dirent` in JS, an explicit `is_symlink()` skip in Python.** `statSync`
  and pathlib's `is_dir()` both FOLLOW symlinks, so the obvious recursion written with the
  existing `isFile`/`isDir` helpers can loop — in the SessionStart hook, where a hang costs
  the whole session. `Dirent.isFile()`/`isDirectory()` are lstat-based and both false for a
  symlink, so skipping is free and reproduces `walkdir`'s no-follow default. Parity, not a
  divergence.
- **Recursion happens where the directory sorts, not after all files.** Both twins emit the
  same interleaved order. This is precisely the rule that agrees on flat fixtures and
  diverges the moment a namespace appears — i.e. it would have drifted silently.

Fail-open is now **per directory** on both sides: one unreadable subdirectory hides itself,
never its siblings. The previous shape wrapped the whole scan, so a single failure reported
zero memories.
## Tests added

Three behaviour tests plus the parity test that did not exist, all in
`tests/test_detect.py`:

- `test_namespaced_memories_are_collected_as_paths` — the defect. Asserts the full
  **ordered** list, not just membership, because ordering is the half that drifts silently.
- `test_a_namespace_holding_no_markdown_advertises_nothing` — widening the walk creates a
  way to invent a topic for a directory; the pre-fix guard was wrong but never could.
- `test_a_symlinked_namespace_is_skipped_not_followed` — a test rather than a comment,
  because the failure mode is a hung session rather than a wrong value.
- `test_the_two_detect_twins_agree_on_memory_names` — **the gap this issue named.**
  `detect.mjs` carried a comment asserting "parity with detect.py" and nothing executed it,
  which is how this defect could have been half-fixed. Shells out to the real
  `node detect.mjs` and compares the field. Scoped to `CS_MEMORY_NAMES` deliberately: the
  twins emit different formats on purpose (JSON vs shell `KEY=VALUE` for
  `detect-tools.sh`), so a whole-output diff compares serialisation and reads as a failure
  when nothing is wrong — confirmed by doing exactly that during the fix and briefly
  believing the twins had diverged.

It names the expected string explicitly as well as comparing the twins, so a failure says
*which* side is wrong rather than only that they disagree.

Suites: `test_detect.py` 23, `detect-tools` 20, `session-start` 13,
`session-start-payload` 7, `subagent-guidance` 34 — all green. Live check on the real
project: both twins byte-identical at 23 topics, 5 namespaced, 496 bytes.
## Workarounds

None needed — fixed. Previously: call `memory(action="list")` rather than trusting the
banner, and name namespaced topics explicitly when dispatching a subagent. Both are now
unnecessary; the banner and the subagent Phase 0 block carry the full set.
## References

- `codescout-companion/hooks/detect.mjs:164-178`
- `codescout-companion/scripts/detect.py:173-179`
- `codescout-companion/hooks/session-start.mjs:192` — the banner
- `codescout-companion/hooks/subagent-guidance.mjs:29-35` — the subagent channel
- `codescout:docs/trackers/reconnaissance-patterns.md` — `R-119`
