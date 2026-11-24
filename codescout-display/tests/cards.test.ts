import { expect, test } from 'claude-code/testing'
import { HEAD_LINES, fold, jsonFields, mainArg, replyOf, stripControl } from '../hooks/cards'

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
