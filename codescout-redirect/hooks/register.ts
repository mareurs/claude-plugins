import type { Register } from 'claude-code'
// @ts-expect-error TS7016: guard-rules.mjs is plain JavaScript, shared with the guard (see the sync script)
import { norm, exemptReason } from './guard-rules.mjs'

// Scope (the plugin version is 0.1.0 until a release):
//   Read, Grep, Glob - every call the guard would deny (exemptReason of guard-rules.mjs says which
//                      calls it lets through: images, skill payloads, harness output, config dirs)
//   Write, Edit      - only inside claude-plugins/redirect-probe-sandbox/
//   Bash             - one simple read-only command (SAFE_BASH below)
//   Monitor          - always a refusal that names the fix
// The mod stands aside, and the next hook (the guard) decides, when:
//   - block_reads is false in .claude/codescout-companion.json (or codescout-routing.json) and the
//     caller is the main agent (a subagent is still redirected, as in the guard);
//   - HOME and CLAUDE_CONFIG_DIR cannot be read;
//   - codescout answers with an error.
const SERVER = 'codescout'
const SANDBOX_RE = /\/claude-plugins\/redirect-probe-sandbox\//
// One simple command: no chaining, redirection, pipes or substitution.
const SAFE_BASH = /^(ls|pwd|echo|date|wc|git (status|log|diff|branch))(\s[^;&|<>`$\n]*)?$/
// The same expression as pre-tool-guard.mjs: HOME, else USERPROFILE, else os.homedir().
const ENV_SCRIPT =
  "JSON.stringify({home:process.env.HOME||process.env.USERPROFILE||require('os').homedir()," +
  "configDir:process.env.CLAUDE_CONFIG_DIR||''})"

type Env = { home: string; configDir: string }

// codescout may add a block after its reply (a guide, on the first call of a session): the first block
// is the reply, and every block is what the agent would see.
const blocksOf = (res: { content: Array<{ type: string; text?: string }> }) =>
  res.content.map(b => (b.type === 'text' ? (b.text ?? '') : ''))
const textOf = (res: { content: Array<{ type: string; text?: string }> }) => blocksOf(res).join('\n')

// The codescout call as the agent would write it, with a long string value clipped.
const clip = (s: string) => (s.length > 80 ? `${s.slice(0, 80)}…(${s.length} chars)` : s)
function fmtCall(tool: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(
    ([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(clip(v)) : JSON.stringify(v)}`,
  )
  return `${tool}(${parts.join(', ')})`
}

// What the agent reads about a redirected call: the real call, and the rule.
const note = (native: string, call: string) =>
  `[codescout-redirect] native ${native} ran as codescout ${call}. Call it directly: ${native} is not used here.`

// Read once per session and kept: the mod has no env of its own. `register` clears it, so a reload
// (and each test) starts clean.
let env: Env | undefined

async function getEnv($: any): Promise<Env | null> {
  if (env) return env
  try {
    const r = await $.process.run(['node', '-p', ENV_SCRIPT])
    if (r.exitCode === 0) {
      const j = JSON.parse(r.stdout)
      if (typeof j.home === 'string' && j.home) env = { home: norm(j.home), configDir: String(j.configDir || '') }
    }
  } catch {
    /* stays undefined: the mod does not redirect */
  }
  return env ?? null
}

// The guard's rule: the FIRST config file that exists decides; `false` or "false" opts out.
async function blockReadsOff($: any, cwd: string): Promise<boolean> {
  for (const f of ['codescout-companion.json', 'codescout-routing.json']) {
    let text: string
    try {
      text = await $.fs.read(`${cwd}/.claude/${f}`)
    } catch {
      continue
    }
    try {
      const v = JSON.parse(text).block_reads
      return v === false || v === 'false'
    } catch {
      return false
    }
  }
  return false
}

// The environment when the mod may answer this call, else null.
async function gate($: any, e: { agentId?: string }): Promise<Env | null> {
  const got = await getEnv($)
  if (!got) return null
  if (!e.agentId && (await blockReadsOff($, await $.session.cwd()))) return null
  return got
}

// The native tools whose description points at the codescout tool that replaces them:
// [the codescout tool's name, the call as the agent writes it].
const DESCRIBE: Record<string, [string, string]> = {
  Bash: ['run_command', 'run_command(command=...)'],
  Read: ['read_file', 'read_file(path=...)'],
  Grep: ['grep', 'grep(pattern=...)'],
  Glob: ['tree', 'tree(glob=...)'],
  Edit: ['edit_file', 'edit_file(path, old_string, new_string)'],
  Write: ['create_file', 'create_file(path, content)'],
}

