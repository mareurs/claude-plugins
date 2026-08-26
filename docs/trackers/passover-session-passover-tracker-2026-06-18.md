---
id: cada4e50e6b3cfba
kind: tracker
status: active
title: Passover — session-passover-tracker — 2026-06-18
owners: []
tags:
- passover
topic: session-passover-tracker
time_scope: dated:2026-06-18
branch: main
origin_session_id: b53ae7a6-e322-4f78-988c-3522541a18ac
---

# Passover — session-passover-tracker — 2026-06-18

> **Correlation keys** — now all in **frontmatter** (`topic`/`time_scope` native, `origin_session_id`/`branch` via the `extra` passthrough; codescout bug `13164fb35d6f71ed` fixed + live-verified 2026-06-19). Echoed here for the human reader:
> - **topic:** session-passover-tracker
> - **origin_session_id:** b53ae7a6-e322-4f78-988c-3522541a18ac
> - **branch:** main (feature already merged; no live feature branch)
> - **time_scope:** dated:2026-06-18

## State

Feature **B** (the session-passover tracker pattern: template + discovery convention + drift-lint test + work-stream session-log) is **shipped and merged to local `main`** (merge `57fabad`, `--no-ff`; suite 16/16 green). Idea **A** (Task 4 — a `librarian-runtime` guide section teaching "trackers carry cross-session behavior like skills," with this passover as the worked example) is **deferred**: it's an external codescout-repo change. Local `main` has **diverged from `origin/main` (ahead 8, behind 4)**; nothing pushed. This doc is the first dogfood of the shipped template — and it surfaced a contract gap (F-3, below).

## Next actions

1. Read this doc, then **VERIFY** before acting: `git status` (expect clean), `git rev-list --left-right --count main...origin/main` (expect drift ~8/4), `./tests/run-all.sh` (expect 16/16). The handoff may be stale.
2. **Reconcile `main` with `origin` (your call):** `git pull --rebase` to take origin's 4 commits, then push the 8 local — or keep local-only. Origin advanced to `b201e0d`; two new remote branches appeared (`fix/copilot-cli-command-name-load`, `fix/windows-tool-name-drift`).
3. **Task 4 — idea A (external, gated):** resolve the codescout repo path via `claude mcp list`; add the "Trackers carry behavior across sessions — like skills" section to the `librarian-runtime` guide (passover as worked example); cross-ref from `tracker-conventions`. Content sketch is in plan Task 4.
4. **Fix F-3 — reconcile the template with the create API:** decide whether the correlation keys live in the body (as here) or whether the author step uses `create_file` + a manual frontmatter edit. Update `docs/templates/passover-template.md` and the `## Session Passover` author step in `CLAUDE.md` to match reality, then re-run `tests/test-passover-template.sh` (its frontmatter-key assertions encode the current template). Upstream fix tracked in codescout bug `13164fb35d6f71ed`; keep the body-level workaround until it lands.
5. **Promote-when watch:** if a future session MISSES an active passover (≥2 occurrences), promote discovery from the CLAUDE.md convention to a SessionStart hook (plan §2 non-goal). Record each miss in the session-log.

## Working state

- Branch `main`, working tree clean (this passover file + the F-3 session-log entry are uncommitted at handoff — commit them if you want them durable).
- Local `main` ahead 8 / behind 4 of `origin/main` — NOT pushed, NOT reconciled.
- Shipped files (on `main`): `docs/templates/passover-template.md`, `tests/test-passover-template.sh`, `CLAUDE.md` (`## Session Passover`), `docs/trackers/session-passover-impl-session-log.md`, plus spec + plan under `docs/superpowers/`.
- Rode in on the merge: your own commit `d5c302d` (`buddy/tests/BENCHMARK.md`) — intentional, outside passover scope.
- No servers/processes required.

## Anti-goals

- Do NOT add a SessionStart auto-surface hook yet — gated on the ≥2-missed-passover promote-when.
- Do NOT route the passover through the codescout *memory* system — it is a tracker; memory would undercut idea A.
- Do NOT make `origin_session_id` the primary disambiguator — `topic`/`branch` are primary; the id auto-matches only on `--resume`.
- Do NOT push to origin or reconcile the divergence without the user's explicit go-ahead.

## Open threads

- **F-3 (resolved 2026-06-19):** the create/update custom-frontmatter gap is **fixed + live-verified** — codescout `13164fb35d6f71ed` (`time_scope` param + `extra` passthrough). This passover's `origin_session_id`/`branch`/`time_scope` are now in real frontmatter; no body-level workaround needed on current codescout.
- Compaction sid-stability is undocumented (spec §6) — verify locally before relying on `--compact` auto-match.

## Pointers

- Spec: `docs/superpowers/specs/2026-06-18-session-passover-tracker-design.md`
- Plan: `docs/superpowers/plans/2026-06-18-session-passover-tracker.md` (Task 4 = idea A, deferred)
- Work-stream session-log: `docs/trackers/session-passover-impl-session-log.md` (F-1/F-2/W-1, + F-3)
- Backlink: `.buddy/b53ae7a6-e322-4f78-988c-3522541a18ac/` and this session's CC transcript.

## Consumed

<!-- When you finish acting on this passover: flip status to archived, add a one-line note here, and artifact(action="move", …) this file into docs/trackers/archive/. Never bare git mv. -->
