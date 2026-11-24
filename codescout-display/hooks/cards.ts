// Pure module: reply parsing, folding and Card building. No `$`, no JSX.

export const HEAD_LINES = 12

const FIELD_LIMIT = 6
const VALUE_LIMIT = 40
const ARG_CUT = 80
// Control characters other than tab and newline: the engine refuses a tree that holds one.
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/g
// A whole ANSI CSI sequence (colors, cursor moves): stripping the ESC alone would leave `[31m` on the screen.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g

export function stripControl(s: string): string {
  return s.replace(CSI, '').replace(CTRL, '')
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

  return { text: texts[0] ?? '', notes: texts.slice(1) }
}

// The argument that names what the call is about, for the card's header.
export function mainArg(input: unknown): string {
  const key = subjectKey(input)

  return key === undefined ? '' : stripControl(String(recordOf(input)[key])).slice(0, ARG_CUT)
}

// The keys that name what a call is about, in the order the header takes the first one that is set.
const SUBJECT_KEYS = ['topic', 'box', 'id', 'symbol', 'query', 'path', 'pattern', 'name', 'command']

function subjectKey(input: unknown): string | undefined {
  const fields = recordOf(input)

  return SUBJECT_KEYS.find(key => typeof fields[key] === 'string' && fields[key] !== '')
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

type Summary = { line: string; isCut: boolean }

// `status: ok · replaced: 1` for a reply that is a JSON object. `isCut` is true when the line left
// something out: a nested value, a field past the sixth, a value cut at VALUE_LIMIT or at its first newline.
function summarize(text: string): Summary | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined

  const parts: string[] = []
  let isCut = false
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== 'string' && typeof field !== 'number' && typeof field !== 'boolean') {
      isCut = true
      continue
    }
    if (parts.length === FIELD_LIMIT) {
      isCut = true
      continue
    }
    const raw = stripControl(String(field))
    const first = raw.split('\n')[0] ?? ''
    if (first.length < raw.length || first.length > VALUE_LIMIT) isCut = true
    parts.push(`${stripControl(key)}: ${first.slice(0, VALUE_LIMIT)}`)
  }

  return parts.length > 0 ? { line: parts.join(' · '), isCut } : undefined
}

export function jsonFields(text: string): string | undefined {
  return summarize(text)?.line
}

// codescout answers a recoverable error as a success result with the body {"ok": false, "error": …}.
function isFailure(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === 'object' && value !== null && !Array.isArray(value) && (value as { ok?: unknown }).ok === false
  } catch {
    return false
  }
}

export const PREFIX = 'mcp__codescout__'
// No head line is longer than this: one very long line must not make a card slow or wide.
export const LINE_CUT = 400
// A diff keeps this many lines of each side. The rest is counted, not drawn.
const DIFF_SIDE = 40
// A run_command card shows this many lines of the command.
export const COMMAND_LINES = 5
// An opened card draws at most this many characters: the limit of one `Code` element.
export const FULL_CAP = 100000

export type FileBody = { lines: string[]; startLine: number | undefined; trailer?: string }

// A reply cut by the output budget ends with the buffer footer; it is not file content.
const TRAILER = /\n\n  Buffer: (@file_\S+)\n  \[(\d+ of \d+ lines shown)\]\n  Next: ([^\n]*)\s*$/

// codescout writes `N lines` and one blank line before the content of a read_file reply (measured on a
// ranged and an unranged read). An outline of a large file is `N lines  @file_…` and is not content.
export function fileBody(text: string, input: unknown): FileBody | undefined {
  if (/^\d+ lines? +@file_/.test(text)) return undefined
  const header = text.match(/^\d+ lines?\n\n?/)
  if (!header) return undefined

  const fields = recordOf(input)
  const start = [fields.start_line, fields.offset].find(v => typeof v === 'number') as number | undefined
  // The lines of a json_path, toml_key or heading reply are not lines 1..N of the file: no gutter.
  const isSlice = fields.json_path !== undefined || fields.toml_key !== undefined || fields.heading !== undefined

  let body = text.slice(header[0].length)
  const trailer = body.match(TRAILER)
  if (trailer) body = body.slice(0, trailer.index)

  return {
    lines: linesOf(body),
    startLine: isSlice ? undefined : (start ?? 1),
    ...(trailer ? { trailer: `Buffer: ${trailer[1]} · [${trailer[2]}] · Next: ${trailer[3]}` } : {}),
  }
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

// The command of a run_command call, shown on the card: the first COMMAND_LINES lines, the count of the rest,
// and the whole command for an opened card.
export type CommandView = { source: string; extra: number; full: string }

export type Card = {
  title: string
  // The other parameters of the call as one dim line of key=value; "" when there are none.
  params: string
  // The verb of the call changes something (write, delete, update, …): the title draws in the warning color.
  isMutating: boolean
  // One line for the reply of a write whose body is the text that was written.
  result?: string
  body:
    | { kind: 'text'; head: string[] }
    | { kind: 'fields'; line: string }
    | { kind: 'code'; source: string; path?: string; startLine?: number; isMarkdown: boolean }
    | { kind: 'diff'; source: string; path: string }
  hidden: number
  notes: string[]
  full: string
  command?: CommandView
  // The line of a `fields` card left something out (see summarize).
  isCut: boolean
  // The card has something to open: hidden lines, notes, more command lines, or a cut fields line.
  openable: boolean
}

function recordOf(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
}

const cut = (line: string): string => (line.length > LINE_CUT ? line.slice(0, LINE_CUT) : line)
const cap = (text: string): string => (text.length > FULL_CAP ? text.slice(0, FULL_CAP) : text)

function commandOf(value: unknown): CommandView | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  const text = stripControl(value)
  const f = foldLines(linesOf(text), COMMAND_LINES)

  return { source: f.head.map(cut).join('\n'), extra: f.hidden, full: cap(text) }
}

