import type { Register } from 'claude-code'

// Throwaway headless probe (ES-17). Questions it answers: (1) does a mod load under
// `claude -p --setting-sources local --plugin-dir`, (2) does `next({ ...e, effort })` in a
// `turn.step` hook change the request's effort in the transcript, (3) what does that do to
// thinking_tokens. The wanted level comes from the file `.effort-probe` in the run's working
// directory (relative paths are under the session's cwd); no file, or an unknown word, means
// "do not rewrite" (the control arm). Each step logs before and after to `.step-<n>.json`.
const FILE = '.effort-probe'
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
type Level = (typeof LEVELS)[number]

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    let want: Level | null = null
    try {
      if (await $.fs.exists(FILE)) {
        const word = (await $.fs.read(FILE)).trim()
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
