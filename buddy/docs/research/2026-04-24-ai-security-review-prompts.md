---
title: AI Security Review Prompts — What Works in 2025-2026
date: 2026-04-24
status: reference
tags: [prompt-engineering, security-review, buddy, reference-template]
---

# AI Security Review Prompts — Research Findings

Research conducted 2026-04-24 to inform the redesign of the `security-ibex` buddy skill. Preserved as a reference template for future buddy refactors and new buddy design.

## Purpose of This Document

When refactoring or designing a new buddy skill, the prompt-engineering literature and production prompts from vendors tell us which **structural elements** materially improve LLM performance in that domain. This document captures the findings for security review. The same research process should be repeated for other domains (debugging, refactoring, performance) before major buddy rewrites.

## Sources

- **UCSC study** (escholarship.org) — Zero-Shot vs Chain-of-Thought vs Tree-of-Thoughts benchmarks on SAST
- **SEI CMU** (sei.cmu.edu/blog) — canonical LLM adjudication prompt blueprint
- **arxiv 2411.03079 "LLM4FPM" / ZeroFalse** — code property graph context injection
- **arxiv 2310.02059** — LLM-generated-fix risk study
- **Anthropic `claude-code-security-review`** (github.com/anthropics) — production GitHub Action with full prompt source
- **Semgrep Assistant 2025** (semgrep.dev/blog, claude.com/customers/semgrep) — prompt chains with FP-memory loop
- **Snyk DeepCode** — hybrid LLM-on-deterministic-scanner pattern

## Consensus Patterns (Appear in Multiple Sources)

### Q1 — Structural elements of effective prompts

Five layered components show up consistently:

1. **Persona/role anchor** — "senior security engineer", "OWASP specialist". Anchors standards.
2. **Explicit context block** — diff, call graph, adjacent files, trust boundaries. Don't make the model guess.
3. **Explicit taxonomy** — CWE IDs or OWASP Top 10 categories enumerated *in-prompt*, not left abstract. STRIDE alone is too abstract to drive concrete findings.
4. **Reasoning instructions** — force data-flow tracing from source to sink.
5. **Structured output** — fixed schema (severity, CWE, location, evidence, fix, confidence) for audit and machine parsing.

### Q2 — Techniques that materially improve quality

- **Chain-of-Thought with data-flow decomposition** — zero-shot is insufficient for nontrivial logic flaws / IDOR.
- **Multi-pass self-critique** — first pass enumerates candidates, second pass challenges each for false-positive under context. Single biggest lever for FP reduction.
- **Precise context slicing** (call graphs, code property graphs) beats dumping whole files. Prompts should *request* specific context rather than guess.
- **Hybrid adjudication** — LLM as a triage/adjudication layer on top of deterministic scanner output is the dominant industry pattern.

### Q3 — Distinctive production prompts

| Prompt | Distinctive move |
|---|---|
| `anthropics/claude-code-security-review` | Diff-scoped, 5-category taxonomy with 4-6 concrete triggers each, JSON schema with confidence 0.7-1.0 threshold, explicit exclusions list, 3-phase methodology |
| Semgrep Assistant | Project-specific **Memories** that persist prior FP decisions — turns triage into a learning loop |
| ZeroFalse / LLM4FPM | Feeds model an Extended Code Property Graph slice, not raw code |
| SEI CMU blueprint | Role + alert + code slice + CWE description + "explain step-by-step + verdict with confidence" |

### Q4 — Known failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Hallucinated CVEs / nonexistent packages | Require citations to actual code locations; disallow external claims without evidence |
| Cross-file taint blindness | Pre-compute call graphs; inject slices; request adjacent-file context explicitly |
| High FPR (>80% unoptimized per Semgrep) | Self-critique pass + hybrid deterministic pre-filter |
| Overconfident low-severity noise | Calibrated severity rubric (exploitability + blast-radius); explicit "if unsure, drop it" |
| Replicating insecure training-data patterns in fixes | Treat AI fix output as untrusted; require human approval |

## Reference: Anthropic's Production Prompt (Verbatim Structure)

Source: `claudecode/prompts.py` in `anthropics/claude-code-security-review` (fetched 2026-04-24).