// The advice for one native tool's description, or null when it would be wrong or unsafe to give:
// the pool has no such codescout tool, block_reads is false, or the pool cannot be read.
async function describeAdvice($: any, tool: string): Promise<string | null> {
  const entry = DESCRIBE[tool]
  if (!entry) return null
  const [name, call] = entry
  try {
    const pool: Array<{ name: string }> = await $.tool.list()
    if (!pool.some(t => t.name === `mcp__codescout__${name}`)) return null
    if (await blockReadsOff($, await $.session.cwd())) return null
  } catch {
    return null
  }
  return (
    `IN THIS PROJECT call the codescout tool ${call} instead of this one. ` +
    `If it is not in your tool list, load it with ToolSearch (query "select:mcp__codescout__${name}"). ` +
    `This native tool is only a fallback.\n\n`
  )
}

// The codescout tools whose schema goes in the prompt list. Behind ToolSearch a subagent chose Bash
// first whatever the description said; with the schema in the list it chose the codescout tool.
const PIN = ['run_command', 'read_file', 'edit_file', 'create_file', 'grep', 'tree', 'symbols', 'edit_code']

// May the schemas be placed in the prompt list? Not when block_reads is false, and not when that
// cannot be read: placing them changes every request of the session.
async function pinAllowed($: any): Promise<boolean> {
  try {
    return !(await blockReadsOff($, await $.session.cwd()))
  } catch {
    return false
  }
}

