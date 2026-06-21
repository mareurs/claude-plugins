---
name: researcher-mcp
description: Reference guide for /research-web and /research-subagent — do not invoke directly. Provides tool-selection matrix, mode guide, context budgets, and the shared research brief template used when calling the researcher MCP server.
---

# Researcher MCP — Shared Reference

**Not intended for direct invocation.** Loaded by `/research-web` and `/research-subagent` as `REQUIRED SUB-SKILL` to share tool selection logic, context budgets, and the research brief template.

## Single Tool API

The server exposes **one tool**. All research targets go through it via the `target` parameter. There are no separate `research_code`, `research_person`, `market_insight`, or `search_jobs` tools — those do not exist.

> **Tool name by runtime**
> - **pi**: `researcher_research_run` (direct tool)
> - **Claude Code**: `mcp__researcher__research_run`
> Use whichever is available in your tool list.

```
researcher_research_run(   # or mcp__researcher__research_run in Claude Code
  query,          # required — research subject or question
  target?,        # topic(default)|person|company|market|code|jobs
  mode?,          # quick|summary|report(default)|deep
  ...             # per-target params below
)
```

## Target Selection

| Query type | `target` value | Notes |
|---|---|---|
| General web topic | `"topic"` (default) | Omit target entirely |
| Person background | `"person"` | Meeting prep on individuals |
| Company intel | `"company"` | Meeting prep on organizations |
| Library / framework | `"code"` | Bugs, releases, breaking changes |
| Stock / crypto / macro | `"market"` | Web research only, no price APIs |
| Job search | `"jobs"` | Uses profiles.toml [job-profile] |

## Mode Guide

| Mode | Output | Token cost | When |
|---|---|---|---|
| `quick` | Links + snippets only | Very low | Just need URLs |
| `summary` | Bullet facts | Low | Inline default |
| `report` | Full markdown analysis | Medium | Subagent default |
| `deep` | Exhaustive (2× queries+sources) | High | Only when thorough research required |

## Per-Target Parameters

**[person]**
- `person_method`: `"company"` | `"personal"` | `"both"` (default)

**[company]**
- `country`: string — disambiguates company name

**[market]**
- `asset_class`: `"stock"` | `"crypto"` | `"macro"` (default)

**[code]** — all optional
- `version`: string — e.g. `"0.8"` or `"latest"`
- `aspects`: **JSON array** of aspects to research — `["bugs","changelog","community","releases"]`
  - Default when omitted: `["bugs","changelog","community"]`
  - Pass as a real JSON array, NOT a string: ✓ `["releases","changelog"]` ✗ `"releases,changelog"`
- `repo`: `"owner/repo"` — GitHub repo for targeted issue/release search
- `keywords`: string — narrows search within the framework

**[all targets]**
- `intent`: `"developer-docs"` | `"news"` | `"product-research"` | `"academic"` | `"general"` (default)
- `domain_profile`: named preset — `"news"` | `"academic"` | `"tech-news"` | `"llm-news"` | `"shopping-ro"` | `"travel"`
- `domains`: **JSON array** of sites to pin — `["example.com","docs.rs"]`
- `summary_style`: `"toc"` | `"abstract"` (default) | `"takeaways"`
- `max_queries`: integer — max sub-questions for planner (topic/market only)
- `max_sources`: integer — max sources scraped per query (topic/market only)

## Context Budget Defaults

| Path | mode | summary_style | max_queries | max_sources |
|---|---|---|---|---|
| `/research-web` (inline) | `summary` | omit (server default `abstract`) | 3 | 5 |
| `/research-subagent` | `report` | `"toc"` (cheapest; subagent reads file) | default (uncapped) | default (uncapped) |

## Examples

