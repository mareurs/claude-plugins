---
kind: entry
status: proposed
title: A hook that steers an agent lets the call run and attaches the note; it refuses only a call that must not run
confidence: medium
created: 2026-11-24
entry_kind: proposal
log:
- '2026-11-24 proposed created codescout:ce0a6936-5650-4ce2-bd20-10d01f955692'
revisit_by: 2026-12-24
source: operator, 2026-11-24; probe research/hold-ack-probe-20261124
status_since: 2026-11-24
---

**Decision:** When a hook only wants to steer the agent (a nudge, a hint, a policy that the agent may decline), it lets the call run and puts the note after the result. It refuses (deny) only a call that must not run: a hazard, a policy that has no safe reading, a state that must change first. A refusal that expects the same call again is the pattern to leave.

**Scope:** PreToolUse hooks of `codescout-companion` that ask for the same call twice: `scribe-nudge.mjs` (refuses the first `codescout box` write of a window, a repeat passes) and the breaker of `pre-tool-guard.mjs` ("retrying releases it"). Not the guards that name a different fix: `door-shell-guard`, `git-worktree-guard`, `constitution-guard`, `worktree-write-guard`.

**Context:** 2026-11-24. The operator's worry: the agent writes the same large call twice, and what the agent writes costs several times what it reads. The probe: a mod in headless `claude -p` (Claude Code 2.1.331, Haiku, n=3 per cell, a stub in place of `codescout box add`, the real scribe text; criteria written in `PREREG.md` before each batch). Note: the call runs and the note follows in the `context` field of the answer (`{result, context}`) or, in a classic hook, in `additionalContext` (`contextPreToolUse` in `lib.mjs`).

| task | arm | output tokens | bytes of command written |
|---|---|---|---|
| S, one note of 1 KB | refuse and repeat (today) | 1241 | 2163 |
| S | run and note | 512 | 1088 |
| M, four notes in the prompt | refuse and repeat | 1814 | 3400 |
| M | run and note | 1454 | 2750 |
| F, four notes in a file | refuse and repeat | 3715 | 5475 |
| F | run and note | 1560 | 2424 |

Output tokens come from the `result` event. Bytes: S and M count the `./boxw add` commands the agent wrote; F counts every tool call, because the agent read the file and sometimes used a loop. The spread is large at n=3 (F, repeat: 2096 to 5565); the direction is the same on all three tasks.

**Alternatives considered:**
- Refuse once and let a repeat pass (today). Lost: the agent writes the call twice. Every agent in every `repeat` run repeated the whole call.
- Hold the refused call under a handle and let the agent say `ack` (a tool a mod registers; the replay through `$.tool.call` worked and the note was filed). Lost: the agent chose `ack` in 1 of 9 counted runs (S 1 of 3, M 0 of 6) and repeated the whole call in the others; the pilot run repeated too. When it was used it halved the bytes written (1102 against about 2165). A habit beats a new tool at this n.
- Offer a fork as the cheap way. Not supported: no agent delegated in 21 runs (tasks M and F, every arm), also when the content was on disk and the fork brief would have been a few words. The text asking for a fork was ignored whether or not it was cheap.

**Consequences:** Now easier: no second write, no new tool, no handle to explain; fewer output tokens in every cell. Now harder: the first call has already run, so a hook cannot stop a large edit that should have been delegated; the note has to carry the advice for the next call. A deny stays for the cases that need a real change.

**Not measured:** a model other than Haiku; a real session; a real fork (the stub never needed one); wording of the note; why no agent forks. The mod sat in the working directory of each run, and one run listed it (names only).

**Rests on:** `CLAUDE.md` § IRON LAW rules 5 (few turns: one call that answers beats a call and a follow-up) and 6 (lenient: do what the agent meant, say what was understood).

**Unanchored:** not built. The probe mod and scripts are in a session scratchpad; the numbers are in the memory topic `research/hold-ack-probe-20261124`.

**Revisit-when:** `scribe-nudge.mjs` ships this and a replay of real sessions shows how often the agent forks or edits inline afterwards; or the probe is repeated on Sonnet with a task the agent plans itself.
