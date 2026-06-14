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

_Last refresh: `9e1dbaa`_

**buddy** — canonical `0.7.23` · readme `0.7.23` · marketplace clean ✅

| profile | installed | cache dir | install_path ok |
|---|---|---|---|
| `~/.claude` | `0.7.23` ✅ | ✅ | ✅ |
| `~/.claude-sdd` | `0.7.23` ✅ | ✅ | ✅ |
| `~/.claude-kat` | `0.7.23` ✅ | ✅ | ✅ |
## History

### 2026-06-14 — buddy 0.7.22 → 0.7.23

Statusline skills display split (commit `dbbc166`; bump `9e1dbaa`): codescout skills now render on their own `cs:` line (slot 6) above the generic `skills:` line (slot 7), so a crowd of loaded skills no longer buries workflow-relevant ones. `_compose_segments` grew 7→8 slots and `_partition_skills` was added; truncation priority now caps slot 6 while slot 7 stays the uncapped bottom row. Canonical/readme → 0.7.23; cache seeded + install records repointed across all three profiles; sanity loop all ✅ (cache + installPath, no cross-profile drift). Pre-bump `run-all.sh` all suites green + buddy pytest 454. Pushed to main; cold restart pending to bind the 0.7.23 cache.

### 2026-06-14 — buddy 0.7.21 → 0.7.22

codescout-pika Phase 2b SQL path fix (commit `3e8ff23`; bump `9366c3b`): replaced `$HOME/.claude/buddy/skills/codescout-pika/sql/` — wrong profile root for multi-profile users (-sdd/-kat) + a nonexistent subpath — with `${CLAUDE_PLUGIN_ROOT}/skills/codescout-pika/sql/`, the plugin-wide convention. Canonical/readme → 0.7.22; cache seeded + install records repointed across all three profiles; sanity loop all ✅ (cache + installPath, no cross-profile drift). Pre-bump `run-all.sh` all suites green + buddy pytest. NO_PUSH (committed locally, not pushed); cold restart pending to bind the 0.7.22 cache.

### 2026-06-14 — buddy 0.7.20 → 0.7.21

prompt-hamsa upgrade: completeness done-state + audit-log tracker + compute-the-fault Reaction (commits `6eda7ca` + `7ad4fa0`). Canonical/readme → 0.7.21; cache seeded + install records repointed across all three profiles; sanity loop all ✅ (cache + installPath, no cross-profile drift). Pre-bump `run-all.sh` all suites green, buddy pytest 451. Cold restart pending to bind the 0.7.21 cache.

### 2026-06-13 — buddy 0.7.19 → 0.7.20

Versions the cache-based migration (be87850 + 2c1fcc5): SessionStart drops the
dev-symlink warning, dev-install/dev-check tooling removed, and the in-place
0.7.19 cache re-seed gets an honest new version number. Cache seeded + records
repointed to 0.7.20 across all three profiles; vestigial 0.7.19 cache pruned.
Tests: `run-all.sh` all suites green, buddy pytest 451. Cold restart pending to
bind the 0.7.20 cache.

### 2026-06-13 — buddy reverted to cache-based install

Dev-symlink model retired (commit be87850). buddy is now a cache-based
directory-source plugin like codescout-companion: the `0.1.0` symlinks were
removed, all three install records repointed to `cache/.../buddy/0.7.19`,
`dev-install.sh`/`dev-check.sh` deleted, and the buddy codescout sub-project
folded into `root`. State columns for buddy revert to cache-based
(`installed == canonical`, cache dir); the refresh prompt's dev-symlink logic
was removed.

### 2026-06-13 — buddy switched to dev-symlink install model

buddy is now dev-symlinked across all three profiles: install records pinned at
`0.1.0` → repo via `dev-install.sh` (now covers `.claude-kat` and repairs a
bump-clobbered record). Buddy's State columns changed from cache-based
(`installed == canonical`, cache dir) to dev-symlink (`installed == 0.1.0`,
symlink → repo); refresh prompt updated to match. Vestigial `0.7.x` cache
copies pruned in all three profiles. Commit 6ec9ae6.

