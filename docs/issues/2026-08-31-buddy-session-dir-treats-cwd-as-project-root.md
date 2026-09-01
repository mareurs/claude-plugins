---
kind: bug
status: fixed
title: buddy's session dir treats event["cwd"] as the project root, so a session started in a subdirectory plants .buddy/ there and hands the judge a wrong root
opened: 2026-08-31
owner: marius
severity: med
closed: 2026-09-01
---

## Summary

`hook_helpers.py:469` builds the per-session buddy directory as
`Path(event["cwd"]) / ".buddy" / session_id`, and `:605` then derives the project root
back out of it (`session_dir.parent.parent  # .buddy/<sid> → project`). A cwd is not a
project root. A session whose cwd is a subdirectory of the repo therefore plants its
`.buddy/<sid>/` in that subdirectory, and every consumer of the derived `project_root`
resolves against the subdirectory instead of the repo.

Both downstream failures are guarded by `exists()` / `except`, so nothing raises and the
judge degrades silently.


## Fixed 2026-09-01

A shared resolver, because this file's own warning was that a single call site would not
be enough: `buddy_paths.resolve_project_root(cwd)` and its Node twin
`codescout-companion/hooks/lib.mjs::resolveProjectRoot(cwd)`. Both walk up to the nearest
ancestor holding `.git` or `.codescout/project.toml`, with a documented fallback to the
starting directory. `.git` is tested with `exists()`, not a directory test, so a **linked
worktree's gitfile** resolves — pinned by a test.

`event["cwd"]` is kept as the per-session source, exactly as this file argued.

Seven call sites in buddy, all previously `Path(event.get("cwd") or os.getcwd())`:
`hook_entry._project_root` (the choke point feeding every `.buddy/<sid>` and `by-ppid`
path), `hook_helpers` session_dir, both trace roots, the `.codescout` detect for
`recon_reload`, the `find_skill_md` project_root, and the resume/compact project_root.

Four in codescout-companion — the three `constitution-seen` writers this file named, plus
**a fourth it did not**: `lib.mjs::emitSkillHint`, which planted
`<cwd>/.buddy/<sid>/hint-emitted-<topic>`.

The two resolvers must agree, and the comment in each says so: they resolve the same
`event["cwd"]` for the same session, so a disagreement puts one plugin's markers where
the other cannot see them.

Tests: 7 in `test_buddy_paths.py` — subdirectory walk, gitfile worktree,
`.codescout/project.toml`, unmarked fallback, nearest-marker-wins for a nested repo, the
`_project_root` choke point, and an end-to-end assertion that a subdirectory session
plants **no** stray `.buddy` beside itself. Per this file's instruction, each names the
expected absolute root rather than re-deriving it from the result — re-deriving passes in
the broken world by construction.

Migration is unchanged from this file's decision: existing strays are debris and are left
alone; they stop being created.
## Symptom (Effect)

Observed 2026-08-31 in the **codescout** checkout, not this one:

```text
codescout/docs/issues/.buddy/<peer-session-id>/
    cs_tool_log.jsonl
    narrative.jsonl
    state.json
```

That session's canonical directory — `codescout/.buddy/<same-sid>/` — existed too, live and
being written, holding the three files the stray copy lacked (`verdicts.json`,
`cs_verdicts.json`, `recon-loaded`). So one session had buddy state in two places at once.

Whether writes were *interleaving* between the two, or the stray copy was created once and
abandoned, is unknown: I deleted it before reading its mtimes. That mistake is recorded as
`codescout:R-150`, and it is why this file cannot state which of the two it was.

### Consequence 1 — the stray directory is not ignored

codescout's `.gitignore:43` is `/.buddy/*` — root-anchored. Confirmed with
`git check-ignore -v docs/issues/.buddy/x`, which reports nothing.

So a `.buddy/` under any subdirectory is **untracked, not ignored**, and a peer running
`git add -A` commits another session's tool log and narrative into the repo.

This is not fixable in the `.gitignore`. There is no pattern matching nested `.buddy/`
that leaves the root rule's `!/.buddy/memory/` negation reachable, because git does not
descend into a directory it has already ignored. The fix has to be here.

### Consequence 2 — the judge loses its plan and its project constraints

`judge_worker.py` is the live consumer of the derived root:

- `:82` — `plan_path = project_root / plan_path` for a relative active-plan path. Wrong
  root → `read_text` raises → `except: plan_content = None`. The judge reviews the
  timeline with no plan.
- `:92` — `memory_dir = project_root / ".codescout" / "memory"`, read for `conventions`,
  `gotchas`, `architecture`. Wrong root → `mem_file.exists()` is false → the constraints
  list is empty. The judge reviews with no project constraints.

Its verdicts feed the pre-tool gate that blocks tool calls, so a degraded judge is not
merely quieter — it gates on less.

**`cs_judge_worker.py` is NOT affected**, and the file says so rather than implying a
symmetry it does not have: `project_root` appears there exactly three times — docstring,
signature, and the `__main__` call — and is never read in the body. That lane is inert.

