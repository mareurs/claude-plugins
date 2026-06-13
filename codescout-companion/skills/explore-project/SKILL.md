---
name: explore-project
description: Use when you explicitly want a READ-ONLY exploration of a DIFFERENT repo than the current one, returned as a structured findings report. Dispatches a subagent at the target repo; the explore-inject hook auto-bootstraps that project's CLAUDE.md + codescout memories. Routine cross-repo dispatches do NOT need this — the hook bootstraps them automatically.
---

# /codescout-companion:explore-project

Explicit, read-only exploration of a foreign project, returned as a findings block.

This is the **manual companion** to `hooks/explore-inject.sh` — the PreToolUse-on-`Agent`
hook that auto-bootstraps any subagent dispatch whose prompt names a path in a *different
git repo* (prepends that project's `CLAUDE.md` + codescout memories + a codescout-tool
directive). Use this skill when you want a *deliberate* exploration with a named topic and
a structured report; rely on the hook alone for routine cross-repo dispatches.

## When to Use

- You want a focused, read-only answer about a topic in another repo, returned as a
  structured `## Exploration` report.
- You want to name the topic and questions up front.

## When NOT to Use

- You're already dispatching a subagent at the foreign repo for normal work — the
  `explore-inject` hook bootstraps it automatically; no skill needed.
- You need to make changes → use a worktree-based workflow.
- The target is the current project → explore directly with codescout tools.

## Flow

1. **Parse args.** `[path] [topic]`. Infer from context; ask at most **one** clarifying
   question, and only if path or topic is genuinely missing.
2. **Dispatch** a `general-purpose` subagent with the template below — naming the target
   repo path and the topic. Do **NOT** hand-write the bootstrap (see Common Mistakes).
3. **Present** the subagent's `## Exploration` block as-is. Do not re-synthesize.

## Subagent Prompt Template

Pass verbatim to the `general-purpose` subagent. Substitute `<path>` and `<topic>`.

```
Read-only exploration of the project at <path> — a different repo than the current one.

Topic: <topic>

Questions to answer:
- <Q1>
- <Q2>

If a foreign-project bootstrap directive was not already prepended above this line,
first read_markdown("<path>/CLAUDE.md") (if present) and check
memory(action="list", workspace="<path>") for that project, reading the relevant
topics — before exploring.

Rules:
- READ-ONLY. Do not write or modify any file.
- Use codescout tools (symbols / semantic_search / grep / read_markdown / tree),
  pinned to the target with workspace="<path>" — not native Read/Grep/Bash on source.
- Answer every question, or flag it explicitly unanswerable.

## Response format — return ONLY this block

## Exploration: <topic>
**Project:** <path>

### Findings
- <bullet with file/symbol ref where relevant>

### Key files
- `path/to/file` — what it does

**Confidence:** high / medium / low
**Caveats:** <gaps or what couldn't be determined>
**Follow-up:** <next suggested explorations, or "none">

Do not include raw symbol dumps, full file listings, or meta-commentary.
```

## Common Mistakes

- **Hand-writing the bootstrap.** `explore-inject.sh` owns it. Writing
  `workspace(action="activate", ...)` into the prompt yourself trips the hook's
  idempotency guard and **suppresses** the richer auto-bootstrap (which adds the
  project's memories). Name the path + topic; let the hook prepend the bootstrap.
- **Asking more than one clarifying question.** Infer aggressively from context.
- **Re-synthesizing the subagent output.** Present the `## Exploration` block verbatim.
- **Using it for routine cross-repo dispatches.** Those are auto-bootstrapped — skip the skill.

## See also

- `hooks/explore-inject.sh` and `docs/plans/2026-06-13-explore-bootstrap-injector-design.md`
  — the auto-bootstrap hook this skill composes with (the contract: foreign iff the path
  resolves to a different git repo than cwd, by `git-common-dir` identity).
