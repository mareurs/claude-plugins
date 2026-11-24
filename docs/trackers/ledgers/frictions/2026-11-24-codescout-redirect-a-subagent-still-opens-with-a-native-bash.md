---
kind: entry
status: open
title: 'codescout-redirect: a subagent still opens with a native Bash when only the description advises'
created: 2026-11-24
entry_kind: friction
log:
- '2026-11-24 open created codescout:457161f7-f66c-4b6c-a42f-629164dad4f2'
status_since: 2026-11-24
---

**What happened:** With the mod's description advice alone, a Haiku and a Sonnet subagent each picked native `Bash` first in 3 of 3 runs. The advice quoted back in their reasoning did not change the choice. With the schemas pinned (`isDeferred:false`) the first call was `run_command` in 2 of 3 (Haiku, installed mod) and 3 of 3 (probe).

**Evidence:** `docs/superpowers/specs/2026-11-24-codescout-redirect-mod-design.md` § Results; commit e556837.

**Recovery:** the guard or the redirect refuses the native call once, then the subagent calls `run_command`. One call lost per run.

**Severity:** low.

**Fix:** pin in the mod (e556837). Re-measure over more than 3 runs per model before `fixed-verified`.
