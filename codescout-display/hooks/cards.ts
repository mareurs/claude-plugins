// Pure module: reply parsing, folding and Card building. No `$`, no JSX.

export const HEAD_LINES = 12

const FIELD_LIMIT = 6
const VALUE_LIMIT = 40
const ARG_CUT = 80
// Control characters other than tab and newline: the engine refuses a tree that holds one.
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/g

export function stripControl(s: string): string {
  return s.replace(CTRL, '')
}

export type Reply = { text: string; notes: string[] }

// A codescout result is `[{ type: 'text', text }, ...]`. Block 0 is codescout's reply; the blocks
// after it are notes that hooks added. Anything else is not a reply.
export function replyOf(output: unknown): Reply | undefined {
  if (!Array.isArray(output)) return undefined
  const first = output[0] as { text?: unknown } | null | undefined
  if (typeof first?.text !== 'string') return undefined

  const texts: string[] = []
  for (const block of output) {
    const text = (block as { text?: unknown } | null)?.text
    if (typeof text === 'string') texts.push(stripControl(text))
  }

  return { text: texts[0], notes: texts.slice(1) }
}

// The argument that names what the call is about, for the card's header.
export function mainArg(input: unknown): string {
  if (typeof input !== 'object' || input === null) return ''
  const fields = input as Record<string, unknown>

  for (const key of ['path', 'pattern', 'name', 'command']) {
    const value = fields[key]
    if (typeof value === 'string' && value !== '') return stripControl(value).slice(0, ARG_CUT)
  }

  return ''
}

export type Fold = { head: string[]; hidden: number }

// A single trailing newline does not make a line.
export function fold(text: string, max: number = HEAD_LINES): Fold {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  return { head: lines.slice(0, max), hidden: Math.max(0, lines.length - max) }
}

// `status: ok · replaced: 1` for a reply that is a JSON object; nested values are skipped.
export function jsonFields(text: string): string | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

  const parts: string[] = []
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean') {
      parts.push(`${key}: ${String(field).slice(0, VALUE_LIMIT)}`)
      if (parts.length === FIELD_LIMIT) break
    }
  }

  return parts.length > 0 ? parts.join(' · ') : undefined
}
