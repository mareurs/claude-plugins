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
  pendingCard,
  replyOf,
  stripControl,
  tokenLevel,
  tokenParts,
  IN_HIGH,
  IN_MID,
  OUT_HIGH,
  OUT_MID,
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

  expect(FULL_CAP).toBe(20000)
  expect(card?.full).toHaveLength(20000)
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

// A card frame from the first render: the header (and the command) are known from the input alone.

test('a pending card has the title the finished card will have, and nothing else to draw', () => {
  const pending = pendingCard(`${P}read_file`, { path: 'src/a.ts' })
  const done = buildCard(`${P}read_file`, { path: 'src/a.ts' }, text('1 lines\n\nx'))

  expect(pending.title).toBe('◆ read_file  src/a.ts')
  expect(pending.title).toBe(done?.title)
  expect(pending.body).toEqual({ kind: 'text', head: [] })
  expect(pending.openable).toBe(false)
  expect(pending.hidden).toBe(0)
  expect(pending.notes).toEqual([])
})

test('a pending card for a call with no input yet is the bare tool name', () => {
  expect(pendingCard(`${P}tree`, {}).title).toBe('◆ tree')
  expect(pendingCard(`${P}tree`, undefined).title).toBe('◆ tree')
})

test('a pending run_command card carries the command view the finished card has', () => {
  const input = { command: 'l1\nl2\nl3\nl4\nl5\nl6\nl7' }
  const pending = pendingCard(`${P}run_command`, input)
  const done = buildCard(`${P}run_command`, input, text('{"exit_code":0}'))

  expect(pending.command).toEqual(done?.command)
  expect(pending.command?.extra).toBe(2)
  expect(pending.title).toBe('◆ run_command')
})

test('control characters in the input of a pending card are removed', () => {
  expect(pendingCard(`${P}read_file`, { path: 'a\u001b[31m\u0007b' }).title).toBe('◆ read_file  ab')
})

// Verbs, subjects and parameters in the header (2026-11-24): the card says what the call does.

const ok = text('{"status":"ok","wrote_to":"/home/x/repo"}')

test('mainArg finds the subject of a tool that has no path: topic, box, id, symbol, query', () => {
  expect(mainArg({ action: 'read', topic: 'architecture' })).toBe('architecture')
  expect(mainArg({ action: 'list', box: 'residuals' })).toBe('residuals')
  expect(mainArg({ action: 'get', id: 'cc8cb9e23ab5cc67' })).toBe('cc8cb9e23ab5cc67')
  expect(mainArg({ symbol: 'Config/load', path: 'src/a.rs' })).toBe('Config/load')
  expect(mainArg({ query: 'where is the guard' })).toBe('where is the guard')
  expect(mainArg({ pattern: 'x', path: 'src' })).toBe('src')
})

test('the title carries the verb of a tool with an action, and the subject after it', () => {
  const read = buildCard(`${P}memory`, { action: 'read', topic: 'architecture' }, text('# Architecture'))
  expect(read?.title).toBe('◆ memory · read  architecture')
  expect(read?.params).toBe('')
  expect(buildCard(`${P}doc`, { action: 'find', kind: 'tracker', status: 'open' }, text('{"rows":[]}'))?.title).toBe('◆ doc · find')
  expect(buildCard(`${P}call_graph`, { symbol: 'Config/load', path: 'src/a.rs', direction: 'callers' }, text('x'))?.title).toBe('◆ call_graph · callers  Config/load')
})

test('the other parameters are one dim line of key=value, without the subject, the verb or noise', () => {
  const card = buildCard(
    `${P}doc`,
    { action: 'find', kind: 'tracker', status: 'open', workspace: '/w', force: false, include_archived: true, empty: '' },
    text('x'),
  )
  expect(card?.params).toBe('kind=tracker status=open include_archived=true')

  const graph = buildCard(`${P}call_graph`, { symbol: 'Config/load', path: 'src/a.rs', direction: 'callees', max_depth: 3 }, text('x'))
  expect(graph?.params).toBe('path=src/a.rs max_depth=3')
})

