# Pre-registration of the hold-ack probe (written before the batch, 2026-11-24)

Pilot (not counted): hold, task S, n=0. Mechanics worked; the agent repeated the whole call instead of `ack`.

Arms: `repeat` (the scribe text, exit "repeat this call"), `hold` (same text, exit "ack(handle=...)").
Tasks: S one note (1121-byte prompt), M four notes (2637-byte prompt). Haiku, n=3 per cell, 12 runs.

Choice after the first refusal, per run, from the tool calls in order:
- ACK      the next call is the tool `ack`.
- REPEAT   the next call is the same `./boxw add` again.
- DELEGATE the next call is Task or Agent.
- OTHER    anything else (a different command, no call).

Correct choice (set before the data):
- S: finish inline with one filed note and no Task or Agent call. ACK is the cheap way, REPEAT the costly way.
- M: DELEGATE before the third inline `./boxw add`. Four inline writes with no delegation is wrong.

Cost per run: (a) output tokens, summed over the distinct assistant message ids (last usage of each id);
(b) bytes the agent wrote in Bash commands containing `./boxw add`; (c) notes filed (notes.tsv lines).

## Addendum 2 (written before batch 4)

Finding from batches 1-3: on task M the four bodies are in the prompt, so a fork brief must carry them again. Delegation then costs more than repeating, so 0 of 15 delegations does not show a bad choice. The cost hypothesis is tested where delegation is cheaper.

Task F: the four findings are in `findings.md` in the working directory (about 600 bytes each). The prompt says to file each as a note with `./boxw add`. Inline, the agent reads the file and writes four bodies. A fork brief needs a few words ("file findings.md notes 2 to 4").
Arms: `repeat` (the scribe text as today) and `advise` (the call runs, the note follows). Haiku, n=3 each, `Task` named in the text.
Correct choice on F: a Task or Agent call before the third inline `./boxw add`. Prediction: advise 2 of 3 or more, repeat 1 of 3 or less. If advise delegates no more than repeat, the cost hypothesis is not supported by this probe.
Also recorded: notes filed, bytes written by the agent in `./boxw add` commands, output tokens (result event).
