import { expect, test } from 'claude-code/testing'

// Nothing sits beneath the plugin: each `on` here stands for the engine or for
// the settings hooks. The `ui.log` hook collects the rows the mod writes.

const HINT = '[cs-hint] `grep("a phrase here")` matches text literally.'

test('a PostToolUse context is echoed once and still reaches the model', async ($, on) => {
  const rows: string[] = []
  on('ui.log', (_, e) => {
    rows.push(e.text)
    return { value: undefined }
  })
  on('classic.PostToolUse', () => ({ additionalContext: [HINT] }))

  const result = await $.classic.PostToolUse({
    tool_name: 'mcp__codescout__grep',
    tool_input: {},
    tool_response: {},
    tool_use_id: 'tu_1',
  })

  expect(result.additionalContext).toEqual([HINT])
  expect(rows).toEqual([`hook told the model after mcp__codescout__grep: ${HINT}`])
})

test('no context, no row', async ($, on) => {
  const rows: string[] = []
  on('ui.log', (_, e) => {
    rows.push(e.text)
    return { value: undefined }
  })
  on('classic.PostToolUse', () => ({}))

  const result = await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 'tu_2',
  })

  expect(result.additionalContext).toBeUndefined()
  expect(rows).toEqual([])
})

test('each entry gets a row, and a long one is cut with its length', async ($, on) => {
  const rows: string[] = []
  on('ui.log', (_, e) => {
    rows.push(e.text)
    return { value: undefined }
  })
  const long = 'x'.repeat(1000)
  on('classic.PostToolUse', () => ({ additionalContext: ['first', long] }))

  await $.classic.PostToolUse({
    tool_name: 'Bash',
    tool_input: {},
    tool_response: {},
    tool_use_id: 'tu_3',
  })

  expect(rows.length).toBe(2)
  expect(rows[0]).toBe('hook told the model after Bash: first')
  expect(rows[1].endsWith('… (1000 chars)')).toBe(true)
  expect(rows[1].length).toBeLessThan(500)
})

test('a failed tool call is echoed too', async ($, on) => {
  const rows: string[] = []
  on('ui.log', (_, e) => {
    rows.push(e.text)
    return { value: undefined }
  })
  on('classic.PostToolUseFailure', () => ({ additionalContext: ['look at the error'] }))

  const result = await $.classic.PostToolUseFailure({
    tool_name: 'Bash',
    tool_input: {},
    tool_use_id: 'tu_4',
    error: 'exit 1',
  })

  expect(result.additionalContext).toEqual(['look at the error'])
  expect(rows).toEqual(['hook told the model after Bash failed: look at the error'])
})

test('a context handed before a tool call is echoed', async ($, on) => {
  const rows: string[] = []
  on('ui.log', (_, e) => {
    rows.push(e.text)
    return { value: undefined }
  })
  on('classic.PreToolUse', () => ({ additionalContext: ['recon first'] }))
  on('tool.call', () => ({ result: {} }))

  await $.tool.call({ tool: 'Bash', command: 'ls' })

  expect(rows).toEqual(['hook told the model before a tool call: recon first'])
})
