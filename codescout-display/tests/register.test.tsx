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
