import { expect, test } from 'claude-code/testing'
import { HEAD_LINES } from '../hooks/cards'

test('HEAD_LINES is 12', () => {
  expect(HEAD_LINES).toBe(12)
})
