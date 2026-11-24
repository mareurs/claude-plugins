import type { Register } from 'claude-code'

import { TOAST_MS, noticeToasts, peerToast } from './toasts'

// A message from another session reaches the model and leaves no mark on the screen. This mod shows a toast for each.
// It only reads: every hook returns what `next(e)` returned. A toast that throws falls to the `.catch` of its hook,
// which passes the delivery on (measured with the throwing-toast tests: the message arrives once, unchanged).

export const register: Register = on => {
  // A native peer message, before the engine queues it. A message for a subagent (`agentId` set) shows nothing.
  on('session.receive', { origin: { kind: 'peer' } }, ($, e, next) => {
    if (e.agentId === undefined) {
      const line = peerToast(e.text)
      if (line !== undefined) $.ui.toast(line, { timeoutMs: TOAST_MS })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // A session-bridge notice: hook text with a fixed closing sentence. It arrives at a prompt or at a tool call.
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    for (const entry of result.additionalContext ?? []) {
      for (const line of noticeToasts(entry)) $.ui.toast(line, { timeoutMs: TOAST_MS })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    for (const entry of result.additionalContext ?? []) {
      for (const line of noticeToasts(entry)) $.ui.toast(line, { timeoutMs: TOAST_MS })
    }
    return result
  }).catch(($, e, next) => next(e))
}