## Root cause

`hook_helpers.py:464-469` chose `event["cwd"]` deliberately, and the reasoning is sound —
the comment records that `state.signals.root_cwd` is a shared global overwritten by every
concurrent session, causing cross-session path corruption, and that `pre-tool-use.sh` and
`session-start.sh` use `event["cwd"]` too, so all three hooks stay on one path.

**That choice is right and should be kept.** `event["cwd"]` is the correct *per-session*
source. The defect is one layer up: it is used as a **project root** without being resolved
to one. `:605`'s comment states the assumption outright — `.buddy/<sid> → project` — and it
holds only when cwd happens to be the repo root.

The resume/compact path at `:296` already shows the hazard was noticed in a neighbouring
form: *"Without this, project_root collapses to `Path("")` and the .codescout detect below
resolves relative to whatever cwd python landed in."* The fix there was to supply a cwd; the
remaining gap is that a cwd was never enough.

## Fix

Resolve `event["cwd"]` upward to the nearest ancestor holding a project marker — `.git`, or
`.codescout/project.toml` — with a bounded walk and a documented fallback to cwd when none
is found. Build `.buddy/<sid>` under *that*, and drop `:605`'s `parent.parent` derivation in
favour of the resolved value.

**There is no existing helper to reuse, and this is the part worth checking before writing
the fix.** The natural candidate, `codescout-companion/scripts/detect.py::_find_project_dir`,
is `return cwd / ".codescout"` — a single join, no walk (verified, `detect.py:68-69`). The
comment at `hook_helpers.py:310-311` cites that function as the resolution being matched,
which is accurate and is exactly why matching it is not sufficient. The walk has to be
written.

`git rev-parse --show-toplevel` is the one-liner but adds a subprocess to a hook on every
tool call; an ancestor walk for two marker names is cheaper and has no dependency.

**Migration:** existing stray directories are debris, not state worth moving — a session
whose state is split has already lost the ordering. Leave them; they stop being created.
Do not sweep them from other repos automatically, for the reason in `codescout:R-150`.

## Tests added

None yet. The case worth pinning: a fixture whose `event["cwd"]` is `<repo>/sub/dir` must
produce `<repo>/.buddy/<sid>`, and the assertion must read the resolved root rather than
re-deriving it from the returned path — re-deriving would pass in the broken world by
construction.

## References

- `codescout:R-150` — the deletion that removed this bug's own mtime evidence, and why the
  "interleaving or abandoned?" question was unanswerable. **Answered since — see the live
  reproduction below; it is interleaving.**
- `docs/issues/2026-08-31-judge-worker-reads-codescout-memory-not-memories.md` — filed
  alongside. `judge_worker.py:92` also has the directory name wrong, so the constraints
  block is dead on *every* cwd. Fixing this bug alone does not restore it.

## Live reproduction, 2026-08-31 22:39 — and it is wider than one hook

About an hour after this file was written, the same peer session recreated the same nested
directory in the same repo. Read this time, not removed:

```text
codescout/docs/issues/.buddy/<peer-sid>/
    active_plan.json      22:13
    cs_tool_log.jsonl     22:39   9724 bytes
    loaded_skills.json    22:35
    narrative.jsonl       22:39   6680 bytes
    state.json            22:39
codescout/docs/issues/.buddy/by-ppid/983773/{session_id,started_at}   22:35
codescout/docs/issues/.codescout/constitution-seen/<peer-sid>.json   22:35
```

**Two findings, and the second is the reason this section exists.**

1. **The split is real.** Both logs were being written seconds before the listing, while the
   same session's canonical `codescout/.buddy/<sid>/` was also live. So the judge's narrative
   is genuinely divided across two directories, and whichever one a judge worker reads holds
   part of the timeline. This upgrades Consequence 2: the judge does not merely get a wrong
   `project_root`, it can get an incomplete narrative.

2. **`hook_helpers.py:469` is not the only writer.** Two more cwd-relative planters, one of
   them in a different plugin:
   - `.buddy/by-ppid/<ppid>/` — the ppid-keyed rendezvous slot.
   - `.codescout/constitution-seen/<sid>.json` — **codescout-companion**, not buddy.

   So the fix cannot be a single call site. Whatever resolver the fix introduces has to be
   shared, or each writer will be corrected separately and at different times.

**Why the `.codescout/` one deserves its own look.** `.codescout/` is the directory name the
whole ecosystem treats as a project marker. It does not misfire *today* —
`detect.py::_find_project_dir` returns `cwd / ".codescout"` and callers test for
`project.toml` inside it, which this stray does not have. But the failure mode is one file
away: any writer that puts a `project.toml`-shaped file under a stray `.codescout/` makes a
subdirectory answer yes to "is this a project root?", and the detection is what several
hooks branch on.

Not cleaned up. The peer session is live, the directories are its state, and removing them
is what produced `codescout:R-150`.
