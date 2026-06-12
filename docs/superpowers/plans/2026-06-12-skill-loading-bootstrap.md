# Skill-Loading Bootstrap — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-06-12-skill-loading-bootstrap-design.md`
**Evidence:** `docs/trackers/skill-loading-session-log.md` (F-1, W-1)

## Task order

Layer A ships independently of B/C/D (separate plugins, separate bumps).

### T1 — Guard exemption (companion, layer A)
- `codescout-companion/hooks/pre-tool-guard.sh`: add `is_skill_payload()`
  (matches `/plugins/cache/`, `/.buddy/`, `skills/<name>/SKILL.md`,
  `skills/<name>/_<lens>.md`, `skills/<name>/references/<file>`); call it in
  the Read case next to `is_binary_image`. Update the "only binary images/PDF
  are exempt" copy in the generic-read block message.

### T2 — Guard tests
- `codescout-companion/hooks/pre-tool-guard.test.sh`: flip `read-skill-md` →
  allow; add `read-skill-lens-allow`, `read-skill-refs-allow`,
  `read-plugin-cache-allow`, `read-dot-buddy-allow`; keep `read-skills-dir`
  + `read-xrepo-md` deny. Mirror in `tests/test-pre-tool-guard.sh` if it
  duplicates cases.

### T3 — Companion bump 1.11.12
- Full CLAUDE.md checklist: plugin.json, README table, check-versions.sh,
  bump-cache.sh, 3× install records, tracker cc8cb9e23ab5cc67 refresh, push.

### T4 — `summon_bootstrap.py` (buddy, layers B+D)
- New `buddy/scripts/summon_bootstrap.py`: prompt parse → conservative resolve
  (via `discover-specialists.sh` subprocess) → dedup (state import) → payload
  assembly (frontmatter strip; memories per Step 2.5; protocol; gates) →
  `inject:` bindings (trackers paths, memory_topics) → track summon → stdout.
  Exit 0 + empty stdout on any failure. Minimal hand frontmatter parser.

### T5 — Hook wiring
- `buddy/hooks/user-prompt-submit.sh`: when `prompt` matches `^/buddy:summon`,
  run bootstrap after the pointer write, emit its stdout.

### T6 — `summon.md` rewrite
- Fast path: `buddy:summon-payload` marker present → Steps 3–4 only.
- Legacy fallback preserved for: no marker, ambiguous arg, lens ask.
- Steps 2a/2b/2.5/2.6/5/6 annotated as fallback-only; `run_command` mentioned
  as the codescout-present alternative to Bash.

### T7 — Frontmatter (layer C) + demo bindings (layer D)
- 12× `buddy/skills/<dir>/SKILL.md`: prepend `name` + `description`
  frontmatter (descriptions from summon.md builtin table).
- `planning-crane`: `inject.trackers: [docs/trackers/active-plan.md]`.
- `codescout-pika`: `inject.memory_topics: [gotchas, conventions]`.

### T8 — `reload.py` frontmatter strip
- Strip YAML frontmatter when rendering reload blocks (shared helper with T4).

### T8b — Skill ledger (layer E)
- New `buddy/scripts/skill_ledger.py`: transcript tail-scan from saved offset,
  ledger upsert, repeat-load advisory lines. Wire into
  `user-prompt-submit.sh` (always runs, after pointer write).
- `statusline.py`: `skills_line` segment from ledger (short names).
### T9 — Buddy tests
- New `buddy/tests/test_summon_bootstrap.py`; extend
  `test_hooks_user_prompt.sh` + `test_reload.py`.

### T10 — Buddy bump 0.7.18
- Same checklist as T3 (buddy key). Note: `data/instances.json` lists only 2
  profiles — install records still updated in all 3 (gotchas memory).

### T11 — Wrap
- `./tests/run-all.sh` green; session-log statuses updated; push; cold-restart
  note to user.
