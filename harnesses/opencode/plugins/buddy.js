// buddy for OpenCode — the host bridge (server part).
//
// buddy's behaviour lives in five Claude Code hooks (buddy/hooks/hooks.json), all routed
// through one launcher, buddy/hooks/run.mjs <event>, which resolves a Python interpreter
// and runs scripts/hook_entry.py. This plugin runs THAT launcher from OpenCode's plugin
// callbacks and translates the answers. Nothing about buddy's mood, narrative, memory,
// judges or summon logic is reimplemented here.
//
//   Claude Code event                 OpenCode channel (2.1.3)
//   ───────────────────────────────── ─────────────────────────────────────────────────────
//   SessionStart (startup)            session.hook("context"), first request of a top-level
//                                     session; its text is cached and re-pushed each request
//   SessionStart (compact)            session.hook("compaction"); replaces the cached text
//   UserPromptSubmit                  session.hook("context"): the latest USER message of a
//                                     top-level session, once per message id
//   PreToolUse (judge block, exit 2)  tool.hook("execute.before") — only when judge.env asks
//                                     for blocking, because otherwise the hook is a no-op
//   PostToolUse                       tool.hook("execute.after"): signals, narrative, and
//                                     the [cs-hint] advisories, appended to result.content
//   SessionEnd                        none — OpenCode has no session-end hook. The by-ppid
//                                     entry it would remove is GC'd at the next SessionStart
//
// SESSION IDENTITY. buddy keys state on `.buddy/<session_id>/`; the OpenCode session id is
// passed as session_id, so the TUI part (tui/buddy/) and the /buddy-* commands find the
// same directory. One `opencode serve` hosts every session, so run.mjs's BUDDY_HOOK_PPID is
// the service pid for all of them: the by-ppid index cannot tell sessions apart here, and
// commands resolve through the `.buddy/.current_session_id` pointer (written on every
// prompt) instead. That is the resolver's documented second step, not a new mechanism.
//
// SUBAGENTS. Claude Code fires no buddy hook for a subagent's start, and buddy's state is
// per main session, so child sessions (a parentID) are skipped by the context hook. Their
// tool calls still reach PreToolUse/PostToolUse, under the family ROOT's session id with the
// child's own id as agent_id: what Claude Code sends for a subagent's tool call, whose
// session_id is its parent's.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { runProcess, resolveRuntime, resolveDir, ccInput, lastUserMessage, echoHint, codescoutBareTool, sessionFamily } from '../lib/host.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
export const BUDDY_ROOT = join(REPO, 'buddy');
export const LAUNCHER = join(BUDDY_ROOT, 'hooks', 'run.mjs');
export const JUDGE_ENV = join(BUDDY_ROOT, 'hooks', 'judge.env');
const LABEL = 'buddy';
// SessionStart can run memory consolidation nudges and a migration; give it more room than
// a per-tool hook, which sits on the critical path of every call.
const TIMEOUTS = { 'session-start': 15000, 'user-prompt-submit': 8000, 'pre-tool-use': 5000, 'post-tool-use': 5000 };

// --- tool names -------------------------------------------------------------------------
// buddy reads Claude Code's tool names: Edit/Write/NotebookEdit stamp last_edit_ts, Bash is
// parsed for commits and test runs and is the input of the native-tool-on-source [cs-hint],
// and mcp__codescout__* drives the codescout log, heuristics and judge. OpenCode's own
// spellings (measured for sdd.js/codescout-companion.js) map onto those.
const NATIVE = {
  shell: 'Bash',
  bash: 'Bash',
  edit: 'Edit',
  multiedit: 'Edit',
  patch: 'Edit',
  apply_patch: 'Edit',
  write: 'Write',
  read: 'Read',
  grep: 'Grep',
  glob: 'Glob',
  list: 'LS',
  task: 'Task',
  subagent: 'Task', // v2's name for `task` (lib.mjs normalizedToolName)
  skill: 'Skill',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
};
// Codescout tools: the rule codescout-companion.js applies (lib/host.mjs codescoutBareTool),
// so the two bridges never disagree about whether a call is codescout's.
export function ccToolName(tool) {
  const t = String(tool || '');
  const cs = codescoutBareTool(t);
  if (cs) return `mcp__codescout__${cs}`;
  return NATIVE[t.toLowerCase()] ?? t;
}

