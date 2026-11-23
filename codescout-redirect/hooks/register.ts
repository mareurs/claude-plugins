import type { Register } from 'claude-code'

// Scope of 0.1.0 (narrow on purpose, see the spec):
//   Read   - a .mjs file under claude-plugins
//   Grep, Glob - path unset or under claude-plugins
//   Write, Edit - only inside claude-plugins/redirect-probe-sandbox/
//   Bash   - one simple read-only command (SAFE_BASH below)
//   Monitor - always a refusal that names the fix
// Everything else goes on to the next hook and the engine. A failure fails open.
const SRC_RE = /\/claude-plugins\/.*\.mjs$/
const ROOT_RE = /\/claude-plugins(\/|$)/
const SERVER = 'codescout'
// Write and Edit act only inside this throwaway folder of the repo.
const SANDBOX_RE = /\/claude-plugins\/redirect-probe-sandbox\//

const textOf = (res: { content: Array<{ type: string; text?: string }> }) =>
  res.content.map(b => (b.type === 'text' ? (b.text ?? '') : '')).join('')

const inScope = (p: unknown) => typeof p !== 'string' || ROOT_RE.test(p)

export const register: Register = on => {
  // ---- Read -> codescout read_file ------------------------------------
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!SRC_RE.test(e.file_path)) return next(e)
    const args: Record<string, unknown> = { path: e.file_path }
    if (e.offset !== undefined) args.offset = e.offset
    if (e.limit !== undefined) args.limit = e.limit

    const res = await $.mcp.call(SERVER, 'read_file', args)
    if (res.isError) {
      $.ui.toast(`${$.plugin.name}: read_file failed, native Read goes on`)
      return next(e)
    }
    // codescout puts "N lines" (and, on a range read, one blank line) first.
    const ranged = e.offset !== undefined || e.limit !== undefined
    const text = textOf(res).replace(ranged ? /^\d+ lines?\n\n?/ : /^\d+ lines?\n/, '')
    const lines = text.split('\n').length
    $.ui.toast(`${$.plugin.name}: Read answered by codescout read_file`)
    return {
      result: {
        type: 'text',
        file: {
          filePath: e.file_path,
          content: text,
          numLines: lines,
          startLine: e.offset ?? 1,
          totalLines: lines,
        },
      },
      context: [
        `[codescout-redirect] Read answered by codescout read_file. ` +
          `An "@file_*" buffer reads only through read_file(path="@file_*", start_line, end_line). ` +
          `Use symbols(path) for an overview, symbols(name, include_body=true) for one body.`,
      ],
    }
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Read hook failed, native Read goes on`)
    return next(e)
  })

  // ---- Grep -> codescout grep -----------------------------------------
  on('tool.call', { tool: 'Grep' }, async ($, e, next) => {
    const a = e as unknown as Record<string, any>
    if (!inScope(a.path)) return next(e)
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
      $.ui.toast(`${$.plugin.name}: grep failed, native Grep goes on`)
      return next(e)
    }
    const text = textOf(res)
    $.ui.toast(`${$.plugin.name}: Grep answered by codescout grep`)
    return {
      result: {
        mode: 'content',
        numFiles: 0,
        filenames: [],
        content: text,
        numLines: text.split('\n').length,
      },
      context: [
        `[codescout-redirect] Grep answered by codescout grep(${JSON.stringify(args)}). ` +
          `For callers use references(symbol, path); for a concept use semantic_search(query).`,
      ],
    } as never
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Grep hook failed, native Grep goes on`)
    return next(e)
  })

  // ---- Glob -> codescout tree(glob) -----------------------------------
  on('tool.call', { tool: 'Glob' }, async ($, e, next) => {
    const a = e as unknown as Record<string, any>
    if (!inScope(a.path)) return next(e)
    const args: Record<string, unknown> = { glob: a.pattern }
    if (a.path) args.path = a.path

    const res = await $.mcp.call(SERVER, 'tree', args)
    if (res.isError) {
      $.ui.toast(`${$.plugin.name}: tree failed, native Glob goes on`)
      return next(e)
    }
    const text = textOf(res)
    const filenames = text
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !/^\d+ (files?|matches|entries)/.test(l) && !l.startsWith('['))
    $.ui.toast(`${$.plugin.name}: Glob answered by codescout tree`)
    return {
      result: {
        durationMs: 0,
        numFiles: filenames.length,
        filenames,
        truncated: false,
      },
      context: [
        `[codescout-redirect] Glob answered by codescout tree(${JSON.stringify(args)}). ` +
          `For a symbol use symbols(name=...).`,
      ],
    } as never
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Glob hook failed, native Glob goes on`)
    return next(e)
  })

  // ---- Write -> codescout create_file (sandbox only) -------------------
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!SANDBOX_RE.test(e.file_path)) return next(e)
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
      $.ui.toast(`${$.plugin.name}: create_file refused, native Write goes on`)
      return next(e)
    }
    $.ui.toast(`${$.plugin.name}: Write answered by codescout create_file`)
    return {
      result: {
        type: original === null ? 'create' : 'update',
        filePath: e.file_path,
        content: e.content,
        structuredPatch: [],
        originalFile: original,
      },
      context: [
        `[codescout-redirect] Write answered by codescout create_file. Reply: ${text.slice(0, 200)}`,
      ],
    }
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Write hook failed, native Write goes on`)
    return next(e)
  })

  // ---- Edit -> codescout edit_file (sandbox only) ----------------------
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!SANDBOX_RE.test(e.file_path)) return next(e)
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
      $.ui.toast(`${$.plugin.name}: edit_file refused, native Edit goes on`)
      return next(e)
    }
    const idx = original.indexOf(e.old_string)
    const oldStart = idx < 0 ? 1 : original.slice(0, idx).split('\n').length
    const oldLines = e.old_string.split('\n')
    const newLines = e.new_string.split('\n')
    $.ui.toast(`${$.plugin.name}: Edit answered by codescout edit_file`)
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
      context: [
        `[codescout-redirect] Edit answered by codescout edit_file. Reply: ${text.slice(0, 200)}`,
      ],
    }
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Edit hook failed, native Edit goes on`)
    return next(e)
  })

  // ---- Bash -> codescout run_command (read-only allowlist only) --------
  // One simple command, no chaining, redirection, pipes or substitution.
  const SAFE_BASH = /^(ls|pwd|echo|date|wc|git (status|log|diff|branch))(\s[^;&|<>`$\n]*)?$/
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.run_in_background || !SAFE_BASH.test(e.command.trim())) return next(e)
    const args: Record<string, unknown> = {
      command: e.command,
      timeout_secs: Math.ceil((e.timeout ?? 120000) / 1000),
      effect: 'read',
    }
    const res = await $.mcp.call(SERVER, 'run_command', args)
    const text = textOf(res)
    let out: Record<string, any> | null
    try {
      out = JSON.parse(text)
    } catch {
      out = null
    }
    if (res.isError || !out || typeof out.exit_code !== 'number' || /pending_ack/.test(text)) {
      $.ui.toast(`${$.plugin.name}: run_command gave no plain result, native Bash goes on`)
      return next(e)
    }
    const stdout = String(out.stdout ?? '')
    const stderr = String(out.stderr ?? '')
    if (out.exit_code !== 0) {
      // Native Bash reports a non-zero exit as an error result.
      return { deny: `Exit code ${out.exit_code}\n${stdout}${stderr}` }
    }
    $.ui.toast(`${$.plugin.name}: Bash answered by codescout run_command`)
    return {
      result: { stdout, stderr, interrupted: false },
      context: [
        out.output_id
          ? `[codescout-redirect] Bash output was long, so codescout buffered it as ${out.output_id}; stdout above is an excerpt. ` +
            `Query it with run_command(command="grep PATTERN ${out.output_id}") or "tail -20 ${out.output_id}".`
          : `[codescout-redirect] Bash answered by codescout run_command. ` +
            `Prefer run_command: its output is buffered (@cmd_*) and queryable.`,
      ],
    }
  }).catch(($, e, next) => {
    $.ui.toast(`${$.plugin.name}: Bash hook failed, native Bash goes on`)
    return next(e)
  })

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
