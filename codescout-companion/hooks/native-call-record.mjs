// PostToolUse hook — one JSONL line per NATIVE tool call (Read, Grep, Glob, Agent, WebFetch).
//
// codescout's own recorder (`usage.db`, `tool_calls`) sees MCP calls only, so every usage question
// answers over a subset (codescout:docs/issues/2026-09-01-tool-call-recorder-cannot-see-the-arm-under-evaluation.md,
// "Tier 2"). This hook is the missing half: it records THAT a native call happened, never WHAT was asked.
//
// Fields (schema v1): v, ts, project, session_id, tool_use_id, tool, duration_ms, profile, plus
// agent_id/agent_type ONLY on a subagent's own call (the point of keeping them: a subagent shares its
// parent's session_id, so agent_id is the only thing that separates the two), ext for a file read or a
// search path, subagent_type for Agent, host for WebFetch. Payload shapes measured on 2026-11-02 with a
// real `claude -p` run (2.1.316).
//
// PRIVACY, by construction: no file path, no search pattern, no prompt, no URL path or query reaches the
// file. A reader that needs them has the transcript.
//
// Where: `$XDG_STATE_HOME/codescout/native-calls/<YYYY-MM>.jsonl` (default ~/.local/state), a machine-local
// path outside every repo (a file under `.codescout/` would show up untracked in each project), shared by
// all Claude Code profiles, so one reader sees the four of them. Join key to usage.db: session_id =
// tool_calls.cc_session_id.
//
// COST: this runs after every matched native call, so it does the least that works: parse stdin, one
// `appendFileSync` (O_APPEND, one whole line per call, so concurrent writers do not tear lines), exit.
// It never writes to stdout and ALWAYS exits 0: a recorder that can fail a tool call or speak to the
// model is worse than no recorder. Register it with `"async": true` so it cannot delay the call at all.
// Opt out with CS_NATIVE_CALL_LOG=off.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { readInput, resolveProjectRoot } from './lib.mjs';

// The tools this hook records. The hooks.json matcher is the first filter; this is the second, so a
// widened matcher cannot start recording something this file never reasoned about.
const NATIVE = new Set(['Read', 'Grep', 'Glob', 'Agent', 'WebFetch']);

function fileExt(p) {
  if (typeof p !== 'string' || !p) return null;
  const e = extname(p).slice(1).toLowerCase();
  return e || null;
}

function hostOf(url) {
  try {
    return new URL(String(url)).host || null;
  } catch {
    return null;
  }
}

function main() {
  if (String(process.env.CS_NATIVE_CALL_LOG || '').toLowerCase() === 'off') return;
  const input = readInput();
  if (!input || typeof input !== 'object') return;
  const tool = input.tool_name;
  if (!NATIVE.has(tool)) return;

  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const row = {
    v: 1,
    ts: new Date().toISOString(),
    project: resolveProjectRoot(input.cwd),
    session_id: input.session_id ?? null,
    tool_use_id: input.tool_use_id ?? null,
    tool,
    duration_ms: Number.isFinite(input.duration_ms) ? input.duration_ms : null,
    profile: process.env.CLAUDE_CONFIG_DIR ? basename(process.env.CLAUDE_CONFIG_DIR) : null,
  };
  // Present ONLY on a subagent's own call; absent keys keep a main-thread line short and let a reader
  // test `agent_id` for "is a subagent" directly.
  if (input.agent_id) {
    row.agent_id = input.agent_id;
    row.agent_type = input.agent_type ?? null;
  }
  if (tool === 'Read') row.ext = fileExt(ti.file_path);
  else if (tool === 'Grep') row.ext = fileExt(ti.path);
  else if (tool === 'Agent') row.subagent_type = ti.subagent_type ?? null;
  else if (tool === 'WebFetch') row.host = hostOf(ti.url);

  const base = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state');
  const dir = join(base, 'codescout', 'native-calls');
  mkdirSync(dir, { recursive: true });
  const month = row.ts.slice(0, 7);
  appendFileSync(join(dir, `${month}.jsonl`), JSON.stringify(row) + '\n');
}

try {
  main();
} catch {
  // Nothing to report and nobody to report it to: stdout belongs to the model, and a failed
  // recorder must not fail the call it observes.
}
process.exit(0);
