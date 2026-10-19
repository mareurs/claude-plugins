import type { Register } from 'claude-code'

// effort-toggle: the mod of the effort-toggle experiment (spec 2026-10-17-effort-toggle-design.md, "The mod").
//
// One config file, `${$.plugin.root}/config.json`, written by `writeHookCopy` once per batch (not by the stage step),
// picks the mode:
//   toggle    registers the set_effort tool; the model's last valid choice is the effort of every later main step.
//   placebo   registers the same tool and answers the same text, but rewrites no step (the tool does nothing).
//   random    registers the same tool and answers the same text; the effort of the main steps follows a seeded
//             two-state chain, independent of what the model asks (randomLevels below is that chain).
//   schedule  registers no tool; request number n asks schedule[min(n, length - 1)].
// Levels are exactly 'low' and 'xhigh'. A "request" is a request of the MAIN loop, counted across the whole session
// from 0 (turn.step's `index` is per turn and is not used). Subagent steps (agentId set) never advance the count and
// get the current main level, which is none until the first main step has chosen one.
//
// Log: one JSON line per event at config.logPath, the whole file rewritten after each line because $.fs.write has no
// append. A log failure never breaks a request or a tool answer. A missing or malformed config registers nothing,
// rewrites nothing and leaves one `error` line at FALLBACK_LOG.
//   { type: 'step', request: number | null, index, agentId: string | null, turnId, before, after }   index = the engine's
//       per-turn step index (it restarts every turn; `request` does not); before = the effort the step carried, after =
//       the effort the request carries (equal to before when not rewritten); null only if it had none
//   { type: 'call', request, agentId: string | null, level, reason, text }    text = the result text the tool answered
//   { type: 'invalid', request, agentId: string | null, input }    input without the reserved keys (tool, tool_use_id,
//       agentId, consent)
//   { type: 'error', message }
//
// This file is loaded by the engine AND imported by Node in mod.test.mjs, so it is erasable TypeScript only (type
// annotations and `import type`: no enums, namespaces or parameter properties). State lives in `register`'s closure.

export const TOOL_NAME = 'set_effort'
export const FULL_TOOL_NAME = 'mcp__effort-toggle__set_effort'
export const FALLBACK_LOG = '/run/state/effort-toggle/log.jsonl'
export const TOOL_DESCRIPTION =
  'You start at low reasoning effort. Call this tool to change your effort for your next steps. Reviewing and verifying your work need higher effort: switch to xhigh before you review a change or run your final checks. When you judge that low effort is enough for what comes next, switch back to low.'
export const INPUT_SCHEMA = {
  type: 'object',
  properties: { level: { type: 'string', enum: ['low', 'xhigh'] }, reason: { type: 'string' } },
  required: ['level', 'reason'],
}
const DENY_TEXT = 'set_effort needs level "low" or "xhigh" and a non-empty reason.'

type Level = 'low' | 'xhigh'
type RandomParams = { pUp: number; pDown: number; seed: number }
type ModConfig =
  | { mode: 'toggle' | 'placebo'; logPath: string }
  | { mode: 'schedule'; schedule: Level[]; logPath: string }
  | { mode: 'random'; random: RandomParams; logPath: string }

export function resultText(level: Level): string {
  return `Effort is now ${level}. It applies from your next step.`
}

// FNV-1a over the UTF-16 code units of `s`, as an unsigned 32-bit number.
function fnv1a32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// mulberry32: a 32-bit generator, a number in [0, 1) per call.
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The random mode's chain, one level per call: the first is 'low'; each later call draws one number u and switches
// low -> xhigh when u < pUp, xhigh -> low when u < pDown. The generator is seeded with seed ^ fnv1a32(turnId).
function levelChain(pUp: number, pDown: number, seed: number, turnId: string): () => Level {
  const rand = mulberry32(seed ^ fnv1a32(turnId))
  let cur: Level | null = null
  return () => {
    if (cur === null) {
      cur = 'low'
    } else {
      const u = rand()
      if (cur === 'low' && u < pUp) cur = 'xhigh'
      else if (cur === 'xhigh' && u < pDown) cur = 'low'
    }
    return cur
  }
}

// The levels of main requests 0 .. n - 1 of a random arm whose session began with turn `turnId`.
export function randomLevels(pUp: number, pDown: number, seed: number, turnId: string, n: number): Level[] {
  const next = levelChain(pUp, pDown, seed, turnId)
  const out: Level[] = []
  for (let i = 0; i < n; i += 1) out.push(next())
  return out
}

function isLevel(x: unknown): x is Level {
  return x === 'low' || x === 'xhigh'
}

function isProbability(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1
}

