import { expect, test } from 'claude-code/testing'

// Task 1 findings (kit calls for mounting a ToolUse):
//   mount:        $.ui.mount({ plugin, surface, component: 'ToolUse', props })
//   pass-through: await ui.keepsBeneath() is true when the hook kept the engine's node (next(e)),
//                 false when the hook replaced the row with a tree of its own.
//   read:         ui.find({ type, key, text }) -> { type, key, props, text, children } | undefined

const USE = { plugin: 'codescout-display', surface: 'terminal', component: 'ToolUse' } as const

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

test('a mounted ToolUse passes through', async $ => {
  const ui = await $.ui.mount({ ...USE, props })

  expect(await ui.keepsBeneath()).toBe(true)
  await ui.unmount()
})

// Task 1 gate: a Button with stored state, keyed by tool_use_id, inside a ToolUse row.
test('the open control flips on press', async $ => {
  const ui = await $.ui.mount({ ...USE, props })

  expect(await ui.find({ type: 'Text', text: 'closed' })).toBeDefined()
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ type: 'Text', text: 'OPEN' })).toBeDefined()
  await ui.unmount()
})
