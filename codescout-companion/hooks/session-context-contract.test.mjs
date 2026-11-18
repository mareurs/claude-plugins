import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeHookContext } from './session-context.mjs';

const root = mkdtempSync(join(tmpdir(), 'contract-'));
test.after(() => rmSync(root, { recursive: true, force: true }));
test('shared contract cases produce the complete independently specified result', () => {
  const pack = JSON.parse(readFileSync(new URL('../contracts/fixtures/session-context-v1.json', import.meta.url), 'utf8')
    .replaceAll('${WORKSPACE}', root));
  for (const value of pack.cases) {
    assert.deepEqual(normalizeHookContext(value.harness, value.input, root, value.harness_version), value.expected, value.name);
  }
});
test('captured Claude root hook preserves native root identity without inventing a child', () => {
  const payload = JSON.parse(readFileSync(new URL('../contracts/fixtures/native-histories/claude-root-hook.json', import.meta.url), 'utf8')
    .replaceAll('${WORKSPACE}', root));
  assert.deepEqual(normalizeHookContext('claude-code', payload, root, '2.1.296'), {
    state: 'available', context: {
      schema_version: 1, harness: 'claude-code', session_id: 'claude-root',
      agent_id: null, workspace: root, source: 'native-hook', harness_version: '2.1.296',
    }, reason: '',
  });
});
