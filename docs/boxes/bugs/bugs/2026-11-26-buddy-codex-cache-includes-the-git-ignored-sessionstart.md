---
kind: entry
status: fixed
title: Buddy Codex cache includes the Git-ignored SessionStart trace
closed: 2026-11-26
created: 2026-11-26
entry_kind: bug
log:
- '2026-11-26 open created codescout:anonymous'
- '2026-11-26 open -> fixed codescout:anonymous'
severity: low
status_since: 2026-11-26
---

**Summary:** Buddy's local-marketplace reference package and installed Codex cache both contain `buddy/.buddy/.session-start-trace.log`. The source path is ignored by `buddy/.gitignore`. The cache check compares the runtime file as release payload.

**Observed:** On 2026-11-27, `./scripts/check-profile-parity.sh buddy` exited 1 and named `.buddy/.session-start-trace.log` as the first cache difference for Buddy 0.12.5. The working tree also has committed Buddy changes since 0.12.5, so this observation does not attribute all current cache drift to the trace.

**Control:** Two temporary copies with identical payload and a `.gitignore` for `.buddy/` compare equal with `cache_payload` and `cache_difference` in `scripts/sync-codex.py`. Adding only a synthetic `.buddy/.session-start-trace.log` to the reference causes the same difference. Both actual copies were checked for the file's presence without reading its contents.

**Expected:** Runtime state stays out of the Buddy Codex package and a change to the trace never prompts a cache refresh. `packaged_marketplace` stages filtered content for codescout-companion in `dbfe5e6` through `copy_plugin_tree`, which already excludes `.buddy/`. Buddy uses the raw local marketplace source.

## Closed

Buddy now uses the same staged local marketplace and `copy_plugin_tree` filter as codescout-companion. Parity builds its reference from that staging area, and installation uses it for the same payload. The temporary source override preserves the configured marketplace.

The real Codex fixture reproduced three Buddy failures before the fix. After the fix, all 36 checks in `tests/test-sync-codex.sh` passed. They cover detection of an old cache with a trace, refresh through the filtered package, and parity after the source trace changes. A separate reference build from the full Buddy source also excluded `.buddy/` and matched the source bytes of its hook manifest, session-start helper and Prompt Hamsa skill.

Existing installations receive the filtered package on their next Buddy release.
