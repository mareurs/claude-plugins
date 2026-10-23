---
name: researcher-mcp
description: Reference guide for /research-web and /research-subagent — do not invoke directly. Provides target selection, modes, context budgets, and a shared research brief for researcher MCP.
---

# Researcher MCP — Shared Reference

Loaded by research-web when needed. Research-subagent has a self-contained worker workflow.

## Live tool contract

The server exposes one dispatcher: `research(query, target?, ...)`.
Find its actual name and schema in the live tool list before calling it:
`mcp__researcher__research` in Claude Code/Codex, usually `researcher_research` in pi.
The live schema takes precedence if a deployment differs from this reference.

## Target selection

| Subject | target | Additional arguments |
|---|---|---|
| General topic, news, shopping, travel | `topic` (default) | `intent`, `domain_profile`, `domains` |
| Person background | `person` | `person_method`: company, personal, both (default) |
| Company information | `company` | `country` for disambiguation |
| Library or framework | `code` | `version`, `aspects`, `repo`, `keywords` |
| Stock, crypto, macro research | `market` | `asset_class`: stock, crypto, macro (default) |
| Jobs | `jobs` | Uses configured profiles.toml job profile |

Use `query` for the subject with every target. For code research, put the library
name in `query` and a narrowing term in `keywords`; use `repo="owner/repo"`.
`aspects` is a JSON array of bugs, changelog, community, releases.
`domains` is a JSON array of sites; it unions with `domain_profile`.
Domain profiles: news, academic, tech-news, llm-news, shopping-ro, travel.
Intents: developer-docs, news, product-research, academic, general (default).

## Modes and budgets

| mode | Output | Use |
|---|---|---|
| `quick` | Links and snippets | URL discovery or explicit quick request |
| `summary` | Short findings | Inline default |
| `report` | Full report | Worker default |
| `deep` | Expanded research | Explicit request for greater depth |

Topic/market accept `max_queries` and `max_sources`. Inline limits are 3 and 5;
workers also default to 3 and 5 unless the user requests a different budget.
Do not assume these limits constrain the specialized targets.
Choose `target` from the subject and `mode` from the requested depth independently.
Use only mode values accepted by the live dispatcher schema.

## Examples

```text
research(query="Rust async runtimes", target="topic", mode="summary", max_queries=3, max_sources=5)
research(query="tokio", target="code", repo="tokio-rs/tokio", keywords="cancellation safety", aspects=["community","changelog"])
research(query="Axum", target="code", version="0.8", aspects=["changelog","releases"])
research(query="Andrej Karpathy", target="person", person_method="company")
research(query="Anthropic", target="company", country="US")
research(query="BTC halving", target="market", asset_class="crypto", mode="summary", max_queries=3, max_sources=5)
research(query="senior Rust engineer", target="jobs", mode="deep")
research(query="Romanian laptop offers", intent="product-research", domain_profile="shopping-ro", mode="summary", max_queries=3, max_sources=5)
research(query="Tokio Receiver recv cancellation safety", intent="developer-docs", domains=["docs.rs"], mode="quick", max_queries=1, max_sources=2)
```

## Progressive disclosure and evidence

Reports exceeding `PROGRESSIVE_DISCLOSURE_CHARS` (default 4000 characters) return
an envelope with `summary`, `toc`, `path`, `word_count`, and `hint`.
The threshold is configurable; detect the `path` field instead of assuming a size.
`summary_style` is accepted: abstract (default), toc, takeaways.
Inline calls normally leave it unset; workers use toc and read the full report.
`raw_json=true` bypasses the envelope and returns ResearchResult with report,
sources, and queries. Quick results can have `report=null`.

Inline: present the summary and table of contents, linking the saved report.
Workers: read the complete saved report before synthesis. If unreadable, report
the limitation; the envelope alone is not the full report.
For evidence audits, follow research-subagent's raw response and exact byte-copy
instructions for both inline and saved-file responses.

Source provenance identifies origin, retrieval time, and truncation. A URL or
title alone does not establish a factual claim. Preserve explicit evidence gaps;
do not fill them from memory. A tool error is a failed call, not research evidence.

## Research brief

Infer a compact brief from the request and ambient context:

```text
Question: <specific research question>
Context: <why it matters, prior knowledge, relevant version>
Questions to answer: <up to three concrete questions>
Look for: <authoritative sources, source/date constraints>
Invalidate: <outdated versions or assumptions to test>
Coverage: <reconcile conflicts; name unanswered questions and missing evidence>
Output: <target, mode, budget, decision this informs>
```

Ask only for missing information that prevents useful research. Existing user
authorization covers the research call; do not add a routine confirmation step.
Stay within the call budget and report remaining gaps rather than promising
exhaustive or independently corroborated coverage the evidence did not provide.
