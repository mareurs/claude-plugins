import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';

const scratch = mkdtempSync(join(tmpdir(), 'context-'));
const root = join(scratch, 'checkout with spaces');
mkdirSync(root);
execFileSync('git', ['init', '-q', root]);
let adapter = {};
try { adapter = await import('./session-context.mjs'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
const expected = (harness, agent = null) => ({
  schema_version: 1, harness, session_id: 'same:root', agent_id: agent,
  workspace: root, source: 'native-hook', harness_version: 'fixture-version',
});

test('native checkout containment uses the host path separator', () => {
  // Exercise the production function with Windows path dependencies on any host.
  const normalize = runInNewContext(`(${adapter.normalizeHookContext.toString()})`, {
    relative: win32.relative, isAbsolute: win32.isAbsolute, sep: win32.sep,
    canonical: value => value,
    object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
    nonempty: value => typeof value === 'string' && value.trim().length > 0,
    failure: (state, reason) => ({ state, context: null, reason }),
    validateContext: value => ({ state: 'available', context: value }),
  });
  const workspace = 'C:\\repo';
  for (const cwd of ['C:\\outside', 'C:\\repo-sibling', 'D:\\repo']) {
    assert.equal(normalize('codex', { session_id: 'x', cwd }, workspace).state, 'conflicting');
  }
  for (const cwd of [workspace, 'C:\\repo\\child']) {
    assert.equal(normalize('codex', { session_id: 'x', cwd }, workspace).state, 'available');
  }
});

test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('exports the context decoder used by the CLI', () => {
  assert.equal(typeof adapter.normalizeHookContext, 'function');
  assert.equal(typeof adapter.validateContext, 'function');
});
for (const harness of ['claude-code', 'codex']) {
  for (const agent of [null, 'child:1']) {
    test(`${harness} preserves native root and separate child identity ${agent}`, () => {
      const result = adapter.normalizeHookContext(harness,
        { session_id: 'same:root', cwd: root, ...(agent ? { agent_id: agent } : {}) },
        root, 'fixture-version');
      assert.deepEqual(result, { state: 'available', context: expected(harness, agent), reason: '' });
      assert.equal(JSON.stringify(result).includes('permissionDecision'), false);
    });
  }
}
test('requires explicit adapter origin', () => {
  assert.equal(adapter.normalizeHookContext(null, { session_id: 'same:root', cwd: root }, root).state, 'unsupported');
  assert.equal(adapter.normalizeHookContext('manual', { session_id: 'x', cwd: root }, root).state, 'unsupported');
});
test('reports missing identity rather than inventing it', () => {
  assert.equal(adapter.normalizeHookContext('codex', { cwd: root }, root).state, 'missing');
});
test('rejects malformed native fields and unrelated checkout', () => {
  for (const input of [null, [], { session_id: 7, cwd: root }, { session_id: 'x', cwd: 7 },
    { session_id: 'x', cwd: root, agent_id: 7 }]) {
    assert.equal(adapter.normalizeHookContext('codex', input, root).state, 'unsupported');
  }
  assert.equal(adapter.normalizeHookContext('codex', { session_id: 'x', cwd: scratch }, root).state, 'conflicting');
});
test('validates every required context field and rejects unsupported versions', () => {
  const value = expected('codex');
  assert.deepEqual(adapter.validateContext(value, root).context, value);
  for (const version of [2, 1.5, '1', true]) {
    assert.equal(adapter.validateContext({ ...value, schema_version: version }, root).state, 'unsupported');
  }
  assert.equal(adapter.validateContext({ ...value, schema_version: 1.0 }, root).context.schema_version, 1);
  for (const field of Object.keys(value)) {
    const missing = { ...value }; delete missing[field];
    assert.equal(adapter.validateContext(missing, root).state, 'unsupported', field);
  }
  for (const patch of [{ harness: 'other' }, { source: 'pointer' }, { session_id: '' },
    { agent_id: '' }, { harness_version: 3 }, { workspace: 'relative' }]) {
    assert.equal(adapter.validateContext({ ...value, ...patch }, root).state, 'unsupported');
  }
  assert.equal(adapter.validateContext({ ...value, workspace: scratch }, root).state, 'conflicting');
});
test('CLI accepts canonical actual checkout and reports mismatch without hook directives', () => {
  const cli = new URL('../scripts/session-context.mjs', import.meta.url);
  const payload = { session_id: 'same:root', cwd: root, tool_name: 'mcp__foreign__write', tool_input: { keep: true } };
  const result = spawnSync(process.execPath, [cli.pathname, '--harness', 'codex', '--workspace', root],
    { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).context.workspace, root);
  assert.equal(JSON.stringify(payload.tool_input), '{"keep":true}');
  assert.equal(result.stdout.includes('updatedInput'), false);
  const nested = join(root, 'nested'); mkdirSync(nested); execFileSync('git', ['init', '-q', nested]);
  const wrong = spawnSync(process.execPath, [cli.pathname, '--harness', 'codex', '--workspace', root],
    { input: JSON.stringify({ ...payload, cwd: nested }), encoding: 'utf8' });
  assert.equal(wrong.status, 2);
  assert.equal(JSON.parse(wrong.stdout).state, 'conflicting');
  const bad = spawnSync(process.execPath, [cli.pathname, '--harness', 'codex', '--workspace', root],
    { input: '{broken', encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.equal(JSON.parse(bad.stdout).state, 'unsupported');
});
