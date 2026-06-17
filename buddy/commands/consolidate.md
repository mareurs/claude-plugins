---
description: Consolidate accumulated memories — merge near-duplicates, archive stale entries, summarize tag-clusters, surface contradictions for resolution. Runs as a four-phase pipeline (rules shortlist → specialist judgment → user dry-run gate → apply). Pass a target (specialist alias, `common`, `all`) or one of the sub-commands `apply`/`revise <text>`/`cancel`. With no argument, consolidates memories of currently active specialists.
---

You are running memory consolidation. The argument passed by the user is `$1`.

<!--
Specialists this command can target (alias-table parity with summon.md):
- `debugging-yeti`
- `testing-snow-leopard`
- `refactoring-yak`
- `ml-training-takin`
- `performance-lammergeier`
- `planning-crane`
- `architecture-snow-lion`
- `docs-lotus-frog`
- `data-leakage-snow-pheasant`
- `security-ibex`
- `prompt-hamsa`
- `codescout-pika`
-->

## Step 1 — Parse the argument

Trim `$1`. Cases:

- Empty: target = each currently-active specialist (load `active_specialists` from session state) plus their `common/` overlap. If `active_specialists` is empty, print `→ no active specialists. Use /buddy:summon first, then /buddy:consolidate.` and stop.
- One of `apply`, `revise`, `cancel`: skip to Step 6 (sub-command routing).
- Otherwise: resolve to a specialist directory using the alias table in `summon.md`. If unresolved or ambiguous, print the table and stop. Special targets:
  - `common` → operate on the `common/` bucket; judged by each currently-active specialist in turn.
  - `all` → every specialist directory under each channel root. Confirm before proceeding: print `→ this will consolidate every specialist's memories — type /buddy:consolidate all confirm to proceed.` Only the literal argument `all confirm` proceeds.

## Step 2 — Resolve channel roots

Use the existing helpers from `scripts/memory.py`:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts import buddy_paths
print(buddy_paths.global_memory())
" 2>&1
```

Global channel: `${BUDDY_HOME:-~/.buddy}/memory/`. Project channel: `<cwd>/.buddy/memory/` if it exists.

For each (channel, specialist) pair, run Step 3.

## Step 3 — Phase 1: build the candidate brief

```bash
python3 -c "
import sys, json
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import find_candidates, render_brief
cand = find_candidates(Path('<channel-root>'), '<specialist>')
print(render_brief(cand))
"
```

Substitute `<channel-root>` and `<specialist>` with the resolved values. Capture stdout — that is the brief.

If every category is empty (no slug groups, no clusters, no stale, no contradictions, no orphans), print `→ <specialist> in <channel>: nothing to consolidate.` and skip to next pair. Do not invoke the specialist.

## Step 4 — Phase 2: emit the brief + protocol, await the plan

For the resolved specialist, the specialist must already be summoned (or you summon it first via `/buddy:summon <specialist>` — but only with explicit user consent on this turn; do not auto-summon).

Inject (verbatim) into the active turn:

1. The candidate brief from Step 3.
2. For every entry path referenced anywhere in the brief, the **full body** of that file. Use `mcp__codescout__read_markdown` (preferred) or `Read`.
3. The contents of `${CLAUDE_PLUGIN_ROOT}/data/consolidation-protocol.md`.

Then say to the specialist:

> Emit your consolidation plan as a YAML fenced code block per the protocol's required schema. Nothing else in your response will be parsed.

Wait for the specialist to respond.

## Step 5 — Parse and cache the plan

Extract the first `yaml` fenced code block from the specialist's response. Pass it to the parser:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import parse_plan
plan_text = open('<temp-plan-file>').read()
plan = parse_plan(plan_text)
import json; print(json.dumps(plan, default=str))
"
```

If parsing raises `ValueError`, report `→ specialist plan was unparseable. Raw response saved at <temp-plan-file>. Run /buddy:consolidate revise <feedback> to retry.` and stop.

If parsing succeeds, write the rendered plan markdown to `<channel-root>/.consolidation-plan.md` (this file is what the user reviews). Render via `render_plan_for_user(plan)` (filled in Task 12).

Also write the raw YAML plan (the same string parsed by `parse_plan`) to `<channel-root>/.consolidation-plan.yaml`. This is what `apply_plan_from_cache` re-parses. The `.md` file is for humans; the `.yaml` file is for the script.

For Tasks 1–11, until `render_plan_for_user` is wired, stash the raw YAML at the cache path and announce: `→ dry-run plan cached at <path>. /buddy:consolidate apply | revise <text> | cancel`.

## Step 6 — Sub-command routing (apply / revise / cancel)

If `$1` is `apply`, run:

```bash
python3 -c "
import sys
sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}')
from pathlib import Path
from scripts.consolidate import apply_plan_from_cache
result = apply_plan_from_cache()  # walks every channel for plan files
print(result)
"
```

If `$1` is `revise <text>`, re-run Steps 3–5 with the user's feedback appended to the brief sent to the specialist. The text after `revise` is the feedback. Append a section `## User feedback (consider before plan)` containing the text verbatim.

If `$1` is `cancel`, delete every `.consolidation-plan.md` under both channel roots and announce.
