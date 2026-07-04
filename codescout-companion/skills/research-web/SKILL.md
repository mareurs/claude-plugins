---
name: research-web
description: Use when the user runs /research-web or asks for web research on a topic, person, company, library, market, or jobs and wants results inline in the current conversation. Calls the researcher MCP directly; results land in main context. Prefer /research-subagent if context is precious or the user asked for a deep/report mode search.
---

# /research-web — Inline Research

Direct-call researcher MCP skill. Results land in the main context — keep the budget small.

**REQUIRED SUB-SKILL:** researcher-mcp — load it to pick the right tool and mode, and to use the shared research brief template.

## When to Use

- User ran `/research-web [query]` or asked for a quick lookup
- The research output is short enough to live inline (summary/quick modes)
- Main context is not tight

## When NOT to Use

- User wants a deep report, or research will return multi-page output → use `/research-subagent`
- Context window is already near capacity → use `/research-subagent`

## Flow

1. **Parse input.**
   - If args provided on invocation, treat as the query.
   - If no args, ask the user for the query.

2. **Build the research brief** (see `researcher-mcp` skill for template).
   - Infer Context and Prior knowledge from ambient conversation — do not ask.
   - Draft "What to look for" and "What to invalidate" from project context.
   - Ask the user for clarifications only if strictly needed (hard cap: 3 questions).

3. **Pick the MCP tool** using the matrix in `researcher-mcp`.
   - If query maps unambiguously to one tool, skip asking.
   - If ambiguous, ask with multiple choice.

4. **Confirm the brief.** Show the user the compact brief and ask "proceed?" before spending tokens on the search.

5. **Call the MCP tool.** Defaults:
   - `mode: "summary"` (override only if user explicitly asked for `quick`, `report`, or `deep`)
   - `max_queries: 3`
   - `max_sources: 5`
   - Pass `intent` and `domain_profile` if relevant (see `researcher-mcp`)
   - Do not pass `summary_style` — server default (`abstract`) is correct for inline

6. **Present results.**
   - **Inline response** (no `path` field): output goes straight to the user — do not re-synthesize.
   - **Progressive envelope** (`path` field present): present the `summary` content, show the `toc` headings, then offer: "Full report saved at `<path>` — want me to read a specific section?"

## Context Budget

Hard caps are intentional. Do not raise `max_queries` or `max_sources` for an inline call. If the user needs more depth, route them to `/research-subagent`.

## Example Invocation

User: `/research-web rust async cancellation patterns`

You:
1. Infer context (Rust project, currently working on async code).
2. Draft brief — What to look for: canonical patterns, tokio docs, recent (2024+). What to invalidate: pre-tokio-1.0 info.
3. Pick tool: `mcp__researcher__research_code` (Claude Code) / `researcher_research_code` (pi) — framework-specific.
4. Show compact brief, ask "proceed?"
5. On confirm: call `research_code(framework="tokio", repo="tokio-rs/tokio", aspects=["community","changelog"], query="async cancellation patterns")`. (`research_code` takes no `mode` / `max_queries` / `max_sources` — those apply to `research`.)
6. Present the MCP output.

## Common Mistakes

- **Asking too many clarifying questions.** Hard cap at 3. Infer aggressively from ambient context.
- **Skipping the brief confirm step.** The confirm step is cheap insurance against a wasted search.
- **Raising the context budget "just this once".** Don't. Route to `/research-subagent` instead.
- **Re-synthesizing inline MCP output.** The user already sees the tool output; adding your own synthesis burns tokens for no gain.
- **Dumping a progressive envelope JSON to the user.** If `path` is present, present the `summary` content and `toc` — not the raw JSON.
