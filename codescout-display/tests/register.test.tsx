import { expect, test } from 'claude-code/testing'

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
  ['a running row', { isRunning: true }],
  ['an errored row', { isErrored: true }],
  ['no output yet', { output: undefined }],
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
