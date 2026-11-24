import { expect, test } from 'claude-code/testing'

import { MARK } from '../hooks/toasts'

// Nothing sits beneath the plugin: each `on` here stands for the engine. The `ui.toast` hook collects what the mod shows.

const WRAPPED = '<cross-session-message from="uds:x" from-name="claude-plugins-c1">Probe message. Nothing to do.</cross-session-message>'
const NOTICE = `Message to you from session main:1 (main:0078a446), 01:23 UTC: build done. All green. Refs: . ${MARK}`

type Toast = { text: string; timeoutMs?: number }

test('a peer message shows one toast for 8 seconds and is delivered unchanged', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  const result = await $.session.receive({ origin: { kind: 'peer' }, text: WRAPPED })

  expect(result.text).toBe(WRAPPED)
  expect(toasts).toEqual([{ text: 'from claude-plugins-c1: Probe message. Nothing to do.', timeoutMs: 8000 }])
})

test('a delivery that is not from a peer shows no toast', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  const result = await $.session.receive({ origin: { kind: 'coordinator' }, text: WRAPPED })

  expect(result.text).toBe(WRAPPED)
  expect(toasts).toEqual([])
})

test('a message for a subagent shows no toast and is still delivered', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  const result = await $.session.receive({ origin: { kind: 'peer' }, text: WRAPPED, agentId: 'a1' })

  expect(result.text).toBe(WRAPPED)
  expect(toasts).toEqual([])
})

test('a toast that fails does not stop the delivery of a peer message', async ($, on) => {
  on('ui.toast', () => {
    throw new Error('toast broke')
  })
  on('session.receive', (_, e) => ({ text: e.text }))

  const result = await $.session.receive({ origin: { kind: 'peer' }, text: WRAPPED })

  expect(result.text).toBe(WRAPPED)
})

test('a notice in PostToolUse context shows one toast and the context is unchanged', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('classic.PostToolUse', () => ({ additionalContext: [NOTICE] }))

  const result = await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'tu_1' })

  expect(result.additionalContext).toEqual([NOTICE])
  expect(toasts).toEqual([{ text: 'notice from main:0078a446: build done. All green.', timeoutMs: 8000 }])
})

test('a notice in UserPromptSubmit context shows one toast and the context is unchanged', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('classic.UserPromptSubmit', () => ({ additionalContext: [NOTICE] }))

  const result = await $.classic.UserPromptSubmit({ prompt: 'hello' })

  expect(result.additionalContext).toEqual([NOTICE])
  expect(toasts.length).toBe(1)
})

test('a hook context that holds no notice shows no toast', async ($, on) => {
  const toasts: Toast[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e)
    return { value: undefined }
  })
  on('classic.PostToolUse', () => ({ additionalContext: ['[cs-hint] a plain advisory'] }))

  const result = await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'tu_2' })

  expect(result.additionalContext).toEqual(['[cs-hint] a plain advisory'])
  expect(toasts).toEqual([])
})

test('a toast that fails does not change the hook context or run the lower hooks twice', async ($, on) => {
  let calls = 0
  on('ui.toast', () => {
    throw new Error('toast broke')
  })
  on('classic.PostToolUse', () => {
    calls += 1
    return { additionalContext: [NOTICE] }
  })

  const result = await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'tu_3' })

  expect(result.additionalContext).toEqual([NOTICE])
  expect(calls).toBe(1)
})
