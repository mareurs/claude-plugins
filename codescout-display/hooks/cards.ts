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
function linesOf(text: string): string[] {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  return lines
}

function foldLines(lines: string[], max: number = HEAD_LINES): Fold {
  return { head: lines.slice(0, max), hidden: Math.max(0, lines.length - max) }
}

export function fold(text: string, max: number = HEAD_LINES): Fold {
  return foldLines(linesOf(text), max)
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

export const PREFIX = 'mcp__codescout__'
// No head line is longer than this: one very long line must not make a card slow or wide.
export const LINE_CUT = 400
// A diff keeps this many lines of each side. The rest is counted, not drawn.
const DIFF_SIDE = 40

export type FileBody = { lines: string[]; startLine: number }

// codescout writes `N lines` and one blank line before the content of a read_file reply (measured on a
// ranged and an unranged read). An outline of a large file is `N lines  @file_…` and is not content.
export function fileBody(text: string, input: unknown): FileBody | undefined {
  if (/^\d+ lines? +@file_/.test(text)) return undefined
  const header = text.match(/^\d+ lines?\n\n?/)
  if (!header) return undefined

  const fields = recordOf(input)
  const start = [fields.start_line, fields.offset].find(v => typeof v === 'number') as number | undefined

  return { lines: linesOf(text.slice(header[0].length)), startLine: start ?? 1 }
}

// One hunk: every old line as `-`, then every new line as `+`. The start line is unknown, so it is 1.
export function diffOf(oldText: string, newText: string): string {
  const a = oldText.split('\n')
  const b = newText.split('\n')

  return [`@@ -1,${a.length} +1,${b.length} @@`, ...a.map(l => `-${l}`), ...b.map(l => `+${l}`)].join('\n')
}

// codescout answers an applied edit with the string "ok" or an object with `status: "ok"`.
export function editApplied(text: string): boolean {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return false
  }

  return value === 'ok' || (typeof value === 'object' && value !== null && (value as { status?: unknown }).status === 'ok')
}

export type Card = {
  title: string
  body:
    | { kind: 'text'; head: string[] }
    | { kind: 'fields'; line: string }
    | { kind: 'code'; source: string; path?: string; startLine?: number; isMarkdown: boolean }
    | { kind: 'diff'; source: string; path: string }
  hidden: number
  notes: string[]
  full: string
}

function recordOf(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

const cut = (line: string): string => (line.length > LINE_CUT ? line.slice(0, LINE_CUT) : line)

// What to draw for one finished codescout call, or undefined to leave the engine's row.
export function buildCard(tool: string, input: unknown, output: unknown): Card | undefined {
  const reply = replyOf(output)
  if (!reply) return undefined

  const name = tool.startsWith(PREFIX) ? tool.slice(PREFIX.length) : tool
  const fields = recordOf(input)
  const path = typeof fields.path === 'string' ? stripControl(fields.path) : undefined
  const base = { title: `◆ ${name}  ${mainArg(input)}`.trimEnd(), notes: reply.notes, full: reply.text }

  if (name === 'read_file') {
    const file = fileBody(reply.text, input)
    if (file) {
      const f = foldLines(file.lines)
      const body = { kind: 'code' as const, source: f.head.map(cut).join('\n'), path, startLine: file.startLine, isMarkdown: /\.md$/i.test(path ?? '') }

      return { ...base, body, hidden: f.hidden }
    }
  }

  if (name === 'edit_file' && editApplied(reply.text) && typeof fields.old_string === 'string' && fields.old_string !== '' && typeof fields.new_string === 'string') {
    const a = fields.old_string.split('\n')
    const b = fields.new_string.split('\n')
    const hidden = Math.max(0, a.length - DIFF_SIDE) + Math.max(0, b.length - DIFF_SIDE)
    const source = diffOf(a.slice(0, DIFF_SIDE).map(cut).join('\n'), b.slice(0, DIFF_SIDE).map(cut).join('\n'))

    return { ...base, body: { kind: 'diff', source, path: path ?? '' }, hidden }
  }

  if (name === 'create_file' && editApplied(reply.text) && typeof fields.content === 'string') {
    const f = fold(fields.content)

    return { ...base, body: { kind: 'code', source: f.head.map(cut).join('\n'), path, isMarkdown: false }, hidden: f.hidden }
  }

  const summary = jsonFields(reply.text)
  if (summary !== undefined) return { ...base, body: { kind: 'fields', line: summary }, hidden: 0 }

  const f = fold(reply.text)

  return { ...base, body: { kind: 'text', head: f.head.map(cut) }, hidden: f.hidden }
}
