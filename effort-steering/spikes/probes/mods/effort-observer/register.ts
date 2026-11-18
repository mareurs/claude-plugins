import type { Register } from 'claude-code'

// Throwaway probe (ES-17). Question it answers: does `turn.step` fire in this build, per model
// request, and what do `effort`, `model`, `index` and `messageCount` hold on the main loop and in
// subagents? It only observes: every request is passed on unchanged (`return yield* next(e)`).
// One file per step, so two parallel steps (main and a subagent) never overwrite each other.
// Change DIR to any writable directory before use.
const DIR = '/tmp/effort-observer'

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    try {
      const at = await $.clock.now()
      const who = e.agentId ?? 'main'
      const line = JSON.stringify({
        at,
        turnId: e.turnId,
        index: e.index,
        agentId: e.agentId ?? null,
        model: e.model,
        effort: e.effort ?? null,
        messageCount: e.messageCount,
      })
      await $.fs.write(`${DIR}/${at}-${e.turnId}-${e.index}-${who}.json`, line + '\n')
    } catch {
      // A probe must never break the request.
    }
    return yield* next(e)
  })
}
