// legible OpenCode bridge — unit tests. Run: node harnesses/opencode/tests/test-legible.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DEF, { styleText, registerAgent, onContextFor, AGENT_ID, STYLE_FILE } from '../plugins/legible.js';

let pass = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`  FAIL: ${name}\n        ${String(e?.message || e).split('\n').join('\n        ')}`);
  }
};

const fakeTransform = (agents) => ({
  get: (id) => agents[id],
  update: (id, fn) => {
    const a = agents[id] ?? (agents[id] = { id, name: id, permissions: [{ action: '*', resource: '*', effect: 'allow' }] });
    fn(a);
  },
});

await ok('default export matches the v2 loader union {id, setup}', () => {
  assert.equal(DEF.id, 'legible');
  assert.equal(typeof DEF.setup, 'function');
});

await ok('styleText reads the real style file and drops its frontmatter', () => {
  const t = styleText(STYLE_FILE);
  assert.ok(t.length > 500, 'style body should be substantial');
  assert.ok(!t.startsWith('---'), 'frontmatter must be stripped');
  assert.ok(!/keep-coding-instructions/.test(t), 'frontmatter keys must not leak into the prompt');
  assert.match(t, /Insight/);
});

await ok('styleText on an unreadable file returns empty (fail open), not a throw', () => {
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    assert.equal(styleText('/nonexistent/legible.md'), '');
  } finally {
    process.stderr.write = orig;
  }
});

await ok('styleText handles a file with no frontmatter', () => {
  const d = mkdtempSync(join(tmpdir(), 'legible-'));
  try {
    writeFileSync(join(d, 's.md'), 'just a body\n');
    assert.equal(styleText(join(d, 's.md')), 'just a body');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// The design hinges on this: agent.system REPLACES the coding prompt on 2.1.3.
await ok('the agent never sets `system` (keep-coding-instructions) and copies build', () => {
  const build = {
    id: 'build', mode: 'primary', model: { id: 'main', providerID: 'litellm' },
    permissions: [{ action: '*', resource: '*', effect: 'allow' }, { action: 'question', resource: '*', effect: 'allow' }],
  };
  const agents = { build };
  registerAgent(fakeTransform(agents));
  const a = agents[AGENT_ID];
  assert.ok(a, 'agent registered');
  assert.equal(a.mode, 'primary');
  assert.equal(a.system, undefined, 'system must stay unset, or the coding prompt is lost');
  assert.deepEqual(a.permissions, build.permissions);
  assert.notEqual(a.permissions, build.permissions, 'permissions must be copied, not shared');
  assert.deepEqual(a.model, build.model);
});

await ok('the style is pushed only when the active agent is legible', () => {
  const on = onContextFor('STYLE');
  const ev1 = { agent: 'legible', system: [] };
  on(ev1);
  assert.deepEqual(ev1.system, [{ type: 'text', text: 'STYLE' }]);
  const ev2 = { agent: 'build', system: [] };
  on(ev2);
  assert.deepEqual(ev2.system, []);
  const ev3 = { agent: 'legible', system: [] };
  onContextFor('')(ev3);
  assert.deepEqual(ev3.system, [], 'an empty style adds nothing');
  onContextFor('STYLE')({ agent: 'legible' }); // malformed: must not throw
});

await ok('setup registers the agent and the context hook against a fake ctx', async () => {
  const agents = { build: { id: 'build', permissions: [] } };
  const hooks = [];
  await DEF.setup({
    agent: { transform: async (fn) => fn(fakeTransform(agents)) },
    session: { hook: async (name, fn) => hooks.push([name, fn]) },
  });
  assert.ok(agents[AGENT_ID]);
  assert.deepEqual(hooks.map(([n]) => n), ['context']);
});

console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