function parseConfig(text: string): ModConfig {
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`config.json is not JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('config.json is not an object')
  if (typeof raw.logPath !== 'string' || raw.logPath === '') throw new Error('config.json: logPath must be a non-empty string')
  const logPath: string = raw.logPath
  switch (raw.mode) {
    case 'toggle':
    case 'placebo':
      return { mode: raw.mode, logPath }
    case 'schedule': {
      const s = raw.schedule
      if (!Array.isArray(s) || s.length === 0 || !s.every(isLevel)) {
        throw new Error('config.json: schedule must be a non-empty list of "low" and "xhigh"')
      }
      return { mode: 'schedule', schedule: s.slice(), logPath }
    }
    case 'random': {
      const r = raw.random
      if (r === null || typeof r !== 'object' || !isProbability(r.pUp) || !isProbability(r.pDown) || !Number.isSafeInteger(r.seed)) {
        throw new Error('config.json: random needs pUp and pDown in [0, 1] and an integer seed')
      }
      return { mode: 'random', random: { pUp: r.pUp, pDown: r.pDown, seed: r.seed }, logPath }
    }
    default:
      throw new Error(`config.json: unknown mode ${JSON.stringify(raw.mode)}`)
  }
}

type FsWriter = { fs: { write: (path: string, text: string) => Promise<unknown> } }
type Sink = { path: string; lines: string[]; writing: Promise<void> }

// Appends a line and rewrites the file. Writes are serialised, and each writes every line so far, so a failed write is
// repaired by the next one and parallel callers lose no line. Never rejects. A top-level function, because the engine
// follows `$` only into functions declared at the top of this file.
function appendLog($: FsWriter, sink: Sink, line: object): Promise<void> {
  sink.lines.push(JSON.stringify(line))
  sink.writing = sink.writing
    .then(() => $.fs.write(sink.path, sink.lines.join('\n') + '\n'))
    .then(
      () => undefined,
      () => undefined,
    )
  return sink.writing
}

export const register: Register = on => {
  let cfg: ModConfig | null = null
  const sink: Sink = { path: FALLBACK_LOG, lines: [], writing: Promise.resolve() }
  let requests = 0 // main requests taken so far; the next main step is request number `requests`
  let mainLevel: Level | null = null // the level of the main loop now; null until one is chosen
  let chain: (() => Level) | null = null

  on('session.start', async ($, e, next) => {
    try {
      let text: string
      try {
        text = await $.fs.read(`${$.plugin.root}/config.json`)
      } catch (err) {
        throw new Error(`cannot read config.json: ${err instanceof Error ? err.message : String(err)}`)
      }
      const parsed = parseConfig(text)
      if (parsed.mode !== 'schedule') {
        try {
          await $.tool.register({ name: TOOL_NAME, description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA })
        } catch (err) {
          throw new Error(`tool.register failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      cfg = parsed
      sink.path = parsed.logPath
    } catch (err) {
      cfg = null
      await appendLog($, sink, { type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return next(e)
  })

  on('tool.call', { tool: FULL_TOOL_NAME }, async ($, e, next) => {
    if (cfg === null) return next(e)
    const { tool: _tool, tool_use_id: _id, agentId: rawAgent, consent: _consent, ...input } = e as Record<string, unknown>
    const agentId = typeof rawAgent === 'string' ? rawAgent : null
    const request = Math.max(requests - 1, 0) // the main request whose response made this call
    const { level, reason } = input
    if (!isLevel(level) || typeof reason !== 'string' || reason.trim() === '') {
      await appendLog($, sink, { type: 'invalid', request, agentId, input })
      return { deny: DENY_TEXT }
    }
    // Set before any await, so calls answered in one message apply in the order their hooks start: the last one wins.
    if (cfg.mode === 'toggle') mainLevel = level
    const text = resultText(level)
    await appendLog($, sink, { type: 'call', request, agentId, level, reason, text })
    return { result: text }
  })

  on('turn.step', async function* ($, e, next) {
    if (cfg === null) return yield* next(e)
    let request: number | null = null
    if (typeof e.agentId !== 'string') {
      request = requests
      requests += 1
      if (cfg.mode === 'schedule') {
        mainLevel = cfg.schedule[Math.min(request, cfg.schedule.length - 1)]
      } else if (cfg.mode === 'random') {
        chain ??= levelChain(cfg.random.pUp, cfg.random.pDown, cfg.random.seed, e.turnId)
        mainLevel = chain()
      }
    }
    const rewrite = mainLevel !== null && mainLevel !== e.effort
    const sent = rewrite ? { ...e, effort: mainLevel as Level } : e
    await appendLog($, sink, {
      type: 'step',
      request,
      index: e.index,
      agentId: typeof e.agentId === 'string' ? e.agentId : null,
      turnId: e.turnId,
      before: e.effort ?? null,
      after: sent.effort ?? null,
    })
    return yield* next(sent)
  })
}
