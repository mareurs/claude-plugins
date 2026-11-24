# Hold-and-ack probe (measured 2026-11-24, Claude Code 2.1.331, Haiku, headless `claude -p`)

Question: when a hook refuses a call that the agent must repeat in full, can the refusal hold the call under a handle and let the agent say `ack` instead? Does the agent choose well (short task inline, several edits another way)?

Instrument: a dev mod `hold-ack-probe` (not in the repository; scratchpad of session ce0a6936, `ackprobe/`). Run with `claude -p --setting-sources local --plugin-dir <mod>` so no companion or buddy hook fires. `--bare` needs ANTHROPIC_API_KEY, so it was not usable. Stand-in for `codescout box <key> add`: a stub `./boxw add`. Refusal text = the scribe text of `scribe-rules.mjs`, only the exit differs. Pre-registered in `PREREG.md` before the batch.

## Mechanics (verified)
- A mod registers a tool with `$.tool.register({name, description, inputSchema, isDeferred:false})` and answers it in `on('tool.call', {tool:'mcp__<plugin>__<name>'})` with `{result}`. `isDeferred:false` put it in the prompt list (no ToolSearch).
- The replay worked: `$.tool.call({tool:'Bash', command})` ran the held command, the note was filed, the model got the output. The replay passes through the mod's own `tool.call` hook, so a `released` set is needed or the call is held again.
- `claude plugin validate` refuses a helper that takes `$` unless it is a top-level function declaration (not a closure inside `register`); `export const register: Register = on => {...}`, not `export default`.
- A hook can also answer `{result, context}`: the call runs and the model reads `context` after the result (arm `advise`).
- The headless build has the subagent tool named `Task`, not `Agent`; the scribe text names `Agent(...)`.

## Results (n=3 per cell, Haiku; output tokens from the `result` event, bytes = what the agent wrote in `./boxw add` commands)
Task S = one note (1 KB body). Task M = four notes (500 B bodies).

| arm | S: choice after refusal | S: out tokens | S: bytes | M: delegated | M: out tokens | M: bytes |
|---|---|---|---|---|---|---|
| repeat (as today) | REPEAT 3/3 | 1241 | 2163 | 0/6 | 1814 | 3400 |
| hold + ack | ACK 1/3, REPEAT 2/3 | 1427 | 1811 | 0/6 | 2011 | 3400 |
| advise (call runs, note after) | no refusal | 512 | 1088 | 0/3 | 1454 | 2750 |

M "delegated" for repeat and hold counts batch 1 (text names `Agent`) and batch 2 (text names `Task`): 0 of 6 each. Order of runs was interleaved; token spread is large at n=3, so only the advise-vs-others gap on S (about 60% fewer output tokens) is clear. When the agent did use `ack`, it wrote half the bytes (1102 against about 2165).

## Reading
- The agent prefers repeating the whole call to `ack` (ACK 1 of 3 on S, 0 of 6 on M), although a repeat also passes in the mod. The habit beats a new tool at this n.
- No arm made the agent fork on M (0 of 15 runs). The prompt gave the four commands, so the agent only executed them; a real session may differ. Not measured: a prompt where the agent plans the edits itself.
- `advise` has no refusal, no repeat and no new tool, and it was the cheapest arm on both tasks. It cannot stop the first write; the first note runs inline.

## Not measured
Other models, Sonnet, a real session, a real fork (the stub never needed one), an `ack` handle read by the fork, wording variants of the `ack` exit, a refusal as `{result}` instead of `{deny}`.