```
1. ROLE        — "senior security engineer conducting a focused security review"
2. CONTEXT     — repo, author, files changed, lines added/deleted
3. OBJECTIVE   — high-confidence real vulnerabilities; NOT general review;
                 do NOT comment on existing concerns
4. CRITICAL INSTRUCTIONS (4):
                 (a) >80% confidence of actual exploitability
                 (b) avoid noise (theoretical/style/low-impact)
                 (c) focus on impact (unauth access, data breach, compromise)
                 (d) exclusions (DOS, disk-stored secrets, rate limiting)
5. SECURITY CATEGORIES (5 groups, 4-6 items each):
                 - Input Validation     (SQLi, cmd inj, XXE, template, NoSQL, path traversal)
                 - AuthN/AuthZ          (auth bypass, privesc, session, JWT, authz bypass)
                 - Crypto & Secrets     (hardcoded keys, weak algos, key storage, RNG, cert validation)
                 - Injection/RCE        (deserialization, pickle, YAML, eval, XSS)
                 - Data Exposure        (sensitive logging, PII, API leakage, debug info)
6. ANALYSIS METHODOLOGY (3 phases):
                 Phase 1 — Repository context research
                 Phase 2 — Comparative analysis (deviations from existing patterns)
                 Phase 3 — Vulnerability assessment (data-flow tracing)
7. OUTPUT SCHEMA (strict JSON):
                 file, line, severity, category, description, exploit_scenario,
                 recommendation, confidence
8. SEVERITY RUBRIC:
                 HIGH   — directly exploitable → RCE/breach/auth bypass
                 MEDIUM — significant impact with specific conditions
                 LOW    — defense-in-depth
9. CONFIDENCE SCORING:
                 0.9-1.0  certain exploit path
                 0.8-0.9  clear pattern with known exploitation
                 0.7-0.8  suspicious pattern, specific conditions
                 <0.7     don't report
10. FINAL REMINDER  — "better to miss theoretical issues than flood with FPs"
11. EXCLUSIONS (explicit repeat)
```

## Template: How to Apply This to Other Buddies

When considering a buddy rewrite or designing a new one, walk the same four questions:

1. **Structural elements** — what persona, context, taxonomy, reasoning, and output format do effective prompts in this domain use?
2. **Techniques** — what reasoning disciplines (CoT, self-critique, context slicing) materially improve quality?
3. **Distinctive production prompts** — what are vendors and serious open-source projects doing? Fetch the actual source when possible — README summaries lose the structural detail.
4. **Failure modes** — what goes wrong in this domain, and how do prompts guard against it?

Then decide: which patterns belong in a **conversational coach** (the buddy mode) vs a **batch auditor** (not the buddy mode). The buddy should keep character voice and interactive guidance while absorbing the domain-specific discipline.

## Translating Research → Buddy Structure

Not every production-prompt element maps to buddy format:

| Production prompt element | Keep for buddy? | Why / Why not |
|---|---|---|
| Role anchor | Yes | Compatible with Voice section |
| Context block | Partial | Buddy doesn't know PR numbers — let user set scope |
| Concrete taxonomy (5 groups, 4-6 items each) | **Yes** | Much better than abstract framework alone |
| Two-pass methodology (find + self-critique) | **Yes** | Single biggest FP lever |
| JSON output schema | **No** | Wrong mode — buddy is conversational |
| Structured *prose* finding format | Yes | Adapt schema fields to prose |
| Severity rubric with concrete criteria | Yes | Drop-in compatible |
| Confidence threshold ("when in doubt, drop") | Yes | Interactive equivalent of 0.7 cutoff |
| Exclusions list | Yes, but let user set | Anthropic's DOS-exclusion is scope-specific |
| "Self-traps" / failure modes for the assistant | **Yes (NEW)** | Not in original but implied by literature |

## Applied to Security Ibex

See the redesign of `buddy/skills/security-ibex/SKILL.md` (commit tied to this document). Key changes derived directly from this research:

- Method restructured into 3 phases (Context → Taxonomy-guided traversal → Self-critique pass)
- NEW concrete taxonomy section (5 groups, 4-6 triggers each) replacing reliance on abstract STRIDE alone
- NEW severity & confidence rubric with "when in doubt, lower or drop"
- NEW structured finding format (location, category, evidence, exploit sketch, fix, confidence)
- NEW self-traps section (hallucinated CVEs, invented APIs, cross-file assumptions)
- Heuristics and Reactions preserved (character voice) with pruning and additions

## Reuse

Before the next buddy refactor or new-buddy design, re-run this same research process for that domain. Save findings to `buddy/docs/research/YYYY-MM-DD-<domain>-prompts.md`. Accumulating these files builds a corpus of evidence-based prompt design.