// The text of a finished tool call. The model reads `result.content` (measured, see
// codescout-companion.js); `result.output` is structured (a file object for `read`).
export function resultText(event) {
  const r = event?.result;
  const parts = Array.isArray(r?.content) ? r.content.filter((p) => p?.type === 'text').map((p) => p.text) : [];
  if (parts.length) return parts.join('\n').slice(0, 20000);
  if (typeof r?.output === 'string') return r.output.slice(0, 20000);
  return '';
}

export function errorText(event) {
  if (event?.status !== 'error' && !event?.error) return '';
  const e = event.error;
  if (!e) return 'error';
  if (typeof e === 'string') return e;
  return String(e.message ?? e.data?.message ?? JSON.stringify(e)).slice(0, 2000);
}

// Claude Code hands a hook an MCP tool's answer as structured data, and buddy reads it that
// way: `isinstance(tool_response, dict) and "output_id" in tool_response` marks a run_command
// buffer (the ignored-buffer [cs-hint] keys on it), and tool_response["project_root"] is the
// home root a workspace(activate) records. OpenCode gives the answer as text, so a codescout
// answer that is a JSON object is passed parsed. Only the FIRST text part is parsed: another
// bridge may already have appended its own advisory to result.content.
export function toolResponse(event, toolName = ccToolName(event?.tool)) {
  const text = resultText(event);
  if (!String(toolName).startsWith('mcp__codescout__')) return text;
  const r = event?.result;
  const first = Array.isArray(r?.content) ? r.content.find((p) => p?.type === 'text')?.text : r?.output;
  if (typeof first === 'string' && first.length <= 1 << 20 && first.trimStart().startsWith('{')) {
    try {
      const v = JSON.parse(first);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      /* not JSON: pass the text */
    }
  }
  return text;
}

export function postToolPayload(event, dir) {
  const out = {
    hook_event_name: 'PostToolUse',
    session_id: String(event?.sessionID || ''),
    cwd: dir,
    tool_name: ccToolName(event?.tool),
    tool_input: ccInput(event?.input),
  };
  // Claude Code sends `tool_response`; buddy's test-run parser reads `tool_output` (text).
  out.tool_response = toolResponse(event, out.tool_name);
  out.tool_output = resultText(event);
  const err = errorText(event);
  if (err) out.tool_error = err;
  return out;
}

// --- reading buddy's answers ------------------------------------------------------------
// SessionStart / UserPromptSubmit: Claude Code injects a hook's plain stdout as context,
// and a JSON object's hookSpecificOutput.additionalContext the same way. buddy prints
// plain lines (nudges, the summon payload pointer), so both shapes are accepted.
export function contextText(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return '';
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      const c = j?.hookSpecificOutput?.additionalContext ?? j?.additionalContext;
      if (typeof c === 'string') return c.trim();
    } catch {
      /* plain text that happens to start with a brace */
    }
  }
  return text;
}

// PostToolUse: one JSON object per line, each carrying additionalContext (the [cs-hint]
// advisories). Anything else on stdout is not an advisory and is ignored.
export function adviceOf(stdout) {
  const out = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l.startsWith('{')) continue;
    try {
      const c = JSON.parse(l)?.hookSpecificOutput?.additionalContext;
      if (typeof c === 'string' && c.trim()) out.push(c.trim());
    } catch {
      /* not JSON */
    }
  }
  return out;
}

