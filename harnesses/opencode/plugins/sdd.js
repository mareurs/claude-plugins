// sdd for OpenCode — the host bridge.
//
// sdd's enforcement lives in five Claude Code hooks (sdd/hooks/hooks.json). This plugin
// runs the SAME hook scripts from OpenCode's plugin callbacks and translates the answers,
// exactly as codescout-companion.js does for its guard. Nothing about sdd's rules is
// reimplemented here.
//
//   Claude Code event                 OpenCode channel (2.1.3, measured)
//   ───────────────────────────────── ─────────────────────────────────────────────────
//   PreToolUse  → spec-guard.mjs      tool.hook("execute.before") on edit/write/patch and
//                                     codescout edit_file/edit_code/create_file/doc
//   PreToolUse  → review-guard.mjs    tool.hook("execute.before") on shell/bash and
//                                     codescout run_command
//   SessionStart → session-start.mjs  session.hook("context"), top-level sessions; run once
//                                     per session and cached, re-run after an approval
//   UserPromptSubmit → approve-intake session.hook("context"): the latest USER message of a
//                                     TOP-LEVEL session, once per message id
//   SubagentStart → subagent-inject   session.hook("context") in a CHILD session (one with
//                                     a parentID), once per session
//
// THE APPROVAL BOUNDARY. On Claude Code only the user can approve: approve-intake runs on
// UserPromptSubmit, which the model cannot trigger. OpenCode has no prompt-submit event, so
// this reads the latest user message from the context event instead. Two things keep the
// boundary: (1) only role "user" messages count, and the model cannot author those in its
// own session; (2) only TOP-LEVEL sessions count, because a subagent's first message IS
// written by the model (the task prompt). If the session lookup fails, approvals are not
// processed: approvals fail closed, everything else fails open.
//
// COMMAND NAMES. OpenCode has a built-in /review, so sdd's cannot keep that name. The
// commands are /sdd-approve, /sdd-review, /sdd-init: one dashed spelling, because a ':'
// is not allowed in a Windows filename (a `sdd:approve.md` does load on Linux, measured).
// install.sh renders them; rehostSdd() maps the names inside hook messages the same way.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { runHook, decisionOf, resolveDir, ccInput, lastUserMessage, echoHint, sessionFamily } from '../lib/host.mjs';

// Moved to lib/host.mjs (buddy.js needs both); re-exported so existing importers keep working.
export { ccInput, lastUserMessage };

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const HOOKS = join(REPO, 'sdd', 'hooks');
export const SPEC_GUARD = join(HOOKS, 'spec-guard.mjs');
export const REVIEW_GUARD = join(HOOKS, 'review-guard.mjs');
export const SESSION_START = join(HOOKS, 'session-start.mjs');
export const APPROVE_INTAKE = join(HOOKS, 'approve-intake.mjs');
export const SUBAGENT_INJECT = join(HOOKS, 'subagent-inject.mjs');
const LABEL = 'sdd';

// --- which project is under sdd ---------------------------------------------------------
// Walk up for .sdd/config.json, the file every sdd hook checks first. A `.git` FILE means a
// linked worktree, whose config lives in the main checkout: hand that case to the hooks,
// which resolve the main checkout themselves. Checked per call (a few stats), because
// /sdd-init can create the config mid-session.
export function sddActive(dir) {
  let d = resolve(dir || process.cwd());
  for (;;) {
    if (existsSync(join(d, '.sdd', 'config.json'))) return true;
    const g = join(d, '.git');
    if (existsSync(g)) {
      try {
        return statSync(g).isFile();
      } catch {
        return false;
      }
    }
    const up = dirname(d);
    if (up === d) return false;
    d = up;
  }
}

// --- tool routing -------------------------------------------------------------------------
const NATIVE_WRITE = new Set(['edit', 'write', 'multiedit', 'patch', 'apply_patch']);
const NATIVE_SHELL = new Set(['shell', 'bash']);
const CS = /^(?:mcp__codescout__|codescout[._/])([a-z_]+)$/i;
const CS_WRITE = new Set(['edit_file', 'edit_code', 'create_file', 'doc']);

