import type { Register } from 'claude-code'

// Throwaway headless probe (ES-17, cache and mid-turn). The file `.effort-probe` in the run's
// working directory holds a comma list of effort levels, one per `turn.step` index; an index past
// the end uses the last entry ("medium,medium,high" = medium for steps 0 and 1, high from step 2).
// No file, or an unknown word at an index, means "do not rewrite that step". Every step logs
// before and after to `.step-<index>-<agent>.json` in the working directory.
const FILE = '.effort-probe'
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Level = (typeof LEVELS)[number]

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    let want: Level | null = null
    try {
      if (await $.fs.exists(FILE)) {
        const list = (await $.fs.read(FILE)).trim().split(',').map(s => s.trim())
        const word = list[Math.min(e.index, list.length - 1)]
        want = (LEVELS as readonly string[]).includes(word) ? (word as Level) : null
      }
    } catch {
      // No file: control arm.
    }
    try {
      await $.fs.write(
        `.step-${e.index}-${e.agentId ?? 'main'}.json`,
        JSON.stringify({
          index: e.index,
          agentId: e.agentId ?? null,
          model: e.model,
          before: e.effort ?? null,
          rewrittenTo: want,
          messageCount: e.messageCount,
        }) + '\n',
      )
    } catch {
      // A probe must never break the request.
    }
    return yield* next(want === null ? e : { ...e, effort: want })
  })
}
