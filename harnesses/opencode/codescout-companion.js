// codescout-companion for OpenCode — the host bridge.
//
// WHAT THIS IS
//
// OpenCode's plugin API is a different contract from Claude Code's hooks. Claude Code's
// hooks are separate processes that read event JSON on stdin and answer with
// `permissionDecision` JSON on stdout; an OpenCode plugin is an ESM module that registers
// callbacks *inside* the host, and the only way to stop a tool is to THROW from one of
// those callbacks.
//
// So this file does not reimplement the routing rules. It *bridges*: it translates an
// OpenCode tool call into the shape `pre-tool-guard.mjs` already understands, runs that
// hook as a subprocess, and translates its answer back into OpenCode terms (throw, or
// append advice to the result). One brain, many hosts — the same reasoning that put the
// Pi routing adapter in `codescout-companion/.pi/` rather than in a fork of the guard.
//
// API SURFACE — v2, MEASURED ON THE BINARY AFTER A FAILED INSTALL
//
// The first version of this file was written against the v1 plugin typing, and OpenCode
// 2.1.3 refused to load it:
//
//   "Plugin must export a default definition with an id and an effect or setup function."
//
// That was not a quirk of the user's config. The v1→v2 migration doc says it outright:
// "V1 plugin implementations do not run in V2 … Moving a file or renaming its config entry
// is not enough." Everything below is read off the installed host at
// ~/.local/share/mise/installs/opencode/2.1.3/node_modules/@opencode/cli/bin/opencode.exe.
//
// 1. WHAT THE LOADER ACCEPTS. The validator is a union of exactly two shapes:
//
//      cj = Struct({ default: Union([
//                       Struct({ id: String, effect: <function> }),
//                       Struct({ id: String, setup: <function> }) ]) })
//
//    `module.default` must be one of those. A bare function export — the v1 shape — has
//    no `id` and fails, which is the error above. `effect` is the native Effect-based
//    form; a plain `setup` function is wrapped by the host's own compat shim (`pZ`),
//    which builds the context object and calls `setup(ctx)`. We use `{ id, setup }`
//    because it needs NO import from `@opencode/plugin`, which is not installed in
//    ~/.config/opencode (that dir pins @opencode-ai/plugin@1.18.25 — the v1 types).
//
// 2. WHAT setup(ctx) GETS. An imperative registration context — `ctx.tool.hook`,
//    `ctx.session.hook`, `ctx.permission.hook`, `ctx.shell.hook`, plus `transform`
//    domains (tool/model/mcp/skill/agent/command/provider/…). It is NOT the v1
//    `{client, directory}` object, and the returned value is used as a *cleanup
//    function*, not as a hooks map: `Promise.resolve(i.setup(Z))` then, if truthy,
//    `o()`. Returning the old hooks object would be *called* at teardown.
//
// 3. THE CHANNELS THIS BRIDGE NEEDS, with the old name beside each (v1 → v2, per the
//    migration table and confirmed in the dispatch code):
//
//      tool.execute.before                → ctx.tool.hook("execute.before", fn)
//      tool.execute.after                 → ctx.tool.hook("execute.after", fn)
//      experimental.chat.system.transform → ctx.session.hook("context", fn)  [event.system]
//      experimental.session.compacting    → ctx.session.hook("compaction", fn)
//
//    The v1 event split args from the tool identity — `(input{tool,sessionID,callID},
//    output{args})`. v2 merges them into ONE event; the trigger call in the binary is:
//
//      e.trigger("tool","execute.before",
//                {tool, sessionID, agent, messageID, id, input})
//
//    so args are `event.input` and the call id is `event.id`. `execute.after` carries the
//    same identity fields plus `status` and `result` (completed) or `error` (failed).
//    `event.system` is a typed SystemPart[], so injection pushes `{type:"text", text}`
//    rather than a bare string. Denial stays throw-based: the host wraps these callbacks
//    as `Effect.try({try: fn, catch: X})`, so a throw becomes a tool failure carrying the
//    message — it does not crash the host.
//
// 4. WHAT IS STILL UNVERIFIED. Whether `ctx` carries the project directory under a known
//    key: the observed context begins `{app, location, options, …}` and no field is
//    confirmed to be the working directory. resolveDir() therefore walks several shapes and
//    falls back to process.cwd(), which is correct for `opencode` launched inside the
//    project — the documented way to use this bridge. See README §Verified vs asserted.
//
// FAIL-OPEN, ON PURPOSE
//
// Every path here exits by doing nothing. A missing repo, a hung subprocess, an
// unparseable payload, an unrecognised tool name, a context without the group we wanted —
// all fall through to "let the call proceed". This mirrors the contract in
// codescout-companion/hooks/lib.mjs: a crash must never block the user's tool. Blocking is
// reserved for a parsed, explicit deny. The one thing this file must NOT do is fail to
// load, so registration is individually guarded and reports to stderr rather than
// rejecting setup.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// Self-locate. install.sh symlinks this file into the OpenCode plugin dir, and
// import.meta.url resolves through the symlink to the real repo checkout — so the
// bridge finds its hooks without needing ${CLAUDE_PLUGIN_ROOT}, which OpenCode has no
// equivalent of. (That missing variable is the exact blocker that stalled the Copilot
// CLI port; see docs/INSTALL-COPILOT.md §2.)
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const HOOKS = join(REPO, 'codescout-companion', 'hooks');
const GUARD = join(HOOKS, 'pre-tool-guard.mjs');
const LIVENESS = join(HOOKS, 'cs-liveness.mjs');