// What to draw for one finished codescout call, or undefined to leave the engine's row.
// `full` is what an opened card draws in place of its head: the whole file body, the whole diff,
// the whole content, or the whole reply text, cut at FULL_CAP.
// The engine's row stays for a reply that is not a reply, an error codescout reported as a result
// ({"ok": false, …}: the engine shows it in full) and a blank reply.
export function buildCard(tool: string, input: unknown, output: unknown): Card | undefined {
  const card = draft(tool, input, output)
  if (!card) return undefined

  return { ...card, openable: card.hidden > 0 || card.notes.length > 0 || (card.command?.extra ?? 0) > 0 || card.isCut }
}

// Verbs that change something. The title of such a card draws in the warning color.
const MUTATING = new Set(['write', 'add', 'edit', 'drop', 'delete', 'close', 'now', 'create', 'update', 'move', 'append_entry', 'update_entry', 'event_create', 'register', 'build'])
// Parameters the header leaves out: the text of a write and the command show as the body, the rest is noise.
const NOT_PARAMS = new Set(['workspace', 'content', 'body', 'old_string', 'new_string', 'command'])
const MAX_PARAMS = 4
const PARAM_CUT = 40

function paramValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number') return String(value)
  if (value === true) return 'true'
  if (value === false || value === null || value === undefined) return undefined
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

// The header of a card: the tool, the verb (`action`, or `direction`), what it is about, and the other parameters.
// A run_command card shows its command in the body instead of the subject.
function headerOf(name: string, input: unknown, command: CommandView | undefined): { title: string; params: string; isMutating: boolean } {
  const fields = recordOf(input)
  const verbKey = ['action', 'direction'].find(key => typeof fields[key] === 'string' && fields[key] !== '')
  const verb = verbKey === undefined ? undefined : stripControl(String(fields[verbKey])).slice(0, 24)
  const subject = command ? '' : mainArg(input)
  const used = new Set([verbKey, subjectKey(input)])

  const shown: string[] = []
  for (const [key, raw] of Object.entries(fields)) {
    if (used.has(key) || NOT_PARAMS.has(key)) continue
    const value = paramValue(raw)
    if (value === undefined) continue
    const flat = stripControl(value).replace(/\s+/g, ' ')
    shown.push(`${stripControl(key)}=${flat.length > PARAM_CUT ? `${flat.slice(0, PARAM_CUT - 1)}…` : flat}`)
  }
  const rest = shown.length - MAX_PARAMS

  return {
    title: `◆ ${name}${verb ? ` · ${verb}` : ''}  ${subject}`.trimEnd(),
    params: shown.slice(0, MAX_PARAMS).join(' ') + (rest > 0 ? ` +${rest} more` : ''),
    isMutating: verb !== undefined && MUTATING.has(verb),
  }
}

// The text a memory or doc write carries. The reply of such a write is only a status, so the text is the body.
function writtenText(name: string, fields: Record<string, unknown>): string | undefined {
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined)
  if (name === 'memory' && ['write', 'add', 'now', 'close'].includes(String(fields.action))) return text(fields.content)
  if (name === 'doc' && ['create', 'append_entry'].includes(String(fields.action))) return text(fields.body)
  if (name === 'doc' && fields.action === 'update') return text(recordOf(fields.patch).body)

  return undefined
}