test('parameters: at most 4, then "+N more"; a value is cut at 40; an object is compact JSON; control characters are removed', () => {
  const many = buildCard(`${P}doc`, { action: 'find', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }, text('x'))
  expect(many?.params).toBe('a=1 b=2 c=3 d=4 +2 more')

  const long = buildCard(`${P}doc`, { action: 'find', topic: 't', note: 'n'.repeat(60) }, text('x'))
  expect(long?.params).toBe(`note=${'n'.repeat(39)}…`)

  const obj = buildCard(`${P}doc`, { action: 'find', filter: { kind: { eq: 'spec' } } }, text('x'))
  expect(obj?.params).toBe('filter={"kind":{"eq":"spec"}}')

  const ctl = buildCard(`${P}doc`, { action: 'find', kind: 'a\u001b[31m\u0007b' }, text('x'))
  expect(ctl?.params).toBe('kind=ab')
})

test('the content of a write, the old and new string and the command are not parameters', () => {
  const card = buildCard(`${P}memory`, { action: 'write', topic: 't', content: 'c', private: true }, ok)
  expect(card?.params).toBe('private=true')
  expect(buildCard(`${P}run_command`, { command: 'ls', timeout_secs: 300 }, text('{"exit_code":0}'))?.params).toBe('timeout_secs=300')
})

test('a verb that changes something marks the card; a read does not', () => {
  const m = (action: string) => buildCard(`${P}memory`, { action, topic: 't' }, ok)?.isMutating
  for (const verb of ['write', 'add', 'edit', 'delete', 'drop', 'now', 'close']) expect(m(verb)).toBe(true)
  for (const verb of ['read', 'list', 'reviewed']) expect(m(verb)).toBe(false)
  expect(buildCard(`${P}doc`, { action: 'update', id: 'x' }, ok)?.isMutating).toBe(true)
  expect(buildCard(`${P}doc`, { action: 'find' }, text('x'))?.isMutating).toBe(false)
  expect(buildCard(`${P}grep`, { pattern: 'x' }, text('x'))?.isMutating).toBe(false)
})

