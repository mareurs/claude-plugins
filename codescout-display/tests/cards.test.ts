import { expect, test } from 'claude-code/testing'
import {
  HEAD_LINES,
  LINE_CUT,
  buildCard,
  diffOf,
  editApplied,
  fileBody,
  fold,
  jsonFields,
  mainArg,
  replyOf,
  stripControl,
} from '../hooks/cards'

const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join('\n')

test('HEAD_LINES is 12', () => {
  expect(HEAD_LINES).toBe(12)
})

test('fold: 12 lines have no hidden', () => {
  const f = fold(lines(12))

  expect(f.head).toHaveLength(12)
  expect(f.hidden).toBe(0)
})

test('fold: 13 lines hide 1', () => {
  const f = fold(lines(13))

  expect(f.head).toHaveLength(12)
  expect(f.hidden).toBe(1)
})

test('fold: a trailing newline is not a line', () => {
  expect(fold('a\nb\n')).toEqual({ head: ['a', 'b'], hidden: 0 })
})

test('fold: 5000 lines keep a 12-line head and hidden 4988', () => {
  const f = fold(lines(5000))

  expect(f.head).toHaveLength(12)
  expect(f.hidden).toBe(4988)
})

test('stripControl removes ESC and NUL, keeps tab and newline', () => {
  expect(stripControl('a\u001b[0m\u0000b\tc\nd')).toBe('a[0mb\tc\nd')
})

test('replyOf: [], a string, and a block with no text give undefined', () => {
  expect(replyOf([])).toBeUndefined()
  expect(replyOf('plain')).toBeUndefined()
  expect(replyOf([{ type: 'text' }])).toBeUndefined()
})

test('replyOf: block 1 is a note', () => {
  expect(
    replyOf([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'n' },
    ]),
  ).toEqual({ text: 'a', notes: ['n'] })
})

test('replyOf: control characters are stripped from the reply and the notes', () => {
  const r = replyOf([
    { type: 'text', text: '\u001b[31mred' },
    { type: 'text', text: 'n\u0000ote' },
  ])

  expect(r?.text.includes('\u001b')).toBe(false)
  expect(r?.notes[0]).toBe('note')
})

test('mainArg: path wins over command; empty input gives ""; 200 characters are cut at 80', () => {
  expect(mainArg({ command: 'ls', path: 'src' })).toBe('src')
  expect(mainArg({})).toBe('')
  expect(mainArg(undefined)).toBe('')
  expect(mainArg({ path: 'a'.repeat(200) })).toHaveLength(80)
})

test('jsonFields: {"status":"ok","replaced":1} gives "status: ok · replaced: 1"', () => {
  expect(jsonFields('{"status":"ok","replaced":1}')).toBe('status: ok · replaced: 1')
})

test('jsonFields: 7 scalar fields give 6', () => {
  expect(jsonFields('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}')).toBe('a: 1 · b: 2 · c: 3 · d: 4 · e: 5 · f: 6')
})

test('jsonFields: a 60-character value is cut at 40', () => {
  expect(jsonFields(JSON.stringify({ k: 'x'.repeat(60) }))).toBe(`k: ${'x'.repeat(40)}`)
})

test('jsonFields: an array, a bare string and plain text give undefined', () => {
  expect(jsonFields('[1,2]')).toBeUndefined()
  expect(jsonFields('"ok"')).toBeUndefined()
  expect(jsonFields('42 lines\n\nabc')).toBeUndefined()
})

test('jsonFields: nested values are skipped, and an object with no scalar gives undefined', () => {
  expect(jsonFields('{"a":{"b":1},"status":"ok"}')).toBe('status: ok')
  expect(jsonFields('{"a":{"b":1}}')).toBeUndefined()
})

const P = 'mcp__codescout__'
const text = (t: string, ...notes: string[]) => [t, ...notes].map(x => ({ type: 'text', text: x }))

test('read_file: header and blank line are stripped, gutter starts at start_line', () => {
  expect(fileBody('40 lines\n\nalpha\nbeta', { start_line: 7 })).toEqual({ lines: ['alpha', 'beta'], startLine: 7 })
})

test('read_file: a whole-file reply has the same header, so the same strip', () => {
  expect(fileBody('1 line\n\n{ "a": 1 }\n', {})).toEqual({ lines: ['{ "a": 1 }'], startLine: 1 })
})

test('read_file: an outline reply takes the generic text card', () => {
  const card = buildCard(`${P}read_file`, { path: 'a.rs' }, text('103 lines  @file_0ad5\n\n# Title  L1'))

  expect(fileBody('103 lines  @file_0ad5\n\n# Title  L1', {})).toBeUndefined()
  expect(card?.body.kind).toBe('text')
})

test('read_file: a .md path sets isMarkdown', () => {
  const card = buildCard(`${P}read_file`, { path: 'docs/a.md', start_line: 1 }, text('2 lines\n\n# A\nb'))

  expect(card?.body).toEqual({ kind: 'code', source: '# A\nb', path: 'docs/a.md', startLine: 1, isMarkdown: true })
})