export function hooksFor(tool) {
  const t = String(tool || '');
  const cs = t.match(CS)?.[1];
  if (NATIVE_WRITE.has(t) || (cs && CS_WRITE.has(cs))) return 'spec';
  if (NATIVE_SHELL.has(t) || cs === 'run_command') return 'review';
  return null;
}

// OpenCode's `patch` tool carries no single path: it takes `patchText` with
// `*** Add File: p` / `*** Update File: p` / `*** Delete File: p` / `*** Move to: p` headers
// (the tool's own description, measured). spec-guard decides per file, so each file becomes
// its own guard call: an Add is a whole-file `write` with the added lines as content,
// anything else an `edit`.
export function patchCalls(input) {
  const text = String(input?.patchText ?? input?.patch ?? input?.input ?? '');
  const calls = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\*\*\* (Add|Update|Delete) File: (.+?)\s*$/) || lines[i].match(/^\*\*\* (Move) to: (.+?)\s*$/);
    if (!m) continue;
    if (m[1] === 'Add') {
      const body = [];
      for (let j = i + 1; j < lines.length && !lines[j].startsWith('*** '); j++) {
        if (lines[j].startsWith('+')) body.push(lines[j].slice(1));
      }
      calls.push({ tool_name: 'write', tool_input: { filePath: m[2], content: body.join('\n') } });
    } else {
      calls.push({ tool_name: 'edit', tool_input: { filePath: m[2] } });
    }
  }
  return calls;
}

// ccInput (camelCase OpenCode args → the snake_case sdd's guards read) lives in lib/host.mjs.

export function guardCalls(tool, input, dir) {
  const which = hooksFor(tool);
  if (!which) return [];
  const script = which === 'spec' ? SPEC_GUARD : REVIEW_GUARD;
  const abs = (p) => (p && !isAbsolute(p) ? join(dir, p) : p);
  if (tool === 'patch' || tool === 'apply_patch') {
    return patchCalls(input).map((c) => ({
      script,
      tool_name: c.tool_name,
      tool_input: ccInput({ ...c.tool_input, filePath: abs(c.tool_input.filePath) }),
    }));
  }
  return [{ script, tool_name: tool, tool_input: ccInput(input) }];
}

