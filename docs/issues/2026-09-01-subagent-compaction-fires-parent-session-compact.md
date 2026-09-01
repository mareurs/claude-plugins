---
id:
kind: bug
status: open
title: A subagent's compaction fires SessionStart source=compact under the PARENT's session id — wiping the parent's session state and routing the recon reload into the subagent
opened: 2026-09-01
owner: marius
severity: high
tags:
  - cluster/shared-resource-carries-no-owner
  - buddy
  - compaction
  - subagents
  - session-state
related: []
unverified: "one thread open and BLOCKED ON A HUMAN: a genuine main-session compaction has never been observed delivering the recon reload end-to-end (needs a real /compact, which a session cannot trigger); restored hookResults are unconfirmed as reaching the model. `fork` handling and agent_id-based subagent detection are both closed."
partially_fixed: 2026-09-01 — state clobber only, with regression test
---

# A subagent's compaction fires `SessionStart source=compact` under the PARENT's session id

## Summary

`buddy/scripts/hook_helpers.py::handle_session_start` states an assumption in a
comment and builds two behaviours on it:

```python
# SessionStart carries a "source" field: startup | resume | clear | compact.
# Only "startup" events can originate from a subagent; resume/clear/compact
# are user-initiated on the same session and must always reset signals.
```

**The assumption is false.** When a *subagent* runs out of context, Claude Code fires
`SessionStart` with `source=compact` carrying the **parent's** `session_id`. Two things
follow, and neither is visible to anyone:

1. **The reconnaissance reload block never reaches the main conversation.** It is
   emitted (correctly, 45 KB of it), but the compaction that fired it was the
   *subagent's* — so by the dispatch code the block is restored into that subagent's
   context, not the parent's. See § *Root cause*.
2. **The main session's summoned specialists are silently dismissed** and
   `cs_active_project` / `root_cwd` are reset, because the handler treats the event as a
   user-initiated compact of the main session.

The design intent is documented twice in the source — *"Reconnaissance is the one
exception: re-injected when codescout is the backend"* — so this is a delivery failure,
not a missing feature.


## Fixed 2026-09-01 — consequence 2 only (the state clobber)

`handle_session_start` now returns immediately, mutating nothing, when the event
carries `agent_id` and `source != "startup"`:

```python
if str(event.get("agent_id") or "").strip() and source != "startup":
    …append a SKIPPED=subagent-scoped-event trace line…
    return
```

Three properties worth stating, because each was a choice:

- **`agent_id`, not a heuristic.** CC's hook schema names it the discriminator and it
  is source-independent. buddy used `agent_id` nowhere before this.
- **`startup` is excluded on purpose.** A subagent *startup* carries its OWN
  session_id, and the existing `is_subagent` branch is meant to clear that subagent's
  narrative/verdict files. Routing startup through the new early return would leak
  them.
- **It still writes a trace line.** The original defect was silent in every direction;
  a fix that returns quietly would make the *next* variant equally silent. A skipped
  event is now visible as `SKIPPED=subagent-scoped-event`.

Regression test: `buddy/tests/test_hook_helpers.py::
test_session_start_compact_from_subagent_leaves_parent_state_alone`. It fails on the
pre-fix code with `assert [] == ['debugging-yeti', 'prompt-hamsa']`, and its captured
stdout shows the user-facing harm directly — a dismissal notice reading *"the
specialists summoned earlier were released"*, fired by a subagent's compaction.

Suites after the fix: buddy pytest **503 passed** (502 + this one), `tests/run-all.sh`
**16/16**. The genuine main-session compact behaviour is unchanged — the pre-existing
`test_session_start_compact_releases_active_specialists` still passes.

## Next — the routing half, deliberately NOT fixed here

The state clobber is fixed above. Of the three follow-up threads this section originally
listed, **two are now closed** and one remains.

