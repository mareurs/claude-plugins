---
name: researcher-mcp
description: Reference guide for /research-web and /research-subagent — do not invoke directly. Provides the tool-selection matrix, mode guide, context budgets, and the shared research brief template used when calling the researcher MCP server.
---

# Researcher MCP — Shared Reference

**Not intended for direct invocation.** Loaded by `/research-web` and `/research-subagent` as `REQUIRED SUB-SKILL` to share tool selection logic, context budgets, and the research brief template.

## Tools

The server exposes **six tools**, one per research target. Pick the tool that matches the query — there is no single dispatcher tool and no `target` parameter.

> **Tool name by runtime**
> - **Claude Code**: `mcp__researcher__<tool>` (e.g. `mcp__researcher__research`)
> - **pi**: `researcher_<tool>` (e.g. `researcher_research`)
> Use whichever prefix appears in your tool list.

| Tool | Signature | Use for |
|---|---|---|
| `research` | `research(query, mode?, intent?, domain_profile?, domains?, max_queries?, max_sources?)` | General web topic / question |
| `research_person` | `research_person(name, method?)` | Person background / meeting prep |
| `research_company` | `research_company(name, country?)` | Company intel |
| `research_code` | `research_code(framework, version?, aspects?, repo?, query?)` | Library / framework: bugs, releases, breaking changes |
| `market_insight` | `market_insight(query, asset_class?, mode?)` | Stock / crypto / macro (web research, no price APIs) |
| `search_jobs` | `search_jobs(query, mode?)` | Job search (uses `profiles.toml [job-profile]`) |

## Tool Selection

| Query type | Tool |
|---|---|
| General web topic | `research` |
| Person background | `research_person` |
| Company intel | `research_company` |
| Library / framework | `research_code` |
| Stock / crypto / macro | `market_insight` |
| Job search | `search_jobs` |

## Mode Guide

`mode` applies to `research` and `market_insight`; `search_jobs` has its own mode values; the remaining tools have no `mode`.

| Mode | Output | Token cost | When |
|---|---|---|---|
| `quick` | Links + snippets only | Very low | Just need URLs |
| `summary` | Bullet facts | Low | Inline default (`/research-web`) |
| `report` | Full markdown analysis | Medium | Subagent default (`/research-subagent`) |
| `deep` | Exhaustive (2× queries + sources) | High | Only when thorough research required |

`search_jobs` modes: `list` (ranked shortlist, default) | `deep` (shortlist + company briefs on the top matches).

## Per-Tool Parameters

**`research`** (general web)
- `mode`: quick | summary | report (default) | deep
- `intent`: developer-docs | news | product-research | academic | general (default) — tunes planner query style
- `domain_profile`: named preset — news | academic | tech-news | llm-news | shopping-ro | travel
- `domains`: **JSON array** of sites to pin — `["docs.rs","example.com"]`
- `max_queries`: integer — max planner sub-questions
- `max_sources`: integer — max sources scraped per query

**`research_person`**
- `method`: company | personal | both (default)

**`research_company`**
- `country`: string — disambiguates the company name

**`research_code`** — all optional except `framework`
- `version`: string — e.g. `"0.8"` or `"latest"` (default)
- `aspects`: **JSON array** — `["bugs","changelog","community","releases"]` (default `["bugs","changelog","community"]`). Pass a real JSON array, NOT a string.
- `repo`: `"owner/repo"` — anchors bug / release search to GitHub
- `query`: string — keyword appended to every search to narrow results

**`market_insight`**
- `asset_class`: stock | crypto | macro (default)
- `mode`: quick | summary | report (default) | deep

**`search_jobs`**
- `mode`: list (default) | deep

## Context Budget Defaults

| Path | mode | max_queries | max_sources |
|---|---|---|---|
| `/research-web` (inline) | `summary` | 3 | 5 |
| `/research-subagent` | `report` | default (uncapped) | default (uncapped) |

`max_queries` / `max_sources` apply to `research` (and `market_insight`).

## Examples

Names shown in Claude Code form (`mcp__researcher__<tool>`); in pi use `researcher_<tool>`.

```
# General topic
research(query="Rust async runtimes comparison 2025", mode="summary")

# Code / library
research_code(framework="axum", version="0.8", aspects=["changelog","releases"])

# Code with repo pinning
research_code(framework="tokio", version="1.44", aspects=["bugs","releases"], repo="tokio-rs/tokio")

# Person
research_person(name="Andrej Karpathy", method="company")

# Company
research_company(name="Anthropic", country="US")

# Market
market_insight(query="BTC halving", asset_class="crypto")

# News topic with domain profile
research(query="OpenAI o3 release", intent="news", domain_profile="news", mode="summary")

# Jobs
search_jobs(query="senior Rust engineer", mode="deep")

# Pinned domains
research(query="Ktor routing", domains=["ktor.io","kotlinlang.org"])
```

## Progressive Disclosure

The researcher applies size-gated progressive disclosure to `research` / `market_insight` reports. Reports under ~4000 characters return inline; larger reports return a progressive envelope instead.

### Detecting an envelope

Response is an envelope if it contains a `path` field:

```json
{
  "summary": "<server-generated summary>",
  "toc": ["## Section 1", "## Section 2"],
  "path": "/home/user/.local/share/researcher/2026-05-03T14-30-42-<slug>.md",
  "word_count": 1847,
  "hint": "Full report saved to disk. Read the file at 'path' using a file-reading tool."
}
```

The `summary` and `toc` are generated server-side. **Summary style is not a caller parameter** — do not pass `summary_style`.

### Handling envelope responses

| Context | What to do |
|---|---|
| Inline (`/research-web`) | Present `summary` + `toc`; offer to read `path` for full depth |
| Subagent (`/research-subagent`) | Read the full file at `path`, synthesize from complete content; if the file is unreadable, synthesize from the envelope and set Confidence to `low` |

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
2. **Tool disambiguation** — multiple choice, only if the query maps to multiple tools ambiguously
3. **Mode** — default per skill; ask only if the user hints at depth
4. **Invalidation targets** — only if stakes are high or ambient context is thin

**Hard cap:** max 3 questions. Beyond that, build the brief with best-effort inference.

After gathering: show the compact brief and ask "proceed?" — one confirm step so the user can correct wrong inferences before the search runs.
