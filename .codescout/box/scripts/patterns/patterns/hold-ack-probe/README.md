# Hold-and-ack probe (measured 2026-11-24, Claude Code 2.1.331, Haiku, headless `claude -p`)

Question: when a hook refuses a call that the agent must repeat in full, can the refusal hold the call under a handle and let the agent say `ack` instead? Does the agent choose well (short task inline, several edits another way)?

## Files (this folder, `.codescout/box/scripts/patterns/patterns/hold-ack-probe/`)

The box `patterns` holds only markdown entries (`codescout box patterns check` refuses any other file in the box folder), so the probe lives in the box's scripts folder, in a subfolder with no `.py` at the top level (a top-level `<name>.py` there would become a verb of the box).

- `mod/`: the dev mod (`hooks/register.ts`, `hooks/hooks.json`, `.claude-plugin/plugin.json`). `config.json` is written per run by `run_one.sh`.
- `run_one.sh`: one run. `RUNS_DIR=<dir outside the repository> [FORK_TOOL=Task] ./run_one.sh <repeat|hold|advise> <S|M|F> <n>`. It copies `mod/` into the run directory, writes its config, makes the `./boxw` stub and runs `claude -p`.
- `gen_prompts.py <dir>`: writes the three prompts and `findings.md` (deterministic; the copies in `prompts/` are byte-identical).
- `analyze.py <parent-dir> <runs-subdir>`: the per-run table by the rules of `PREREG.md`. Its `out_tok` column is the `result` event's total.
- `PREREG.md`: the criteria, written before the batches.
- `results/runs.txt`, `runs2.txt`, `runs3.txt`, `runs4.txt`: the analysis of the four batches. The raw streams (about 2 MB) are not kept; the tool-call sequence and the figures of each run are in these files.

Rerun: `RUNS_DIR=$(mktemp -d) FORK_TOOL=Task ./run_one.sh advise S 1`, then `python3 -I analyze.py $RUNS_DIR/.. <name of the runs dir>`. About 0.005 dollars per run on Haiku.

Instrument: the dev mod in `mod/`. Run with `claude -p --setting-sources local --plugin-dir <mod>` so no companion or buddy hook fires. `--bare` needs ANTHROPIC_API_KEY, so it was not usable. Stand-in for `codescout box <key> add`: a stub `./boxw add`. Refusal text = the scribe text of `scribe-rules.mjs`, only the exit differs. Pre-registered in `PREREG.md` before the batch.

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

## Batch 4: task F, the content is on disk (added 2026-11-24, pre-registered in PREREG.md Addendum 2)
Prompt: "the four findings are in findings.md; file each with ./boxw add". A fork brief would be a few words; inline needs the agent to read the file and write four bodies. Arms `repeat` and `advise`, `Task` named in the text, n=3 each.

| arm | delegated | real notes filed | command bytes written (all tool calls) | output tokens |
|---|---|---|---|---|
| repeat | 0/3 | 4, 4, 4 | 6085, 3738, 6602 (mean 5475) | 3485, 2096, 5565 (mean 3715) |
| advise | 0/3 | 4, 4, 4 | 827, 3111, 3334 (mean 2424) | 1181, 1536, 1963 (mean 1560) |

- The prediction (advise delegates 2 of 3 or more) failed. The cost hypothesis, "agents do not delegate because the fork brief costs more", is not supported: no agent delegated even when the content was on disk. Delegation is 0 of 21 runs over tasks M and F.
- advise-F-1 solved the task with one loop command of 299 bytes (`for n in 1 2 3 4; do ... awk ... | ./boxw add ...; done`). The better "otherwise" the agent found was a script, not a fork. One run; the other five wrote the bodies.
- advise wrote fewer tokens than repeat on every task: S 512 against 1241, M 1454 against 1814, F 1560 against 3715. n=3 each, large spread (F repeat 2096 to 5565).
- Artifacts: the stub filed a 0-byte entry on `./boxw --help` in 3 runs (advise-F-1, advise-F-3, repeat-F-1); the table counts real notes only. advise-F-3 listed the `mod` directory in the working dir (names only, no source read). The mod sits in the run directory, which is a leak channel for a longer probe.
- Not measured: why no agent forks (the fork text may read as optional; `subagent_type="fork"` may not exist in the headless build; the stub task may be too small to need one).
