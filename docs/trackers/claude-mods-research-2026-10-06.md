---
id: '2d465e83e750aa31'
kind: tracker
status: active
title: Claude mods — research findings and probe plan
owners:
- marius
tags:
- mods
- research
- codescout-companion
- buddy
topic: claude-mods
time_scope: dated:2026-10-06
---

# Claude mods — research findings and probe plan

Research run 2026-10-06: one BFS grounding subagent, then three parallel researchers
(runtime contract, distribution/security, migration candidates). Local `claude` is
`2.1.291`; mods shipped in `v2.1.287` (CLI) and `v2.1.286` (Desktop) on 2026-10-01.
**Provenance:** claims tagged `[read]` come from a source a subagent read; `[inferred]`
claims are not verified. Only two claims were re-checked by the main session: the local
version, and that `claude-code.d.ts` defines `agent.spawn` / `AgentSpawnInput`.

## What a mod is

A plugin whose module registers `on(event, matcher?, ($, e, next) => …)` handlers that run
inside the Claude Code process. A handler passes the event on with `next(e)`, rewrites it
with `next({...e, …})`, or answers without `next`. It can draw a pane, an `AbovePrompt`
band, a status line entry, a toast, or a slash command. `hooks/hooks.json` may hold
`"modules": ["./register.ts"]` (exactly one path) beside the classic `hooks` map.
Sources: code.claude.com/docs/en/plugins/mods/{overview,admin,reference,create}.

## Runtime contract `[read]`

- `tool.call` returns `next(e)`, `{ deny }` or `{ result }`; `tool.check` returns
  `{ decision }`. `e` is the tool name plus the args spread flat. `tool`, `tool_use_id`,
  `agentId` are reserved (a rewrite is refused).
- `agent.spawn` is the SubagentStart equivalent. The hook may rewrite `prompt`,
  `description`, `subagentType`, `model`, `background`, `cwd`, or return `{ deny }`.
  `classic.SubagentStart` also exists.
- Order: managed hooks, then mod `tool.call` chain, then non-managed settings/plugin
  `PreToolUse` shell hooks, then `tool.check`. A mod that never calls `next` hides our
  shell hooks from that call.
- A hook that throws, times out or returns a wrong shape is skipped (**fail-open**). Fail
  closed with `.catch(($,e,next) => next.called ? next(e) : { deny })`.
- Budget 10 s own time per event; `.catch` 1 s; `session.end` about 1.5 s in total.
- `$.process.run(argv[], …)`: no shell, each stream capped at 4 MiB, 30 s default timeout.
  `$.process.spawn` holds a child for the life of its `for await` loop. A child that
  outlives the session is not supported. No native SQLite: shell out to `sqlite3`.
- `$.state` is session-scoped; `$.store` is a 4 MiB JSON store shared across sessions.
- `$.model.complete` runs one completion on the user's own credentials (billed to them).

## Distribution and security

- One plugin may ship shell hooks and a mod together `[read]`.
- Mods are **not sandboxed**: user permissions, can approve tool calls, see every prompt.
  No per-mod consent prompt exists for a marketplace install `[read]`.
- Mods run in CLI, Desktop, VS Code panel, `claude -p`, SDK, cloud; they **draw** only in
  the terminal and the Desktop Code tab. Issue anthropics/claude-code#99423 (open,
  2026-10-04): nothing draws in VS Code `[read]`.
- No `minVersion`/`engines` field. Behavior of a pre-2.1.287 build on `modules` is
  undocumented `[read: absence]`. Our three profiles share one binary, so this is low risk here.
- Release gate candidates `[inferred]`: `claude plugin validate --strict`, `claude plugin test`.
  `validate` rejects plugin names starting `claude-`/`cc-plugin-`/`anthropic-`; check whether
  `claude-statusline` is a plugin name before relying on it.
- Copilot and pi harnesses cannot load mods, so every migrated hook keeps a shell copy.

## Migration candidates (ranked)

| # | Hook | Verdict |
|---|---|---|
| 1 | `principal-stamp.mjs` | migrate — first prototype (`tool.call`, `e.agentId` set only in subagents) |
| 2 | `pre-tool-guard.mjs` + `cs-liveness.mjs` | migrate later; do **not** add `.catch` (recreates the MCP-disconnect deadlock the breaker exists to break) |
| 3 | `pre-edit-dirty-check`, `explore-inject`, `suspicious-zero-hint` | migrate; dirty-check advice would reach the model after the edit, not before |
| 4 | buddy judge-verdict bubble | complement (band/toast) |
| 5 | SessionStart hooks, `goal-stop-hook`, buddy Python core and judges, `git-worktree-guard` | keep shell |