```
# General topic
researcher_research_run(query="Rust async runtimes comparison 2025", mode="summary")

# Code / library
researcher_research_run(query="Axum 0.8 breaking changes", target="code", version="0.8", aspects=["changelog","releases"])

# Code with repo pinning
researcher_research_run(query="tokio", target="code", version="1.44", aspects=["bugs","releases"], repo="tokio-rs/tokio")

# Person
researcher_research_run(query="Andrej Karpathy", target="person", person_method="company")

# Company
researcher_research_run(query="Anthropic", target="company", country="US")

# Market
researcher_research_run(query="BTC halving", target="market", asset_class="crypto")

# News with domain profile
researcher_research_run(query="OpenAI o3 release", intent="news", domain_profile="news", mode="summary")

# Jobs
researcher_research_run(query="senior Rust engineer", target="jobs", mode="deep")

# Pinned domains
researcher_research_run(query="Ktor routing", domains=["ktor.io","kotlinlang.org"])
```

## Progressive Disclosure

The researcher MCP applies size-gated progressive disclosure. Reports under ~4000 characters return inline; larger reports return a progressive envelope instead.

### Detecting an envelope

Response is an envelope if it contains a `path` field:

```json
{
  "summary": "<generated per summary_style>",
  "toc": ["## Section 1", "## Section 2"],
  "path": "/home/user/.local/share/researcher/2026-05-03T14-30-42-<slug>.md",
  "word_count": 1847,
  "hint": "Full report saved to disk. Read the file at 'path' using a file-reading tool, or read specific sections by heading."
}
```

### `summary_style` parameter

| Value | Behavior | LLM call? |
|---|---|---|
| `"toc"` | Headings only | No — cheapest |
| `"abstract"` | 3–5 sentence abstract | Yes — server default |
| `"takeaways"` | 5–8 bullet key findings | Yes |

### Handling envelope responses

| Context | What to do |
|---|---|
| Inline (`/research-web`) | Present `summary` content + `toc` to user; offer to read `path` for full depth |
| Subagent (`/research-subagent`) | Read full file at `path`, synthesize from complete content; if file unreadable, synthesize from envelope and set Confidence to `low` |

## Research Brief Template

Both action skills build this brief before calling the MCP. In `/research-web` it guides Claude's internal reasoning. In `/research-subagent` it is passed verbatim as the subagent's context.

```
## Research Brief

### Context
- Project: <inferred from ambient conversation>
- Working on: <current task / why this research matters>
- Prior knowledge: <what we already know / current assumptions>

### Query
<refined, specific, testable>

### Questions to answer
- <Q1: specific question the research must answer>
- <Q2: ...>
- <Q3: ...>

### What to look for
- Canonical sources, authoritative guides
- Recency markers (within N months if time-sensitive)
- Version alignment (e.g. matches lib version X)
- <task-specific signals>

### What to invalidate
- Outdated info predating relevant version
- Vendor marketing without benchmarks
- <assumptions we might have wrong>

### Coverage & reconciliation directives
- Keep searching until every question above is answered from at least two independent sources.
- Cover all relevant angles — don't stop at the first plausible answer.
- If sources contradict: surface the conflict, weigh source quality, note the reconciled position OR flag as unresolved with both views cited.
- If a question cannot be answered, say so explicitly in Caveats.

### Output target
- Mode: quick / summary / report / deep
- Decision this informs: <what we do with findings>
```

### Field sources

| Field | How populated |
|---|---|
| Context, Prior knowledge | Inferred from ambient conversation — not asked |
| Query | From args, or one prompt if args missing |
| Questions to answer | Drafted from the query + ambient task context; 2–5 concrete, answerable questions |
| What to look for / invalidate | Drafted from project context; user asked only if brief is thin or stakes high |
| Coverage & reconciliation | Static directives — always included verbatim |
| Output target | One multiple-choice question |

## Clarifying Questions Flow

Minimal — infer from ambient context, ask only true unknowns.

1. **Query** — ask once if no args, otherwise skip
2. **Target disambiguation** — multiple choice, only if query maps to multiple targets ambiguously
3. **Mode** — default per skill; ask only if user hints at depth
4. **Invalidation targets** — only if stakes are high or ambient context is thin

**Hard cap:** max 3 questions. Beyond that, build the brief with best-effort inference.

After gathering: show the compact brief and ask "proceed?" — one confirm step so the user can correct wrong inferences before the search runs.
