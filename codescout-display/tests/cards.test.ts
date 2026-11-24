import { expect, test } from 'claude-code/testing'
import {
  FULL_CAP,
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

test('stripControl removes ANSI sequences and control characters, keeps tab and newline', () => {
  expect(stripControl('a\u001b[0m\u0000b\tc\nd')).toBe('ab\tc\nd')
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
  expect(card?.body.kind === 'text' && card.body.head[0]?.length).toBe(400)
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

// Task 5: `full` is what an opened card draws in place of its head.

test('read_file: full is the whole file body, without the header', () => {
  const card = buildCard(`${P}read_file`, { path: 'a.ts', start_line: 1 }, text(`30 lines\n\n${lines(30)}`))

  expect(card?.full).toBe(lines(30))
})

test('edit_file: full is the whole diff, not the 40-line head', () => {
  const big = lines(100)
  const card = buildCard(`${P}edit_file`, { path: 'a.ts', old_string: big, new_string: 'y' }, text('{"status":"ok"}'))

  expect(card?.full).toBe(diffOf(big, 'y'))
})

test('create_file: full is the whole content', () => {
  const card = buildCard(`${P}create_file`, { path: 'n.ts', content: lines(20) }, text('{"status":"ok"}'))

  expect(card?.full).toBe(lines(20))
})

test('a generic card: full is the reply text, cut at FULL_CAP characters', () => {
  const card = buildCard(`${P}grep`, { pattern: 'z' }, text('z'.repeat(150000)))

  expect(FULL_CAP).toBe(100000)
  expect(card?.full).toHaveLength(100000)
})

test('edit_file: control characters in the strings are stripped from the diff and the full diff', () => {
  const card = buildCard(`${P}edit_file`, { path: 'a.ts', old_string: 'a\u001b[0m', new_string: 'b\u0000' }, text('{"status":"ok"}'))

  expect(card?.body.kind === 'diff' && card.body.source.includes('\u001b')).toBe(false)
  expect(card?.full.includes('\u001b') || card?.full.includes('\u0000')).toBe(false)
})

test('create_file: control characters are stripped from the content', () => {
  const card = buildCard(`${P}create_file`, { path: 'n.ts', content: 'a\u001bb' }, text('{"status":"ok"}'))

  expect(card?.body.kind === 'code' && card.body.source).toBe('ab')
  expect(card?.full).toBe('ab')
})

// run_command: the card shows the command, up to COMMAND_LINES lines.

test('run_command: the command is shown in up to 5 lines and the rest is counted', () => {
  const card = buildCard(`${P}run_command`, { command: lines(7) }, text('{"exit_code":0}'))

  expect(card?.command).toMatchObject({ source: 'l1\nl2\nl3\nl4\nl5', extra: 2 })
  expect(card?.title).toBe('◆ run_command')
})

test('run_command: a 3-line command has nothing counted, a long line is cut at LINE_CUT', () => {
  expect(buildCard(`${P}run_command`, { command: lines(3) }, text('{"exit_code":0}'))?.command).toMatchObject({ source: 'l1\nl2\nl3', extra: 0 })
  expect(buildCard(`${P}run_command`, { command: 'x'.repeat(1000) }, text('{"exit_code":0}'))?.command?.source).toHaveLength(400)
})

test('run_command: control characters are stripped from the command', () => {
  expect(buildCard(`${P}run_command`, { command: 'ls\u001b[0m' }, text('{"exit_code":0}'))?.command?.source).toBe('ls')
})

test('run_command: the whole command is kept for the opened card', () => {
  expect(buildCard(`${P}run_command`, { command: lines(7) }, text('{"exit_code":0}'))?.command?.full).toBe(lines(7))
})

test('another tool has no command block', () => {
  expect(buildCard(`${P}tree`, { path: '.' }, text('a'))?.command).toBeUndefined()
})

// Fix pass after the whole-branch review.

test('an ok:false reply gives undefined, so the engine row draws the error in full', () => {
  const err = '{"ok":false,"error":"heading not found","hint":"call read_file(path) for the heading map"}'

  expect(buildCard(`${P}read_file`, { path: 'a.md' }, text(err))).toBeUndefined()
  expect(buildCard(`${P}edit_file`, { path: 'a.md', old_string: 'a', new_string: 'b' }, text(err))).toBeUndefined()
})

test('a fields card is openable when its line left something out, and not otherwise', () => {
  const card = (json: string) => buildCard(`${P}run_command`, { command: 'x' }, text(json))

  expect(card('{"exit_code":0}')?.openable).toBe(false)
  expect(card(JSON.stringify({ exit_code: 101, stderr: 'e'.repeat(60) }))?.openable).toBe(true)
  expect(card('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7}')?.openable).toBe(true)
  expect(card('{"a":{"b":1},"status":"ok"}')?.openable).toBe(true)
  expect(card('{"stderr":"line one\\nline two"}')?.openable).toBe(true)
})

test('openable also covers hidden lines, notes and a long command', () => {
  expect(buildCard(`${P}tree`, {}, text(lines(13)))?.openable).toBe(true)
  expect(buildCard(`${P}tree`, {}, text('a', 'a note'))?.openable).toBe(true)
  expect(buildCard(`${P}run_command`, { command: lines(6) }, text('{"exit_code":0}'))?.openable).toBe(true)
  expect(buildCard(`${P}tree`, {}, text('a\nb'))?.openable).toBe(false)
})

test('jsonFields: a decoded ANSI sequence is stripped and a value is cut at its first newline', () => {
  expect(jsonFields('{"k":"a\\u001b[31mb\\nsecond"}')).toBe('k: ab')
  expect(jsonFields('{"k":"x\\r"}')).toBe('k: x')
})

test('read_file: json_path, toml_key and heading replies get no gutter', () => {
  for (const extra of [{ json_path: '$.a' }, { toml_key: 'deps' }, { heading: '## A' }]) {
    const card = buildCard(`${P}read_file`, { path: 'a.json', ...extra }, text('8 lines\n\n[1, 2]'))

    expect(card?.body.kind === 'code' && card.body.startLine, JSON.stringify(extra)).toBeUndefined()
  }
})

test('read_file: the buffer trailer of a truncated reply is a note, not file lines', () => {
  const trailer = '\n\n  Buffer: @file_0b02\n  [2 of 1817 lines shown]\n  Next: read_file("x", start_line=3, end_line=9)'
  const card = buildCard(`${P}read_file`, { path: 'a.ts', start_line: 1 }, text(`1817 lines\n\nalpha\nbeta${trailer}`))

  expect(card?.body.kind === 'code' && card.body.source).toBe('alpha\nbeta')
  expect(card?.hidden).toBe(0)
  expect(card?.notes[0]).toContain('@file_0b02')
  expect(card?.notes[0]).toContain('[2 of 1817 lines shown]')
  expect(card?.full).toBe('alpha\nbeta')
})

test('an empty reply with no notes and no command gives undefined', () => {
  expect(buildCard(`${P}tree`, { path: '.' }, text(''))).toBeUndefined()
  expect(buildCard(`${P}tree`, { path: '.' }, text('  \n'))).toBeUndefined()
  expect(buildCard(`${P}tree`, { path: '.' }, text('', 'a note'))).toBeDefined()
})
