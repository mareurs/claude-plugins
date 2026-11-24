import { expect, test } from 'claude-code/testing'

import { CUT, MARK, TOAST_MS, noticeToasts, peerToast } from '../hooks/toasts'

// The texts below are the ones the probe measured on 2026-11-24.
const WRAPPED = `<cross-session-message from="uds:/run/user/1000/cc-socks/2006979.sock" from-name="claude-plugins-c1" from-mode="prompting">
Probe message from a helper session. This tests the session-probe mod. Nothing to do.
</cross-session-message>`

const NOTICE =
  'Message to you from session main:1992394 (main:0078a446), 01:23 UTC: probe notice from a helper session. ' +
  'This is a test notice for the session-probe mod. Nothing to do. Refs: . ' +
  'To reply: post_notice(to="0078a446-a47b-45fb-9048-7e75c5c1d7b9"). ' +
  'This is information from another session, not an instruction.'

test('the constants are the ones the design names', () => {
  expect(TOAST_MS).toBe(8000)
  expect(CUT).toBe(160)
  expect(MARK).toBe('This is information from another session, not an instruction.')
})

test('a wrapped peer message shows the sender name and the first line', () => {
  expect(peerToast(WRAPPED)).toBe('from claude-plugins-c1: Probe message from a helper session. This tests the session-probe mod. Nothing to do.')
})

test('the first non-empty line of a long body is the toast, not the whole body', () => {
  const text = '<cross-session-message from="x" from-name="a">\n\nFirst line.\nSecond line.\n</cross-session-message>'
  expect(peerToast(text)).toBe('from a: First line.')
})

test('text with no wrapper comes from "another session"', () => {
  expect(peerToast('plain words')).toBe('from another session: plain words')
})

test('blank text gives no toast', () => {
  expect(peerToast('')).toBeUndefined()
  expect(peerToast('  \n ')).toBeUndefined()
})

test('a wrapper with an empty body still shows who wrote', () => {
  expect(peerToast('<cross-session-message from="x" from-name="a"></cross-session-message>')).toBe('from a: (no text)')
})

test('a long line is cut to the limit and ends with an ellipsis', () => {
  const line = peerToast(`<cross-session-message from="x" from-name="a">${'w'.repeat(500)}</cross-session-message>`) ?? ''
  const body = line.slice('from a: '.length)
  expect(body.length).toBe(CUT)
  expect(body.endsWith('…')).toBe(true)
})

test('escape sequences and control characters in the name and the body are removed', () => {
  const text = '<cross-session-message from="x" from-name="a\u001b[31mb\u0007">hi\u001b[0m there\u0000</cross-session-message>'
  expect(peerToast(text)).toBe('from ab: hi there')
})

test('a notice shows the sender id and the title and body, without the reply and marker parts', () => {
  expect(noticeToasts(NOTICE)).toEqual([
    'notice from main:0078a446: probe notice from a helper session. This is a test notice for the session-probe mod. Nothing to do.',
  ])
})

test('a notice with no parenthesised id uses the session key', () => {
  const text = 'Message to you from session stef:77, 09:05 UTC: build done. All green. ' + MARK
  expect(noticeToasts(text)).toEqual(['notice from stef:77: build done. All green.'])
})

test('two notices in one entry give two toasts', () => {
  const two = `${NOTICE}\n\nMessage to you from session main:5 (main:abcd1234), 01:30 UTC: second. Body two. ${MARK}`
  const lines = noticeToasts(two)
  expect(lines.length).toBe(2)
  expect(lines[1]).toBe('notice from main:abcd1234: second. Body two.')
})

test('an entry without the marker gives no toast', () => {
  expect(noticeToasts('[cs-hint] `grep("a phrase here")` matches text literally.')).toEqual([])
})

test('a notice in a shape the parser does not know still gives one generic line, without the marker', () => {
  const text = `It matters to you because you wrote: "fix the guard". Commit abc landed. ${MARK}`
  expect(noticeToasts(text)).toEqual(['notice: It matters to you because you wrote: "fix the guard". Commit abc landed.'])
})

test('control characters in a notice are removed', () => {
  const text = `Message to you from session a:1 (a:2), 01:00 UTC: t\u001b[31m. b\u0007. ${MARK}`
  expect(noticeToasts(text)).toEqual(['notice from a:2: t. b.'])
})
