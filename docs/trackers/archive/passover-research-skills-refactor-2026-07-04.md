---
id: 9db93cbb2089daab
kind: tracker
status: archived
title: Passover — research-skills-dialect-refactor — 2026-07-04
owners: []
tags:
- passover
topic: null
time_scope: dated:2026-07-04
branch: main
origin_session_id: f8faad8d-37ec-40c6-a9dd-fe3ecec9ec5f
---

# Passover — research-skills-dialect-refactor — 2026-07-04

## State

**Done + committed.** The three researcher skills (`researcher-mcp`, `research-subagent`, `research-web`) and the pi companion described a **fictional researcher API** — a single `research_run` tool with a `target` param (+ an inert `summary_style` param). The deployed server exposes **six** separate tools (`research`, `research_person`, `research_company`, `research_code`, `market_insight`, `search_jobs`); no `research_run`. Corrected across **4 surfaces** and verified **three ways**: static grep (0 `research_run`), a **live acceptance run** (a subagent called `mcp__researcher__research_code` end-to-end + returned real Findings), and a **validated prompt-tdd decision gate** (positive PASS / `--ablate` RED — power confirmed). Both repos committed. **Not pushed** (claude-plugins) / **local-only** (prompt-engineering).

## Next actions

1. Read this doc, then **VERIFY** before acting: `git status` in both repos (below); the decision gate can be re-run with `prompt-tdd run scenarios/skills/researcher-tool-dialect [--ablate]` from prompt-engineering **only in a quiet window** (concurrent `claude -p` evals on this machine saturate the account rate limit → spurious FAILs).
2. **Ship (pending user go-ahead):** run `./scripts/release.sh codescout-companion patch` → repoint caches/records in all 3 profiles → **cold-restart** all 3 CC instances. The skill edits are **NOT live** until this dance completes (sessions still load the old cached research skills otherwise).
3. Optionally `git push` claude-plugins `main` (ahead of origin; user had not decided).

## Working state

- **claude-plugins:** branch `main`, commit `32facf9` ("fix(codescout-companion): correct researcher MCP dialect in research skills"), tree **clean**, ahead of `origin/main` by 5 — only `32facf9` is this thread's (others are unrelated local activity). **KEEP; not pushed.**
- **prompt-engineering:** branch `feat/subscription-judge`, commit `4424361` ("test(skills): add researcher tool-dialect regression gate"). **Local-only repo — NO git remote configured** (intentional). A concurrent judge session committed `1d15976` on top; my files verified intact. **KEEP; do not publish.**
- No uncommitted files for this thread in either repo. No processes need to be running (the background eval poller `@bg_*` already completed).

## Anti-goals

- **Do NOT** try to isolation-eval the *full* research-subagent dispatch loop (spawn → live MCP → reconcile) — L-7 pincer, empirically confirmed (n=2 positive RED). Only the **tool-selection dialect** is isolation-evaluable (the shipped `researcher-tool-dialect` decision gate); the full loop is covered by the one-off live acceptance run.
- **Do NOT** add a remote to / push prompt-engineering — local-only is intended (user confirmed).
- **Do NOT** hand-bump the plugin version or commit a release without the full `release.sh` dance + cold restart.
- **Do NOT** re-cut the `researcher-mcp` "Key Design Notes ↔ Common Mistakes" overlap on inspection — it's an unverified-cut hypothesis (persona redundancy may be load-bearing); needs an A/B, not an eyeball cut.
- The prompt-tdd harness has **no MCP-presence support** (`--strict-mcp-config`, no `--mcp-config`); a full-flow MCP-coupled test would need a harness extension — noted, **not built** (don't assume it exists).

## Open threads

- claude-plugins push + release-dance (D2) — awaiting user go-ahead.
- `reconnaissance-patterns.md` R-N ledger not updated this session; recon findings were captured as research-skills-refactor-session-log:F-1/research-skills-refactor-session-log:F-2 in the work-stream session log instead (acceptable — R-N is the optional cross-cutting skill ledger).

## Pointers

- Plan: `~/.claude-sdd/plans/zany-soaring-key.md`
- Work-stream log: `docs/trackers/research-skills-refactor-session-log.md` (research-skills-refactor-session-log:F-1 = pi surfaces; research-skills-refactor-session-log:F-2 = L-7 / eval, fixed-verified)
- Hamsa audit-log: `prompt-hamsa-audit-log` (id `720408ecd2391251`), row `date=2026-07-04`, `outcome=held`
- Eval: prompt-engineering `scenarios/skills/researcher-tool-dialect/` + `docs/trackers/skill-eval-log.md` § research-subagent
- Back-link: `.buddy/f8faad8d-37ec-40c6-a9dd-fe3ecec9ec5f/` + the session transcript



## Consumed

Consumed 2026-09-01. Every Next action and Open thread is discharged, checked rather than
assumed:

1. **Git state** — the handoff recorded claude-plugins as *"ahead of `origin/main` by 5,
   KEEP; not pushed"* with this thread's commit `32facf9`. `git merge-base --is-ancestor
   32facf9 HEAD` → true, and `origin/main...HEAD` is `0 0`. Pushed and reconciled.
2. **Ship (release.sh + cold restart)** — done many times over since; codescout-companion
   is at **1.20.0**, so the corrected research skills in `32facf9` have long been seeded
   into the versioned caches all three profiles load from. This was the action the
   handoff called load-bearing, and the reason it was: a skill edit is `committed`, not
   `live`, until a release runs — the same law later measured as
   `skill-loading-session-log:F-5`.
3. **Optional push** — done.

Open threads: the release dance (D2) is closed by (2). The note that
`reconnaissance-patterns.md`'s R-N ledger went un-updated was explicitly marked acceptable
at write time — the findings live in
`research-skills-refactor-session-log:F-1`/`research-skills-refactor-session-log:F-2` — so
it is not outstanding work.

**prompt-engineering is deliberately untouched.** That repo is local-only with no remote by
the user's confirmation, and this file's anti-goals forbid adding one. Nothing was done
there.

Archived via `artifact(action="move")`, not `git mv`.
