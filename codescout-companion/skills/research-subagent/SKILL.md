---
name: research-subagent
description: Use when the user requests deep research, a report, or research whose raw results should stay out of the main conversation. Use research-web for a short inline lookup.
---

# Research in a cheap subagent

Use one inexpensive worker to call researcher MCP, read its report, and return findings.
The parent supplies the brief and presents the result; the worker does the research.

## Dispatch

Select the model explicitly on every dispatch, including fan-out workers:

| Harness | Dispatch |
|---|---|
| Claude Code | `Agent(subagent_type="general-purpose", model="claude-haiku-5-5", prompt=...)` |
| Codex | `spawn_agent(task_name=..., model="gpt-6-luna", reasoning_effort="low", fork_turns="none", message=...)` |

These are the research worker models, independent of researcher MCP's internal models.
If the requested model or dispatch capability is unavailable, report that limitation.
Do not silently inherit the parent's model or substitute a more expensive model.
An explicit user model choice overrides these defaults.
For another harness, use its native dispatch with an explicitly selected, available
low-cost model; if none is known, report the limitation.

## Parent workflow

1. Infer a short brief from the request: the question, relevant context/version,
   up to three questions to answer, and any source/date constraints.
   Ask only for missing information that prevents useful research.
2. Find the callable researcher tool in the live tool list. The current API is one
   `research(query, target?, ...)` dispatcher, usually `mcp__researcher__research`
   (pi: `researcher_research`). Use its actual name and schema.
   If absent, report the unavailable server before spawning.
3. Pass the brief, concrete tool name/arguments, and the worker prompt below.
   Pass only relevant context, not the conversation history or repository instructions.
   The worker does not need to load this skill or another reference guide.
4. Present its findings directly. Reconcile only if combining several workers.

Use one worker by default, including broad subjects. Fan out only when the user
requests parallel research: assign distinct questions, use the fewest workers needed,
honor an explicit count, and give each the same cheap-model and call limits.
The parent does not run separate grounding searches before delegation.

## Research arguments

Use `query` for the subject and `target` for the kind of research:
`topic` (default), `person`, `company`, `market`, `code`, or `jobs`.
Copy additional arguments from the live schema rather than inventing separate tools.

Default to `mode="report"` and `summary_style="toc"`: the worker reads the full report,
so an extra server-generated abstract is unnecessary.
For topic/market research, use `max_queries=3`, `max_sources=5` unless the user
requests a different budget. Honor an explicit mode such as `deep`.
These limits apply per worker; fan-out multiplies the work.

## Evidence audits (when requested)

Pass a writable audit directory in the brief. Retain exact MCP responses before
synthesis, including inline reports, plus any saved-report content. Copy saved files
mechanically with the helper below and retain its byte count and SHA-256 manifest;
never rebuild a snapshot by re-emitting a file-reading tool’s rendered text. The parent
records the worker's actual returned answer. Keep audit files outside skill discovery.
Check every factual statement against the retained evidence and every cited URL
against the URLs actually present; a plausible or correct-from-memory addition
still fails. A URL occurring in a source list alone does not establish a claim.
Score unsupported-claim runs and unsupported-URL runs separately, record explicit
gaps, and report the model, reasoning level, sample count, and inline/file path.
Calibrate automated URL checks against hand-reviewed supported and unsupported
examples before trusting zeroes; inspect factual claims separately. Missing raw
evidence is unscorable, not a pass. This checks grounding in the retrieved
material, not whether the material itself is true.

### Saved report snapshots

When an audit is requested, copy each saved report before synthesis:

```bash
python3 <this-skill-dir>/scripts/capture_evidence.py <report-path> <audit-dir> --sequence 1
```

Pass the resolved helper path to the worker. The helper copies raw bytes, verifies
the destination hash, and writes `full-report-1.manifest.json`. Increment the
sequence for another report. If copying fails, record the failure; a rendered or
reconstructed substitute is not an exact snapshot. Read the copied report for
synthesis. Inline responses must still be captured directly from the tool result
before synthesis; this file helper does not replace raw response capture.

## Worker prompt

Fill the placeholders and pass this prompt with the dispatch above:

```text
Research this brief using the named researcher MCP tool.
Use researcher for searching and a file-reading tool for its saved reports.

Brief: <question, relevant context, questions to answer, source/date constraints>
Tool: <actual callable tool name>
Arguments: <concrete JSON arguments>
Scope: <this worker's question/angle; exclusions if other workers own them>

1. Make the research call. The evidence is the complete inline response, or the
   full saved report after reading its path; an envelope summary alone is not
   the full report. If unreadable, state that limitation and lower confidence.
   If an audit directory was provided, save each exact tool response there before
   synthesizing (inline responses included) and copy any saved report with the supplied snapshot helper before reading it.
   Retain the helper’s byte count and SHA-256 manifest. Do not write a report copy
   from rendered tool text or reconstruct its Markdown.
   Do not reconstruct evidence after answering.
2. One refinement call is allowed only for a specific unanswered question:
   at most two researcher calls total. Stop after that and report remaining gaps.
   On an explicit tool/server error, including error text with isError=false,
   return the error and stop.
3. Build the answer from supported findings and explicit gaps:
   - Each factual statement needs supporting text in the response/report you
     actually read. A source URL or title alone does not support further facts.
   - Cite only exact URLs present in that evidence. Familiar chapter numbers,
     remembered links, and plausible URL completions are still outside evidence.
   - For each requested item without support, report "not established by the
     retrieved evidence". A partial answer with named gaps is the correct result.
     Labeling a remembered fact/link as unverified does not make it admissible.
   - Before returning, check every factual statement and every URL against the
     evidence; remove unsupported additions, including explanatory background.
     Confidence applies only to supported findings; keep missing coverage visible.
   Do not fill gaps from memory or run extra searches/subagents.
4. Return supported findings with source URLs, confidence, and unresolved questions.
   Keep the response within 400 words unless the user requested more detail.
   Return no raw tool output, full report, brief, or process narration.
```