**Closed 2026-09-01 — `fork` is handled.** The enum is
`["startup","resume","clear","compact","fork"]`; buddy knew four. `fork` now takes
**resume** semantics — carry specialists forward, emit nothing — and the schema decides
that rather than taste: `seconds_since_last_response` and `context_tokens` are both
documented *"resume/fork: … the resumed transcript's last response"*, so a fork has a
restored transcript and the persona bodies are already present. Pinned by
`test_session_start_fork_behaves_like_resume`.

**Closed 2026-09-01 — `agent_id` is now the primary subagent test, and it caught a
second defect.** The old heuristic required `ts - prev_start_ts < 600`, so a subagent
dispatched **more than ten minutes into a session** was read as a brand-new top-level
session and reset the parent's signals — a live bug in its own right, not merely an
inelegance, and one this file did not predict. `agent_id` carries no time bound. The
timing heuristic is retained as a fallback for builds that do not send the field. Pinned
by `test_session_start_subagent_startup_detected_by_agent_id_beyond_the_600s_window`.

**Still open — where a reload should route on a GENUINE main-session compaction.**

- Subagent compaction now emits nothing, which is correct: a subagent that just ran out
  of context is the last place to inject a 45 KB skill body, and the parent did not
  compact, so it needs no reload.
- The main-session path is *believed* to work. The emit is proven (44,964 bytes) and the
  dispatcher provably restores `hookResults` into the compacted context. **It has never
  been observed end-to-end**, because no genuine main-session compaction occurred in the
  measured window — every `source=compact` event in 24 h was subagent-induced.

Closing it needs a real `/compact` in a session with codescout as the backend, followed
by a transcript check for `buddy:reloaded`. **That cannot be triggered from inside a
session** — `/compact` is the user's command — so this thread is blocked on a human, not
on analysis.

Settle this first while doing it: restored `hookResults` appear in **no** transcript, so
"the reload reached the model" currently rests on the code path alone. A reload that is
generated and silently dropped looks identical to one that worked, which is the same
class of silence as the original defect.
## Measured 2026-09-01

Session `8232b1a0-0e5f-4a61-bb44-805ec8190b81` (`~/.claude-kat`), which spawned five
subagents.

| observation | value |
|---|---|
| `source=compact` events in `.buddy/.session-start-trace.log`, last 24 h | **1** |
| that event's `sid` | `8232b1a0…` — the **parent** |
| that event's ts | `1788225467` = `01:17:47Z` |
| `cs_toml` on that event | `True` → so `recon_reload` was `True` |
| `isCompactSummary: true` entries in the **parent** transcript | **0** — it never compacted |
| `isCompactSummary: true` in subagent `agent-a9c27143b46a30884.jsonl` | **1**, at `01:17:46.891Z` |
| `buddy:reloaded` delivered to that subagent | **0** |

The subagent's compact summary and the trace event land in the **same second**. That
subagent ran 588 s and 113,639 tokens — the largest of the five — and is the only one
that compacted.

Its post-compaction context is the 24,991-char summary alone. Probing that summary:

```
contains 'reconnaissance'        : False
contains 'Reloaded from compact' : False
contains 'seam'                  : False
```

## The code path is sound — only the routing is broken

Fed a synthetic `source=compact` event with `.codescout/project.toml` present, the real
hook emits the block correctly:

```
$ echo '{"session_id":"test-compact-1","source":"compact","cwd":"<tmp>",...}' \
    | CLAUDE_PLUGIN_ROOT=<repo>/buddy node buddy/hooks/run.mjs session-start
<!-- buddy:reloaded sid=test-compact-1 from= source=compact -->
Reloaded from compact — and ONLY these, nothing else: reconnaissance.
## reconnaissance
# /codescout-companion:reconnaissance
...
                                                    → 44,964 bytes
```