export const register: Register = on => {
  env = undefined

  // ---- Read -> codescout read_file ------------------------------------
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const g = await gate($, e)
    if (!g || exemptReason('Read', norm(e.file_path), g)) return next(e)
    const args: Record<string, unknown> = { path: e.file_path }
    if (e.offset !== undefined) args.offset = e.offset
    if (e.limit !== undefined) args.limit = e.limit

    const res = await $.mcp.call(SERVER, 'read_file', args)
    if (res.isError) {
      return next(e)
    }
    // codescout puts "N lines" (and, on a range read, one blank line) first. N is the file's real length.
    const raw = textOf(res)
    const ranged = e.offset !== undefined || e.limit !== undefined
    const head = raw.match(ranged ? /^(\d+) lines?\n\n?/ : /^(\d+) lines?\n/)
    const text = head ? raw.slice(head[0].length) : raw
    const lines = text.split('\n').length
    return {
      result: {
        type: 'text',
        file: {
          filePath: e.file_path,
          content: text,
          numLines: lines,
          startLine: e.offset ?? 1,
          totalLines: head ? Number(head[1]) : lines,
        },
      },
      context: [
        note('Read', fmtCall('read_file', args)) +
          ` An "@file_*" buffer reads only through read_file(path="@file_*", start_line, end_line).` +
          ` Use symbols(path) for an overview, symbols(name, include_body=true) for one body.`,
      ],
    }
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- Grep -> codescout grep -----------------------------------------
  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    const a = e as unknown as Record<string, any>
    const g = await gate($, e)
    if (!g || exemptReason('Grep', norm(a.path || ''), g)) return next(e)
    const ctx = Math.max(a['-C'] ?? 0, a.context ?? 0, a['-A'] ?? 0, a['-B'] ?? 0)
    const args: Record<string, unknown> = { pattern: a.pattern }
    if (a.path) args.path = a.path
    if (a.glob) args.glob = a.glob
    if (a['-i']) args.ignore_case = true
    if (ctx) args.context_lines = Math.min(ctx, 20)
    if (a.head_limit) args.limit = a.head_limit
    if (a.output_mode === 'files_with_matches' || a.output_mode === 'count') args.mode = 'files'

    const res = await $.mcp.call(SERVER, 'grep', args)
    if (res.isError) {
      return next(e)
    }
    const text = textOf(res)
    return {
      result: {
        mode: 'content',
        numFiles: 0,
        filenames: [],
        content: text,
        numLines: text.split('\n').length,
      },
      context: [
        note('Grep', fmtCall('grep', args)) +
          ` For callers use references(symbol, path); for a concept use semantic_search(query).`,
      ],
    } as never
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- Glob -> codescout tree(glob) -----------------------------------
  on('tool.call', { tool: 'Glob' }, async ($, e, next) => {
    const a = e as unknown as Record<string, any>
    const g = await gate($, e)
    if (!g || exemptReason('Glob', norm(a.pattern || ''), g)) return next(e)
    const args: Record<string, unknown> = { glob: a.pattern }
    if (a.path) args.path = a.path

    const res = await $.mcp.call(SERVER, 'tree', args)
    if (res.isError) {
      return next(e)
    }
    const text = textOf(res)
    const filenames = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^\d+ (files?|matches|entries)/.test(l) && !l.startsWith('['))
    return {
      result: {
        durationMs: 0,
        numFiles: filenames.length,
        filenames,
        truncated: false,
      },
      context: [note('Glob', fmtCall('tree', args)) + ` For a symbol use symbols(name=...).`],
    } as never
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- Write -> codescout create_file (sandbox only) -------------------
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!SANDBOX_RE.test(e.file_path) || !(await gate($, e))) return next(e)
    let original: string | null = null
    try {
      original = await $.fs.read(e.file_path)
    } catch {
      original = null
    }
    const args: Record<string, unknown> = { path: e.file_path, content: e.content }
    if (original !== null) {
      args.overwrite = true
      args.force = true
    }
    const res = await $.mcp.call(SERVER, 'create_file', args)
    const text = textOf(res)
    if (res.isError || /pending_ack|"error"/.test(text)) {
      return next(e)
    }
    return {
      result: {
        type: original === null ? 'create' : 'update',
        filePath: e.file_path,
        content: e.content,
        structuredPatch: [],
        originalFile: original,
      },
      context: [`${note('Write', fmtCall('create_file', args))} Reply: ${text.slice(0, 200)}`],
    }
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- Edit -> codescout edit_file (sandbox only) ----------------------
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!SANDBOX_RE.test(e.file_path) || !(await gate($, e))) return next(e)
    let original: string
    try {
      original = await $.fs.read(e.file_path)
    } catch {
      return next(e)
    }
    const args: Record<string, unknown> = {
      path: e.file_path,
      old_string: e.old_string,
      new_string: e.new_string,
      replace_all: !!e.replace_all,
    }
    const res = await $.mcp.call(SERVER, 'edit_file', args)
    const text = textOf(res)
    if (res.isError || /pending_ack|"error"/.test(text)) {
      return next(e)
    }
    const idx = original.indexOf(e.old_string)
    const oldStart = idx < 0 ? 1 : original.slice(0, idx).split('\n').length
    const oldLines = e.old_string.split('\n')
    const newLines = e.new_string.split('\n')
    return {
      result: {
        filePath: e.file_path,
        oldString: e.old_string,
        newString: e.new_string,
        originalFile: original,
        structuredPatch: [
          {
            oldStart,
            oldLines: oldLines.length,
            newStart: oldStart,
            newLines: newLines.length,
            lines: [...oldLines.map(l => '-' + l), ...newLines.map(l => '+' + l)],
          },
        ],
        userModified: false,
        replaceAll: !!e.replace_all,
      },
      context: [`${note('Edit', fmtCall('edit_file', args))} Reply: ${text.slice(0, 200)}`],
    }
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- Bash -> codescout run_command (read-only allowlist only) --------
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background || !SAFE_BASH.test(e.command.trim()) || !(await gate($, e))) return next(e)
    const args: Record<string, unknown> = {
      command: e.command,
      timeout_secs: Math.ceil((e.timeout ?? 120000) / 1000),
      effect: 'read',
    }
    const res = await $.mcp.call(SERVER, 'run_command', args)
    const text = textOf(res)
    let out: Record<string, any> | null
    try {
      out = JSON.parse(blocksOf(res)[0] ?? '')
    } catch {
      out = null
    }
    if (res.isError || !out || typeof out.exit_code !== 'number' || /pending_ack/.test(text)) {
      return next(e)
    }
    const stdout = String(out.stdout ?? '')
    const stderr = String(out.stderr ?? '')
    const call = fmtCall('run_command', args)
    if (out.exit_code !== 0) {
      // Native Bash reports a non-zero exit as an error result.
      return { deny: `[codescout-redirect] codescout ${call} exited ${out.exit_code}\n${stdout}${stderr}` }
    }
    // stdout carries codescout's own reply, so the agent sees what run_command returns.
    return {
      result: { stdout: text, stderr: '', interrupted: false },
      context: [
        note('Bash', call) +
          (out.output_id
            ? ` Long output is buffered as ${out.output_id}: query it with run_command(command="grep PATTERN ${out.output_id}") or "tail -20 ${out.output_id}".`
            : ` Its output is buffered (@cmd_*) and queryable.`),
      ],
    }
  }).catch(($, e, next) => {
    return next(e)
  })

  // ---- tool.describe -> the native description points at the codescout tool -------
  // The model reads this when it first sees the tool, so it picks the codescout tool and never tries
  // the native one. Measured 2026-11-24 (Haiku, n=3 per arm): without it Bash was the first choice
  // 3 times of 3; with the advice in front, ToolSearch for run_command 3 times of 3.
  for (const tool of Object.keys(DESCRIBE)) {
    on('tool.describe', { tool }, async ($, e, next) => {
      const r = await next(e)
      const advice = await describeAdvice($, tool)
      return advice ? { ...r, description: advice + r.description } : r
    }).catch(($, e, next) => next(e))
  }

  // ---- tool.describe -> the codescout tools sit in the prompt list ---------------
  // Behind ToolSearch the model pays a turn to load a tool, and a subagent does not load it at all.
  for (const name of PIN) {
    on('tool.describe', { tool: `mcp__codescout__${name}` }, async ($, e, next) => {
      const r = await next(e)
      return (await pinAllowed($)) ? { ...r, isDeferred: false } : r
    }).catch(($, e, next) => next(e))
  }

  // ---- Monitor -> a refusal that names the fix -------------------------
  on('tool.call', { tool: 'Monitor' }, () => ({
    deny:
      'Monitor is not used here. For a long job call ' +
      'run_command(command, run_in_background=true), then end your turn: ' +
      'the codescout-companion hook wakes the session when the job ends. ' +
      'Do not poll. In a subagent, where no wake arrives, run the command ' +
      'in the foreground with timeout_secs.',
  }))
}
