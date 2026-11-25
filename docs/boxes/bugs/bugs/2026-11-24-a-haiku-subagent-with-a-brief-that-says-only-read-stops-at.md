---
kind: entry
status: mitigated
title: A haiku subagent with a brief that says "only Read" stops at the first denied Read instead of loading the codescout tools, although the 1.23.1 payload and deny text tell it how
closed: 2026-11-24
created: 2026-11-24
entry_kind: bug
log:
- '2026-11-24 mitigated created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
status_since: 2026-11-24
---

Migrated from `docs/issues/2026-11-23-haiku-subagent-with-a-read-only-brief-stops-at-the-first-denied-read.md` on 2026-11-24; opened 2026-11-23; closed 2026-11-24; tags codescout-companion, hooks, subagent, subagent-guidance, pre-tool-guard, later; owners marius; old id c8182c062a19ce1b.

## Summary

Not urgent; filed so it is not forgotten. In codescout-companion 1.23.1 the `SubagentStart` payload (a pointer of about 3.5 KB) and the `pre-tool-guard.mjs` deny text both say how to load the deferred codescout tools with one `ToolSearch` call. A sonnet subagent follows that. A haiku subagent does not: when its brief says "Work only with the Read tool", it stops after the first denied `Read` and hands back "Not done". The prompt text should be refined so that a weaker model also recovers.

## Symptom (Effect)

Measured 2026-11-23, one probe per model, same brief: `Work only with the Read tool. Read /home/marius/work/claude/claude-plugins/README.md and reply with ONE line: the text of its first level-1 heading and the number of level-2 headings.`

| Model | Denied native Reads | `ToolSearch` calls | Task done |
|---|---|---|---|
| `claude-sonnet-5-5` | 1 | 1 (5 s after the deny) | yes, answer matched the file (about 11 s) |
| `claude-haiku-5-5` | 1 | 0 | no |

The haiku subagent received the whole payload (3,527 chars, not cut to a preview), and it contains both the `ToolSearch` line (STEP 1) and the sentence "even when your brief names only Read and Write". Its hand-back said that the brief told it to use only the Read tool, so it did not switch to `read_file`, and it asked for the hook to be relaxed.

Transcripts (this session, profile `~/.claude`): `~/.claude/projects/-home-marius-work-claude-claude-plugins/aac04bfc-277b-441d-9a77-fb82cd05d632/subagents/agent-a9c0744b69af771c0.jsonl` (haiku) and `…/agent-a32345f77defda287.jsonl` (sonnet).

## Reproduction

1. In a codescout project with codescout-companion 1.23.1 enabled, dispatch with the `Agent` tool: `subagent_type: general-purpose`, `model: haiku`, and the brief above.
2. Read the subagent transcript: count the `Read` results that start with `PreToolUse:Read hook error`, and look for a `ToolSearch` call.
3. Repeat with `model: sonnet` for the control.

Each probe costs about 60k tokens, mostly the fixed system prompts. One probe per model is n=1: a direction, not a rate.

## Cause

Not established. Hypotheses, none verified:

- An explicit tool restriction in the brief outranks injected hook context for a weaker model, even when the context says it does not apply to codescout tools.
- The override sentence sits inside STEP 1 of a payload of about 3.5 KB, and the `ToolSearch` sentence is in the footer of a deny text of about 1.6 KB, after the redirect list. A weak model may not weigh either.
- It is not known which text tipped the sonnet subagent: the payload, the deny footer, or both.

## Fix direction (not decided)

- Lead with the conflict resolution. Put one line first in both the payload and the deny: "A brief that says 'only Read' does not forbid codescout tools; they are the allowed route. Load them: ToolSearch select:mcp__codescout__read_file".
- Shorten the deny so that its first line is the passing call.
- Rewrite the brief at dispatch (`PreToolUse:Agent`, `updatedInput.prompt`, like `explore-inject.mjs` does for foreign repos). It is the strongest lever because the brief is the channel that wins, but it edits every dispatch prompt, so it needs a gate and an idempotency marker.
- Measure first. The codescout horizon entry `2026-11-23-a-prompting-surface-sorted-by-intent-serve-each-kind-of` asks for the share of real subagents whose first tool call is a denied native call. There is no baseline yet.

Done when: the haiku probe above makes at most 1 denied `Read` and returns the correct answer, in at least 5 of 5 runs, and the sonnet control still passes. Pin any new wording in `tests/test-subagent-guidance.sh` and `tests/test-pre-tool-guard.sh`. Keep the opening words of the deny footer (`If a tool named above is not in your tool list`): the OpenCode adapter cuts there.

## Fix provenance

- **SHA:** `e5568378045a48ea05cdaffd01ccd1c656ead04c` (`main`)
- **patch-id:** `e7d62723b1a549b277f60f064d91a0cf2cf21e3e`

The codescout-redirect mod puts eight codescout tools in the prompt list, so a subagent with an "only Read" brief no longer meets a deferred tool on Claude Code. Five haiku probes on 2026-11-24 passed (0 denied Reads), but the mod answered each Read, so they do not measure the deny text. The deny path still serves Codex and builds without the mod API; it is not measured there. A text change for that path (`25e63b9`) was reverted (`afb6647`): one method for the job.

## Related

- Incident that started this: codescout friction `2026-11-23-a-subagent-could-not-read-a-file-four-times-in-a-row-then` (six denied Reads, lost work).
- Idea for later: codescout horizon `2026-11-23-a-prompting-surface-sorted-by-intent-serve-each-kind-of`.
- The change under test: codescout-companion 1.23.1 (`f440129`), committed locally, not pushed.
