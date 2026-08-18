When summarizing or presenting SDD plugin work, **do not promote the multi-agent / agentic-infrastructure layer** (the 9 specialized agents like `@project-manager`, `@sdd-expert`, `@connector-expert`, etc. that appear in `extenda/sdd/hiiretail-payments-worldline-tapi/.claude/agents/` and the `SDD_AI_ENGINEERING_PRESENTATION.md`).

**Why:** The multi-agent architecture was a bust later on — it did not pan out in practice. User flagged this 2026-05-27 after I wrote a deep-dive that featured a 9-agent table from the worldline-tapi ARCHITECTURE.md.

**How to apply:**
- Pitching SDD = the plugin itself: `/sdd-init`, `/specify`, `/plan`, `/review`, `/drift`, `/document`, the six-article constitution, hooks (spec-guard, review-guard, session-start, subagent-inject), warn/strict modes, the `sdd-flow` skill.
- The CCC Ingestion metrics (5 days, 0 defects, 9.5/10, 587 LOC + 3,187 test LOC) can still be cited — they came from a real run — but credit the SDD workflow + AI, **not** the multi-agent layer.
- Avoid the retrospective's "agentic vs main agent" framing entirely.
- The `subagent-inject.sh` hook does inject context per subagent *type* (Plan / general-purpose / Explore / code-reviewer) — that is plugin-side and fine to mention; it's different from the project-side `.claude/agents/*.md` ecosystem.