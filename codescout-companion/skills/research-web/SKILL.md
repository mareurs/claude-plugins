---
name: research-web
description: Use when the user runs /research-web or asks for web research and wants short results inline. Calls researcher MCP directly. Prefer research-subagent for deep research, reports, or keeping raw results out of the main context.
---

# Inline research

Use researcher MCP directly for a short lookup in the current conversation.
Load the sibling researcher-mcp reference for target selection and parameters.

## Workflow

1. Infer a compact brief: the question, relevant context/version, questions to
   answer, source/date constraints, and assumptions to test. Ask only for missing
   information that prevents useful research. Existing authorization is enough;
   do not require routine confirmation before the call.
2. Discover the live tool and schema. Use the unified `research(query, target?, ...)`
   dispatcher, normally `mcp__researcher__research` (pi: `researcher_research`).
   Choose target: topic (default), person, company, market, code, or jobs.
3. Default to `mode="summary"`. Honor explicit quick/report/deep requests; route
   substantial reports to research-subagent. For topic/market use at most
   `max_queries=3`, `max_sources=5`. These caps do not apply to other targets.
   Pass intent, domains, or domain_profile when relevant. Leave summary_style
   unset for the normal inline path.
4. Present the returned findings without adding unsupported facts or URLs.
   If the response includes a saved-report path, show summary and toc and link
   the file. Read the full file before making claims beyond the envelope.
   Preserve missing evidence and partial coverage. On a tool/server error,
   report the failure and stop.

## Examples

For Tokio cancellation patterns:

```text
research(query="tokio", target="code", repo="tokio-rs/tokio", keywords="async cancellation patterns", aspects=["community","changelog"], mode="summary")
```

For a short official documentation lookup with bounded topic research:

```text
research(query="Tokio Receiver recv cancellation safety", domains=["docs.rs"], intent="developer-docs", mode="quick", max_queries=1, max_sources=2)
```

For shopping in Romania:

```text
research(query="Compare laptop offers at eMAG and Altex", intent="product-research", domain_profile="shopping-ro", mode="summary", max_queries=3, max_sources=5)
```

For audits, retain the exact tool response before presenting findings. Follow
research-subagent's evidence capture instructions, including its byte-copy helper
for saved reports; inline evidence also needs capture from the raw tool result.
