import { expect, test } from 'claude-code/testing'

import { IN_HIGH, IN_MID, OUT_HIGH, OUT_MID } from '../hooks/cards'

// Kit calls (plan Task 1):
//   mount:        $.ui.mount({ plugin, surface, component: 'ToolUse', props })
//   pass-through: await ui.keepsBeneath() is true when the hook kept the engine's node (next(e)),
//                 false when the hook replaced the row with a tree of its own.
//   read:         ui.find({ type, key, text }) -> { type, key, props, text, children } | undefined
//   state:        a Button with an atom flips on ui.press({ key }) in a mounted ToolUse (hook level).

const USE = { plugin: 'codescout-display', component: 'ToolUse' } as const

const props = {
  tool_use_id: 't1',
  tool: 'mcp__codescout__tree',
  input: { path: '.' },
  isRunning: false,
  isErrored: false,
  isInterrupted: false,
  isExpanded: true,
  output: [{ type: 'text', text: 'a\nb' }],
}

const text = (t: string, ...notes: string[]) => [t, ...notes].map(x => ({ type: 'text', text: x }))
const rows = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join('\n')

const mount = ($: any, over: Record<string, unknown> = {}, surface = 'terminal') =>
  $.ui.mount({ ...USE, surface, props: { ...props, ...over } })

const PASS: Array<[string, Record<string, unknown>, string?]> = [
  ['a desktop surface', {}, 'desktop'],
  ['a non-codescout tool', { tool: 'Bash' }],
  ['a running row with output', { isRunning: true }],
  ['an errored row', { isErrored: true }],
  ['an errored row with no output', { isErrored: true, output: undefined }],
  ['an interrupted row with no output', { isInterrupted: true, output: undefined, isRunning: true }],
  ['isExpanded false', { isExpanded: false }],
  ['isExpanded absent', { isExpanded: undefined }],
  ['an interrupted row', { isInterrupted: true }],
  ['an empty output array', { output: [] }],
  ['an output with no text block', { output: [{ type: 'image' }] }],
]

for (const [name, over, surface] of PASS) {
  test(`pass-through: ${name} keeps the engine row`, async $ => {
    const ui = await mount($, over, surface)

    expect(await ui.keepsBeneath()).toBe(true)
    await ui.unmount()
  })
}

