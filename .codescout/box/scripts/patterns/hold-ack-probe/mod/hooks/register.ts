import type { Register } from 'claude-code'

// hold-ack-probe: a probe of "hold and ack" against "refuse and repeat" (2026-11-24, not shipped).
// config.json in the plugin root: { mode: 'repeat' | 'hold', logPath: string }.
//   repeat  the first `./boxw add` of the main agent is refused with the scribe text and its repeat exit; a repeat passes.
//   hold    the same call is held under a handle; the refusal says `ack` runs it as it is. The tool `ack` replays the held call.
// Only the exit differs between the arms. The match stands in for `codescout box <key> add`.
// Log: one JSON line per event, the whole file rewritten after each line ($.fs.write has no append).

const FULL_ACK = 'mcp__hold-ack-probe__ack'
const head = (tool: string) =>
  'A scribe fork can file this tracker edit while you keep working: ' +
  `${tool}(subagent_type="fork", prompt="Scribe: <what to file, which box>. Read get_guide('scribe').").` + ' '
const repeatText = (tool: string) => head(tool) + 'For a one-line note, repeat this call: it passes.'
const adviseText = (tool: string) =>
  'Filed. ' + head(tool) + 'Use it when you plan more than one edit.'
const holdText = (tool: string, handle: string) => head(tool) + `For a one-line note, run it as it is: ack(handle="${handle}").`

type Cfg = { mode: 'repeat' | 'hold' | 'advise'; logPath: string; forkTool: string }

type Sink = { path: string | null; lines: string[] }

async function log($: any, sink: Sink, rec: Record<string, unknown>) {
  if (sink.path === null) return
  try {
    sink.lines.push(JSON.stringify({ t: Date.now(), ...rec }))
    await $.fs.write(sink.path, sink.lines.join('\n') + '\n')
  } catch {
    // a log failure never breaks a call
  }
}

export const register: Register = on => {
  let cfg: Cfg | null = null
  const sink: Sink = { path: null, lines: [] }
  let refused = false
  let n = 0
  const held = new Map<string, string>()
  const released = new Set<string>()

  on('session.start', async ($, e, next) => {
    try {
      const parsed = JSON.parse(await $.fs.read(`${$.plugin.root}/config.json`))
      if (parsed.mode !== 'repeat' && parsed.mode !== 'hold' && parsed.mode !== 'advise') throw new Error('bad mode')
      cfg = { mode: parsed.mode, logPath: String(parsed.logPath), forkTool: String(parsed.forkTool || 'Agent') }
      sink.path = cfg.logPath
      if (cfg.mode === 'hold') {
        await $.tool.register({
          name: 'ack',
          description: 'Runs a call that a hook held, as it was. Give the handle from the refusal.',
          inputSchema: { type: 'object', properties: { handle: { type: 'string' } }, required: ['handle'] },
          isDeferred: false,
        })
      }
      await log($, sink, { type: 'start', mode: cfg.mode })
    } catch (err) {
      cfg = null
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (cfg === null) return next(e)
    const command = typeof (e as any).command === 'string' ? (e as any).command : ''
    if (released.delete(command)) return next(e) // the replay of a held call
    if (e.agentId || !command.includes('./boxw add')) return next(e)
    if (refused) {
      await log($, sink, { type: 'pass', bytes: command.length })
      return next(e)
    }
    refused = true
    if (cfg.mode === 'advise') {
      await log($, sink, { type: 'advise', bytes: command.length })
      const r: any = await next(e)
      if (r && r.result !== undefined) return { result: r.result, context: adviseText(cfg.forkTool) }
      return r
    }
    if (cfg.mode === 'repeat') {
      await log($, sink, { type: 'refuse', mode: 'repeat', bytes: command.length })
      return { deny: repeatText(cfg.forkTool) }
    }
    n += 1
    const handle = `h${n}`
    held.set(handle, command)
    await log($, sink, { type: 'hold', handle, bytes: command.length })
    return { deny: holdText(cfg.forkTool, handle) }
  })

  on('tool.call', { tool: FULL_ACK }, async ($, e, next) => {
    if (cfg === null) return next(e)
    const handle = String((e as any).handle ?? '')
    const command = held.get(handle)
    if (command === undefined) {
      await log($, sink, { type: 'ack-unknown', handle })
      return { deny: `No held call has the handle ${handle}.` }
    }
    held.delete(handle)
    released.add(command)
    try {
      const r: any = await $.tool.call({ tool: 'Bash', command })
      await log($, sink, { type: 'ack', handle, ok: r && r.deny === undefined, isError: r?.isError ?? null, text: String(r?.text ?? r?.deny ?? '').slice(0, 200) })
      if (r && typeof r.deny === 'string') return { deny: r.deny }
      return { result: String(r?.text ?? '') }
    } catch (err) {
      released.delete(command)
      await log($, sink, { type: 'ack-error', handle, message: err instanceof Error ? err.message : String(err) })
      return { deny: 'The held call could not run.' }
    }
  })
}
