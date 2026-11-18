import type { Register } from 'claude-code'

// Throwaway positive control (ES-17, instrument check I2). The file `.model-probe` in the run's working
// directory holds `<index>:<model>`; from that step index on, the request names that model instead. A model
// switch must break the prompt cache (caches are per model), so a cache-miss detector that cannot see this
// switch cannot be trusted. No file means "do not rewrite". Every step logs before and after.
const FILE = '.model-probe'

export const register: Register = on => {
  on('turn.step', async function* ($, e, next) {
    let target: string | null = null
    try {
      if (await $.fs.exists(FILE)) {
        const [idx, model] = (await $.fs.read(FILE)).trim().split(':')
        if (model && e.index >= Number(idx)) target = model
      }
    } catch {
      // No file: no rewrite.
    }
    try {
      await $.fs.write(
        `.step-${e.index}-${e.agentId ?? 'main'}.json`,
        JSON.stringify({
          index: e.index,
          agentId: e.agentId ?? null,
          modelBefore: e.model,
          modelAfter: target ?? e.model,
          effort: e.effort ?? null,
          messageCount: e.messageCount,
        }) + '\n',
      )
    } catch {
      // A probe must never break the request.
    }
    return yield* next(target === null ? e : { ...e, model: target })
  })
}