test('a thrown error in the hook draws the engine row', async $ => {
  const ui = await mount($, { tool: 123 })

  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

test('a tree call draws a card: a header starting with ◆ tree and 8 lines', async $ => {
  const ui = await mount($, { output: text(rows(8)) })

  expect(await ui.keepsBeneath()).toBe(false)
  expect(await ui.find({ type: 'Text', text: /^◆ tree/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /^l\d+$/ })).toHaveLength(8)
  expect(await ui.find({ text: /more lines hidden/ })).toBeUndefined()
  await ui.unmount()
})

test('a 40-line result draws 12 lines and "… 28 more lines hidden"', async $ => {
  const ui = await mount($, { output: text(rows(40)) })

  expect(await ui.findAll({ type: 'Text', text: /^l\d+$/ })).toHaveLength(12)
  expect(await ui.find({ type: 'Text', text: '… 28 more lines hidden' })).toBeDefined()
  await ui.unmount()
})

test('an edit_file call that applied draws a Code with format diff', async $ => {
  const ui = await mount($, {
    tool: 'mcp__codescout__edit_file',
    input: { path: 'a.mjs', old_string: 'a', new_string: 'b' },
    output: text('{"status":"ok"}'),
  })
  const code = await ui.find({ type: 'Code' })

  expect(code?.props.format).toBe('diff')
  expect(code?.text).toContain('-a')
  expect(code?.text).toContain('+b')
  await ui.unmount()
})

test('a read_file call draws a Code that starts its gutter at the requested line', async $ => {
  const ui = await mount($, {
    tool: 'mcp__codescout__read_file',
    input: { path: 'a.ts', start_line: 5 },
    output: text('2 lines\n\nx\ny'),
  })
  const code = await ui.find({ type: 'Code' })

  expect(code?.props.startLine).toBe(5)
  expect(code?.props.path).toBe('a.ts')
  expect(code?.text).toBe('x\ny')
  await ui.unmount()
})

test('an output with a hook note draws the note as one dim line', async $ => {
  const ui = await mount($, { output: text('a', '\nfirst real line\nsecond') })
  const note = await ui.find({ type: 'Text', text: /first real line/ })

  expect(note?.props.dimColor).toBe(true)
  expect(note?.text).not.toContain('second')
  await ui.unmount()
})

// Task 5: the open control. `toggle` is the Button's key; its state is an atom keyed by tool_use_id.

test('a long result draws an open button; pressing it draws the full text and "fold"', async $ => {
  const ui = await mount($, { tool_use_id: 'open-1', output: text(rows(40)) })

  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (28 more lines)')
  await ui.press({ key: 'toggle' })

  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('fold')
  expect((await ui.find({ type: 'Code' }))?.text).toContain('l40')
  expect(await ui.find({ text: /more lines hidden/ })).toBeUndefined()
  await ui.unmount()
})

test('pressing the button again folds the card', async $ => {
  const ui = await mount($, { tool_use_id: 'open-2', output: text(rows(40)) })

  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'toggle' })

  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (28 more lines)')
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('two cards keep separate state', async $ => {
  const a = await mount($, { tool_use_id: 'open-3a', output: text(rows(40)) })
  const b = await mount($, { tool_use_id: 'open-3b', output: text(rows(40)) })

  await a.press({ key: 'toggle' })

  expect((await a.find({ type: 'Button' }))?.props.label).toBe('fold')
  expect((await b.find({ type: 'Button' }))?.props.label).toBe('open (28 more lines)')
  await a.unmount()
  await b.unmount()
})

test('a result with nothing hidden and no notes draws no button', async $ => {
  const ui = await mount($, { tool_use_id: 'open-4', output: text(rows(3)) })

  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('notes only: a button opens the whole note', async $ => {
  const ui = await mount($, { tool_use_id: 'open-5', output: text(rows(3), 'line one\nline two') })

  expect(await ui.find({ type: 'Text', text: /line two/ })).toBeUndefined()
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open notes')
  await ui.press({ key: 'toggle' })

  expect(await ui.find({ type: 'Text', text: /line two/ })).toBeDefined()
  await ui.unmount()
})

// run_command: a wider card that shows the command in up to 5 lines.

test('a run_command card shows the command in a bash Code, at most 5 lines, and counts the rest', async $ => {
  const ui = await mount($, {
    tool_use_id: 'cmd-1',
    tool: 'mcp__codescout__run_command',
    input: { command: rows(7) },
    output: text('{"exit_code":0,"stdout":"ok"}'),
  })
  const code = await ui.find({ type: 'Code' })

  expect(code?.props.language).toBe('bash')
  expect(code?.text).toBe('l1\nl2\nl3\nl4\nl5')
  expect(await ui.find({ type: 'Text', text: '… 2 more command lines' })).toBeDefined()
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (2 more command lines)')
  await ui.unmount()
})

test('opening a run_command card shows the whole command', async $ => {
  const ui = await mount($, {
    tool_use_id: 'cmd-2',
    tool: 'mcp__codescout__run_command',
    input: { command: rows(7) },
    output: text('{"exit_code":0}'),
  })

  await ui.press({ key: 'toggle' })

  expect((await ui.find({ type: 'Code' }))?.text).toBe(rows(7))
  expect(await ui.find({ type: 'Text', text: /more command lines/ })).toBeUndefined()
  await ui.unmount()
})

test('a run_command card is full width; another tool card is not', async $ => {
  const cmd = await mount($, {
    tool_use_id: 'cmd-3',
    tool: 'mcp__codescout__run_command',
    input: { command: 'ls' },
    output: text('{"exit_code":0}'),
  })
  const tree = await mount($, { tool_use_id: 'cmd-4', output: text('a') })

  expect((await cmd.find({ type: 'Box' }))?.props.width).toBe('100%')
  expect((await tree.find({ type: 'Box' }))?.props.width).toBeUndefined()
  await cmd.unmount()
  await tree.unmount()
})

// Fix pass after the whole-branch review: a cut fields line can be opened.

test('a JSON reply that left something out draws an open button; pressing it shows the whole reply', async $ => {
  const reply = JSON.stringify({ exit_code: 101, stderr: 'e'.repeat(100) })
  const ui = await mount($, {
    tool_use_id: 'cut-1',
    tool: 'mcp__codescout__run_command',
    input: { command: 'cargo build' },
    output: text(reply),
  })

  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (full reply)')
  await ui.press({ key: 'toggle' })

  const codes = await ui.findAll({ type: 'Code' })
  expect(codes.some((c: { text: string }) => c.text.includes('e'.repeat(100)))).toBe(true)
  await ui.unmount()
})

// A card frame from the first render: the border and the header draw before the output exists,
// so the row does not swap from the engine's row to a card when the tool ends.

test('a running codescout call draws a card frame with the header and "running…"', async $ => {
  const ui = await mount($, { tool_use_id: 'run-1', isRunning: true, output: undefined })

  expect(await ui.keepsBeneath()).toBe(false)
  expect((await ui.find({ type: 'Box' }))?.props.borderStyle).toBe('round')
  expect((await ui.find({ type: 'Text', text: /^◆ tree/ }))?.text).toBe('◆ tree  .')
  expect(await ui.find({ type: 'Text', text: 'running…' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('a call that has not started and has no input yet draws the bare frame with no "running…"', async $ => {
  const ui = await mount($, { tool_use_id: 'run-2', input: {}, isRunning: false, output: undefined })

  expect(await ui.keepsBeneath()).toBe(false)
  expect((await ui.find({ type: 'Text', text: /^◆ tree/ }))?.text).toBe('◆ tree')
  expect(await ui.find({ type: 'Text', text: 'running…' })).toBeUndefined()
  await ui.unmount()
})

test('a running run_command call is already full width and shows its command', async $ => {
  const ui = await mount($, {
    tool_use_id: 'run-3',
    tool: 'mcp__codescout__run_command',
    input: { command: rows(7) },
    isRunning: true,
    output: undefined,
  })
  const code = await ui.find({ type: 'Code' })

  expect((await ui.find({ type: 'Box' }))?.props.width).toBe('100%')
  expect(code?.text).toBe('l1\nl2\nl3\nl4\nl5')
  expect(await ui.find({ type: 'Text', text: '… 2 more command lines' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  await ui.unmount()
})

test('the frame of a running call and the frame of its finished card are the same Box', async $ => {
  const running = await mount($, { tool_use_id: 'run-4', isRunning: true, output: undefined })
  const done = await mount($, { tool_use_id: 'run-5', output: text('a') })
  const a = (await running.find({ type: 'Box' }))?.props
  const b = (await done.find({ type: 'Box' }))?.props

  expect({ ...a, children: undefined }).toEqual({ ...b, children: undefined })
  await running.unmount()
  await done.unmount()
})

// Verbs, parameters and written text on the card (2026-11-24).

const okReply = text('{"status":"ok","wrote_to":"/home/x/repo"}')

test('a read draws the title in the accent color; a write draws it in the warning color', async $ => {
  const read = await mount($, { tool_use_id: 'v-1', tool: 'mcp__codescout__memory', input: { action: 'read', topic: 'architecture' }, output: text('# A') })
  const write = await mount($, { tool_use_id: 'v-2', tool: 'mcp__codescout__memory', input: { action: 'write', topic: 'scratch', content: '# T' }, output: okReply })

  const readTitle = await read.find({ type: 'Text', text: /^◆ memory/ })
  const writeTitle = await write.find({ type: 'Text', text: /^◆ memory/ })

  expect(readTitle?.text).toBe('◆ memory · read  architecture')
  expect(readTitle?.props.color).toBe('suggestion')
  expect(writeTitle?.text).toBe('◆ memory · write  scratch')
  expect(writeTitle?.props.color).toBe('warning')
  await read.unmount()
  await write.unmount()
})

test('the other parameters draw as one dim line under the title; no parameters, no line', async $ => {
  const some = await mount($, {
    tool_use_id: 'v-3',
    tool: 'mcp__codescout__doc',
    input: { action: 'find', kind: 'tracker', status: 'open' },
    output: text('{"rows":[]}'),
  })
  const none = await mount($, { tool_use_id: 'v-4', tool: 'mcp__codescout__memory', input: { action: 'read', topic: 'a' }, output: text('# A') })

  const line = await some.find({ type: 'Text', text: 'kind=tracker status=open' })
  expect(line?.props.dimColor).toBe(true)
  expect(await none.find({ type: 'Text', text: /=/ })).toBeUndefined()
  await some.unmount()
  await none.unmount()
})

test('a memory write draws its content as markdown and the result as one dim line', async $ => {
  const ui = await mount($, {
    tool_use_id: 'v-5',
    tool: 'mcp__codescout__memory',
    input: { action: 'write', topic: 'scratch', content: '# Title\n\nbody text' },
    output: okReply,
  })

  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe('# Title\n\nbody text')
  expect((await ui.find({ type: 'Text', text: 'status: ok' }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('a long memory write folds, and its button opens the whole text', async $ => {
  const content = rows(40)
  const ui = await mount($, {
    tool_use_id: 'v-6',
    tool: 'mcp__codescout__memory',
    input: { action: 'write', topic: 'scratch', content },
    output: okReply,
  })

  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (28 more lines)')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Markdown' }))?.props.text).toBe(content)
  await ui.unmount()
})

test('the frame of a pending write is already in the warning color, with its parameters', async $ => {
  const ui = await mount($, {
    tool_use_id: 'v-7',
    tool: 'mcp__codescout__memory',
    input: { action: 'write', topic: 'scratch', content: 'x', private: true },
    isRunning: true,
    output: undefined,
  })

  expect((await ui.find({ type: 'Text', text: /^◆ memory/ }))?.props.color).toBe('warning')
  expect(await ui.find({ type: 'Text', text: 'private=true' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'running…' })).toBeDefined()
  await ui.unmount()
})

const SYM_BODIES = ['a.ts (1)', '  Function  5-9  fileBody', '      export function fileBody() {', '        return 1', '      }', ''].join('\n')
const SYM_OUTLINE = ['a.ts — 2 symbols', '', '  Constant   ACCENT     L7', '  Function   drawCard   L18-79', ''].join('\n')

test('a symbols call with bodies draws each body as a Code with its file path and no gutter, under a label', async $ => {
  const ui = await mount($, { tool: 'mcp__codescout__symbols', input: { path: 'a.ts', include_body: true }, output: text(SYM_BODIES) })
  const code = await ui.find({ type: 'Code' })

  expect(code?.props.path).toBe('a.ts')
  expect(code?.props.startLine).toBeUndefined()
  expect(code?.text).toBe('export function fileBody() {\n  return 1\n}')
  expect(await ui.find({ type: 'Text', text: 'fileBody' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5-9/ })).toBeDefined()
  await ui.unmount()
})

test('a symbols outline draws a label per symbol and no Code', async $ => {
  const ui = await mount($, { tool: 'mcp__codescout__symbols', input: { path: 'a.ts' }, output: text(SYM_OUTLINE) })

  expect(await ui.find({ type: 'Text', text: 'drawCard' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /18-79/ })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.unmount()
})

test('a long symbols reply folds at 12 lines and the open control draws the whole body', async $ => {
  const body = Array.from({ length: 30 }, (_, i) => `      l${i + 1}`).join('\n')
  const ui = await mount($, { tool: 'mcp__codescout__symbols', input: { path: 'a.ts', include_body: true }, output: text(`a.ts (1)\n  Function  1-30  big\n${body}\n`) })

  expect((await ui.find({ type: 'Code' }))?.text).not.toContain('l30')
  expect((await ui.find({ type: 'Button' }))?.props.label).toBe('open (20 more lines)')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('l30')
  await ui.unmount()
})

test('a finished card ends with a right-aligned row of the token estimate, below the open button', async $ => {
  const ui = await mount($, { output: text(rows(40)) })
  const card = await ui.find({ type: 'Box' })
  const last = card?.children.at(-1)

  expect(last?.props.justifyContent).toBe('flex-end')
  expect(await ui.find({ type: 'Text', text: /^out ~\d+$/ })).toBeDefined()
  expect(card?.children.some((c: any) => c.type === 'Button')).toBe(true)
  await ui.unmount()
})

test('a pending frame has no token row', async $ => {
  const ui = await mount($, { isRunning: true, output: undefined })

  expect(await ui.find({ type: 'Text', text: /^in ~/ })).toBeUndefined()
  await ui.unmount()
})

const chars = (tokens: number) => 'x'.repeat(tokens * 4)

for (const [name, tokens, color] of [
  ['below OUT_MID is green', OUT_MID - 10, 'success'],
  ['from OUT_MID is orange', OUT_MID + 10, 'warning'],
  ['from OUT_HIGH is red', OUT_HIGH + 10, 'error'],
] as const) {
  test(`the out figure ${name}`, async $ => {
    const ui = await mount($, { output: text(chars(tokens)) })

    expect((await ui.find({ type: 'Text', text: /^out ~/ }))?.props.color).toBe(color)
    await ui.unmount()
  })
}

for (const [name, tokens, color] of [
  ['below IN_MID is green', IN_MID - 30, 'success'],
  ['from IN_MID is orange', IN_MID + 30, 'warning'],
  ['from IN_HIGH is red', IN_HIGH + 30, 'error'],
] as const) {
  test(`the in figure ${name}, whatever the reply`, async $ => {
    const ui = await mount($, { input: { path: chars(tokens) }, output: text('ok') })

    expect((await ui.find({ type: 'Text', text: /^in ~/ }))?.props.color).toBe(color)
    expect((await ui.find({ type: 'Text', text: /^out ~/ }))?.props.color).toBe('success')
    await ui.unmount()
  })
}

test('a box list shows entry titles and opens the unabridged CLI output', async $ => {
  const stdout = '2026-11-26-sample  open  high  Sample bug\n1 live of 2 entries; 1 terminal and 0 archived are not shown (--all)\n'
  const ui = await mount($, {
    tool_use_id: 'box-list',
    tool: 'mcp__codescout__run_command',
    input: { command: 'codescout box bugs list 2>&1 | grep -v INFO | head -30' },
    output: text(JSON.stringify({ exit_code: 0, producer_exit_code: 0, stdout, unfiltered_output: '@cmd_fixture' })),
  })

  expect(await ui.find({ type: 'Text', text: '◆ box · list  bugs' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Sample bug  ·  open · high' })).toBeDefined()
  expect(await ui.find({ type: 'Code' })).toBeUndefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('2026-11-26-sample')
  await ui.unmount()
})

test('a semantic search card shows ranked paths and leaves the raw reply available', async $ => {
  const stdout = JSON.stringify({ results: [
    { file_path: 'hooks/cards.ts', start_line: 12, end_line: 20, content: 'first line\nsecond line\nthird line' },
  ], total: 1 })
  const ui = await mount($, {
    tool_use_id: 'semantic-search',
    tool: 'mcp__codescout__semantic_search',
    input: { query: 'card renderer' },
    output: text(stdout),
  })

  expect(await ui.find({ type: 'Text', text: '◆ semantic_search  card renderer' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'hooks/cards.ts:12–20' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 hit' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ type: 'Code' }))?.text).toContain('third line')
  await ui.unmount()
})

for (const { name, input, output, headline, row } of [
  {
    name: 'grep',
    input: { pattern: 'buildCard', path: 'hooks' },
    output: '3 matches\n\nhooks/cards.ts (3)\n    367: export function buildCard()',
    headline: '◆ grep  buildCard',
    row: 'hooks/cards.ts (3)',
  },
  {
    name: 'doc',
    input: { action: 'find', kind: 'tracker' },
    output: JSON.stringify({ count: 1, items: [{ title: 'Version checklist', kind: 'tracker', status: 'active', abs_path: 'docs/checklist.md' }] }),
    headline: '◆ doc · find',
    row: 'Version checklist  ·  tracker · active',
  },
  {
    name: 'call_graph',
    input: { symbol: 'buildCard', direction: 'callers' },
    output: 'call_graph for buildCard\n  callers: 1 edges across 1 files\n    hooks/register.tsx (1)\n        117: register → buildCard (depth=1, lsp)',
    headline: '◆ call_graph · callers  buildCard',
    row: '  register → buildCard  ·  hooks/register.tsx:117',
  },
  {
    name: 'references',
    input: { symbol: 'buildCard' },
    output: '3 references in 1 files\nhooks/cards.ts (3)\n    367  export function buildCard()',
    headline: '◆ references  buildCard',
    row: 'hooks/cards.ts (3)',
  },
]) {
  test(name + ' renders the lookup preview and opens the original reply', async $ => {
    const ui = await mount($, { tool_use_id: name + '-lookup', tool: 'mcp__codescout__' + name, input, output: text(output) })
    expect(await ui.find({ type: 'Text', text: headline })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: row })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ type: 'Code' }))?.text).toContain(output)
    await ui.unmount()
  })
}
