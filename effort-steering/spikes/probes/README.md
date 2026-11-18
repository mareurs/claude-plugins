# ES-17 probes (throwaway)

Scripts behind the results in tracker ES-17 (`docs/trackers/effort-steering-second-phase.md`): can a Claude
Code mod (`turn.step`) set the request's effort, does it reach the API, and what does a change do to the
prompt cache. They call the real API. Delete this directory with `effort-steering/spikes/` before any
`plugin.json` lands.

## Run

```
export PROBE_DIR=$(mktemp -d)            # scratch directory OUTSIDE any repo
export CLAUDE_CONFIG_DIR=~/.claude       # the profile whose credentials and transcripts are used
bash effort-steering/spikes/probes/run-boundary.sh
python3 effort-steering/spikes/probes/analyze-boundary.py
```

Every script needs `PROBE_DIR`, spends model calls on Sonnet 5.5 (`claude-sonnet-5-5`, plus Haiku 4.5 in
`run-i2.sh`), and caps each call at 2 USD. Read the script's header for its call count first. Results were
measured with Claude Code 2.1.292.

## Contents

| File | What it answered (see ES-17 for the numbers) |
|---|---|
| `mods/effort-observer` | Read-only: does `turn.step` fire, and what do `effort`, `model`, `index` hold. Hot-reloaded into a live session; set `DIR` in its `register.ts` first. |
| `mods/effort-rewriter`, `run-probe1.sh` | Does `next({ ...e, effort })` change the request (one word in `.effort-probe`): none, low, high on one prompt. |
| `mods/effort-stepper` | Effort per step index from a comma list in `.effort-probe` (`medium,medium,high`). |
| `run-probe2.sh`, `analyze-probe2.py` | Mid-turn change, tools limited to `Read`, a trivial 5-request loop. |
| `run-probe3.sh`, `analyze-probe3.py` | Mid-turn change, default tools, a puzzle loop that makes the model think. |
| `run-i1.sh` | Does `--debug-file` show the request's effort? (No.) |
| `wire_recorder.py`, `run-i1b.sh` | A localhost recorder in front of the API that logs only the effort-related fields; one B-arm run through it. |
| `mods/step-switcher`, `run-i2.sh` | Positive control: a model switch at step 2 must break the cache (it did). |
| `run-boundary.sh`, `analyze-boundary.py` | Effort change at a turn boundary (resumed session), with same-effort controls. |

## Rules these probes learned

- Run `claude -p` with stdin from `/dev/null`. A `claude -p` inside a `while read` loop reads the loop's
  input file and answers every line at once; a peer's first pilots were invalid for that reason.
- Count a message's thinking blocks over ALL records of the message id. The thinking block sits in an
  earlier transcript record than the `tool_use` or text of the same message, so reading only the last
  record shows none.
- The cache check is `read(k) = read(k-1) + creation(k-1)`. It needs a positive control (`run-i2.sh`) before
  a "no miss" result means anything.
- Cache numbers sent through the recorder (`ANTHROPIC_BASE_URL` set) came out about twice as large as the
  same run sent direct; do not mix the two paths.
- The recorder binds to 127.0.0.1 and forwards the client's credentials to the upstream unchanged. It logs
  no headers except the Claude Code session id and the beta header, and no message text.
- No script here has a unit test. They are instruments, not product code.
