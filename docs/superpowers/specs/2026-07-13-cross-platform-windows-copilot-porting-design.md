---
title: Cross-platform porting — Windows and GitHub Copilot collapse into one problem (cross-platform hooks)
date: 2026-07-13
status: draft
topic: cross-platform-windows-copilot-porting
---

# Windows + Copilot Porting — One Problem, Not Two: Make the Hook Layer Cross-Platform and Both Fall Out

## Summary

The three plugins (`codescout-companion`, `buddy`, `sdd`) run today only on Linux/macOS.
The goal is Windows-native support and GitHub Copilot support. The central finding of the
2026-07-13 investigation is that **these are the same problem, not two.**

- **Copilot loads the whole Claude plugin format natively.** VS Code agent mode and Copilot
  CLI auto-detect a Claude-format plugin — skills *and* `hooks/hooks.json` *and* MCP servers
  *and* commands *and* agents — and expand `${CLAUDE_PLUGIN_ROOT}` at runtime (and set it as
  an env var in the hook process). Primary docs: *"A single plugin can provide any combination
  of slash commands, agent skills, custom agents, hooks, and MCP servers"* and *"The plugin
  format is shared between VS Code, GitHub Copilot CLI, and Claude Code. A single plugin
  repository can work across all three tools"* (code.visualstudio.com).
- Therefore our hooks do not fail "on Copilot" as a category — they fail **wherever bash (and
  jq/sqlite3/coreutils) is absent.** Copilot-on-Linux/macOS runs our bash hooks today (modulo
  matcher/exit-code differences); Copilot-**or**-Claude-Code-on-Windows does not.
- **The real axis is the OS, not the host.** Fix the hook layer for Windows and the same fix
  serves Copilot, because it is one plugin format across all three tools.

So there is no separate "Copilot port." There is **one cross-platform-hooks track** (best
served by moving hook logic off bash+jq+sqlite3), plus a **short Copilot-only cleanup list**
(matcher syntax, exit-code semantics, statusline has no home, MCP install is per-surface).

The markdown surface (skills, commands, agents, templates, constitution, data catalogs) is
already portable-as-text and auto-discovered by Copilot; it needs no work beyond placement.

## Status

- Investigation complete (four parallel tracks, 2026-07-13): local portability audit of all
  three plugins; teardown of how `superpowers` (obra) stays portable; web research on
  Claude-Code-Windows patterns; web research on the Copilot extensibility surface.
- Copilot plugin-format auto-detection **verified against primary docs** (code.visualstudio.com
  agent-plugins + hooks pages). This upgrades the earlier medium-confidence claim to confirmed.
- No code changed yet. This spec is the plan of record.
- **Exit-code semantics on Copilot RESOLVED** (2026-07-13, docs.github.com hooks-reference):
  `preToolUse` is *fail-closed* and JSON `permissionDecision` is honored — see Copilot residuals
  + Risks. This *inverts* the spec's first-draft risk.
- **Node ≥22 available locally** (v26.4.0) — `node:sqlite` viable; confirm the version bundled
  with shipped Claude Code / Copilot, not just this dev box (Open questions).
- **codescout Windows build RESOLVED (2026-07-13):** first-class Windows target, builds from
  source (no prebuilt binary shipped). **P2 unblocked.** See Open questions #1.
- **P0 SHIPPED (2026-07-13):** sdd hooks rewritten to Node exec-form — `session-start.mjs`,
  `spec-guard.mjs`, `review-guard.mjs`, `subagent-inject.mjs`, `mark-reviewed.mjs` + shared
  `lib.mjs`; `hooks.json` → `node` exec-form; `/review` marker now via `mark-reviewed.mjs`; the
  four old `.sh` hooks removed; `tests/test-sdd-hooks.sh` (14 cases) and full
  `./tests/run-all.sh` green. Deviation from plan: the review marker stays in `os.tmpdir()`
  (per-user, ephemeral) rather than `${CLAUDE_PLUGIN_DATA}` — the marker is a per-session gate,
  not durable state, so ephemerality is the correct semantic and avoids a review staying "done"
  across reboots/updates.
- **P1 (partial) SHIPPED (2026-07-13):** buddy's #1 Windows blocker fixed — `import fcntl` is now
  guarded (`hook_helpers` no longer crash-imports on Windows) with a `msvcrt`-based lock fallback
  so the migration guard survives; both judge spawns use `sys.executable` + cross-platform
  detachment (`creationflags` on Windows, `start_new_session` on POSIX) via a new
  `_spawn_detached_worker`. `buddy/tests/test_cross_platform_hooks.py` (5 cases) + full buddy
  suite (466) green. Deferred buddy items (need a decision or more care): `requests`→urllib
  (or declare it), the `ps -o lstart=` PPID index, the Windows statusline default, pika
  `sqlite3`→stdlib.