test('a memory write draws the content as markdown, folded, and the result as one line', () => {
  const content = ['# Title', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n')
  const card = buildCard(`${P}memory`, { action: 'write', topic: 'scratch', content }, ok)

  expect(card?.title).toBe('◆ memory · write  scratch')
  expect(card?.body.kind).toBe('code')
  expect(card?.body.kind === 'code' && card.body.isMarkdown).toBe(true)
  expect(card?.body.kind === 'code' && card.body.source.split('\n')).toHaveLength(12)
  expect(card?.hidden).toBe(9)
  expect(card?.full).toBe(content)
  expect(card?.result).toBe('status: ok')
  expect(card?.openable).toBe(true)
})

test('a memory edit draws a diff, like edit_file', () => {
  const card = buildCard(`${P}memory`, { action: 'edit', topic: 'gotchas', subject: 'Locks', old_string: 'old', new_string: 'new' }, ok)

  expect(card?.body.kind).toBe('diff')
  expect(card?.body.kind === 'diff' && card.body.source).toBe(diffOf('old', 'new'))
  expect(card?.params).toBe('subject=Locks')
})

test('memory add, now and close draw the content; a write with no content text draws the reply', () => {
  for (const action of ['add', 'now', 'close']) {
    const card = buildCard(`${P}memory`, { action, topic: 't', content: 'some text' }, ok)
    expect(card?.body.kind === 'code' && card.body.source).toBe('some text')
  }
  const none = buildCard(`${P}memory`, { action: 'write', topic: 't' }, ok)
  expect(none?.body.kind).toBe('fields')
  expect(none?.result).toBeUndefined()
})

test('doc create and append_entry draw their body as markdown; doc update draws patch.body', () => {
  expect(buildCard(`${P}doc`, { action: 'create', title: 'T', body: '# T\n\ntext' }, ok)?.full).toBe('# T\n\ntext')
  const entry = buildCard(`${P}doc`, { action: 'append_entry', id: 'x', title: 'E', body: 'entry text' }, ok)
  expect(entry?.body.kind === 'code' && entry.body.isMarkdown).toBe(true)
  const update = buildCard(`${P}doc`, { action: 'update', id: 'x', patch: { body: 'new body' } }, ok)
  expect(update?.body.kind === 'code' && update.body.source).toBe('new body')
  expect(update?.params).toBe('patch={"body":"new body"}')
})

test('a write that codescout refused keeps the engine row', () => {
  expect(buildCard(`${P}memory`, { action: 'write', topic: 't', content: 'x' }, text('{"ok":false,"error":"shrink guard"}'))).toBeUndefined()
})

test('a pending card has the verb, the subject, the parameters and the mutating mark of the finished card', () => {
  const input = { action: 'write', topic: 'scratch', content: 'x', private: true }
  const pending = pendingCard(`${P}memory`, input)
  const done = buildCard(`${P}memory`, input, ok)

  expect(pending.title).toBe('◆ memory · write  scratch')
  expect(pending.params).toBe('private=true')
  expect(pending.isMutating).toBe(true)
  expect(pending.title).toBe(done?.title)
  expect(pending.params).toBe(done?.params)
})

// ---- symbols ----------------------------------------------------------------------------------

const BODIES = [
  'codescout-display/hooks/cards.ts (2)',
  '  Function  134-153  fileBody',
  '      // a comment',
  '      export function fileBody() {',
  '        return 1',
  '      }',
  '  Variable  127  FileBody',
  '      export type FileBody = { a: 1 }',
  '',
].join('\n')

const OUTLINE = [
  'codescout-display/hooks/register.tsx — 5 symbols',
  '',
  '  Constant   ACCENT     L7',
  '  Function   drawCard   L18-79',
  '       Constant  body      L22',
  '',
].join('\n')

const sym = (text: string, input: Record<string, unknown> = { path: 'codescout-display/hooks/cards.ts', include_body: true }) =>
  buildCard('mcp__codescout__symbols', input, [{ type: 'text', text }])

test('symbols with bodies: a label per symbol, then its body as code with the path of its group and no gutter', () => {
  const card = sym(BODIES)

  expect(card?.body.kind).toBe('symbols')
  const rows = (card?.body as any).all
  expect(rows[0]).toEqual({ type: 'file', path: 'codescout-display/hooks/cards.ts' })
  expect(rows[1]).toEqual({ type: 'label', kind: 'Function', name: 'fileBody', range: '134-153', indent: 0 })
  expect(rows[2]).toEqual({
    type: 'code',
    path: 'codescout-display/hooks/cards.ts',
    source: '// a comment\nexport function fileBody() {\n  return 1\n}',
  })
  expect(rows[3]).toMatchObject({ type: 'label', kind: 'Variable', name: 'FileBody', range: '127' })
  expect(rows[4]).toMatchObject({ type: 'code', source: 'export type FileBody = { a: 1 }' })
  expect(rows.some((r: any) => r.startLine !== undefined)).toBe(false)
})

test('symbols outline: one label row per symbol, a child keeps its indent, no code', () => {
  const rows = (sym(OUTLINE, { path: 'codescout-display/hooks/register.tsx' })?.body as any).all

  expect(rows[0]).toEqual({ type: 'file', path: 'codescout-display/hooks/register.tsx' })
  expect(rows[1]).toEqual({ type: 'label', kind: 'Constant', name: 'ACCENT', range: '7', indent: 0 })
  expect(rows[2]).toEqual({ type: 'label', kind: 'Function', name: 'drawCard', range: '18-79', indent: 0 })
  expect(rows[3]).toEqual({ type: 'label', kind: 'Constant', name: 'body', range: '22', indent: 5 })
  expect(rows.some((r: any) => r.type === 'code')).toBe(false)
})

test('symbols: a large outline arrives as JSON; the card draws its summary and keeps the hint as a note', () => {
  const json = JSON.stringify({ output_id: '@tool_1', summary: OUTLINE, hint: 'read_file("@tool_1", …)', buffered_bytes: 9 })
  const card = sym(json, { path: 'codescout-display/hooks/register.tsx' })

  expect(card?.body.kind).toBe('symbols')
  expect((card?.body as any).all[2]).toMatchObject({ type: 'label', name: 'drawCard' })
  expect(card?.notes).toContain('read_file("@tool_1", …)')
})

test('symbols: a line that is neither a file line nor a symbol line is kept as a note row', () => {
  const rows = (sym(['a.ts — 9 symbols', '  … showing 2 of 9', '  Function   f   L1'].join('\n'), { path: 'a.ts' })?.body as any).all

  expect(rows[1]).toEqual({ type: 'note', text: '… showing 2 of 9' })
  expect(rows[2]).toMatchObject({ type: 'label', name: 'f' })
})

test('symbols: a reply that holds no symbol line keeps the generic card', () => {
  expect(sym('nothing found')?.body.kind).toBe('text')
  expect(sym('{"error":"x"}')?.body.kind).toBe('fields')
})

test('symbols: 12 lines are shown over labels and bodies together, the rest is counted, and open draws all', () => {
  const body = Array.from({ length: 20 }, (_, i) => `      line${i + 1}`).join('\n')
  const card = sym(`a.ts (1)\n  Function  1-20  big\n${body}\n`, { path: 'a.ts' })
  const b = card?.body as any
  const shown = b.head.reduce((n: number, r: any) => n + (r.type === 'code' ? r.source.split('\n').length : 1), 0)

  expect(shown).toBe(HEAD_LINES)
  expect(card?.hidden).toBe(22 - HEAD_LINES)
  expect(card?.openable).toBe(true)
  expect(b.all[2].source.split('\n')).toHaveLength(20)
})

test('symbols: the language of a body comes from the file line of its group, not from input.path (a directory or a glob)', () => {
  const rows = (sym(BODIES, { path: 'codescout-display/', include_body: true })?.body as any).all

  expect(rows.find((r: any) => r.type === 'code').path).toBe('codescout-display/hooks/cards.ts')
})

// ---- tokens -----------------------------------------------------------------------------------

test('tokenParts: plain below 1000, one decimal to 10k, whole thousands above', () => {
  expect(tokenParts({ input: 3, output: 12 })).toEqual({ input: 'in ~3', output: 'out ~12' })
  expect(tokenParts({ input: 999, output: 1000 })).toEqual({ input: 'in ~999', output: 'out ~1k' })
  expect(tokenParts({ input: 1234, output: 9949 })).toEqual({ input: 'in ~1.2k', output: 'out ~9.9k' })
  expect(tokenParts({ input: 10400, output: 125000 })).toEqual({ input: 'in ~10k', output: 'out ~125k' })
})

test('a card carries an estimate of the tokens of the call and of everything the model read back, notes included', () => {
  const input = { path: 'a' }
  const out = [{ type: 'text', text: 'x'.repeat(40) }, { type: 'text', text: 'y'.repeat(40) }]
  const card = buildCard('mcp__codescout__tree', input, out)

  expect(card?.tokens).toEqual({ input: Math.ceil(JSON.stringify(input).length / 4), output: 20 })
})

test('the output estimate counts the whole reply, not the folded head', () => {
  const card = buildCard('mcp__codescout__tree', {}, [{ type: 'text', text: 'z'.repeat(4000) }])

  expect(card?.tokens?.output).toBe(1000)
})

test('a pending card has no token estimate', () => {
  expect(pendingCard('mcp__codescout__tree', { path: '.' }).tokens).toBeUndefined()
})

test('the token limits are ordered, and a call is judged smaller than a reply', () => {
  expect(IN_MID).toBeGreaterThan(0)
  expect(IN_HIGH).toBeGreaterThan(IN_MID)
  expect(OUT_MID).toBeGreaterThan(0)
  expect(OUT_HIGH).toBeGreaterThan(OUT_MID)
  expect(IN_MID).toBeLessThan(OUT_MID)
  expect(IN_HIGH).toBeLessThan(OUT_HIGH)
})

test('tokenLevel output: low below OUT_MID, mid from OUT_MID, high from OUT_HIGH', () => {
  expect(tokenLevel('output', OUT_MID - 1)).toBe('low')
  expect(tokenLevel('output', OUT_MID)).toBe('mid')
  expect(tokenLevel('output', OUT_HIGH - 1)).toBe('mid')
  expect(tokenLevel('output', OUT_HIGH)).toBe('high')
})

test('tokenLevel input: low below IN_MID, mid from IN_MID, high from IN_HIGH', () => {
  expect(tokenLevel('input', IN_MID - 1)).toBe('low')
  expect(tokenLevel('input', IN_MID)).toBe('mid')
  expect(tokenLevel('input', IN_HIGH - 1)).toBe('mid')
  expect(tokenLevel('input', IN_HIGH)).toBe('high')
})

test('the same number of tokens is a different level on each side', () => {
  expect(tokenLevel('input', IN_HIGH)).toBe('high')
  expect(tokenLevel('output', IN_HIGH)).toBe('low')
})

// ---- latency ----------------------------------------------------------------------------------
// The card is built in the render path of the terminal, so its cost is paid on every repaint of a row.
// Measured 2026-11-24 (node 22, one core): 0.05 to 0.6 ms for 100,000 characters, under 2 ms for 400,000.
// The budget is 40 times that: it catches a pass that grows with the square of the reply, not a slow machine.

const BUDGET_MS = 25
const BENCHMARK_CHARS = 100000

const bulk = (chars: number, make: (i: number) => string): string => {
  const out: string[] = []
  for (let n = 0, i = 0; n < chars; i++) {
    const line = make(i)
    out.push(line)
    n += line.length + 1
  }

  return (out.join('\n') + '\n').slice(0, chars)
}

const code = (i: number) => `  const value${i} = compute(${i}, 'some text that looks like code', [1, 2, 3]) // note ${i}`
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!

for (const [name, tool, input, text] of [
  ['read_file', 'read_file', { path: 'a.ts' }, `2000 lines\n\n${bulk(BENCHMARK_CHARS, code)}`],
  ['grep', 'grep', { pattern: 'x' }, bulk(BENCHMARK_CHARS, code)],
  ['symbols with bodies', 'symbols', { path: 'a.ts', include_body: true }, `a.ts (1)\n  Function  1-9  big\n${bulk(BENCHMARK_CHARS, i => `      ${code(i)}`)}`],
  ['a JSON reply', 'run_command', { command: 'ls' }, JSON.stringify({ stdout: bulk(BENCHMARK_CHARS, code), exit_code: 0 })],
] as const) {
  test(`latency: a card for ${name} of ${BENCHMARK_CHARS} characters builds in under ${BUDGET_MS} ms`, () => {
    const output = [{ type: 'text', text }]
    buildCard(`mcp__codescout__${tool}`, input, output)
    const times = Array.from({ length: 9 }, () => {
      const start = performance.now()
      buildCard(`mcp__codescout__${tool}`, input, output)

      return performance.now() - start
    })

    expect(median(times)).toBeLessThan(BUDGET_MS)
  })
}

test('box list renders titles in pending and finished cards and opens the original output', () => {
  const input = { command: 'codescout box bugs list --status open' }
  const stdout = '2026-11-26-sample  open  low  Sample bug\n1 live of 2 entries; 1 terminal and 0 archived are not shown (--all)\n'
  const card = buildCard(P + 'run_command', input, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(pendingCard(P + 'run_command', input).title).toBe('◆ box · list  bugs')
  expect(card?.title).toBe('◆ box · list  bugs')
  expect(card?.command).toBeUndefined()
  expect(card?.body).toEqual({ kind: 'text', head: ['Sample bug  ·  open · low'] })
  expect(card?.result).toContain('1 live of 2 entries')
  expect(card?.full).toBe(stdout)
  expect(card?.openable).toBe(true)
})

test('box find shows JSON matches and preserves a quoted query', () => {
  const input = { command: '/opt/bin/codescout box --json bugs find "settings | profiles"' }
  const stdout = JSON.stringify({ shown: true, searched: 3, hits: [{ title: 'Profile settings', status: 'open', line: 16, match: 'A marker file' }] })
  const card = buildCard(P + 'run_command', input, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(card?.title).toBe('◆ box · find  bugs')
  expect(card?.params).toContain('settings | profiles')
  expect(card?.body).toEqual({ kind: 'text', head: ['Profile settings  ·  open', '  L16: A marker file'] })
  expect(card?.result).toBe('1 match · 3 searched')
})

test('box root shows its directory and a custom verb displays stdout', () => {
  const card = (command: string, stdout: string) => buildCard(P + 'run_command', { command }, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(card('codescout box', 'core: list\nruntime (ledger): 8 of 18 hot\nboxes:\n  bugs (ledger) 3 hot\n  runtime (box) 2 collections\n    recon (stream) 1 hot\nverbs: list\nstate: main\n')?.body).toEqual({
    kind: 'text', head: ['  bugs (ledger) 3 hot', '  runtime (box) 2 collections', '    recon (stream) 1 hot'],
  })
  expect(card('codescout box frictions recent', 'Recent friction\n')?.body).toEqual({ kind: 'text', head: ['Recent friction'] })
  expect(pendingCard(P + 'run_command', { command: 'codescout box frictions recent' }).title).toBe('◆ box · recent  frictions')
  expect(pendingCard(P + 'run_command', { command: 'codescout box bugs list | head' }).title).toBe('◆ box · list  bugs')
})

test('a box failure keeps the box title and displays the exit code and error', () => {
  const card = buildCard(P + 'run_command', { command: 'codescout box bugs close missing' }, text(JSON.stringify({ exit_code: 2, stderr: 'NOT DONE — no such entry\n' })))
  expect(card?.title).toBe('◆ box · close  bugs')
  expect(card?.isMutating).toBe(true)
  expect(card?.result).toBe('Exit 2')
  expect(card?.body).toEqual({ kind: 'text', head: ['NOT DONE — no such entry'] })
})

test('a global box search shows the source collection and match excerpt', () => {
  const stdout = 'bugs  2026-11-26-sample  open  A  sample title\n  L16: marker file\n1 of 49 live entries of 8 boxes hold "marker file"\n'
  const card = buildCard(P + 'run_command', { command: 'codescout box find "marker file"' }, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(card?.body).toEqual({ kind: 'text', head: ['A  sample title  ·  open · bugs', '  L16: marker file'] })
  expect(card?.result).toContain('1 of 49 live entries')
})

test('box show puts the title, status and current section first and keeps the path on open', () => {
  const stdout = '2026-11-26-sample  [open since 2026-11-26]  bug\nSample bug\npath: docs/boxes/bugs/sample.md\n\n## Now\nWaiting on a run.\n'
  const card = buildCard(P + 'run_command', { command: 'codescout box bugs show 2026-11-26-sample' }, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(card?.body).toEqual({ kind: 'text', head: ['Sample bug  ·  open since 2026-11-26 · bug', '', '## Now', 'Waiting on a run.'] })
  expect(card?.full).toBe(stdout)
  expect(card?.openable).toBe(true)
})

test('a box call inside cd, assignment and output filters gets its own preview', () => {
  const input = { command: 'cd /repo && K=$(git rev-parse HEAD); codescout box frictions show "$K" --full 2>&1 | grep -v INFO | cut -c1-1500' }
  const stdout = 'sample  [open since 2026-11-26]  friction\nA friction\npath: docs/sample.md\n\n## Now\nStill open.\n'
  const output = { exit_code: 0, producer_exit_code: 0, stdout, unfiltered_output: '@cmd_original' }
  const card = buildCard(P + 'run_command', input, text(JSON.stringify(output)))
  expect(pendingCard(P + 'run_command', input).title).toBe('◆ box · show  frictions')
  expect(card?.body).toEqual({ kind: 'text', head: ['A friction  ·  open since 2026-11-26 · friction', '', '## Now', 'Still open.'] })
  expect(card?.full).toContain('@cmd_original')
})

test('a batch names both box operations and preserves the shared output', () => {
  const input = { command: 'codescout box 2>&1 | grep -v INFO; echo ---; codescout box check 2>&1 | head -30' }
  const stdout = 'boxes:\n  bugs (ledger) 3 hot\n---\ncheck: clean\n'
  const card = buildCard(P + 'run_command', input, text(JSON.stringify({ exit_code: 0, stdout })))
  expect(pendingCard(P + 'run_command', input).title).toBe('◆ box · batch  open · check')
  expect(card?.title).toBe('◆ box · batch  open · check')
  expect(card?.body).toEqual({ kind: 'text', head: ['boxes:', '  bugs (ledger) 3 hot', '---', 'check: clean'] })
})

test('box writes with heredocs show the invocation, ignoring shell-shaped data', () => {
  const input = { command: "cd /repo && codescout box bugs add --title 'A bug' --text body - <<'BODY'\n; codescout box fake list\nBODY" }
  expect(pendingCard(P + 'run_command', input).title).toBe('◆ box · add  bugs')
  expect(pendingCard(P + 'run_command', { command: "cat <<'BODY'\n; codescout box fake list\nBODY" }).title).toBe('◆ run_command')
  expect(pendingCard(P + 'run_command', { command: "printf '%s' 'echo hi; codescout box bugs list' # codescout box bugs find" }).title).toBe('◆ run_command')
  expect(pendingCard(P + 'run_command', { command: "cat <<'BODY' | codescout box bugs add --text body -\ntext\nBODY" }).title).toBe('◆ box · add  bugs')
})

test('a filter does not conceal a failed box producer', () => {
  const input = { command: 'codescout box bugs list 2>&1 | head' }
  const output = { exit_code: 0, producer_exit_code: 2, stdout: 'NOT SHOWN — missing\n' }
  const card = buildCard(P + 'run_command', input, text(JSON.stringify(output)))
  expect(card?.title).toBe('◆ box · list  bugs')
  expect(card?.result).toBe('Exit 2')
})

test('semantic search shows a query, ranked source locations and snippets', () => {
  const input = { query: 'Where is the card built?', mode: 'full' }
  const reply = { results: [
    { file_path: 'hooks/cards.ts', start_line: 367, end_line: 372, source: 'stack', content: '\nexport function buildCard() {\n  const card = draft()\n  return card\n}' },
    { file_path: 'README.md', start_line: 8, end_line: 15, score: 0.92, content: 'Display documentation' },
  ], total: 2, truncated: true }
  const raw = JSON.stringify(reply)
  const card = buildCard(P + 'semantic_search', input, text(raw))
  expect(card?.title).toBe('◆ semantic_search  Where is the card built?')
  expect(card?.body).toEqual({ kind: 'text', head: [
    'hooks/cards.ts:367–372', '  export function buildCard() {', '    const card = draft()',
    'README.md:8–15 · score 0.92', '  Display documentation',
  ] })
  expect(card?.result).toBe('2 hits · limit reached')
  expect(card?.full).toBe(raw)
  expect(card?.openable).toBe(true)
})

test('semantic search with no hits says so directly', () => {
  const card = buildCard(P + 'semantic_search', { query: 'missing' }, text('{"results":[],"total":0}'))
  expect(card?.result).toBe('0 hits')
})

test('grep puts the pattern in the title and keeps grouped matches below the cutoff notice', () => {
  const input = { pattern: 'boxCall', path: 'codescout-display' }
  const stdout = [
    '28 matches (capped) in 3 files',
    '  … showing 7 of 28 — Collection stopped at the candidate cap',
    '',
    'hooks/cards.ts (2)',
    '    453: function boxCall(command: unknown) {  [boxCall]',
    '    454-   const calls = []',
    '  --',
    '    599: const box = boxCall(command)  [draft]',
  ].join('\n')
  const card = buildCard(P + 'grep', input, text(stdout))
  expect(card?.title).toBe('◆ grep  boxCall')
  expect(card?.params).toBe('path=codescout-display')
  expect(card?.result).toBe('28 matches (capped) in 3 files · showing 7 of 28')
  expect(card?.body).toEqual({ kind: 'text', head: [
    'hooks/cards.ts (2)',
    '    453: function boxCall(command: unknown) {  [boxCall]',
    '    454-   const calls = []',
    '  --',
    '    599: const box = boxCall(command)  [draft]',
  ] })
  expect(card?.full).toBe(stdout)
})

test('grep file counts present the path first, and no hits have a result line', () => {
  const card = buildCard(P + 'grep', { pattern: 'box', mode: 'files' }, text('6 matches in 2 files\n    4  hooks/cards.ts\n    2  README.md'))
  expect(card?.body).toEqual({ kind: 'text', head: ['hooks/cards.ts  ·  4 matches', 'README.md  ·  2 matches'] })
  expect(buildCard(P + 'grep', { pattern: 'missing' }, text('0 matches'))?.result).toBe('0 matches')
})

test('doc find shows titles, kinds, statuses, paths and page information', () => {
  const raw = JSON.stringify({ count: 2, items: [
    { title: 'Version-bump checklist', kind: 'tracker', status: 'active', abs_path: 'docs/checklist.md', id: 'abcd' },
    { title: 'A release spec', kind: 'spec', status: 'draft', abs_path: 'docs/spec.md', matched: { start_line: 20, end_line: 30 } },
  ], hints: { more_in_scope: 11 } })
  const card = buildCard(P + 'doc', { action: 'find', semantic: 'release' }, text(raw))
  expect(card?.title).toBe('◆ doc · find  release')
  expect(card?.body).toEqual({ kind: 'text', head: [
    'Version-bump checklist  ·  tracker · active', '  docs/checklist.md', 'A release spec  ·  spec · draft', '  docs/spec.md:20–30',
  ] })
  expect(card?.result).toBe('2 results · 11 more in scope')
  expect(card?.full).toBe(raw)
})

test('references keep file groups and promote the page summary', () => {
  const raw = '89 references in 3 files\n  … showing 4 of 89 — offset 0; pass offset=4 for the next page, or raise the limit\n\nhooks/cards.ts (1)\n    367  export function buildCard() {'
  const card = buildCard(P + 'references', { symbol: 'buildCard' }, text(raw))
  expect(card?.result).toBe('89 references in 3 files · showing 4 of 89')
  expect(card?.body).toEqual({ kind: 'text', head: ['hooks/cards.ts (1)', '    367  export function buildCard() {'] })
  expect(card?.full).toBe(raw)
})

test('call graph leads with direct edges from both directions and preserves the full graph', () => {
  const raw = [
    'call_graph for ' + String.fromCharCode(96) + 'boxCall' + String.fromCharCode(96),
    '  callers: 3 edges across 2 files',
    '    hooks/register.tsx (1)',
    '        116: register → pendingCard (depth=2, lsp)',
    '    hooks/cards.ts (2)',
    '        699: pendingCard → boxCall (depth=1, lsp)',
    '        720: draft → boxCall (depth=1, lsp)',
    '  callees: 1 edges across 1 files',
    '    hooks/cards.ts (1)',
    '        496: boxCall → finish (depth=1, ts)',
    '  max_depth_reached: 2',
  ].join('\n')
  const card = buildCard(P + 'call_graph', { symbol: 'boxCall', direction: 'both' }, text(raw))
  expect(card?.result).toBe('callers: 3 edges across 2 files · callees: 1 edges across 1 files')
  expect(card?.body).toEqual({ kind: 'text', head: [
    'Callers', '  pendingCard → boxCall  ·  hooks/cards.ts:699', '  draft → boxCall  ·  hooks/cards.ts:720',
    'Callees', '  boxCall → finish  ·  hooks/cards.ts:496 · ts',
  ] })
  expect(card?.full).toBe(raw)
})

test('an exploring call graph keeps the tool-reported file summary', () => {
  const raw = 'call_graph for boxCall\n  callers: 106 across 3 files\n    hooks/cards.ts: 3\n    by_depth: 1=2 2=18 3=86\n  max_depth_reached: 3'
  const card = buildCard(P + 'call_graph', { symbol: 'boxCall', direction: 'callers' }, text(raw))
  expect(card?.body).toEqual({ kind: 'text', head: ['Callers', '  hooks/cards.ts: 3', '  by_depth: 1=2 2=18 3=86'] })
  expect(card?.result).toBe('callers: 106 across 3 files')
  expect(card?.full).toBe(raw)
})
