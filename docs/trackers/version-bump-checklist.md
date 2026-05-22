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

_Last refresh: `f1b0f31`_

**codescout-companion** — canonical `1.11.3` · readme `1.11.3` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | 1.11.3 ✅ | ✅ | ✅ |
| `~/.claude-sdd` | 1.11.3 ✅ | ✅ | ✅ |
| `~/.claude-kat` | 1.11.3 ✅ | ✅ | ✅ |

**buddy** — canonical `0.7.14` · readme `0.7.14` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | 0.7.14 ✅ | ✅ | ✅ |
| `~/.claude-sdd` | 0.7.14 ✅ | ✅ | ✅ |
| `~/.claude-kat` | 0.7.14 ✅ | ✅ | ✅ |

**sdd** — canonical `2.4.1` · readme `2.4.1` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | — ❌ | ❌ | ❌ |
| `~/.claude-sdd` | — ❌ | ❌ | ❌ |
| `~/.claude-kat` | — ❌ | ❌ | ❌ |

## History

_Append dated session deltas: ### YYYY-MM-DD — <what changed>._

### 2026-05-22 — codescout-companion 1.11.2 → 1.11.3

Path-agnostic guard hardening: native Read/Edit/Write/Grep/Glob/Bash blocked regardless of path or extension; cross-repo md/source/Bash `cd <other-repo>` escapes closed; only binary images/PDF exempt from native Read; `workspace_root` no longer relaxes the guard. Cache seeded + install records updated across 3 profiles, all green.

### 2026-05-21 — codescout-companion 1.11.1 → 1.11.2, buddy 0.7.13 → 0.7.14

Recon badge session F/W counters feature: new `codescout-companion/skills/reconnaissance/recon_count.py` (session-scoped F/W counter, writes `.buddy/<sid>/recon-counts.json`) + recon SKILL.md Phase 3 bump instruction; buddy statusline `_render_recon_badge` renders the `F<n>/W<n>` suffix in both badge states (zero sides omitted). Both plugins green across 3 profiles after cache seed + install-record update. sdd remains uninstalled in all profiles (unchanged).

### 2026-05-21 — buddy 0.7.5 → 0.7.13, codescout-companion 1.9.10 → 1.11.1

buddy 0.7.13: auto-migrate legacy per-profile global state (`~/.claude*/buddy`) into `${BUDDY_HOME:-~/.buddy}` on SessionStart — lock-guarded, idempotent, never breaks session start; merged via `buddy-global-home` branch (fast-forward into main). codescout-companion State row advanced 1.9.10 → 1.11.1 (interim bumps not individually logged here; reconciled this refresh). Both plugins green across 3 profiles after cache seed + install-record update. sdd remains uninstalled in all profiles (unchanged).

### 2026-05-18 — codescout-companion 1.9.9 → 1.9.10, claude-statusline 1.1.2 → 1.1.3

Added codescout-active marker convention: three codescout-companion hooks (cs-activate-project, worktree-activate, session-start) write the agent's declared workspace path to $CLAUDE_CONFIG_DIR/codescout-active/<session_id>. claude-statusline reads it to display `cs:<branch>` truthfully instead of guessing from CC's frozen PWD. Falls back silently when marker absent. See docs/marker-convention.md.

### 2026-05-18 — codescout-companion 1.9.8 → 1.9.9, claude-statusline 1.1.0 → 1.1.2

Added `git-worktree-guard.sh` (codescout-companion) and multi-worktree warning suffix (claude-statusline). Both target the worktree-ambiguous-PWD failure class that caused the 2026-05-18 MRV-poc wrong-branch commit. 1.1.2 shortened the warning to `·Nwt`.

### 2026-05-18 — buddy 0.7.4 → 0.7.5

Fixed CLAUDE_DIR detection in summon.md + create.md (ancestor walk instead of fixed 2-dirname). Bumped, cache seeded, install records updated across 3 profiles.

