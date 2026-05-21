# Auto-migrate legacy per-profile buddy state on SessionStart

**Date:** 2026-05-21
**Status:** approved (brainstorm) — pending implementation plan
**Builds on:** `2026-05-21-buddy-global-config-home-design.md` (the `~/.buddy` unification + `migrate-global-to-home.py`). This adds a hook that runs that migration automatically.

## Problem

The `~/.buddy` unification ships a `migrate-global-to-home.py` script the user must run by hand (`--apply`). Until they do, global specialists/memories don't resolve (they now live at `~/.buddy`, which is empty). We want the migration to happen on its own the first time any CC instance starts after the upgrade — no manual step.

## Goal

When a buddy SessionStart hook fires and detects leftover per-profile global state in `~/.claude{,-sdd,-kat}/buddy/`, silently merge it into `${BUDDY_HOME:-~/.buddy}/`, delete the migrated source artifacts, and surface a one-line summary — safely, idempotently, and without ever breaking session start.

## Decisions (from brainstorm)

| # | Decision |
|---|----------|
| Behavior | **Auto-apply silently** when old state is detected (no user action). |
| Source disposition | **Delete the migrated artifacts** from sources after a successful apply (self-cleaning: detection then goes false, zero future overhead). |
| Where the logic lives | A tested Python function `auto_migrate_if_needed()` in `hook_helpers.py`, reusing `migrate.run()`. |
| Wiring | Invoked from the **first** inline python block in `session-start.sh`, **before** the memory-nudge block, so nudges see merged memory on the same (first) session. |
| Safety | Cross-instance non-blocking `flock`; `BUDDY_NO_AUTO_MIGRATE` kill-switch; delete only known artifacts (no blind `rmtree`); never raise out of the hook. |

## §1 — Detection

`_pending_migration_sources(home: Path) -> list[Path]`:
- For each of `~/.claude`, `~/.claude-sdd`, `~/.claude-kat`, look at `<profile>/buddy`.
- Include it iff it contains **any of the 4 known migratable artifacts**: `skills/` (dir), `memory/` (dir), `summons.log` (file), `identity.json` (file).
- Return the list of qualifying `buddy` dirs (possibly empty).

Keying on the artifacts — not merely "the `buddy` dir exists" — means that after the artifacts are deleted, detection is false even if an unrecognized file lingers in the dir. No infinite re-trigger. Steady-state cost: a handful of `stat`s, negligible.

## §2 — Orchestration

**Importability prerequisite.** `migrate.run` currently lives in `migrate-global-to-home.py` — a hyphenated filename that is not a valid module name, so it can only be loaded via `importlib` (as the existing test does). Before `hook_helpers` can `import` it cleanly, **extract the reusable logic into an importable `buddy/scripts/migrate_global.py`** (`run`, `_iter_files`, `_copy`, constants), and reduce `migrate-global-to-home.py` to a thin CLI wrapper that does `from scripts.migrate_global import run, main; ...`. Update `test_migrate_global.py` to import `from scripts.migrate_global import run` (drop the `importlib` shim). This refactor is the plan's first task; it has no behavior change and must keep all existing migration tests green.

`auto_migrate_if_needed(home: Path | None = None, dest: Path | None = None) -> str | None`
(defaults: `home = Path.home()`, `dest = buddy_paths.global_root()`)

1. If `os.environ.get("BUDDY_NO_AUTO_MIGRATE")` is set → return `None`.
2. `sources = _pending_migration_sources(home)`; if empty → return `None`.
3. Ensure `dest` exists; acquire a **non-blocking** `flock` on `dest/.migrate.lock`. If it cannot be acquired (another instance is migrating) → return `None`.
4. `stats = migrate.run(home=home, dest=dest, apply=True)` (the existing, tested merge: copy-absent / skip-identical / newest-wins+backup / summons union).
5. On success, for each source in `sources`, delete **only** the migrated artifacts present there — `skills/` (tree), `memory/` (tree), `summons.log`, `identity.json` — then `rmdir` the `buddy` dir **iff it is now empty**. Never `rmtree` the whole `buddy` dir.
6. Release the lock.
7. Return a one-line summary, e.g. `→ buddy: migrated {copied} files from {n} profile(s) into {dest}; removed legacy dirs`.
8. **Error handling:** wrap steps 4-5; on any exception, do NOT delete sources, return a one-line warning (`→ buddy: auto-migration failed ({err}); left legacy dirs in place, run /buddy:migrate`). The function must NEVER raise — session start cannot break.

## §3 — Locking & races

Three CC instances may fire SessionStart at once. The non-blocking `flock` on `dest/.migrate.lock` guarantees exactly one migrates; the others return `None` immediately. This prevents double-migration and a delete-mid-copy race. (A losing instance simply skips; if the winner is still mid-migrate, the loser's own later sessions will already see sources gone.)

## §4 — Deletion safety

Delete exactly the four known artifacts from each source, then conditionally `rmdir` the empty `buddy` dir. Rationale: `migrate.run` only knows how to merge those four; anything else the user placed under `<profile>/buddy/` is outside the migration's contract and must survive. The empty-only `rmdir` keeps the tree tidy when nothing unexpected is present (the common case).

## §5 — Wiring

- The function lives in `buddy/scripts/hook_helpers.py` (tested module).
- `buddy/hooks/session-start.sh`: add a **new first** inline python block (before the existing memory-nudge block) that does:
  ```
  sys.path.insert(0, '$PLUGIN_ROOT')
  from scripts.hook_helpers import auto_migrate_if_needed
  line = auto_migrate_if_needed()
  if line:
      print(line)
  ```
  guarded with `2>/dev/null` like the sibling blocks. Echo the returned line if non-empty. Because this runs first, the subsequent nudge block reads the freshly-merged `~/.buddy/memory`.

## §6 — Testing (pytest, all Python)

- `_pending_migration_sources`: returns dirs holding any artifact; empty when none; respects nothing else (env handled in the orchestrator).
- `auto_migrate_if_needed` happy path (tmp `home` + `dest`): sources merged into dest; the 4 artifacts deleted from each source; emptied `buddy` dirs removed; summary string returned; **idempotent** — second call returns `None`.
- Kill-switch: `BUDDY_NO_AUTO_MIGRATE=1` → returns `None`, nothing touched.
- Unknown-file survival: a stray `<profile>/buddy/notes.txt` is left intact and its `buddy` dir not removed.
- Failure path: monkeypatch `migrate.run` to raise → sources untouched, warning returned, no exception propagates.
- Lock contention: pre-acquire `dest/.migrate.lock` in the test → call returns `None`.
- Smoke: run the session-start.sh first-block body via the venv python (as in the T7.5 fix) → prints summary or nothing, no error.

## Out of scope

- Migrating anything beyond the four artifacts (unknown files are never touched).
- A standalone `/buddy:migrate` command (the manual `migrate-global-to-home.py --apply` already exists; the warning path references it).
- Changing `migrate.run`'s merge semantics — reused verbatim.

## Risks

- **Silent data deletion on a hook.** Mitigated: data is copied (and conflicts backed up to `~/.buddy/.migration-backup/`) before any source artifact is removed; only known artifacts are deleted; failures abort deletion. The kill-switch `BUDDY_NO_AUTO_MIGRATE` is the escape hatch.
- **flock portability:** `flock` via Python `fcntl` is POSIX-only. Buddy is developed on Linux (this machine); acceptable. Document the assumption.
- **First-session latency:** one-time copy of ~tens of small files, sub-100ms; only on the first post-upgrade session, then never again.