// One line for the reply of a write: `status: ok`. The project path codescout adds (`wrote_to`) is left out.
function resultOf(text: string): string | undefined {
  try {
    const value: unknown = JSON.parse(text)
    if (typeof value === 'string') return stripControl(value).slice(0, 120) || undefined
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const parts = Object.entries(value)
        .filter(([key, field]) => key !== 'wrote_to' && ['string', 'number', 'boolean'].includes(typeof field))
        .slice(0, FIELD_LIMIT)
        .map(([key, field]) => `${stripControl(key)}: ${(stripControl(String(field)).split('\n')[0] ?? '').slice(0, VALUE_LIMIT)}`)

      return parts.length > 0 ? parts.join(' · ') : undefined
    }
  } catch {
    // not JSON: its first line stands in
  }

  return stripControl(text).split('\n').find(line => line.trim() !== '')?.slice(0, 120)
}

// The frame of a call whose output does not exist yet: the header and the command are known from the input alone.
// Drawing it from the first render keeps the border where it is when the tool ends, so the row does not swap
// from the engine's row to a card. `input` may be empty (the first render of a call) or absent.
export function pendingCard(tool: string, input: unknown): Card {
  const name = tool.startsWith(PREFIX) ? tool.slice(PREFIX.length) : tool
  const command = name === 'run_command' ? commandOf(recordOf(input).command) : undefined

  return {
    ...headerOf(name, input, command),
    body: { kind: 'text', head: [] },
    hidden: 0,
    notes: [],
    full: '',
    isCut: false,
    openable: false,
    ...(command ? { command } : {}),
  }
}

function draft(tool: string, input: unknown, output: unknown): Omit<Card, 'openable'> | undefined {
  const reply = replyOf(output)
  if (!reply || isFailure(reply.text)) return undefined

  const name = tool.startsWith(PREFIX) ? tool.slice(PREFIX.length) : tool
  const fields = recordOf(input)
  const path = typeof fields.path === 'string' ? stripControl(fields.path) : undefined
  const command = name === 'run_command' ? commandOf(fields.command) : undefined
  const header = headerOf(name, input, command)
  if (reply.text.trim() === '' && reply.notes.length === 0 && !command) return undefined

  const base = { ...header, notes: reply.notes, full: cap(reply.text), isCut: false, ...(command ? { command } : {}) }

  if (name === 'read_file') {
    const file = fileBody(reply.text, input)
    if (file) {
      const f = foldLines(file.lines)
      const body = { kind: 'code' as const, source: f.head.map(cut).join('\n'), path, startLine: file.startLine, isMarkdown: /\.md$/i.test(path ?? '') }

      const notes = file.trailer ? [file.trailer, ...reply.notes] : reply.notes

      return { ...base, notes, body, hidden: f.hidden, full: cap(file.lines.join('\n')) }
    }
  }

  const hasDiff = typeof fields.old_string === 'string' && fields.old_string !== '' && typeof fields.new_string === 'string'
  if (hasDiff && ((name === 'edit_file' && editApplied(reply.text)) || (name === 'memory' && fields.action === 'edit'))) {
    const oldText = stripControl(String(fields.old_string))
    const newText = stripControl(String(fields.new_string))
    const a = oldText.split('\n')
    const b = newText.split('\n')
    const hidden = Math.max(0, a.length - DIFF_SIDE) + Math.max(0, b.length - DIFF_SIDE)
    const source = diffOf(a.slice(0, DIFF_SIDE).map(cut).join('\n'), b.slice(0, DIFF_SIDE).map(cut).join('\n'))
    const diffPath = path ?? (typeof fields.topic === 'string' ? `${stripControl(fields.topic)}.md` : '')

    return { ...base, body: { kind: 'diff', source, path: diffPath }, hidden, full: cap(diffOf(oldText, newText)) }
  }

  const written = writtenText(name, fields)
  if (written !== undefined) {
    const text = stripControl(written)
    const f = fold(text)
    const result = resultOf(reply.text)

    return {
      ...base,
      body: { kind: 'code', source: f.head.map(cut).join('\n'), isMarkdown: true },
      hidden: f.hidden,
      full: cap(text),
      ...(result !== undefined ? { result } : {}),
    }
  }

  if (name === 'create_file' && editApplied(reply.text) && typeof fields.content === 'string') {
    const content = stripControl(fields.content)
    const f = fold(content)

    return { ...base, body: { kind: 'code', source: f.head.map(cut).join('\n'), path, isMarkdown: false }, hidden: f.hidden, full: cap(content) }
  }

  const summary = summarize(reply.text)
  if (summary !== undefined) return { ...base, body: { kind: 'fields', line: summary.line }, hidden: 0, isCut: summary.isCut }

  const f = fold(reply.text)

  return { ...base, body: { kind: 'text', head: f.head.map(cut) }, hidden: f.hidden }
}