So `recon_reload`, `find_skill_md`, and `render_reload_block` all work. `recon_skill=`
in the trace log resolves on every compact event — **but that field is purely
diagnostic** (its own comment says so: *"Diagnostic trace … Helps debug reload
failures"*). It records that the path was *found*, never that the body was *delivered*.
Reading a green `recon_skill=` as "recon reloaded" is the trap this bug hides behind.

## Consequence 2, reproduced

```
BEFORE: active_specialists=["debugging-yeti","prompt-hamsa"]  cs_active_project="/some/proj"
   (one source=compact event)
AFTER : active_specialists=[]                                 cs_active_project=null
```

`state["active_specialists"] = []` at the `if source == "compact"` branch. So any
long-running subagent that exhausts its context releases the parent's specialists
mid-conversation, with no dismissal notice reaching the parent — the notice, like the
reload block, goes to the same nowhere.

In the measured session `carried=-` (no specialists were summoned), so nothing was
visibly lost. Two **earlier** compact events in the same trace log carry
`carried=prompt-hamsa`, which shows the field is live and the loss is reachable.

## Root cause — read from the dispatch code

**Read from the dispatch code 2026-09-01** — this section replaces the earlier
"inferred from correlation" boundary. Claude Code 2.1.252,
`/home/marius/.local/share/claude/versions/2.1.252`, located by byte offset.

The compaction routine fires the SessionStart hook itself:

```js
// @182667959
if (!y)
  t.onCompactEvent?.({type:"compact_progress",
                      event:{type:"hooks_start", hookType:"session_start"}}),
  z = await P4(t.session, "compact",
               {model:t.options.mainLoopModel, storageV5:…, credentials:…});
return {attachments:[…], hookResults:z}
```

where `y = Ca(t.agentContext)`, and `Ca` (@176937189) is:

```js
function Ca(e){ return e?.agentType==="subagent" && e.delegatedObservation===!0 }
```

Three things follow, none of them correlational:

1. **The gate excludes only `delegatedObservation` subagents.** An ordinary subagent —
   `agentType==="subagent"` without that flag — falls through `!y` and **does** fire
   `SessionStart source=compact`. buddy's comment ("Only `startup` events can originate
   from a subagent") is contradicted by the dispatcher, not merely by a timestamp.
2. **The call passes `t.session` with no `sessionId` / `agentType` override.** Contrast
   the five startup call sites, which pass them explicitly:
   `u3(…,{kind:"session-start",source:"startup",agentType:cn?.agentType,…})` →
   `P4(b, w.source, {sessionId:w.sessionId, agentType:w.agentType, …})`. The compact
   path supplies neither, which is why the payload carries the **parent's** id — as the
   trace log shows.
3. **`hookResults` are restored into the compacted context**, alongside attachments:
   `xe = {boundaryMarker, summaryMessages, messagesToKeep, attachments,
   hookResults: Ee.hookResults, …}` and
   `restoredAttachmentCount: Ee.attachments.length + Ee.hookResults.length`.

Point 3 **corrects the Summary's original claim** that the block "goes nowhere." By the
code path it goes into the *subagent's* restored context — so the 45 KB reconnaissance
body is injected into a subagent that never asked for it, immediately after that
subagent was compacted **for running out of context**. That is a context-budget insult
on top of a lost feature.

What is still not directly observed: the block does not appear anywhere in
`agent-a9c27143b46a30884.jsonl` (`buddy:reloaded` = 0 across the file), so restored
hookResults are evidently not written to the subagent transcript. "It reached the
subagent's model" therefore rests on the code path, not on a transcript observation.
What **is** settled either way: it never reaches the main conversation, which is the
only place a post-compaction reconnaissance reload was meant to land.
## Why it is silent

Every layer reads healthy. The hook runs, the trace logs a resolved recon path,
`cs_toml=True`, no exception is raised, and the block is generated. Nothing anywhere
records that the bytes had no reader. The only way to see it is to compare the trace
log's compact events against `isCompactSummary` in the transcripts — two files that no
check joins.
