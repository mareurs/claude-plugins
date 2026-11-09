import type { Register } from 'claude-code'

// The text a tool hook hands to the model is invisible to the user. This mod
// echoes each entry as a dim transcript row, so the user can see what the
// model was told. It only reads: it always returns what `next(e)` returned.

const CLIP = 400

const clip = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > CLIP ? `${flat.slice(0, CLIP)}… (${flat.length} chars)` : flat
}

export const register: Register = on => {
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    for (const text of result.additionalContext ?? []) {
      $.ui.log(`hook told the model after ${e.tool_name}: ${clip(text)}`)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.PostToolUseFailure', async ($, e, next) => {
    const result = await next(e)
    for (const text of result.additionalContext ?? []) {
      $.ui.log(`hook told the model after ${e.tool_name} failed: ${clip(text)}`)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('classic.PreToolUse', async ($, e, next) => {
    const result = await next(e)
    for (const text of result.additionalContext ?? []) {
      $.ui.log(`hook told the model before a tool call: ${clip(text)}`)
    }
    return result
  }).catch(($, e, next) => next(e))
}