test('read_file: a code reply shows the first 12 lines and counts the rest', () => {
  const body = Array.from({ length: 30 }, (_, i) => `row${i + 1}`).join('\n')
  const card = buildCard(`${P}read_file`, { path: 'a.ts', start_line: 1 }, text(`30 lines\n\n${body}`))

  expect(card?.hidden).toBe(18)
  expect(card?.body.kind === 'code' && card.body.source.split('\n')).toHaveLength(12)
})

test('edit_file: diffOf builds one hunk from two strings', () => {
  expect(diffOf('a\nb', 'c')).toBe('@@ -1,2 +1,1 @@\n-a\n-b\n+c')
})

test('edit_file: an applied edit gives a diff with the old and new lines', () => {
  const card = buildCard(`${P}edit_file`, { path: 'a.mjs', old_string: 'a', new_string: 'b' }, text('{"status":"ok"}'))

  expect(card?.body).toEqual({ kind: 'diff', source: '@@ -1,1 +1,1 @@\n-a\n+b', path: 'a.mjs' })
  expect(editApplied('"ok"')).toBe(true)
  expect(editApplied('{"status":"ok","replaced":1}')).toBe(true)
})

test('edit_file: a reply that is not ok takes the fields card, never a diff', () => {
  const input = { path: 'a.mjs', old_string: 'a', new_string: 'b' }

  expect(editApplied('{"status":"error"}')).toBe(false)
  expect(editApplied('not json')).toBe(false)
  expect(buildCard(`${P}edit_file`, input, text('{"status":"error","error":"no match"}'))?.body.kind).toBe('fields')
  expect(buildCard(`${P}edit_file`, input, text('plain refusal'))?.body.kind).toBe('text')
})

test('edit_file: no old_string, or an empty one, takes the generic card', () => {
  const ok = text('{"status":"ok"}')

  expect(buildCard(`${P}edit_file`, { path: 'a.md', heading: '## A', new_string: 'x' }, ok)?.body.kind).toBe('fields')
  expect(buildCard(`${P}edit_file`, { path: 'a.md', old_string: '', new_string: 'x' }, ok)?.body.kind).toBe('fields')
})

test('edit_file: a large edit keeps 40 lines of each side and counts the rest', () => {
  const big = Array.from({ length: 100 }, (_, i) => `x${i}`).join('\n')
  const card = buildCard(`${P}edit_file`, { path: 'a.ts', old_string: big, new_string: 'y' }, text('{"status":"ok"}'))

  expect(card?.hidden).toBe(60)
  expect(card?.body.kind === 'diff' && card.body.source.split('\n')).toHaveLength(1 + 40 + 1)
})

test('create_file: status ok shows the head of content', () => {
  const content = Array.from({ length: 20 }, (_, i) => `c${i + 1}`).join('\n')
  const card = buildCard(`${P}create_file`, { path: 'n.ts', content }, text('{"status":"ok","wrote_to":"/x"}'))

  expect(card?.hidden).toBe(8)
  expect(card?.body.kind === 'code' && card.body.source.split('\n')).toHaveLength(12)
})

test('a 100000-character reply: the card holds at most 12 head lines and hidden is exact', () => {
  const big = Array.from({ length: 1000 }, () => 'y'.repeat(99)).join('\n')
  const card = buildCard(`${P}grep`, { pattern: 'y' }, text(big))

  expect(card?.body.kind === 'text' && card.body.head).toHaveLength(12)
  expect(card?.hidden).toBe(988)
})

test('a single 100000-character line is cut so no head line exceeds 400 characters', () => {
  const card = buildCard(`${P}grep`, { pattern: 'y' }, text('y'.repeat(100000)))

  expect(LINE_CUT).toBe(400)
  expect(card?.body.kind === 'text' && card.body.head[0].length).toBe(400)
})

test('notes ride along: output with two blocks gives notes of length 1', () => {
  expect(buildCard(`${P}tree`, { path: '.' }, text('a\nb', 'a hook note'))?.notes).toEqual(['a hook note'])
})

test('the title names the tool without the prefix and the main argument; the full reply is kept', () => {
  const card = buildCard(`${P}tree`, { path: 'codescout-companion/hooks' }, text('a\nb'))

  expect(card?.title).toBe('◆ tree  codescout-companion/hooks')
  expect(card?.full).toBe('a\nb')
  expect(buildCard(`${P}tree`, {}, text('a'))?.title).toBe('◆ tree')
})

test('buildCard gives undefined when the output is not a reply', () => {
  expect(buildCard(`${P}tree`, {}, [])).toBeUndefined()
  expect(buildCard(`${P}tree`, {}, undefined)).toBeUndefined()
})

test('a JSON reply takes the fields card, a plain reply the text card', () => {
  expect(buildCard(`${P}run_command`, { command: 'ls' }, text('{"exit_code":0,"stdout":"a"}'))?.body).toEqual({
    kind: 'fields',
    line: 'exit_code: 0 · stdout: a',
  })
  expect(buildCard(`${P}tree`, {}, text('a\nb'))?.body).toEqual({ kind: 'text', head: ['a', 'b'] })
})
