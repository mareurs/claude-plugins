# OpenCode harness

Runs the `codescout-companion` tool-routing guard under
[OpenCode](https://opencode.ai), the terminal coding agent. This is a **host bridge**, not a
fork of the routing rules.

**Target: OpenCode v2.** The first version of this bridge was written against the v1 plugin
typing and v2 refused to load it — see §The v1 failure below, because it is the reason the
adapter is shaped the way it is and the reason §Verified vs asserted is written the way it is.

## The v1 failure

Installed on a real v2 host (2.1.3), the plugin was rejected at load:

```
Plugin must export a default definition with an id and an effect or setup function.
```

Not a config quirk. OpenCode's own v1→v2 migration doc states it flatly: **"V1 plugin
implementations do not run in V2 … Moving a file or renaming its config entry is not
enough."** The v1 shape — a default-exported async function returning a hooks object — has
no `id`, so it fails the loader's schema before any hook can register, and *every* feature
of the port dies silently behind a one-line error. What v2 actually wants, read out of the
installed binary:

```js
//  cj = Struct({ default: Union([
//                   Struct({ id: String, effect: <function> }),
//                   Struct({ id: String, setup: <function> }) ]) })
export default { id: 'codescout-companion', setup: async (ctx) => { …register…; return dispose } }
```

We take the `setup` arm, not `effect`, because the `effect` arm wants the Effect runtime and
an import from `@opencode/plugin` — which is **not installed** in `~/.config/opencode`
(that dir pins `@opencode-ai/plugin@1.18.25`, the v1 types). `{id, setup}` needs no import.

Channel renames that same rewrite had to absorb:

| v1 (what the first draft used) | v2 (what actually fires) |
|---|---|
| `tool.execute.before(input, output)` | `ctx.tool.hook("execute.before", (event) => …)` |
| `tool.execute.after(input, output)` | `ctx.tool.hook("execute.after", (event) => …)` |
| `experimental.chat.system.transform` | `ctx.session.hook("context", …)` — `event.system` is a typed `SystemPart[]` |
| `experimental.session.compacting` | `ctx.session.hook("compaction", …)` |
| args in `output.args`, id in `input.callID` | **one event object**: `{tool, sessionID, agent, messageID, id, input}` |
| return a hooks object | **register**; the return value is used as a *cleanup function*, so returning an object would be called at teardown |

`tests/test-opencode-adapter.sh` now asserts the loader contract itself, so a v1-shaped
regression fails in CI instead of on someone's machine.

## What you get

- **Native `read` / `grep` / `glob` / `shell` / `edit` / `write` on files codescout can
  serve is denied**, with the same redirect advice Claude Code gets — including the
  circuit breaker that stands the guard down if the codescout tools it names never answer.
- **The codescout routing directive and the project system prompt are injected into the
  system prompt** on every request. OpenCode 2.1.3 *does* surface codescout's own MCP
  `server_instructions` (a live session showed the model quoting them, and the host posts
  "MCP server instructions are no longer available" when they drop). This block adds what
  those instructions lack: the OpenCode tool names (`codescout_<tool>`, `shell`, …) and the
  project's root `.codescout/system-prompt.md`.
- **Proof of life flows back.** When a `codescout_*` tool answers, the bridge notifies
  `cs-liveness.mjs`, which clears the circuit breaker and re-arms the guard.
- **Advisories reach the model.** When the guard allows a call but has something to say
  (the circuit breaker's stand-down notice, for one), the text is appended as a new
  `{type: "text"}` part on `result.content`, which is what the model reads.

## What you do NOT get (yet)

Honesty here is the point — see §Verified vs asserted before reporting a gap as a bug.

| Claude Code affordance | OpenCode status | Why |
|---|---|---|
| `SubagentStart` guidance injection | **absent** | No subagent-start hook found in v2's context (`ctx.tool/session/permission/shell` + transform domains). Subagents get no codescout directive. This is the single largest functional gap. |
| `SessionStart` pointer injection | approximated | folded into the `session.hook("context")` transform, which runs per request rather than once per session. |
| `PreCompact` epoch bump | approximated | `session.hook("compaction")` re-injects the directive; it does not run `constitution-epoch-bump.mjs`. |
| Post-tool advisory text | **delivered** (was silently dropped before 2026-11-09) | v2's `result.output` is structured data (a file *object* for `read`), and the model reads `result.content`. Advice is now pushed onto `content` in place. If `content` is not an array, the advice is dropped rather than risk corrupting the result. |
| Skills (`reconnaissance`, `tracker-hygiene`, …) | **not wired** | v2 has `ctx.skill.transform(...)`/`skill.list`, but its discovery configuration was never verified against a live session, so nothing is claimed. |
| Statusline, `buddy`, `sdd`, `statusline` plugins | **not ported** | `sdd`'s guards and buddy's judges depend on Claude Code hook events with no OpenCode equivalent found. Only `codescout-companion`'s routing is bridged. |
| Background-job continuation | **not ported** | `background-wake/` has `claude-code` and `codex` adapters; an OpenCode adapter would be its own piece of work. |

## Install

```bash
cd /path/to/claude-plugins
git checkout feat/opencode-harness-adapter
./harnesses/opencode/install.sh            # user-level: ~/.config/opencode/plugins/
./harnesses/opencode/install.sh --project  # or project-level: ./.opencode/plugins/
./harnesses/opencode/install.sh --check    # verify, change nothing
```

The installer **only symlinks the plugin**. It deliberately does not touch
`opencode.json` — that file holds provider API keys on real machines, and it prints the
one block you need to add yourself:

```jsonc
"mcp": {
  "servers": {
    "codescout": { "type": "local", "command": ["codescout", "start", "--project", "."], "cwd": "." }
  }
}
```

Then restart OpenCode. Verify with `--check`.

**Restarting the TUI is not enough if the background service is running.** `opencode`
attaches to a long-lived `opencode serve --service` process, and that process keeps the
plugin module it loaded first. It also watches the *symlink*, so an edit to the file the
symlink points to does not reload it. After installing or editing the plugin, stop the
service (`pgrep -af 'opencode.*serve --service'`, then `kill <pid>`) and relaunch. Each
server run logs under its own `run=<id>`, so in
`~/.local/share/opencode/log/opencode.log` a `failed to load plugin` from an old `run=`
means the service was never restarted. `opencode run --standalone` uses a private server,
so it always loads the current file. That is what to use for testing.

**If you already have a working codescout MCP entry, you do not need to change it** — but
read §Detection first: *where* that entry lives (project vs user) changes what the guard
does in unrelated repos.

Do **not** register the plugin through the `plugins: [...]` config array — v2 requires a
configured local plugin to be a *directory* (`…/index.ts`). The symlinked file in
`plugins/` is discovered directly, which is what `install.sh` sets up.

## How it works

```
opencode tool call → one event object {tool, sessionID, agent, messageID, id, input}
   │  ctx.tool.hook("execute.before", fn)      ← registered by setup(ctx), not returned
   ▼
harnesses/opencode/codescout-companion.js
   │  translate to Claude Code's stdin JSON dialect, spawn, parse stdout
   ▼
codescout-companion/hooks/pre-tool-guard.mjs   ← the same guard Claude Code runs
   │  permissionDecision:"deny" + reason
   ▼
throw new Error(reason)   ← v2 catches it (Effect.try) and turns it into a failed tool
                             call whose message reaches the model. It is the only lever.
```

Two translation layers keep the guard host-agnostic:

1. **Tool names.** `lib.mjs::normalizedToolName` maps OpenCode's bare lower-case ids
   (`read`, `grep`, `glob`, `edit`, `write`). OpenCode **v2 renamed three built-ins**:
   `bash`→`shell`, `apply_patch`→`patch`, `task`→`subagent`. Both spellings of the first
   two map, because matching only `bash` silently no-ops on a v2 host. `task`/`subagent`
   is **not** mapped: the guard has no branch for subagent dispatch, so it has nothing to
   map to.
2. **Denial semantics.** Claude Code wants JSON; OpenCode wants a thrown error. The bridge
   also re-hosts the reason string: the Claude version tells you to run `/mcp` or type
   `! <command>`, neither verified on OpenCode, so it is replaced with advice that is true
   here (`mcp.servers.codescout` in `opencode.json`).

## Detection, and why the Claude-side one is not enough

`detect.mjs` looks for `.mcp.json`, `~/.claude.json` and `~/.claude/settings.json`.
OpenCode registers MCP servers in `opencode.json` instead, so on an OpenCode-only machine
`detect.mjs` reports "no codescout" and every hook exits 0 — the guard would be inert and
nothing would say so.

The bridge therefore distinguishes **three** signals and tells the guard about the strong
ones via `CS_COMPANION_HOST_ARMED=1`:

| signal | proves | effect |
|---|---|---|
| `codescout` in **this project's** `opencode.json` | codescout serves *this* cwd | queries the guard **and forces it** |
| a `codescout_*` tool answered in this session | codescout serves *this* cwd (strongest) | queries the guard **and forces it** |
| `codescout` in the **user-level** `opencode.json` only | the server is registered *somewhere* | queries the guard, **does not force it** — `detect.mjs(cwd)` decides |

The last row is not a hedge, it is a bug fix found by the test suite.
`CS_COMPANION_HOST_ARMED` is a blanket override inside `detectFor()` — it forces presence
for *whatever* cwd is passed — so honouring a user-level entry with it would let one global
`opencode.json` block native reads in every unrelated checkout on the machine. Codescout is
a **per-project** server, so registration is not presence-for-here. Asserted in both
directions: `an opencode-only host with PROJECT config still blocks` and `a USER-level
registration does NOT lock an unrelated project` (the latter goes red under the mutant that
forces on user-level — mutation-checked).

Forcing is scoped per call, never globally, so an unrelated project's bridge is not dragged
along by another project's arming.

**Your Claude Code config takes part in this.** The user-level row hands the decision to
`detect.mjs(cwd)`, and `detect.mjs` reads `~/.claude.json`. If codescout is registered
there at user level (the normal Claude Code setup), `detect.mjs` reports codescout present
for **every** directory, so the guard blocks native reads everywhere under OpenCode too.
Observed live: a plain temp dir with no `.codescout/` was blocked. That is correct there,
since codescout did serve that directory (`codescout_tree`/`read_file` answered). The
"does NOT lock an unrelated project" guarantee only holds on a machine without a
user-level Claude registration.

## Verified vs asserted

**Verified from files on disk (v2, 2.1.3)** — read out of
`~/.local/share/mise/installs/opencode/2.1.3/node_modules/@opencode/cli/bin/opencode.exe`:
the loader's accepted default-export shapes (the `cj` union quoted above), the compat shim
`pZ` that turns `{id, setup}` into `{id, effect}` and the `setup(ctx)` context it builds,
the `execute.before` trigger and its exact field list, and the fact that plugin callbacks
are wrapped in `Effect.try{catch}` so a throw becomes a failed call. Cross-checked against
OpenCode's own v1→v2 migration table and server-plugin reference.

**Verified by execution** — `node harnesses/opencode/codescout-companion.test.mjs`, 26
cases: loader-union conformance, the four registered channel names, teardown-is-a-function,
registration failure still loads the plugin (fail-open, reported on stderr), name
normalisation incl. the v2 renames, MCP recognition across four plausible prefix forms plus
lookalike negatives, reason re-hosting (incl. keeping the breaker's `[!]` warning), typed
system-part injection, compaction re-injection, deny on a source read, deny on a
plain-text read, image exemption (extension-based — `isBinaryImage` is
`/\.(png|jpg|jpeg|gif|webp|bmp|ico|pdf)$/i`), unarmed session never blocked,
project-config arming, user-config **non**-arming, self-call never self-blocks, malformed
events ignored, `resolveDir` ignoring non-string ctx keys, `resolveRuntime` never picking
the host binary, stand-down advice delivered on the v2 `result.content` shape, only a
codescout call clearing the breaker unless it failed on the connection, only the guarded native tools reaching the
guard, the `block_reads: false` opt-out surviving host arming, spawn failures reported on
stderr, and `CLAUDE_CONFIG_DIR` reaching the hooks. The user-config case and the last five
are mutation-checked. The suite runs in a throwaway `TMPDIR`/`XDG_STATE_HOME`, so it leaves
no markers in `/tmp` and never touches the live codescout server slot.

**Verified live (OpenCode 2.1.3, 2026-11-09)** — real `opencode run --standalone` sessions,
tool calls read from `--format json` events:

| claim | observed |
|---|---|
| plugin loads and registers all four channels | `loading plugin`, no `failed to load` / `could not register` |
| `execute.before` payload is `{tool, sessionID, agent, messageID, id, input}` | matches the host's `trigger(...)` call and the guard got the right path |
| a throw surfaces as a readable tool error | `state.status: "error"` with the full redirect text, and the model acted on it |
| native `read`/`grep`/`glob`/`shell`/`edit`/`write` on source are denied | all six blocked, and the model switched to `codescout_*` |
| markdown is redirected to `read_markdown` | blocked, then `codescout_read_markdown` completed |
| image reads are exempt | `read` on a `.png` completed |
| MCP tools are exposed as `codescout_<tool>` | `codescout_read_file`, `codescout_tree`, … called directly |
| routing block injected via `session.hook("context")` | the model quoted the bridge-only `## Project system prompt` section |
| proof of life clears the breaker | breaker file `1\tread_file` after a block, gone after `codescout_read_file` answered |
| circuit breaker stands down at strike 4 | with codescout unreachable, `read` completed on the 4th counted strike and the model quoted the stand-down notice |
| compaction hook does not break compaction | `POST /api/session/:id/compact` → `status: "completed"`, no plugin errors |
| `ctx.location.directory` is the project dir | read from the `pZ` shim and the host's own plugins; the guard reasoned about the right project |

**Bugs that only a live session exposed.** All four passed the unit suite; each has a
regression test now:

1. `ctx.worktree` is an **API group** (an object), and `resolveDir` returned it as a path:
   `setup()` died with `ERR_INVALID_ARG_TYPE: "paths[0]" … got object`.
2. Inside OpenCode, `process.execPath` is the **opencode binary**. Hooks were spawned as
   `opencode pre-tool-guard.mjs`, which died with `ENOTDIR` and printed nothing. So every
   guard call failed **open**, and the plugin loaded clean but blocked nothing.
   `resolveRuntime()` now uses `node` unless `execPath` really is node/bun
   (override: `CS_COMPANION_NODE`).
3. Advisories were appended to `result.output`, which the model never reads. A probe plugin
   showed `content` is what the model reads, mutated in place.
4. `rehostReason` cut everything after the Claude footer, including the breaker's
   `[!] 3 redirects in a row` warning that comes after it.

**Fixed after code review (2026-11-09).** Each has a regression test:

- Host arming forced `BLOCK_READS`, which overrode a project's `block_reads: false`
  opt-out. It now forces presence only.
- A codescout call that failed on the **connection** counted as proof of life, so a server
  that died mid-session reset the breaker on every failed redirect and the guard never
  stood down. Now a connection failure (`Connection closed`, `process exited`,
  `ECONNREFUSED`, …) does not count, while a completed call or an error the server itself
  returned still does: that is the breaker's documented rule ("an error payload still
  counts — what is measured is whether the tool surface is REACHABLE").
- A hook that could not start (e.g. no `node` on the service's PATH) failed open with no
  trace. Spawn failures, crashes, timeouts and non-JSON output are now reported once each
  on stderr, which ends up in `opencode.log`.
- Every tool call in an armed session spawned the guard **synchronously**, freezing the
  whole `opencode serve` process for every session. Hooks now run asynchronously, and only
  the guarded native tools (`read`, `grep`, `glob`, `shell`/`bash`, `edit`/`patch`,
  `write`) reach the guard, the same filter Claude Code's matcher applies.
- `CLAUDE_CONFIG_DIR` was stripped before running the hooks, so a multi-profile machine
  read the default profile. It is passed through now (repo rule
  `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`).

**Known, not yet fixed** (from the same review): `opencode.jsonc` and commented configs are
not recognised as project arming; the stand-down note still mentions `/mcp`; the project
prompt is injected on every request even though codescout's server instructions already
carry it; `pending`/`armedSessions` are shared by every project in one service process;
`install.sh` treats unknown flags as an install and `--check` reports a dangling symlink as
present; the lower-case tool names live in the shared `normalizedToolName` rather than in
the bridge.

**NOT verified:**

- Whether the routing block injected at compaction changes the summary. The hook runs and
  compaction completes; its effect on the summary text is not observable from outside.
- `permission` behaviour for `codescout_*`, and skill discovery.
- Copilot CLI is the other documented host of `pre-tool-guard.mjs`. If its payload carries
  `tool_name: "bash"`/`"edit"`, the new lower-case rows in `normalizedToolName` would start
  guarding calls that used to fall through unmatched. Its payload shape is not verified.

Version skew is real and unresolved: the binary is 2.1.3 while `~/.config/opencode` pins
`@opencode-ai/plugin@1.18.25` — the **v1** types. That is *why* a v1-shaped plugin looked
writable on this machine at all, and why nothing in this adapter imports from
`@opencode/plugin`.

## Tests

```bash
node harnesses/opencode/codescout-companion.test.mjs   # direct
bash tests/test-opencode-adapter.sh                    # as run-all.sh discovers it
```