const HOOK_TIMEOUT_MS = 5000;

// --- OpenCode's own "is codescout here", since detect.mjs reads Claude paths -------
//
// detect.mjs looks for .mcp.json / ~/.claude.json / ~/.claude/settings.json. OpenCode
// registers MCP servers in opencode.json under `mcp.servers` instead (verified against
// this machine's own config), so detection has three arms, in ascending order of trust:
//
//   1. PROJECT CONFIG — a `codescout` entry in THIS project's opencode.json. Codescout is
//      a per-project server, so this proves presence *for this cwd* and is trusted enough
//      to force the guard's own detection.
//   2. PROOF OF LIFE — we actually watched a codescout tool run in this session. Also
//      presence for this cwd, and the strongest evidence there is: lib.mjs's breakerFile
//      comment says "Detection is by PROOF OF LIFE, not by polling".
//   3. USER CONFIG — codescout in the user-level opencode.json only. This proves the
//      server is registered, NOT that it serves this project, so it queries the guard but
//      does NOT force it. Measured while writing the test suite: forcing on a user-level
//      entry made a global registration lock native reads in every unrelated checkout,
//      which is a worse outcome than the inert-guard bug it was meant to fix.
//
// The guard ARMS on 1 or 2 for any cwd; on 3 it defers to detect.mjs(cwd), i.e. the same
// per-project decision Claude Code makes. It never disarms mid-session except through the
// Claude-side circuit breaker, which the cs-liveness bridge below keeps honest.
const hasCodescoutServer = (path) => {
  try {
    if (!path || !existsSync(path)) return false;
    const servers = JSON.parse(readFileSync(path, 'utf8'))?.mcp?.servers;
    return !!(servers && Object.prototype.hasOwnProperty.call(servers, 'codescout'));
  } catch {
    // Unparseable or unreadable config: evidence of nothing.
    return false;
  }
};