- **P2 foundation SHIPPED (2026-07-13):** `scripts/detect.py` (241-line codescout server/binary/
  config resolver) ported to `hooks/detect.mjs` (Node-only, no Python), with `hooks/detect.test.sh`
  proving **byte-parity** vs `detect.py --json` across 6 config scenarios. This keystone unblocks
  porting the 19 companion bash hooks onto a Node foundation. Committed on branch
  `feat/cross-platform-porting` (4 commits: spec, sdd, buddy, detect-foundation).
- Remaining product decision: buddy Python-vs-Node for the *deep* work (gates P3) — the P1
  mechanical fixes above assume Python-first (the spec's recommendation) and are low-regret; see
  Open questions #4.

## The core finding, in one table

| Host × OS | Hooks run today? | Why |
|---|---|---|
| Claude Code · Linux/macOS | ✅ | native environment |
| Claude Code · Windows | ❌ | no bash / jq / sqlite3 / POSIX APIs |
| Copilot (CLI + VS Code) · Linux/macOS | ⚠️ mostly | plugin format loads; bash present. Residuals: matcher syntax, exit-code-2 semantics |
| Copilot · Windows | ❌ | same OS blocker as Claude-Code-Windows |

The two ❌ cells share one root cause. Close it once.

## Goals

1. All three plugins install and their hooks **execute** on Windows-native Claude Code (no WSL,
   no assumption of a pre-installed Git Bash environment carrying jq/sqlite3).
2. The same plugins load and function on GitHub Copilot (CLI + VS Code agent mode) on all OSes,
   to the extent Copilot's surface supports each component.
3. **Fail open, never fail the session.** A missing dependency degrades a feature silently
   (`exit 0`), consistent with the existing "companion hooks always exit 0" rule.
4. Single implementation per hook where feasible — avoid the dual `.sh`+`.ps1` maintenance trap.

## Non-goals

- Rewriting the markdown/skill content (already portable; Copilot auto-discovers `.claude/skills`).
- A statusline for Copilot — there is no equivalent surface anywhere in Copilot (buddy's
  spirit-animal statusline stays Claude-Code-only, by design).
- Porting codescout the MCP server itself. Its Windows build status is a **precondition**, not
  part of this work (see Open questions). Where codescout is absent, the companion degrades.
- A Copilot marketplace entry. Copilot has no marketplace analog to `marketplace.json`; the git
  repo is the distribution unit. Distribution changes are out of scope here.
- WSL as the answer. WSL is an escape hatch, not a port; and its presence actively breaks
  native Windows `.sh` hook resolution (claude-code#23556). We target native Windows.

## Constraints

- **Node is the only interpreter guaranteed present** across Claude Code, Copilot CLI, and VS
  Code, on every OS. bash, jq, sqlite3, python3, `ps`, and coreutils are **not** guaranteed on
  Windows. This is the single most important design constraint.
- **`${CLAUDE_PLUGIN_ROOT}` changes on every plugin update** (old dir lingers ~7 days); the
  docs-sanctioned home for persistent state is **`${CLAUDE_PLUGIN_DATA}`** — relevant to
  buddy's `.buddy/` state and any cache files currently rooted at the plugin dir or `$HOME`.
- **Windows hook command execution** (code.claude.com/docs/en/hooks): the `shell` field
  defaults to bash (Git Bash if installed, else PowerShell); it is **ignored when `args` is
  set**. The docs bless an **exec form** — `"command": "node", "args": [...]` — that spawns the
  binary directly with **no shell at all**, sidestepping the entire Git-Bash bug class
  (backslash-path mangling #21878/#18610, bare-`bash`-not-on-PATH #22700/#16602, WSL bash.exe
  shadowing #23556, "Could not fork child process"). npm `.cmd`/`.bat` shims cannot be spawned
  by exec form — reference the real `.js` with `node`.
- **Copilot hooks support per-OS command variants** (`windows`/`linux`/`osx` properties);
  *"the execution service selects the appropriate command based on your OS."* This is a
  first-class lever but implies maintaining two command strings per hook — a cost to weigh
  against a single OS-agnostic command.
- Companion hooks are **tightly coupled to codescout** (reads its SQLite `drift_report`/
  `usage.db` schema, shells its CLI). Portability work must not loosen that coupling where it
  is intentional; it must only make the *access mechanism* cross-platform.

## Strategy — the cross-platform hook layer

Three candidate mechanisms, evaluated:

| Mechanism | Kills bash? | Kills jq/sqlite3? | Impl count | Verdict |
|---|---|---|---|---|
| **Polyglot dispatcher** (`run-hook.cmd`, superpowers-style) | routes around it | ❌ still needs jq/sqlite3 on Windows | 1 dispatcher + N scripts | Fast unblock; does **not** solve our dependency problem |
| **Per-OS command variants** (`windows`/`linux`/`osx`) | per-OS | only if Windows variant avoids them | 2 per hook | First-class but doubles maintenance |
| **Node exec-form** (`node`, `args:[…mjs]`) | ✅ no shell | ✅ `JSON.parse`, `node:sqlite` (Node ≥22) | 1 | **Recommended endgame** for bash-glue hooks |

**Decision:** the *depth* of our problem is not "bash" — it is the external-dependency and
POSIX-API footprint (jq, sqlite3, `ps`, `fcntl`, symlinks, `/tmp`). The polyglot pattern
routes around the shell but leaves jq/sqlite3 broken on a bare Windows box (Git Bash does not
bundle jq). Only the **Node exec-form** collapses shell + jq + sqlite3 + path handling in one
move, with a single implementation. It is therefore the recommended target for bash-glue hooks
(`codescout-companion`, `sdd`).

**Exception — buddy is a Python codebase, not bash glue.** Its 26 production Python scripts are
the asset and are *mostly* already portable. Rewriting them to Node is wasteful. buddy instead
keeps Python and needs (a) the four POSIX-API defects fixed and (b) a cross-platform way to
reach the interpreter — see its section.

Cross-cutting conventions to adopt from superpowers regardless of mechanism:
- **Extensionless hook scripts** where a shell is still involved (dodges Claude Code's Windows
  behavior of prepending `bash` to any command containing `.sh` — claude-code#9758, #3417).
- **Fail open** (`exit 0`) when a dependency is missing.
- **`printf`, not heredocs**, for JSON emission (avoids the bash 5.3+ heredoc hang, #571).
- **Harness detection by env var** (`CLAUDE_PLUGIN_ROOT` / `CURSOR_PLUGIN_ROOT` / `COPILOT_CLI`)
  to emit the output shape each host expects, if we ever need non-Claude output schemas.

## Per-plugin plan

### sdd — cheapest; do first as the pattern-setter

Smallest executable surface: 4 bash hooks, no Python, no codescout coupling, no statusline.

Blockers found:
- `md5sum` (GNU-only) — `sdd/hooks/review-guard.sh:31`.
- `/tmp` review marker (world-writable, fixed name) — `review-guard.sh:34`.
- `compgen -G` (bash builtin) + `xargs -r basename -a` (GNU) — `session-start.sh:27-28`,
  `subagent-inject.sh:24-25`.
- jq — `spec-guard.sh`, `review-guard.sh`, `subagent-inject.sh` (note: `session-start.sh:8`
  already parses cwd with `grep -o`, no jq — a WIN-positive precedent).

**Plan:** rewrite the 4 hooks as Node `.mjs` exec-form. Trivial in size; establishes the
`node`-exec-form + `${CLAUDE_PLUGIN_DATA}` conventions the other two plugins reuse. The `/tmp`
review marker moves to `${CLAUDE_PLUGIN_DATA}`; the md5 hash → `node:crypto`; spec/frontmatter
parsing → plain JS. This is the reference implementation.

### codescout-companion — the main event; Node exec-form rewrite

19 production bash hooks, 18 of them hardcoding `#!/bin/bash`. Two already-portable Python
helpers (`scripts/detect.py`, `skills/reconnaissance/recon_count.py`) reached *through* bash.

Blockers found (worst offenders):
- **jq pervasive** — session-start, worktree-activate, pre-tool-guard, goal-stop-hook,
  constitution-*, cs-activate-project, subagent-guidance, git-worktree-guard.
- **Direct sqlite3 read of codescout's DB** — `session-start.sh:167` (`drift_report` query).
- **Symlink-based worktree sharing** — `worktree-activate.sh:96,105`, `session-start.sh:226,235`
  (`ln -s`, `[ ! -L ]`). Windows symlinks need privilege; **directory junctions (`mklink /J`)
  need none** — use `fs.symlink('…','…','junction')` from Node, which maps to junctions on
  Windows and symlinks on POSIX.
- **GNU `stat -c %Y`** — `worktree-activate.sh:34` → `fs.statSync().mtimeMs`.
- **`/tmp` fixed-name files** — `pre-tool-guard.sh:69,108` → `os.tmpdir()` + unique names.
- **Backgrounding via `&`** — `session-start.sh:157` (reindex), `pre-tool-guard.sh:80` (dedup
  cleanup) → Node `child_process.spawn(…, {detached:true, stdio:'ignore'}).unref()`.
- codescout CLI shelling — `session-start.sh:157`, `goal-stop-hook.sh:39-41` → `spawn`/`execFile`
  with a cross-platform binary resolver (the CLI name/path logic already exists; port it to JS).

WIN-positive precedent already in the plugin: `detect-tools.sh:17,19` does `cygpath -m` and
`python3 || python` resolution, and detection logic already lives in the stdlib-only
`scripts/detect.py`. The direction is set; extend it.

**Plan:** rewrite hooks as Node `.mjs` exec-form. `JSON.parse` replaces every jq call;
`node:sqlite` (Node ≥22) replaces the sqlite3 binary for the drift query; `fs.symlink(…,
'junction')` replaces `ln -s`; `os.tmpdir()`/`node:crypto` replace `/tmp`/GNU tools; `spawn`
+`.unref()` replaces `&`. Keep `detect.py` as-is or fold into JS. This is the largest chunk of
work and the highest-value: it is the plugin whose guards are load-bearing, and the polyglot
alternative would leave jq/sqlite3 broken. **Gated on codescout having a Windows build** (Open
questions) — a Windows companion is only useful where the codescout binary runs.

### buddy — Python-first; fix four defects, dispatch cross-platform

5 bash hook wrappers → 26 Python scripts. The Python is the asset and is mostly portable
already (`Path.home()`, `tempfile.mkstemp` atomic writes, `shutil` moves). Do **not** rewrite
to Node. Four point-defects plus the wrapper/statusline layer are the work.

Point-defects (each small, each load-bearing):
1. **`import fcntl` at module top** — `scripts/hook_helpers.py:6` (used `:91` `flock` in
   `auto_migrate_if_needed`). Windows has no `fcntl` → **ImportError crashes the entire buddy
   Python dispatch hub before any handler runs.** Highest blast radius. Fix: guard the import
   and the lock (`try: import fcntl` / `msvcrt.locking` fallback / or a portable lockfile).
2. **PPID + `ps -o lstart=` session-identity index** — shell `session-start.sh:33,43`,
   `user-prompt-submit.sh:22`, `session-end.sh:10`; Python `state.py:181-182` (docstring
   `:176` "Linux and macOS"). No native-Windows `ps`. Fix: replace with a cross-platform
   process-start lookup (e.g. `psutil` if we accept the dep, or read the value CC provides in
   hook stdin, or drop process-start disambiguation on Windows and key on PPID alone).
3. **Detached judge spawn hardcodes `python3` + POSIX `start_new_session`** —
   `hook_helpers.py:559-572, 646-660`: `Popen(["python3", …], start_new_session=True)`. Fix:
   `sys.executable` for the interpreter; on Windows use `creationflags=DETACHED_PROCESS |
   CREATE_NEW_PROCESS_GROUP` instead of `start_new_session`.
4. **Undeclared `requests` dependency** — `judge.py:136,160`, `cs_judge.py:72,99`;
   `buddy/pyproject.toml` has no `[project]` deps and no `requires-python`. Fix: declare deps +
   `requires-python`, or drop `requests` for `urllib` (already used in the eval tests) to erase
   the third-party dependency entirely.

Wrapper + statusline layer:
- The bash wrappers already resolve `python3 || python` and `cygpath` (except `session-end.sh`,
  which lacks both). Fold the wrappers' jq/`ps`/`sed` work into the Python entry points and make
  the hook `command` reach Python cross-platform (OS-variant `windows`→`py -3 …` /
  `linux`,`osx`→`python3 …`, or a small extensionless dispatcher). This is where buddy's
  Python-runtime-on-Windows assumption bites (Open questions).
- `summon_bootstrap.py:57-59` shells `bash discover-specialists.sh` — port that one script's
  logic into Python so the Python path needs no bash.
- `consolidate.py:721-725` shells `git` — acceptable (git is a documented dep), keep.
- **Statusline:** default Windows users to the already-portable **`scripts/statusline.py`**
  (pure Python), not `statusline-composed.sh` (curl+jq+mktemp+`stat -c %Y`+`&`+`disown`, all
  Windows blockers). Update `commands/install.md` to select the Python statusline on Windows.
- **codescout-pika** specialist shells `sqlite3` directly in its *skill body*
  (`skills/codescout-pika/SKILL.md:71,81`) against codescout's `usage.db`. On Windows this
  needs either a bundled sqlite3, `node:sqlite`, or Python's stdlib `sqlite3` module. Prefer
  routing pika's DB access through a Python helper using stdlib `sqlite3` (no external binary).
  Also fix the developer-hardcoded absolute path in `tests/test-smoke-codescout.sh:5`.

## Copilot-only residuals (after hooks are cross-platform)

The shared plugin format does **not** erase these four:

1. **Matcher syntax.** Our matchers (`mcp__codescout__*`, `EnterWorktree`, `Agent`,
   `mcp__.*__run_command`) must be validated against Copilot's matcher grammar; filtering that
   doesn't translate moves into the hook body.
2. **Exit-code semantics — RESOLVED (2026-07-13), and inverted from the initial read.** Copilot
   CLI `preToolUse` is *fail-closed*: a crash or non-zero exit (other than 2) **denies** the
   tool; exit 2 is a non-blocking warning; and JSON stdout `{permissionDecision:
   "allow"|"deny"|"ask"}` is honored (docs.github.com hooks-reference). Our guards deny via that
   JSON field with exit 0 (verified in `sdd/hooks/spec-guard.sh`, `review-guard.sh`; companion
   guards per CLAUDE.md), so **intended denies port cleanly**. VS Code is Claude-compatible (exit
   2 blocks). The remaining action is not "make denies work" — it is "guarantee hooks never
   crash," because a crash *is* a deny on Copilot CLI (see Risks).
3. **Statusline.** No Copilot equivalent — buddy's statusline is Claude-Code-only. Accepted.
4. **MCP install.** Copilot reads a plugin-declared MCP server, but the codescout **binary**
   must still be installed and runnable; per-repo CLI MCP config was historically a gap
   (copilot-cli#2528). Document `.vscode/mcp.json` (IDE) and `~/.copilot/mcp-config.json` (CLI)
   setup rather than assuming plugin-bundled install.

Distribution note: Copilot discovers plugins via `chat.plugins.marketplaces`, git-URL install
(*Chat: Install Plugin From Source*), `chat.pluginLocations`, or auto-discovery of
CLI-installed plugins; Copilot CLI understands `.claude-plugin` manifests and installs via
`copilot plugin install owner/repo:subdir`. No conversion needed — the existing repo layout is
installable.

## Phasing / sequencing

1. ✅ **P0 — conventions + sdd (pattern-setter) — DONE (2026-07-13).** sdd's 4 hooks rewritten as
   Node `.mjs` exec-form + shared `lib.mjs`; established the fail-open/`exit 0` convention,
   `node:crypto` md5, `os.tmpdir()` marker (not world-writable `/tmp`), and
   `tests/test-sdd-hooks.sh`. `${CLAUDE_PLUGIN_ROOT}` referenced via exec-form `args`. Old `.sh`
   deleted. All suites green.
2. ✅ **P1 — buddy point-defects — COMPLETE (2026-07-13).** ~~`fcntl` guard~~ ✅, ~~judge-spawn
   interpreter + detachment~~ ✅. **Design fork resolved (stdlib-only, no new dep):**
   - `ps -o lstart=` PPID index (`state.py`) — added `_START_TIME_SUPPORTED = os.name != "nt"`;
     `pid_started_at` short-circuits to None where start-time is unsupported (Windows), and
     `resolve_session_id_for_command` trusts the PPID mapping alone there (no `started_at` file
     required) while still requiring a start-time match on POSIX. Rejected `psutil` (new dep,
     against buddy's dependency-free ethos) and Windows `ctypes` (unverifiable on the Linux dev
     box). Note: the *writer* side (`ps` in the bash wrappers) is ported in **P3**; this makes
     the reader forward-compatible so the index works on Windows once P3 lands.
   - `requests` → stdlib `urllib.request` in `judge.py` + `cs_judge.py` (matches the eval
     harness pattern; preserves the raises-on-failure contract via HTTPError/URLError). Erases
     the only undeclared third-party runtime dep. `pyproject.toml` now documents zero runtime
     deps + Python 3.13+ floor (comment, not a `[project]` table — version stays owned by
     `plugin.json`, no drift).
   - Tests: 7 added to `tests/test_cross_platform_hooks.py` (Windows PPID-alone resolution,
     POSIX match/mismatch guards, urllib-not-requests source scan + functional POST for both
     judge modules). Buddy pytest 473 green; full `tests/run-all.sh` green.
   These finish unblocking buddy-on-Windows without touching the 26-script bulk.
3. **P2 — codescout-companion Node rewrite.** The big chunk. Windows-build gate cleared.
   ✅ **Foundation DONE (2026-07-13):** `detect.py` → `hooks/detect.mjs` (byte-parity tested).
   ✅ **PreToolUse guard/hint layer DONE (2026-07-13):** `lib.mjs` (readInput/emit/deny/context +
   `git()` + `detectFor()` + `emitSkillHint()`) plus 8 hooks all ported to exec-form and tested:
   `il3-warn-hook`, `il4-deny-hook`, `worktree-write-guard`, `git-worktree-guard`, `pre-task-hint`,
   `pre-edit-hint`, `constitution-guard`, `pre-tool-guard` (dedup reimplemented as an os.tmpdir()
   mtime window — cross-platform, no backgrounded rm). Retired `skill-hints.sh`. il4 + il3
   additionally **live-verified** in the harness after `/reload-plugins`.
   ✅ **P2 COMPLETE (2026-07-13).** All 14 live hooks + `detect.mjs` foundation ported to Node
   exec-form; `hooks.json` is now 100% `command:"node"` (16 entries, 0 `.sh`). Stateful set done:
   session-start (node:sqlite drift + junction symlinks + spawn().unref() + marker seed/sweep +
   tracker-hygiene), subagent-guidance, constitution-brief, constitution-epoch-bump,
   worktree-activate, cs-activate-project, goal-stop-hook, explore-inject. Every `*.test.sh`
   repointed to node; full `tests/run-all.sh` green.
   **Deferred (optional housekeeping, NOT portability blockers — no live hook invokes them):**
   `detect-tools.sh` + `detect.py` are retained as the byte-parity oracle for `detect.mjs` (and
   `detect.py` backs `detect.test.sh`); unregistered `il3-deny-hook.sh` is dead code (not in
   hooks.json) — retire-vs-port is a separate call. **Remaining stateful:** session-start
   (`node:sqlite` drift query + `fs.symlink(...,'junction')` + `spawn().unref()`),
   worktree-activate, cs-activate-project, goal-stop-hook, subagent-guidance, constitution-brief,
   constitution-epoch-bump. **Cleanup:** delete `detect-tools.sh` (superseded by `detect.mjs`)
   and port/retire `detect.py` once no hook shells it. NB: `il3-deny-hook.sh` is unregistered in
   hooks.json — decide retire vs port separately.
4. ◐ **P3 — buddy wrapper/statusline cross-platform — CORE DONE (2026-07-13).**
   The 5 bash hook wrappers (session-start/user-prompt-submit/pre-tool-use/
   post-tool-use/session-end) are replaced by a Python layer reached through a
   Node launcher. **Interpreter fork resolved:** `python3` fails on Windows,
   bare `python` is often absent on macOS, and CC hooks.json has no per-OS
   variants — so a single interpreter name can't work without regressing the
   current python3 users. Solution: `hooks/run.mjs` (Node is guaranteed wherever
   CC runs) resolves `python3 → python → py -3`, spawns `hooks/hook_dispatch.py
   <event>` with stdio inherited, forwards only an intentional exit 2, and passes
   CC's PID as `BUDDY_HOOK_PPID` so the by-ppid index keys on CC not the launcher.
   hooks.json is now the node exec-form (mirrors codescout-companion). Logic
   folded into `scripts/hook_entry.py` (5 run_* fns) + `hook_dispatch.py`:
   jq→json, ps/sed/mkdir/echo→`state.update_ppid_index`/`gc_ppid_index`/
   `remove_ppid_entry`, `. judge.env`→`hook_helpers.load_judge_env`,
   multiple `python -c`→direct calls. `summon_bootstrap.discover()` ported to a
   pure-Python scope scan (no `bash discover-specialists.sh`). Statusline:
   `commands/install.md` now forces standalone `statusline.py` on Windows (composed
   is POSIX-only) and uses `python` there. `.gitattributes` enforces LF on `.mjs`;
   the CI cross-platform test drives the node launcher end-to-end (real on the
   Windows runner). All 6 wrapper tests repointed to `hook_dispatch.py`; +11 new
   tests (ppid index, judge.env loader, discover precedence, launcher e2e). buddy
   pytest 483 green; full `tests/run-all.sh` green.
   **Deferred:** pika `sqlite3`→stdlib (`skills/codescout-pika` — a specialist
   skill that degrades gracefully; largest, least-critical item). Minor: the
   `create.md`/`summon.md` command docs still show `bash discover-specialists.sh`
   as an interactive fallback (the hot hook path is Python; discover-specialists.sh
   kept as its own test's POSIX oracle).
5. **P4 — Copilot residuals.** Matcher validation, exit-code testing per surface, MCP setup
   docs, `.github/agents`/`.github/prompts` mirrors if we want first-class Copilot commands.

P0–P1 deliver graceful Windows degradation quickly. P2 delivers full Windows companion
function. P4 is the Copilot-specific tail — largely free once P0–P3 land, because it is the same
plugin format.

## Risks

- **codescout has no Windows build** → P2 is moot; the companion can only degrade, not function,
  on Windows. Verify first (Open questions). Mitigation: P0–P1 still deliver value on Windows
  for the codescout-independent surface (sdd, buddy).
- **`node:sqlite` requires Node ≥22.** If Claude Code / Copilot ship an older bundled Node,
  fall back to a bundled sqlite3 or a WASM sqlite. Check the shipped Node version.
- **buddy's Python-on-Windows assumption.** Node is guaranteed; Python is not. Requiring Python
  3.13+ on Windows is a real adoption cost. If unacceptable, buddy's judge/memory layer would
  need a Node rewrite — a large scope increase. Decide explicitly (Open questions).
- **Copilot CLI `preToolUse` is fail-closed** (the inverse of this spec's first draft): a hook
  that crashes or exits non-zero (other than 2) **denies the user's tool call** on Copilot CLI,
  while the same crash is benign (fail-open) on Claude Code. `set -euo pipefail` + a missing
  dependency (jq on Windows) hits exactly this. Mitigation: the fail-open/`exit 0` convention
  becomes *mandatory* on every guard, and the Node rewrite (no jq/sqlite3 binary to go missing)
  removes the main crash source. Intended denies are unaffected — they use JSON
  `permissionDecision`, not the exit code.
- **Regression risk in the Node rewrite.** Per the repo's Iron Rules and the CLAUDE.md review
  policy, the guard rewrites are load-bearing infrastructure — budget an Opus review pass on the
  new hook implementations and port the existing `*.test.sh` assertions to the new runtime.

## Open questions

1. ~~Does codescout have a Windows build today?~~ **RESOLVED (2026-07-13):** yes, from source.
   codescout is a first-class Windows target — CI builds `x86_64-pc-windows-msvc` natively and
   `x86_64-pc-windows-gnu` under wine; real `src/platform/{unix,windows}.rs` abstraction;
   `windows-sys` for Win32 process control. Caveats: **no prebuilt binary ships for any OS**
   (users `cargo build`); the `peer` module + socket-based LSP-mux transport are unix-only
   (feature gaps, not compile blockers); open item WIN-5 (LSP spawn-timeout under EDR). **P2
   unblocked** — target a source-built Windows codescout.
2. ~~Exit-code-2 on Copilot CLI — blocking or warning?~~ **RESOLVED (2026-07-13):** `preToolUse`
   is fail-closed; JSON `permissionDecision` honored. Consequence folded into Copilot residuals
   + Risks. New sub-task: audit every guard so a dependency-miss cannot crash it into a deny.
3. ~~Bundled Node version — is `node:sqlite` available?~~ **RESOLVED (2026-07-13):** CC ships
   no Node; it uses **system Node (≥20)**. `node:sqlite` is **NOT available by default**
   (needs `--experimental-sqlite` through 22.12; still experimental) — do **not** rely on it in
   a hook. (codescout-companion session-start's drift query uses it via a lazy import in the
   dead post-Qdrant path, so it never actually fires — acceptable, but flagged.)
4. ~~buddy on Windows — require Python, or rewrite to Node?~~ **RESOLVED (2026-07-13):** keep
   Python (26 scripts are the asset; a rewrite is wasteful). Require Python on PATH and reach
   it via a **Node launcher** (`hooks/run.mjs`) — Node is guaranteed wherever CC runs, and it
   probes `python3 → python → py -3` so neither `python3`-only (Linux/macOS) nor `python`-only
   (Windows) users regress. P3 core shipped on this basis.
5. ~~Per-OS command variants?~~ **RESOLVED (2026-07-13):** CC hooks.json has **no** per-OS
   field — a single `command` must work everywhere (→ the Node-launcher / Node-exec-form
   pattern). **Copilot CLI is different and gates P4:** its hooks config is a *separate schema*
   — per-event `bash`/`powershell` keys, **no `args`**, and it does **not** expand
   `${CLAUDE_PLUGIN_ROOT}`. So Copilot needs its **own** hooks manifest; the CC hooks.json will
   not load as-is. Also confirmed: `.sh` as a hook `command` is broken on Windows (opens in
   editor / WSL-vs-Git-Bash `bash.exe` conflict — claude-code#21847/#23556) and `python3` fails
   on Windows (#15908/#46449) — both already designed around.

## Tests / Validation

- Port every existing `*.test.sh` assertion to the new hook runtime; keep `./tests/run-all.sh`
  green (required before any version bump per repo convention).
- Add Windows-shape tests: run each rewritten hook with sample stdin JSON on a path with
  backslashes and spaces; assert `${CLAUDE_PLUGIN_ROOT}` resolves and the hook exits 0 when its
  optional dependency (codescout binary, sqlite) is absent (fail-open contract).
- buddy: add a test that `import scripts.hook_helpers` succeeds with `fcntl` unavailable
  (simulate by shadowing the module) — guards against the #1 blocker regressing.
- Copilot: manual matrix — load the plugin in VS Code agent mode and Copilot CLI on Windows and
  Linux; verify skills discovered, a SessionStart hook fires, and a PreToolUse deny actually
  blocks (exit-code-2 check).
- Follow the repo rule: **write a test for each blocker fixed**, alongside the fix.

## References

Investigation artifacts (2026-07-13, four parallel agents): portability audit of all three
plugins; superpowers portability teardown; Windows-patterns research; Copilot-surface research.

Primary docs:
- Claude Code hooks (shell field, exec form, Windows execution): https://code.claude.com/docs/en/hooks
- Claude Code plugins reference (`${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`): https://code.claude.com/docs/en/plugins-reference
- VS Code agent plugins (shared format across CC/Copilot-CLI/VS Code): https://code.visualstudio.com/docs/agent-customization/agent-plugins
- VS Code agent hooks (discovery locations, OS-specific commands): https://code.visualstudio.com/docs/agent-customization/hooks
- Copilot Agent Skills: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- Copilot Agent Skills changelog (Dec 2025): https://github.blog/changelog/2025-12-18-github-copilot-now-supports-agent-skills/
- Creating agent plugins for VS Code + Copilot CLI (Ken Muse): https://www.kenmuse.com/blog/creating-agent-plugins-for-vs-code-and-copilot-cli/

Patterns / prior art:
- superpowers polyglot `run-hook.cmd` + `docs/windows/polyglot-hooks.md` (obra/superpowers, v6.1.1, installed locally)
- Cross-platform Claude Code hooks (Node consensus): https://claudefa.st/blog/tools/hooks/cross-platform-hooks
- Truly cross-platform hooks (Go/polyglot): https://dev.to/shrsv/building-truly-cross-platform-claude-code-hooks-with-go-bash-powershell-wsl-and-git-bash-1ceo
- Windows plugin fork (bash→Windows rewrite precedent): https://github.com/r1di/claude-code-plugins-windows

Related claude-code issues: #9758, #3417 (`.sh` auto-prepend / extensionless), #21878, #18610
(`${CLAUDE_PLUGIN_ROOT}` backslash mangling), #22700, #16602 (bare `bash` not on PATH,
`CLAUDE_CODE_GIT_BASH_PATH`), #23556 (WSL `bash.exe` shadows Git Bash), #19571 (`.cmd`/`.bat`
shims silent-fail), #14817, #29321 (jq/sqlite3 silently fail on Windows), #571 (bash 5.3
heredoc hang), copilot-cli#2528 (per-repo MCP config gap).

Related specs in this repo: `2026-04-16-hook-block-dedup-design.md` (the `/tmp` dedup file this
touches), `2026-05-02-statusline-rate-limits-cache-design.md` and
`2026-05-22-statusline-side-by-side-design.md` (statusline-composed.sh internals),
`2026-05-21-buddy-global-config-home-design.md` (buddy path/home model),
`2026-06-12-system-prompt-source-consolidation-design.md` (subagent injection channel).
