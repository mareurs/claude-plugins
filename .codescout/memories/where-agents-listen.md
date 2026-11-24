# Where an agent listens

The best place for an instruction that must change what an agent does is the system prompt: the text it has before its first step. In a codescout project that is `.codescout/system-prompt.md` (the server injects it into the main agent's instructions) or the project's `CLAUDE.md`. Text that reaches the agent later, in tool output or a hook message, is read and not acted on.

## Evidence (MEASURED 2026-11-24)

Scenario: a headless `claude -p` session adds three functions and, after the first, must triage ten open bugs (a severity and a note each, about twenty box writes) with real work left. The pointer is one line: a tracker job of about ten entries or twenty box writes goes to a background fork, `get_guide("scribe")`. Six runs per arm; all 24 runs were correct.

| Pointer sits in | Forked | Wall time | Cost |
|---|---|---|---|
| nowhere | 0 of 6 | 117 s | $0.73 |
| the output of the first `codescout box` call (the card) | 0 of 6 | 127 s | $0.72 |
| `CLAUDE.md` | 6 of 6 | 78 s | $0.75 |
| `.codescout/system-prompt.md` | 6 of 6 | 94 s | $0.84 |

- The card line reached every run (checked at the bytes) and changed nothing.
- In the 13 runs without a pointer no agent called `get_guide` for any topic, so a pointer inside a guide is not reached either.
- Hook arms on small jobs: advice once per session in a deny message changed nothing (0 of 16); a refusal that blocked the call forced the fork (8 of 8) but cost 29 to 400 percent more than doing the job inline.

## How to apply

- To change what an agent does, put the sentence in the system prompt or `CLAUDE.md`. Put it in a hook message or a tool result only if the text is a fact or a refusal.
- Pointers inside a skill or guide reach only the agents that already load it.
- A line in `server_instructions` (cap 1900 characters) was tried once, on small jobs and with the old threshold (0 of 6). It is untested with the count threshold.
- A fork pays only for a big job: about ten entries or twenty writes. One to three operations cost more in a fork.

## Where the full record lives

- Spec: `docs/superpowers/specs/2026-11-24-scribe-fork-design.md` in the codescout branch `scribe-fork` (unmerged), sections "Result — unprompted use", "the pointer in the box card", "the pointer in the project system prompt".
- Harness: `tests/acceptance/scribe-fork/` in the claude-plugins branch `scribe-hook` (unmerged): `run.sh <A|B|F|M|L> <n>`, arms by the first letter of the run name (n, f, u, c, s).
- The codescout rule: `src/prompts/README.md`, rule 11.