// buddy's text names Claude Code's spellings. Rewrite the two the model must act on:
// codescout tools are `codescout_<tool>` here, and buddy's commands are installed dashed
// (`/buddy-summon`), because a ':' is not allowed in a Windows filename — the same rule
// sdd.js follows for /sdd-approve.
export function rehostBuddy(text) {
  return String(text || '')
    .replace(/\bmcp__codescout__([a-z_]+)/g, 'codescout_$1')
    .replace(/(^|[\s`'"(])\/buddy:([a-z][a-z-]*)/g, '$1/buddy-$2');
}

// The `prompt` UserPromptSubmit carries. On Claude Code it is what the user typed, e.g.
// `/buddy:summon testing`. OpenCode sends a command's EXPANDED template as the user message
// instead; install.sh makes `/buddy:summon $ARGUMENTS` the first line of /buddy-summon's
// template, so for a summon the typed line is the message's first line. Measured on 2.1.3:
// passing the whole message made summon_bootstrap.parse_argument read "testing\n\nYou are
// resolving…" as the argument, decline it as ambiguous, and leave the model to do every
// load step by hand (the slow fallback). Other prompts pass through whole.
export function hookPrompt(text) {
  const t = String(text || '').trim();
  if (t.startsWith('/buddy:summon')) return t.split(/\r?\n/, 1)[0].trim();
  return t;
}

// --- judge.env --------------------------------------------------------------------------
// PreToolUse does something only when a judge is enabled AND blocking is on; otherwise
// hook_entry.run_pre_tool_use returns 0 without reading anything. Spawning Python before
// every tool call to learn that would cost ~100 ms per call for nothing, so the same two
// switches are read here first. Precedence matches hook_dispatch.py for pre-tool-use:
// the caller's environment wins over the file (load_judge_env(override=False)).
export function readJudgeEnv(file = JUDGE_ENV, env = process.env) {
  const vals = {};
  try {
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].replace(/^(['"])(.*)\1$/, '$2');
      // judge.env writes its switches as `export BUDDY_JUDGE_BLOCK="${BUDDY_JUDGE_BLOCK:-true}"`.
      // Read literally that never equals 'true', so the judge block never ran on OpenCode.
      // Same rule as Python's load_judge_env: the named variable when it is set (even to ''),
      // from the environment or an earlier line of the file, else the default.
      const d = v.match(/^\$\{(\w+):-(.*)\}$/);
      if (d) {
        const cur = env[d[1]] !== undefined ? env[d[1]] : vals[d[1]];
        v = cur !== undefined ? cur : d[2];
      }
      vals[m[1]] = v;
    }
  } catch {
    /* no judge.env: everything off */
  }
  const get = (k) => (env[k] !== undefined ? env[k] : vals[k]);
  return {
    judge: get('BUDDY_JUDGE_ENABLED') === 'true',
    csJudge: get('BUDDY_CS_JUDGE_ENABLED') === 'true',
    block: get('BUDDY_JUDGE_BLOCK') === 'true',
  };
}
export function preToolActive(j) {
  return Boolean(j && j.block && (j.judge || j.csJudge));
}

// --- running the launcher ---------------------------------------------------------------
export function runBuddyHook(event, payload, { runtime = resolveRuntime() } = {}) {
  if (!existsSync(LAUNCHER)) return Promise.resolve(null);
  return runProcess(runtime, [LAUNCHER, event], {
    input: JSON.stringify(payload),
    cwd: payload.cwd,
    timeoutMs: TIMEOUTS[event] ?? 5000,
    label: LABEL,
  });
}

// --- the bridge -------------------------------------------------------------------------
// All state is per bridge instance: one long-lived `opencode serve` hosts many projects.
export function buildBuddyBridge(dir, { getSession = async () => ({}), run = runBuddyHook, judgeEnv = readJudgeEnv, echo = echoHint } = {}) {
  // Both Maps hold PROMISES, stored before the first await. Two context events of one session
  // can overlap (a side request beside the main step); with the text stored only after the
  // await, both saw an empty slot and both ran the hook, so prompt_count was counted twice
  // and the summon bootstrap ran twice.
  const banners = new Map(); // session id → Promise<SessionStart text> ('' = nothing to say)
  const prompts = new Map(); // user message id → Promise<UserPromptSubmit text>
  // parentID | null | undefined (lookup failed). A failure is not remembered: one transient
  // error used to make a subagent top-level for the life of the service.
  const family = sessionFamily(getSession);

  const hook = (event, payload) => run(event, { cwd: dir, ...payload });
  // A hook's answer as context text; never rejects, so a cached promise cannot poison a slot.
  const textOf = (p) =>
    Promise.resolve()
      .then(p)
      .then((res) => rehostBuddy(contextText(res?.stdout)), () => '');

  const sessionStart = (sid, source) => textOf(() => hook('session-start', { hook_event_name: 'SessionStart', source, session_id: sid }));

  // The ids a tool hook carries. Claude Code gives a subagent's tool call its PARENT's
  // session_id (and the subagent's own id as agent_id), and buddy keeps state, mood, the
  // codescout log and judge verdicts per main session. OpenCode gives the child's id, which
  // used to grow a `.buddy/<child>/` per subagent that nothing GCs (no SessionEnd here) while
  // the main session never saw the work. A failed lookup keeps the id it has.
  async function toolIds(event) {
    const sid = String(event?.sessionID || '');
    if (!sid) return { session_id: '' };
    const top = await family.root(sid);
    return top && top !== sid ? { session_id: top, agent_id: sid } : { session_id: sid };
  }

  const pushSystem = (event, text) => {
    if (!text) return;
    try {
      event.system.push({ type: 'text', text });
    } catch {
      /* fail open */
    }
  };

  return {
    async onContext(event) {
      const sid = String(event?.sessionID || '');
      if (!sid) return;
      // A child session gets nothing, as on Claude Code. An UNKNOWN parent (lookup failed)
      // is treated as top-level for this request: buddy guards nothing, so the failure
      // direction is "on". The next request asks again.
      if (await family.parent(sid)) return;

      // Each has()/set() pair below runs with no await between them (see the Maps above).
      // SessionStart finishes before UserPromptSubmit starts, as on Claude Code.
      if (!banners.has(sid)) banners.set(sid, sessionStart(sid, 'startup'));
      const banner = await banners.get(sid);

      const msg = lastUserMessage(event?.messages);
      let prompt;
      if (msg) {
        if (!prompts.has(msg.id)) {
          prompts.set(
            msg.id,
            textOf(() => hook('user-prompt-submit', { hook_event_name: 'UserPromptSubmit', prompt: hookPrompt(msg.text), session_id: sid })),
          );
          if (prompts.size > 500) prompts.delete(prompts.keys().next().value);
        }
        prompt = prompts.get(msg.id);
      }

      pushSystem(event, banner);
      if (prompt) pushSystem(event, await prompt);
    },

    async onCompaction(event) {
      const sid = String(event?.sessionID || '');
      if (!sid || (await family.parent(sid))) return;
      // Claude Code's SessionStart(source=compact): buddy releases summoned specialists and
      // prints a re-summon notice. That text replaces the startup banner from here on.
      const text = sessionStart(sid, 'compact');
      banners.set(sid, text);
      pushSystem(event, await text);
    },

    async onToolBefore(event) {
      if (!preToolActive(judgeEnv())) return;
      const res = await hook('pre-tool-use', {
        hook_event_name: 'PreToolUse',
        ...(await toolIds(event)),
        tool_name: ccToolName(event?.tool),
        tool_input: ccInput(event?.input),
      });
      // Exit 2 is buddy's one intentional block; the correction message is on stderr.
      // Throwing is the only way to stop an OpenCode tool call: the host turns the throw
      // into a failed call whose message reaches the model.
      if (res?.code === 2) throw new Error(rehostBuddy(res.stderr.trim() || 'buddy: a judge verdict blocks this call'));
    },

    async onToolAfter(event) {
      const res = await hook('post-tool-use', { ...postToolPayload(event, dir), ...(await toolIds(event)) });
      const advice = adviceOf(res?.stdout).map(rehostBuddy);
      if (!advice.length) return;
      const text = advice.join('\n\n');
      try {
        const content = event.result?.content; // what the model reads (measured)
        if (Array.isArray(content)) {
          content.push({ type: 'text', text });
          echo({ sessionID: String(event?.sessionID || ''), tool: String(event?.tool || ''), source: LABEL, text });
        }
      } catch {
        /* unrecognised shape: drop the advice rather than corrupt the result */
      }
    },
  };
}

export async function Buddy(ctx) {
  const c = ctx || {};
  const dir = resolveDir(c);
  const b = buildBuddyBridge(dir, { getSession: (sessionID) => c.session.get({ sessionID }) });
  const reg = async (where, name, fn) => {
    try {
      const group = c[where];
      if (typeof group?.hook !== 'function') throw new Error(`ctx.${where}.hook missing`);
      await group.hook(name, fn);
    } catch (e) {
      process.stderr.write(`buddy: could not register ${where}.${name} — ${e?.message || e}\n`);
    }
  };
  await reg('session', 'context', b.onContext);
  await reg('session', 'compaction', b.onCompaction);
  await reg('tool', 'execute.before', b.onToolBefore);
  await reg('tool', 'execute.after', b.onToolAfter);
}

export default { id: 'buddy', setup: Buddy };
