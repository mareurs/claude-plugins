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

_Last refresh: `HEAD-pending`_

**codescout-companion** — canonical `1.9.8` · readme `1.9.8` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | 1.9.8 ✅ | ✅ | ✅ |
| `~/.claude-sdd` | 1.9.8 ✅ | ✅ | ✅ |
| `~/.claude-kat` | 1.9.8 ✅ | ✅ | ✅ |

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

### 2026-05-18 — buddy 0.7.4 → 0.7.5

Fixed CLAUDE_DIR detection in summon.md + create.md (ancestor walk instead of fixed 2-dirname). Bumped, cache seeded, install records updated across 3 profiles.