// 'project' | 'user' | null — see the three arms above.
const configArms = (directory) => {
  if (hasCodescoutServer(directory && join(directory, 'opencode.json'))) return 'project';
  if (hasCodescoutServer(join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode', 'opencode.json')))
    return 'user';
  return null;
};

// --- Tool-name matching ------------------------------------------------------------
//
// OpenCode's built-in tool ids are bare lower case (`read`, `grep`, `glob`, `shell`,
// `edit`, `write`, `patch`). lib.mjs::normalizedToolName maps those; the guard classifies
// an OpenCode call correctly as long as we pass OpenCode's own spelling in `tool_name` and
// let lib.mjs do the translating. One source of truth per concept.
//
// For MCP tools the exact v2 spelling is NOT something I re-verified in the 2.1.3 binary
// after the rewrite, and v2 added tool *namespacing* (`ctx.tool.transform` exposes a
// `namespace`), so the prefix could be `codescout_`, `mcp_codescout_`, `mcp.codescout.` or
// the Claude-style `mcp__codescout__`. All of them end in the bare tool name, and all of
// them are accepted here rather than guessed at. Two properties make the tolerance safe:
// a name must START at a `codescout` token (so `codescouthood_symbols` and
// `notcodescout_symbols` are not matches — asserted in the test suite), and a MISSED
// match fails open, i.e. the session is simply not armed by proof-of-life and the circuit
// breaker behaves as it would have.
const CODESCOUT_BARE = /^(?:mcp[._]+)?codescout[._/]+([a-z][a-z0-9_]*)$/i;

export function codescoutBareTool(name) {
  const m = CODESCOUT_BARE.exec(String(name || ''));
  return m ? m[1] : null;
}

// The guard's deny reason ends with an escape hatch written for Claude Code: it names
// `/mcp` and the `! <command>` prompt prefix, neither of which is an OpenCode affordance
// I have verified. Leaving it in would tell a reader on OpenCode to type something that
// may not exist — the same class of harm as a wrong path in an onboarding brief, one
// level down. So swap the tail for host-true advice.
const CC_FOOTER_MARK = '\n\nIf a tool named above is not in your tool list';
const OPENCODE_FOOTER =
  '\n\nIf a tool named above is missing from your tool list, do not assume the MCP server ' +
  'is down: this session may expose only a subset of codescout\'s tools. Call one that IS ' +
  'present to find out — `codescout_run_command` reaches the same file with ' +
  '`acknowledge_risk: true` where the read/edit tools do not appear. If no codescout tool ' +
  'is present at all, the server is not connected in this host: ask the user to check ' +
  '`mcp.servers.codescout` in opencode.json, or to run the command themselves.';

export function rehostReason(reason) {
  const text = String(reason || '');
  const cut = text.indexOf(CC_FOOTER_MARK);
  if (cut === -1) return text + OPENCODE_FOOTER;
  // The guard appends its circuit-breaker warning ("[!] N redirects in a row …") AFTER the
  // Claude footer. Cutting to the end dropped it, so on OpenCode the model was never told
  // the guard was about to stand down (observed live on 2.1.3). Keep that tail.
  const warn = text.indexOf('\n\n[!]', cut);
  return text.slice(0, cut) + OPENCODE_FOOTER + (warn === -1 ? '' : text.slice(warn));
}

// Run a Claude Code hook as a subprocess, speaking its stdin/stdout JSON dialect.
// Returns the parsed payload, or null on ANY failure — callers read null as
// "no opinion", which means the tool call proceeds.
//
// forceArmed is the ONLY thing that sets CS_COMPANION_HOST_ARMED. Callers pass it for the
// two signals that prove presence *for payload.cwd* — a project-level opencode.json, or a
// codescout tool that already answered in this session — and not for a user-level entry,
// which proves registration only. It is a blanket override inside detectFor(), so the
// blast radius of passing it loosely is "native reads blocked in repos codescout does not
// serve", which is what the first version of this file did.
// Which binary runs the hook scripts. NOT blindly process.execPath: OpenCode ships as a
// compiled Bun executable, so inside the host execPath is `opencode.exe` itself, and
// spawning it with a script path ran `opencode <script>` — the CLI took the path as a
// project dir, died with ENOTDIR, printed nothing, and every guard call failed OPEN.
// Measured in opencode.log on 2.1.3. Under the unit tests execPath IS node, which is why
// they never saw it. Order: explicit override → execPath when it really is node/bun →
// `node` from PATH (install.sh already refuses to install without it).
export function resolveRuntime(execPath = process.execPath, env = process.env) {
  if (env.CS_COMPANION_NODE) return env.CS_COMPANION_NODE;
  const base = String(execPath || '').split(/[\\/]/).pop().toLowerCase();
  if (/^(node|nodejs|bun)(\.exe)?$/.test(base)) return execPath;
  return 'node';
}

// A hook that cannot run must fail OPEN — but never SILENTLY: live bug #2 (the opencode
// binary spawned as the interpreter) loaded clean, printed nothing and blocked nothing.
// Each failure kind is reported once per process on stderr (which lands in opencode.log),
// so a missing `node` on the service's PATH is visible instead of looking like "allowed".
const reported = new Set();
function reportOnce(kind, detail) {
  if (reported.has(kind)) return;
  reported.add(kind);
  process.stderr.write(`codescout-companion: hook ${kind} — ${detail} (guard failing open)\n`);
}

// Async on purpose: the plugin runs inside the long-lived `opencode serve` process, and a
// spawnSync there froze the event loop for EVERY session for the length of the hook.
// CLAUDE_CONFIG_DIR is passed through unchanged: detect.mjs resolves Claude config via
// `${CLAUDE_CONFIG_DIR:-$HOME/.claude}` (repo rule), and stripping it made a multi-profile
// machine read the default profile instead of the one in use.
export function runHook(script, payload, { forceArmed = false, runtime = resolveRuntime() } = {}) {
  return new Promise((resolveP) => {
    const env = { ...process.env };
    if (forceArmed) env.CS_COMPANION_HOST_ARMED = '1';
    let out = '';
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolveP(v);
      }
    };
    let child;
    try {
      child = spawn(runtime, [script], { cwd: payload.cwd || process.cwd(), env, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (e) {
      reportOnce('spawn-failed', `${runtime}: ${e?.message || e}`);
      return done(null);
    }
    const timer = setTimeout(() => {
      reportOnce('timeout', `${script} exceeded ${HOOK_TIMEOUT_MS} ms`);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      done(null);
    }, HOOK_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reportOnce('spawn-failed', `${runtime}: ${e?.message || e}`);
      done(null);
    });
    child.stdout.on('data', (d) => {
      if (out.length < 1 << 20) out += d;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // The hooks' contract is "always exit 0"; anything else is a crash, not a decision.
      if (code !== 0) reportOnce('crashed', `${script} exited ${code ?? signal}`);
      const text = out.trim();
      if (!text) return done(null);
      try {
        done(JSON.parse(text));
      } catch {
        reportOnce('bad-output', `${script} printed non-JSON`);
        done(null);
      }
    });
    child.stdin.on('error', () => {
      /* hook exited before reading stdin — its exit code tells the story */
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

// The native tools pre-tool-guard has a branch for, in OpenCode spelling (v1 and v2 names).
// Claude Code limits the guard with the matcher `Grep|Glob|Read|Bash|Edit|Write`; without
// the same filter here, every todowrite/webfetch/skill call paid a node start-up for a
// guard that exits 0 on it.
export const GUARDED_TOOLS = new Set(['read', 'grep', 'glob', 'bash', 'shell', 'edit', 'patch', 'apply_patch', 'write']);

function decisionOf(payload) {
  const h = payload?.hookSpecificOutput;
  if (!h) return null;
  if (h.permissionDecision === 'deny') return { deny: h.permissionDecisionReason || 'blocked' };
  if (h.additionalContext) return { context: h.additionalContext };
  return null;
}

// Advice waiting to be attached to the call that triggered it. Bounded, so a session
// that ends before execute.after fires cannot grow without limit.
const pending = new Map();
const PENDING_CAP = 200;
function remember(callID, text) {
  // Drop the oldest rather than clearing the map: clearing would also discard the
  // arming record of every session, silently disarming the guard under load.
  if (pending.size >= PENDING_CAP) pending.delete(pending.keys().next().value);
  pending.set(callID, text);
}

// Sessions that have personally watched a codescout tool run. Deliberately NOT stored
// in `pending` — that map is bounded and evicts, while an arming record must survive.
const armedSessions = new Set();

const OPENCODE_ROUTING = `# codescout routing (OpenCode host)

This session can reach the codescout MCP server. Prefer its symbol-aware tools over
OpenCode's native read/grep/glob/bash/edit/write on source files:

- Locate a symbol   -> codescout symbols(name=...)            (not grep for "fn X")
- Read a file       -> codescout symbols(path=...) overview, then symbols(name=..., include_body=true)
- Search by concept -> codescout semantic_search(query=...)
- Find files        -> codescout tree(glob=...)
- Search text       -> codescout grep(pattern=..., glob=...)
- Run a command     -> codescout run_command(command=...)

Three rules that are not optional here:
1. Never full-read a source file; take a symbols() overview first, then pull the body you need.
2. Markdown is read with read_markdown (heading-addressed), not read_file.
3. Structural code edits go through edit_code; text/import edits through edit_file.

A large result returns as an @ref buffer handle. Query the buffer
(grep PATTERN @cmd_x, or read_file("@cmd_x", start_line=..., end_line=...)) rather than
re-running the tool to "see the rest".`;

function systemBlock(directory) {
  // The project's curated system prompt is what Claude Code's subagent-guidance hook
  // pushes verbatim (root .codescout/system-prompt.md, written by codescout onboarding).
  // OpenCode receives no MCP server_instructions at all, so this is the only channel it
  // has. Bounded, because injected text is a scarce resource in this plugin's own design.
  const BUDGET = 8000;
  let project = '';
  try {
    const p = directory && join(directory, '.codescout', 'system-prompt.md');
    if (p && existsSync(p)) {
      const raw = readFileSync(p, 'utf8');
      project =
        raw.length > BUDGET
          ? `${raw.slice(0, BUDGET)}\n\n[… project system prompt truncated for the injection budget]`
          : raw;
    }
  } catch {
    // No project prompt. The routing block alone still carries the value.
  }
  return project ? `${OPENCODE_ROUTING}\n\n## Project system prompt\n\n${project}` : OPENCODE_ROUTING;
}

// Which project this bridge speaks for. Measured on the 2.1.3 binary: the setup shim
// (`pZ`) builds ctx as `{app, location, options, agent, …, worktree: {list, …}, …}`, and
// the host's own internal plugins read `e.location.directory`. So `location.directory`
// comes first — and every candidate must be a STRING, because v2 ctx carries API groups
// under names that used to be paths: `ctx.worktree` is the worktree *API*, an object.
// Returning it crashed setup with `ERR_INVALID_ARG_TYPE: "paths[0]" … got object` the
// first time the plugin got past the loader. The older v1 keys stay as fallbacks only.
export function resolveDir(ctx) {
  const c = ctx || {};
  const candidates = [
    c.location?.directory,
    c.location?.worktree,
    c.directory,
    c.worktree,
    c.app?.directory,
  ];
  return candidates.find((v) => typeof v === 'string' && v.length > 0) || process.cwd();
}

// The behaviour, with the host's registration calls stripped out. Everything the test
// suite exercises lives here: it takes the project directory and returns plain callbacks
// that each accept ONE v2 event object.
export function buildBridge(dir) {
  // Which of the three arms holds for this project. 'project' forces the guard; 'user'
  // only asks it, so an unrelated checkout is decided by detect.mjs(cwd) exactly as it is
  // on Claude Code. Kept as a flag rather than a Map entry so a sessionID that happens to
  // be the string "project" cannot arm every session.
  const armLevel = configArms(dir);

  const seenHere = (sessionId) => armedSessions.has(sessionId || 'anon');
  // Ask the guard whenever any signal holds; force it only on the cwd-proving ones.
  const shouldAsk = (sessionId) => armLevel !== null || seenHere(sessionId);
  const forces = (sessionId) => armLevel === 'project' || seenHere(sessionId);

  return {
    // The one channel OpenCode gives for "tell the model how to behave here": the
    // per-request session context. Claude Code gets this content from codescout's own
    // server_instructions; OpenCode does not read MCP server instructions, so without it
    // the redirect advice never reaches the model and the guard below would be enforcing
    // a rule nobody was told about. It fires on every request, which is also why the
    // directive survives compaction.
    onContext(event) {
      try {
        // v2 system parts are typed: push({type:"text", text}), not push("text").
        event.system.push({ type: 'text', text: systemBlock(dir) });
      } catch {
        // Fail open: an un-injected prompt is a worse outcome than a blocked tool.
      }
    },

    // Compaction gets its own event (v1's experimental.session.compacting). Same block,
    // pushed onto the compaction request's own system array.
    onCompaction(event) {
      try {
        event.system.push({ type: 'text', text: OPENCODE_ROUTING });
      } catch {
        // Same contract.
      }
    },

    async onToolBefore(event) {
      const tool = String(event?.tool || '');
      const sessionId = String(event?.sessionID || '');

      // A codescout tool about to run is the strongest evidence the redirect target
      // exists. Record it and let the call through untouched.
      if (codescoutBareTool(tool)) {
        armedSessions.add(sessionId || 'anon');
        return;
      }

      if (!GUARDED_TOOLS.has(tool) || !shouldAsk(sessionId) || !existsSync(GUARD)) return;

      const decision = decisionOf(
        await runHook(
          GUARD,
          {
            hook_event_name: 'PreToolUse',
            tool_name: tool, // OpenCode's spelling; lib.mjs translates it.
            tool_input: event?.input || {}, // v1 kept args in output.args; v2 merged them in.
            cwd: dir,
            session_id: sessionId,
          },
          { forceArmed: forces(sessionId) },
        ),
      );

      // Only a parsed, explicit deny stops the call — and throwing is the ONLY way to
      // stop one: the host catches this throw and turns it into a failed tool call whose
      // message reaches the model.
      if (decision?.deny) throw new Error(rehostReason(decision.deny));

      // No pre-tool advisory channel exists in OpenCode, so hold the advice for the call
      // we are about to let run and attach it to its result in execute.after.
      if (decision?.context && event?.id) remember(event.id, decision.context);
    },

    async onToolAfter(event) {
      const sessionId = String(event?.sessionID || '');
      const tool = String(event?.tool || '');
      const bare = codescoutBareTool(tool);

      // Proof of life has to reach the Claude-side circuit breaker. cs-liveness.mjs
      // recovers the bare tool name by splitting on '__', so hand it the Claude-shaped
      // name it was written against: feeding it `codescout_symbols` would leave the
      // breaker never clearing, and the guard would stand down after three blocks and
      // stay down — a silent loss of the whole feature.
      // Only a call that COMPLETED is proof of life. A transport failure on a server that
      // died mid-session still fires execute.after (status "error"); counting it would reset
      // the breaker on every failed redirect, so the guard would never stand down — the
      // exact deadlock the breaker exists to break. Not awaited: nothing depends on it.
      if (bare && event?.status === 'completed' && existsSync(LIVENESS)) {
        void runHook(LIVENESS, {
          hook_event_name: 'PostToolUse',
          tool_name: `mcp__codescout__${bare}`,
          session_id: sessionId,
          cwd: dir,
        });
      }

      const advice = event?.id && pending.get(event.id);
      if (!advice) return;
      pending.delete(event.id);
      // What the MODEL reads is `result.content`, not `result.output`. Measured on 2.1.3
      // with a probe plugin: the host builds `{…, result: {output, content, metadata}}`,
      // fires execute.after with that SAME object, then renders `A.result.content` for
      // the model. `output` is structured data (for `read` it is a file object, not a
      // string). An earlier version appended to `output` and reassigned `event.result` —
      // the model never saw it, so the circuit breaker's stand-down explanation was
      // silently lost. A text part pushed onto `content` IN PLACE was quoted back verbatim.
      // Anything else is a shape we don't recognise: drop the advice rather than corrupt
      // the result.
      try {
        const content = event.result?.content;
        if (Array.isArray(content)) content.push({ type: 'text', text: advice });
      } catch {
        // Unrecognised shape: losing an advisory is acceptable, corrupting a result is not.
      }
    },

    dispose() {
      pending.clear();
    },
  };
}

// The v1→v2 difference that broke the first install: `setup` REGISTERS, it does not
// return a hooks map. Each registration is awaited and independently guarded — a context
// missing one group must not stop the other three from working, and a rejecting setup
// means the whole plugin fails to load, which is exactly how this bug reached us.
export async function CodescoutCompanion(ctx) {
  const dir = resolveDir(ctx);
  const b = buildBridge(dir);
  const c = ctx || {};

  const reg = async (where, name, fn) => {
    try {
      const group = c[where];
      if (typeof group?.hook !== 'function') throw new Error(`ctx.${where}.hook missing`);
      await group.hook(name, fn);
    } catch (e) {
      // Loud on stderr, quiet in behaviour: fail-open, but never silent.
      process.stderr.write(
        `codescout-companion: could not register ${where}.${name} — ${e?.message || e}\n`,
      );
    }
  };

  await reg('session', 'context', b.onContext);
  await reg('session', 'compaction', b.onCompaction);
  await reg('tool', 'execute.before', b.onToolBefore);
  await reg('tool', 'execute.after', b.onToolAfter);

  // The host treats a truthy return from setup as its cleanup thunk (see header §2), so
  // this MUST be a function — returning an object here would be *called* at teardown.
  return () => b.dispose();
}

// One of the two shapes the loader's union accepts: {id, setup}. Deliberately no
// `@opencode/plugin` import — that package is not present in ~/.config/opencode on the
// machine this was tested on, which pins the v1 @opencode-ai/plugin@1.18.25 instead.
export default { id: 'codescout-companion', setup: CodescoutCompanion };
