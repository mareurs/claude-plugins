---
id: cc8cb9e23ab5cc67
kind: tracker
status: draft
title: Version-bump checklist
owners: []
tags: []
topic: null
time_scope: null
---

## What this tracks

Release readiness across plugins × profiles. See
`docs/superpowers/specs/2026-05-18-version-bump-checklist-tracker-design.md`.

## State

_Last refresh: `d747e5c`_

**codescout-companion** — canonical `1.9.10` · readme `1.9.10` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | 1.9.10 ✅ | ✅ | ✅ |
| `~/.claude-sdd` | 1.9.10 ✅ | ✅ | ✅ |
| `~/.claude-kat` | 1.9.10 ✅ | ✅ | ✅ |

**buddy** — canonical `0.7.5` · readme `0.7.5` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | 0.7.5 ✅ | ✅ | ✅ |
| `~/.claude-sdd` | 0.7.5 ✅ | ✅ | ✅ |
| `~/.claude-kat` | 0.7.5 ✅ | ✅ | ✅ |

**sdd** — canonical `2.4.1` · readme `2.4.1` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | — ❌ | ❌ | ❌ |
| `~/.claude-sdd` | — ❌ | ❌ | ❌ |
| `~/.claude-kat` | — ❌ | ❌ | ❌ |

## History

_Append dated session deltas: ### YYYY-MM-DD — <what changed>._

### 2026-05-18 — codescout-companion 1.9.9 → 1.9.10, claude-statusline 1.1.2 → 1.1.3

Added codescout-active marker convention: three codescout-companion hooks (cs-activate-project, worktree-activate, session-start) write the agent's declared workspace path to $CLAUDE_CONFIG_DIR/codescout-active/<session_id>. claude-statusline reads it to display `cs:<branch>` truthfully instead of guessing from CC's frozen PWD. Falls back silently when marker absent. See docs/marker-convention.md.

### 2026-05-18 — codescout-companion 1.9.8 → 1.9.9, claude-statusline 1.1.0 → 1.1.2

Added `git-worktree-guard.sh` (codescout-companion) and multi-worktree warning suffix (claude-statusline). Both target the worktree-ambiguous-PWD failure class that caused the 2026-05-18 MRV-poc wrong-branch commit. 1.1.2 shortened the warning to `·Nwt`.

### 2026-05-18 — buddy 0.7.4 → 0.7.5

Fixed CLAUDE_DIR detection in summon.md + create.md (ancestor walk instead of fixed 2-dirname). Bumped, cache seeded, install records updated across 3 profiles.