Several hooks were rated without reading their bodies (`pre-task-hint`, `pre-edit-hint`,
`constitution-brief`, `epoch-bump`, `worktree-activate`, `cs-activate-project`, buddy
SessionStart/UserPromptSubmit): those ratings are `[inferred]`.

## Open questions

- **MQ-1 — mod load path.** Docs say a relative-path plugin in a directory marketplace
  loads in place. Our CLAUDE.md measured *skills* served from the cached `installPath`.
  No page says which path a mod module uses. Probe: log `$.plugin.root`.
- **MQ-2 — hot reload for marketplace-folder plugins.** Documented only for
  `--plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS` and skills-dir plugins. The troubleshoot page
  says installed plugins run the cached copy. Assume `/reload-plugins` is needed.
- **MQ-3 — does a rewritten MCP tool input reach the server?** Verified only for the shell
  hook's `updatedInput` path. Needed before the `cs-principal-stamp` prototype.
- **MQ-4 — does `$.ui.status` coexist with a `statusLine` command?** Needed for buddy.
- **MQ-5 — does `prompt.compose` reach subagents?** Needed to replace `subagent-guidance`.
- **MQ-6 — is a `tool.call` hook on the Agent tool invoked?** `agent.spawn` is the verified route.
- **MQ-7 — does `/reload-plugins` re-run a dev-mods mod's `session.start`?** One observation says no
  (log unchanged). Untested otherwise: a second reload, or an edit to the mod file, would show it.
- **MQ-8 — which path serves a skill from this directory marketplace?** Settle it by editing a
  skill in the working tree only (no release), reloading, and checking the served bytes: tree and
  cache then differ. The `re-read from its folder` message suggests the folder.

## Probe: `mods-probe`

Written 2026-10-06 to
`~/.claude-kat/dev-mods/91f1bb54-7cd7-488a-b0f6-71827d308c5c/mods-probe/` (session-scoped,
outside this repo). It hooks `session.start` only, appends one JSON line (`plugin`, `root`,
`session`, `at`) to the session scratchpad `mods-probe.log`, and shows a toast. It changes
nothing in the session. `claude plugin validate` passes (warning: no `author`; fails under
`--strict` for that reason alone). No `*.test.ts` was written.

**Result, 2026-10-07.** After the user enabled hot reloading for the session, the probe
loaded and wrote one line to `mods-probe.log` (read back by the main session, not inferred):
`plugin=mods-probe`, `root=~/.claude-kat/dev-mods/91f1bb54-…/mods-probe`,
`session=91f1bb54-…`. This confirms that a mod loads in this build and that `$.plugin`,
`$.fs` (`exists`/`read`/`write`), `$.session.id` and `$.clock.now` work as the type file
says. The root is the dev-mods folder itself, so the run says nothing about MQ-1.

**Side observation, 2026-10-07 (`/reload-plugins` in this session).** Output: `Reloaded: 5 plugins ·
48 skills · 6 agents · 26 hooks`, then ``codescout-companion@sdd-misc-plugins re-read from its
folder``. After it, `mods-probe.log` still held one line, so the reload did **not** re-fire
`session.start` for the dev-mods mod. The skill text served after the reload carried the
`1.20.16` bytes, but the cache and the working tree were identical then, so that does not
separate the two load paths. The `re-read from its folder` wording points to in-place loading for
this directory marketplace; it is a message, not a measurement of which path serves what.

**What the probe can and cannot settle.** Loaded from the dev-mods folder it proves that a
mod loads here and that `$.plugin`, `$.fs`, `$.session`, `$.clock`, `$.ui.toast` behave as
the types say. It does **not** settle MQ-1: that needs the same module shipped inside a
plugin installed from the `sdd-misc-plugins` directory marketplace, which changes install
records in all three profiles (operator rule OP-4). Do that only after a decision.

## Next actions

1. ~~Verify state: does the probe load and log?~~ Done 2026-10-07: yes (see Probe, Result).
2. Decide whether to run the marketplace variant of the probe (touches three profiles; OP-4).
   MQ-1 stays open until that runs.
3. If MQ-1 and MQ-3 resolve well, build `cs-principal-stamp` and re-run the W-3 measurement
   (`codescout:context-injection-session-log` W-3: 2 guide re-deliveries without the stamp, 0 with it).

## Anti-goals

- Do not migrate `pre-tool-guard.mjs` with a fail-closed `.catch`.
- Do not remove any shell hook: Copilot and pi still need it.
- Do not treat the unread-body ratings above as decisions.