// --- message re-hosting ---------------------------------------------------------------------
export function rehostSdd(text) {
  return String(text || '')
    .replace(/\/sdd:approve\b/g, '/sdd-approve')
    .replace(/\/sdd:review\b/g, '/sdd-review')
    .replace(/(^|[\s`'"(])\/review\b/g, '$1/sdd-review');
}

const APPROVE_PREFIX = /^\s*(?:\/sdd[-:]approve|\/approve|sdd approve)\b/;
// OpenCode's agent ids → the Claude Code agent_type subagent-inject keys on.
const AGENT_TYPE = { general: 'general-purpose', plan: 'Plan', build: 'general-purpose' };

const contextOf = (res) => {
  const d = decisionOf(res);
  return d?.context ? rehostSdd(d.context) : null;
};

// --- the bridge ------------------------------------------------------------------------------
// `getSession(id)` resolves a session's info ({parentID?}) or throws. All state is per bridge
// instance: one long-lived `opencode serve` hosts many projects (code review, 2026-11-09).
export function buildSddBridge(dir, { getSession = async () => ({}), run = runHook, echo = echoHint } = {}) {
  const pending = new Map(); // call id → advice for its result
  const banners = new Map(); // session id → session-start text ('' = nothing to say)
  const subagentText = new Map(); // child session id → subagent-inject text
  const approvals = new Map(); // user message id → approve-intake text ('' = not an approval)
  // parentID | null | undefined (lookup failed: approvals fail closed, the rest fails open).
  // A failed lookup is not remembered (lib/host.mjs sessionFamily), so it costs one request.
  const sessionParent = sessionFamily(getSession).parent;

  const hook = (script, payload) => run(script, { cwd: dir, ...payload }, { label: LABEL });

  async function banner(sid) {
    if (!banners.has(sid)) {
      const res = await hook(SESSION_START, { hook_event_name: 'SessionStart', source: 'startup', session_id: sid });
      banners.set(sid, contextOf(res) || '');
    }
    return banners.get(sid);
  }

  return {
    async onToolBefore(event) {
      const tool = String(event?.tool || '');
      if (!hooksFor(tool) || !sddActive(dir)) return;
      const sid = String(event?.sessionID || '');
      const advice = [];
      for (const c of guardCalls(tool, event?.input, dir)) {
        const d = decisionOf(
          await hook(c.script, { hook_event_name: 'PreToolUse', tool_name: c.tool_name, tool_input: c.tool_input, session_id: sid }),
        );
        if (d?.deny) throw new Error(rehostSdd(d.deny));
        if (d?.context) advice.push(rehostSdd(d.context));
      }
      if (advice.length && event?.id) {
        if (pending.size >= 200) pending.delete(pending.keys().next().value);
        pending.set(event.id, advice.join('\n\n'));
      }
    },

    async onToolAfter(event) {
      const advice = event?.id && pending.get(event.id);
      if (!advice) return;
      pending.delete(event.id);
      try {
        const content = event.result?.content; // what the model reads (measured)
        if (Array.isArray(content)) {
          content.push({ type: 'text', text: advice });
          echo({ sessionID: String(event?.sessionID || ''), tool: String(event?.tool || ''), source: LABEL, text: advice });
        }
      } catch {
        /* unrecognised shape: drop the advice rather than corrupt the result */
      }
    },

    async onContext(event) {
      if (!sddActive(dir)) return;
      const sid = String(event?.sessionID || '');
      if (!sid) return;
      const push = (text) => {
        if (!text) return;
        try {
          event.system.push({ type: 'text', text });
        } catch {
          /* fail open */
        }
      };
      const parent = await sessionParent(sid);

      if (parent) {
        // A child session: SubagentStart's equivalent.
        if (!subagentText.has(sid)) {
          const agentType = AGENT_TYPE[event?.agent] ?? String(event?.agent || '');
          const res = await hook(SUBAGENT_INJECT, { hook_event_name: 'SubagentStart', agent_type: agentType, session_id: sid });
          subagentText.set(sid, contextOf(res) || '');
        }
        push(subagentText.get(sid));
        return;
      }

      // Top-level (or unknown). Approvals only when we KNOW it is top-level.
      if (parent === null) {
        const msg = lastUserMessage(event?.messages);
        if (msg && !approvals.has(msg.id)) {
          let out = '';
          if (APPROVE_PREFIX.test(msg.text)) {
            const res = await hook(APPROVE_INTAKE, { hook_event_name: 'UserPromptSubmit', prompt: msg.text.trim(), session_id: sid });
            out = contextOf(res) || '';
            banners.delete(sid); // the active features may have changed
          }
          approvals.set(msg.id, out);
          if (approvals.size > 500) approvals.delete(approvals.keys().next().value);
        }
        push(await banner(sid));
        if (msg) push(approvals.get(msg.id));
        return;
      }
      push(await banner(sid));
    },

    async onCompaction(event) {
      if (!sddActive(dir)) return;
      const sid = String(event?.sessionID || '');
      if (!sid) return;
      banners.delete(sid);
      const text = await banner(sid);
      if (text) {
        try {
          event.system.push({ type: 'text', text });
        } catch {
          /* fail open */
        }
      }
    },
  };
}

export async function Sdd(ctx) {
  const c = ctx || {};
  const dir = resolveDir(c);
  const b = buildSddBridge(dir, { getSession: (sessionID) => c.session.get({ sessionID }) });
  const reg = async (where, name, fn) => {
    try {
      const group = c[where];
      if (typeof group?.hook !== 'function') throw new Error(`ctx.${where}.hook missing`);
      await group.hook(name, fn);
    } catch (e) {
      process.stderr.write(`sdd: could not register ${where}.${name} — ${e?.message || e}\n`);
    }
  };
  await reg('tool', 'execute.before', b.onToolBefore);
  await reg('tool', 'execute.after', b.onToolAfter);
  await reg('session', 'context', b.onContext);
  await reg('session', 'compaction', b.onCompaction);
}

export default { id: 'sdd', setup: Sdd };