### 2026-06-13 — buddy 0.7.18 → 0.7.19

Skill-ledger hardening from the first live probe (F-2 in `docs/trackers/skill-loading-session-log.md`): compact replays echo `<command-name>` tags (one recon load → two transcript occurrences), so count-threshold advisories would fire falsely after every compact; and `Skill(buddy:summon)` leaked into the ledger because the `buddy:*` exclusion only guarded the command-name path. Fix: advisories require the skill to pre-exist the scan chunk (from-zero scans can never advise), `type ∈ {user, assistant}` + not `isCompactSummary`/`isMeta` filtering, uniform `buddy:*` exclusion, per-chunk advisory dedup. Bonus empirical: `/reload-skills` "+12" confirmed persona frontmatter registers buddy skills with the Skill tool (settles F-1's Q4 docs-silent gap). Ledger tests 12/12, buddy pytest 451 green, hook integration 9/9. Cache seeded + install records updated across 3 profiles; sanity loop all ✅.
### 2026-06-12 — codescout-companion 1.11.11 → 1.11.12, buddy 0.7.17 → 0.7.18

Skill-loading bootstrap (spec `2026-06-12-skill-loading-bootstrap-design.md`; F-1/W-1 evidence in `docs/trackers/skill-loading-session-log.md`). **companion 1.11.12**: `is_skill_payload()` joins `is_binary_image()` as a native-Read exemption (SKILL.md / lens addenda / `references/`, plugin cache, `.buddy/` trees — verbatim fidelity required, codescout has no index over plugin payloads); guard matrix 32/32, repo suite 23/23 (test 8c intentionally flipped deny→allow). **buddy 0.7.18**: UserPromptSubmit summon bootstrap (`summon_bootstrap.py` — cold `/buddy:summon` costs zero model tool calls; tracking happens hook-side at injection time, making the statusline specialist line a certain record); skill ledger (`skill_ledger.py` — transcript scan is the only ground truth for Skill-tool loads since no hook fires for Skill, claude-code#43630; repeat loads emit do-not-reinvoke advisories; statusline gains a skills slot); frontmatter on all 12 personas (consumed by `specialist_labels`) + flat `inject_trackers`/`inject_memory_topics` bindings (planning-crane ← `docs/trackers/active-plan.md`; codescout-pika ← codescout memories gotchas+conventions); reload blocks strip frontmatter. buddy pytest 448 green; `run-all.sh` all suites; `check-versions.sh` clean. Cache seeded + install records updated across 3 profiles; sanity loop all ✅. sdd remains uninstalled in all profiles (standing baseline).
### 2026-06-12 — codescout-companion 1.11.10 → 1.11.11

Removed the redundant SessionStart system-prompt pointer (`memory(action="read", topic="system-prompt")`). codescout injects the root `.codescout/system-prompt.md` into the **main agent** via `server_instructions` (`## Custom Instructions`), so the companion pointer was a duplicate — and it aimed at the `system-prompt` *memory topic* that codescout's onboarding fix (issue `e492592986c67138`) just disowned. **Subagents** do NOT receive `server_instructions` (`claude-code#29655`), so `subagent-guidance.sh`'s verbatim injection is the sole delivery path to them — kept and comment-pinned. Two SessionStart tests flipped to assert pointer absence; the `subagent-guidance` verbatim test is unchanged and green. Spec + plan: `2026-06-12-system-prompt-source-consolidation-design.md`. Pre-bump `run-all.sh` all suites green; `check-versions.sh` clean. Cache seeded + install records updated across 3 profiles; sanity loop all ✅ (cache + installPath, no cross-profile drift). buddy (`0.7.17`) + sdd (uninstalled) unchanged.

### 2026-06-11 — codescout-companion 1.11.9 → 1.11.10

Recon skill gains **promotion routing**: project-shaped lessons promote to a codescout `reconnaissance` memory topic (advertised free by the existing `detect.py` glob — zero companion change), craft-shaped stay → `SKILL.md`; concrete+bounded rule format, ~10-rule cap, ungated-channel discipline. Authored the design + plan as superpowers specs (`2026-06-11-recon-findings-as-project-memory`), substrate verified against codescout source (`memory(write, topic=…)` on-disk Markdown, advertise-pull, ungated — any agent can write). Behavioral eval `reconnaissance-output.md` (codescout) gained Case 15 (advertise-pull efficacy probe). Doc-drift fixed: `CLAUDE.md` + README now say the companion injects *pointers* not verbatim content; dropped the stale "GitHub context injection". `run-all.sh` green; `check-versions.sh` clean. Cache seeded + install records updated across 3 profiles; sanity loop all ✅ (cache + installPath, no cross-profile drift). buddy (`0.7.17`) + sdd (uninstalled) unchanged.

### 2026-06-09 — codescout-companion 1.11.8 → 1.11.9, buddy 0.7.16 → 0.7.17

Scrubbed the obsolete pre-rename name code-explorer from the entire live surface of both plugins (hooks, detect.py, skills, READMEs, dashboard, commands, root tests, CLAUDE.md, .gitignore, buddy hook_helpers.py; pika smoke test renamed test-smoke-codescout.sh) and removed the GitHub guidance naming nonexistent github_* tools; dated design docs + CHANGELOG keep the name. Dropped the legacy .code-explorer/ directory fallback in detect.py + worktree hooks (.codescout only). codescout-companion auto-reindex now reads the Qdrant-era freshness sidecar .codescout/index-state.json (tracker 286ac62b; codescout writer still on experiments) instead of the frozen embeddings.db meta. New seed_index_state fixture; run-all.sh + test_detect.py (19) + buddy pytest (418) + pika smoke all green. Cache seeded + install records updated across 3 profiles; sanity loop all ✅.

### 2026-06-09 — claude-statusline 1.1.4 → 1.1.5, codescout-companion 1.11.7 → 1.11.8

claude-statusline 1.1.5: jq fix in `bin/statusline.sh` — `.workspace.git_worktree.name`/`.branch` now tolerate `git_worktree` arriving as a bare string (not just an object) via `try` + fallback (commit `15c9da6`). codescout-companion 1.11.8: recon SKILL.md R-19 — asserting a specific checkable fact ("it IS BLAKE3", "field IS named Y", "at line N"), especially when it becomes a recommendation or is written into a doc, now requires reading the symbol this session first; plain behavior-describing Q&A still skips the scout (commit `5a5b9c9`). Pre-bump `./tests/run-all.sh` all suites green; `check-versions.sh` clean. Cache seeded + install records updated across 3 profiles; sanity loop all ✅ (cache + installPath). buddy (0.7.16) and sdd (uninstalled) unchanged.

### 2026-06-02 — buddy 0.7.15 → 0.7.16

Promoted `codescout-pika` from a user-global specialist (`~/.buddy/skills/`) to the 12th builtin (`buddy/skills/codescout-pika/`, incl. its `sql/` + `tests/`); deleted the global copy so builtin isn't shadowed (precedence project > global > builtin). Registered in summon/dismiss/introspect/consolidate tables and legend (initial `K`); backfilled the already-missing `prompt-hamsa` into statusline `SPECIALIST_SHORT`/`SPECIALIST_ROLE` and legend (initial `H`). Bumped all "11 builtin" count refs → 12 (summon, create, skill-template, create-buddy-eval README, root CLAUDE.md) and "10 specialist masters" → 12 (README row, plugin.json description). De-hardcoded pika's shipped shell tests (`$HOME/.claude/...` → self-locate via `BASH_SOURCE`). Pre-bump green: buddy pytest 418 passed (widened `test_specialist_role` expected-set to 12), root `run-all.sh` all suites, pika 5/5. Cache seeded + install records updated across 3 profiles, all green. sdd remains uninstalled in all profiles (unchanged).

### 2026-05-28 — codescout-companion 1.11.6 → 1.11.7

Followed audit of all MCP tool-call hints emitted by plugin hooks. Three classes of broken/ambiguous call shapes fixed in commit `89af38d`: Class A (non-existent tools `search_pattern`, `library` in `pre-tool-guard.sh`); Class B (`workspace(...)` missing required `action` param across 4 sites in `worktree-write-guard.sh`, `worktree-activate.sh`, `session-start.sh`); Class C (positional shorthand `tool("X")` throughout `pre-tool-guard.sh` — expanded to `tool(param="X")`). Plus the earlier `read_memory("X")` → `memory(action="read", topic="X")` shorthand fix in `session-start.sh`. Cause: caller hit `memory(action="read", name="gotchas")` → `missing topic parameter`. Pre-bump `./tests/run-all.sh` all suites green (test-pre-tool-guard cargo assertions updated to look for `scope="lib:serde"` instead of removed `library(`). Cache seeded + install records updated across 3 profiles, all green.

### 2026-05-28 — codescout-companion 1.11.5 → 1.11.6

Two commits accumulated on top of 1.11.5: `d64749e` IL3 fix (ignore literal `|` inside quoted substrings — U-22; 4 new hook tests) and `f842848` recon SKILL.md update (close 'trivial mechanical edits' loophole, promote R-1, add R-9). Pre-bump `./tests/run-all.sh` all suites green. Cache seeded + install records updated across 3 profiles, all green.

_Append dated session deltas: ### YYYY-MM-DD — <what changed>._

### 2026-05-25 — codescout-companion 1.11.4 → 1.11.5

Downgraded IL3 run_command pipe guard from deny to warn-only (user request: deny was high-friction). `hooks.json` `mcp__.*__run_command` matcher re-pointed `il3-deny-hook.sh` → `il3-warn-hook.sh`; pipes now run with a non-blocking nudge instead of a hard block. Deny hook + its unit test kept in-repo, unwired, for re-promotion. Registration test updated to expect the warn hook. Cache seeded + install records updated across 3 profiles, all green.

### 2026-05-24 — codescout-companion 1.11.3 → 1.11.4

Covers the IL4 deny hook (`il4-deny-hook.sh` — blocks `read_file`/`Read` on `.md` paths, routes to `read_markdown`) and the recon SKILL.md R-3 grep-scope sentence, both committed on top of 1.11.3 without a bump. Pre-bump gate fixed a stale test: `run-all.sh` now also globs colocated `codescout-companion/hooks/*.test.sh`, so the new `il4-deny-hook.test.sh` and the modern `worktree-write-guard.test.sh` execute in the suite; the obsolete `tests/test-worktree-write-guard.sh` (asserted `replace_symbol → deny`, contradicting the modern `edit_code/edit_file/edit_markdown/create_file` matcher) was deleted. Cache seeded + install records updated across 3 profiles, all green.

### 2026-05-23 — buddy 0.7.14 → 0.7.15

Statusline rewrite to side-by-side layout: ASCII art on left, segments stacked in fixed slots on the right (form·mood, specialists, suggested+recon, plan verdict, codescout verdict). Adaptive specialist line: 1–2 active → full labels, 3+ → role names. Specialists segment exempt from truncation priority (let it overflow rather than ellipsize on falsely-narrow terminal width). Plus fix: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` resolution everywhere in buddy (install/uninstall commands, statusline-composed.sh caveman + primary fallback) so non-default profiles get the right config dir. CLAUDE.md adds the config-dir resolution rule. Cache seeded + install records updated across 3 profiles, all green.

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
