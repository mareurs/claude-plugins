import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {renderPrincipalStampOverride} from '../../scripts/render-codex-principal-override.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const registry = JSON.parse(readFileSync(new URL('./hooks.json', import.meta.url), 'utf8'));
const renderer = join(root, 'scripts/render-codex-principal-override.mjs');
const id = 'codescout-companion@example-marketplace';
const stampCommand = 'node ${CLAUDE_PLUGIN_ROOT}/hooks/principal-stamp.mjs';
const minimal = {hooks: {PreToolUse: [{matcher: 'mcp__codescout__.*', hooks: [{type: 'command', command: stampCommand}]}]}};

test('renders only a disabled metadata state, without mutating registrations', () => {
  const before = JSON.stringify(registry);
  const groups = registry.hooks.PreToolUse;
  const index = groups.findIndex(group => group.hooks.some(hook => hook.command === stampCommand));
  const handler = groups[index].hooks.findIndex(hook => hook.command === stampCommand);
  assert.equal(renderPrincipalStampOverride(registry, id),
    '[hooks.state."' + id + ':hooks/hooks.json:pre_tool_use:' + index + ':' + handler + '"]\nenabled = false\n');
  assert.equal(JSON.stringify(registry), before);
});

test('derives group and handler indices instead of assuming 8:0', () => {
  const changed = structuredClone(minimal);
  changed.hooks.PreToolUse.unshift({hooks: [{type: 'command', command: 'node other.mjs'}]});
  changed.hooks.PreToolUse[1].hooks.unshift({type: 'command', command: 'node guard.mjs'});
  assert.match(renderPrincipalStampOverride(changed, id), /:pre_tool_use:1:1"\]/);
});

test('refuses an absent metadata registration', () => {
  assert.throws(() => renderPrincipalStampOverride({hooks: {PreToolUse: []}}, id));
});

test('refuses ambiguous duplicate metadata registrations', () => {
  const changed = structuredClone(minimal);
  changed.hooks.PreToolUse.push(changed.hooks.PreToolUse[0]);
  assert.throws(() => renderPrincipalStampOverride(changed, id));
});

test('refuses an unexpected wrapper command rather than guessing its identity', () => {
  const changed = structuredClone(minimal);
  changed.hooks.PreToolUse[0].hooks[0].command = 'node wrapper.mjs principal-stamp.mjs';
  assert.throws(() => renderPrincipalStampOverride(changed, id));
});

test('requires the exact server-scoped matcher and command handler', () => {
  for (const mutate of [
    value => { value.hooks.PreToolUse[0].matcher = '*'; },
    value => { value.hooks.PreToolUse[0].hooks[0].type = 'mcp_tool'; }
  ]) {
    const changed = structuredClone(minimal);
    mutate(changed);
    assert.throws(() => renderPrincipalStampOverride(changed, id));
  }
});

test('rejects malformed registries and plugin ids with TOML injection characters', () => {
  for (const value of [null, {}, {hooks: {PreToolUse: 'wrong'}}]) {
    assert.throws(() => renderPrincipalStampOverride(value, id));
  }
  for (const value of ['', 'missing-marketplace', 'x@y"\nenabled=true', 'x@y:z']) {
    assert.throws(() => renderPrincipalStampOverride(minimal, value));
  }
});

test('CLI prints a proposal only; errors never echo supplied content', () => {
  const output = spawnSync(process.execPath, [renderer, '--plugin-id', id], {encoding: 'utf8'});
  assert.equal(output.status, 0);
  assert.equal(output.stdout, renderPrincipalStampOverride(registry, id));
  assert.equal(output.stderr, '');
  const bad = spawnSync(process.execPath, [renderer, '--plugin-id', 'private-fixture@bad"'], {encoding: 'utf8'});
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, '');
  assert.doesNotMatch(bad.stderr, /private-fixture/);
});

test('real hook reproduces the Codex mismatch while preserving the Claude contract', t => {
  const sandbox = mkdtempSync(join(tmpdir(), 'principal-compat-'));
  t.after(() => rmSync(sandbox, {recursive: true, force: true}));
  for (const name of ['home', 'tmp', 'state', 'claude']) mkdirSync(join(sandbox, name));
  const env = {PATH: process.env.PATH, HOME: join(sandbox, 'home'), TMPDIR: join(sandbox, 'tmp'),
    XDG_STATE_HOME: join(sandbox, 'state'), CLAUDE_CONFIG_DIR: join(sandbox, 'claude')};
  const invoke = (script, payload) => {
    const child = spawnSync(process.execPath, [join(root, 'codescout-companion/hooks', script)], {
      input: JSON.stringify(payload), encoding: 'utf8', cwd: sandbox, env, timeout: 5000
    });
    assert.equal(child.status, 0, child.stderr);
    return child.stdout;
  };
  const toolInput = {action: 'status', nested: {values: [false, null, 1]}};
  const payload = {tool_name: 'mcp__codescout__workspace', session_id: 'fixture-session',
    agent_id: 'fixture-agent', tool_input: toolInput};
  const output = JSON.parse(invoke('principal-stamp.mjs', payload)).hookSpecificOutput;
  assert.ok(Object.hasOwn(output, 'updatedInput'));
  assert.ok(!Object.hasOwn(output, 'permissionDecision'));
  assert.deepEqual(output.updatedInput, {...toolInput, 'dev.codescout.mcp/agentId': 'fixture-session/fixture-agent'});
  // Official Codex contract: this combination is invalid. This is an offline
  // predicate, not a live Codex parser/integration test.
  assert.equal(output.permissionDecision === 'allow', false);
  const parent = {...payload}; delete parent.agent_id;
  assert.equal(invoke('principal-stamp.mjs', parent), '');
  assert.equal(invoke('principal-stamp.mjs', {...payload, tool_name: 'mcp__other__workspace'}), '');

  writeFileSync(join(sandbox, '.mcp.json'), JSON.stringify({
    mcpServers: {codescout: {command: '/fixture/codescout', args: ['serve']}}
  }));
  for (const toolName of ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']) {
    // Private dedup state per invocation, never another session's /tmp markers.
    const temp = join(sandbox, 'tmp', toolName); mkdirSync(temp); env.TMPDIR = temp;
    const guard = JSON.parse(invoke('pre-tool-guard.mjs', {
      cwd: sandbox, tool_name: toolName,
      tool_input: {file_path: join(sandbox, 'fixture.ts'), pattern: '*.ts', command: 'fixture only'}
    })).hookSpecificOutput;
    assert.equal(guard.permissionDecision, 'deny', toolName);
    assert.ok(!Object.hasOwn(guard, 'updatedInput'));
  }
});
