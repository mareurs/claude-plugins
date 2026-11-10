// sdd OpenCode bridge — tests against the REAL sdd hooks in throwaway git repos.
// Run: node harnesses/opencode/tests/test-sdd.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import DEF, { buildSddBridge, sddActive, hooksFor, patchCalls, rehostSdd, lastUserMessage } from '../plugins/sdd.js';

// Isolation (repo rule): hooks may write markers to os.tmpdir() / XDG_STATE_HOME.
const SANDBOX = realpathSync(mkdtempSync(join(tmpdir(), 'oc-sdd-test-')));
mkdirSync(join(SANDBOX, 'tmp'));
mkdirSync(join(SANDBOX, 'state'));
process.env.TMPDIR = join(SANDBOX, 'tmp');
process.env.XDG_STATE_HOME = join(SANDBOX, 'state');
process.on('exit', () => rmSync(SANDBOX, { recursive: true, force: true }));

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

const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe' });
const put = (root, rel, text) => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};
let n = 0;
function repo({ config = { enforcement: 'strict' } } = {}) {
  const root = join(SANDBOX, `repo${n++}`);
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  if (config) put(root, '.sdd/config.json', JSON.stringify(config));
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function addActivePlan(root, name) {
  put(root, `docs/superpowers/specs/2026-11-05-${name}-design.md`, '---\nstatus: approved\n---\nspec\n');
  put(root, `docs/superpowers/plans/2026-11-05-${name}.md`,
    `---\nstatus: approved\n---\n**Spec:** docs/superpowers/specs/2026-11-05-${name}-design.md\n`);
}
const denied = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return String(e.message);
  }
};
const top = { getSession: async () => ({ data: { id: 's' } }) }; // no parentID → top-level
const child = { getSession: async () => ({ data: { id: 'c', parentID: 'p' } }) };

await ok('default export matches the v2 loader union {id, setup}', () => {
  assert.equal(DEF.id, 'sdd');
  assert.equal(typeof DEF.setup, 'function');
});

await ok('routing: write tools → spec-guard, shell tools → review-guard, others → nothing', () => {
  for (const t of ['edit', 'write', 'patch', 'codescout_edit_file', 'codescout_edit_code', 'codescout_create_file', 'codescout_doc']) assert.equal(hooksFor(t), 'spec', t);
  for (const t of ['shell', 'bash', 'codescout_run_command']) assert.equal(hooksFor(t), 'review', t);
  for (const t of ['read', 'grep', 'glob', 'todowrite', 'codescout_read_file', 'webfetch']) assert.equal(hooksFor(t), null, t);
});

await ok('patch text splits into one guard call per file (Add → write with content)', () => {
  const calls = patchCalls({ patchText: '*** Begin Patch\n*** Add File: a.ts\n+one\n+two\n*** Update File: b.ts\n@@\n-x\n+y\n*** Delete File: c.ts\n*** End Patch' });
  assert.deepEqual(calls, [
    { tool_name: 'write', tool_input: { filePath: 'a.ts', content: 'one\ntwo' } },
    { tool_name: 'edit', tool_input: { filePath: 'b.ts' } },
    { tool_name: 'edit', tool_input: { filePath: 'c.ts' } },
  ]);
});

await ok('command names in hook text are mapped to their OpenCode spelling', () => {
  assert.equal(rehostSdd('Run /sdd:approve spec x, then `/review`.'), 'Run /sdd-approve spec x, then `/sdd-review`.');
  assert.equal(rehostSdd('see docs/review/notes'), 'see docs/review/notes', 'a path is not a command');
});

await ok('sddActive follows .sdd/config.json up the tree', () => {
  const r = repo();
  mkdirSync(join(r, 'src', 'deep'), { recursive: true });
  assert.equal(sddActive(join(r, 'src', 'deep')), true);
  assert.equal(sddActive(repo({ config: null })), false);
});

await ok('strict, no approved plan: a source edit is DENIED, naming /sdd-approve', async () => {
  const r = repo();
  const b = buildSddBridge(r, top);
  const msg = await denied(b.onToolBefore({ tool: 'edit', sessionID: 's', id: 'e1', input: { filePath: join(r, 'src/a.ts'), oldString: 'a', newString: 'b' } }));
  assert.ok(msg, 'the edit must be denied');
  assert.match(msg, /\/sdd-approve/);
  assert.doesNotMatch(msg, /\/sdd:approve/);
});

await ok('the same edit is allowed once a plan and its spec are approved', async () => {
  const r = repo();
  addActivePlan(r, 'a');
  const b = buildSddBridge(r, top);
  assert.equal(await denied(b.onToolBefore({ tool: 'write', sessionID: 's', id: 'w1', input: { filePath: join(r, 'src/a.ts'), content: 'x' } })), null);
});

await ok('a multi-file patch is denied when one file is denied', async () => {
  const r = repo();
  const b = buildSddBridge(r, top);
  const msg = await denied(b.onToolBefore({ tool: 'patch', sessionID: 's', id: 'p1', input: { patchText: '*** Begin Patch\n*** Add File: src/new.ts\n+x\n*** End Patch' } }));
  assert.ok(msg, 'a patch creating a source file must be denied in strict mode');
});

await ok('a tool write to approval frontmatter is denied even with an active plan', async () => {
  const r = repo();
  addActivePlan(r, 'a');
  const b = buildSddBridge(r, top);
  const spec = join(r, 'docs/superpowers/specs/2026-11-05-a-design.md');
  const msg = await denied(b.onToolBefore({ tool: 'edit', sessionID: 's', id: 'e2', input: { filePath: spec, oldString: 'x', newString: 'status: approved' } }));
  assert.ok(msg, 'only the user may approve');
});

await ok('outside an sdd project nothing is guarded and no hook is spawned', async () => {
  const r = repo({ config: null });
  let spawned = 0;
  const b = buildSddBridge(r, { ...top, run: async () => { spawned++; return null; } });
  await b.onToolBefore({ tool: 'edit', sessionID: 's', id: 'e3', input: { filePath: join(r, 'src/a.ts') } });
  const ev = { sessionID: 's', system: [], messages: [] };
  await b.onContext(ev);
  assert.equal(spawned, 0);
  assert.deepEqual(ev.system, []);
});

await ok('top-level session: the banner names the mode and /sdd-approve', async () => {
  const r = repo();
  const b = buildSddBridge(r, top);
  const ev = { sessionID: 's1', agent: 'build', system: [], messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hello' }] }] };
  await b.onContext(ev);
  const text = ev.system.map((p) => p.text).join('\n');
  assert.match(text, /SDD enforcement: strict/);
  assert.match(text, /\/sdd-approve/);
});

await ok('/sdd-approve typed by the user in a top-level session writes the approval', async () => {
  const r = repo();
  put(r, 'docs/superpowers/specs/2026-11-05-a-design.md', '---\nstatus: draft\ntitle: T\n---\n\n# Spec\n');
  const b = buildSddBridge(r, top);
  const ev = { sessionID: 's2', agent: 'build', system: [], messages: [{ id: 'm2', role: 'user', content: [{ type: 'text', text: 'sdd approve spec a\n' }] }] };
  await b.onContext(ev);
  const text = ev.system.map((p) => p.text).join('\n');
  assert.match(text, /approved/i, `expected an approval confirmation, got: ${text}`);
  const { readFileSync } = await import('node:fs');
  assert.match(readFileSync(join(r, 'docs/superpowers/specs/2026-11-05-a-design.md'), 'utf8'), /status: approved/);
});

await ok('the same approval text in a CHILD session approves nothing', async () => {
  const r = repo();
  put(r, 'docs/superpowers/specs/2026-11-05-a-design.md', '---\nstatus: draft\ntitle: T\n---\n\n# Spec\n');
  const b = buildSddBridge(r, child);
  const ev = { sessionID: 'c1', agent: 'general', system: [], messages: [{ id: 'm3', role: 'user', content: [{ type: 'text', text: 'sdd approve spec a' }] }] };
  await b.onContext(ev);
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync(join(r, 'docs/superpowers/specs/2026-11-05-a-design.md'), 'utf8'), /status: approved/);
});

await ok('when the session lookup fails, approvals fail CLOSED', async () => {
  const r = repo();
  put(r, 'docs/superpowers/specs/2026-11-05-a-design.md', '---\nstatus: draft\ntitle: T\n---\n\n# Spec\n');
  const b = buildSddBridge(r, { getSession: async () => { throw new Error('lookup failed'); } });
  const ev = { sessionID: 's3', system: [], messages: [{ id: 'm4', role: 'user', content: [{ type: 'text', text: 'sdd approve spec a' }] }] };
  await b.onContext(ev);
  const { readFileSync } = await import('node:fs');
  assert.doesNotMatch(readFileSync(join(r, 'docs/superpowers/specs/2026-11-05-a-design.md'), 'utf8'), /status: approved/);
});

await ok('an approval message is processed once, not on every request of the turn', async () => {
  const r = repo();
  let intake = 0;
  const b = buildSddBridge(r, {
    ...top,
    run: async (script) => { if (script.endsWith('approve-intake.mjs')) intake++; return null; },
  });
  const ev = () => ({ sessionID: 's4', system: [], messages: [{ id: 'm5', role: 'user', content: [{ type: 'text', text: 'sdd approve spec a' }] }] });
  await b.onContext(ev());
  await b.onContext(ev());
  assert.equal(intake, 1);
});

await ok('child session with an active plan: implementer gets the plan and spec pointers', async () => {
  const r = repo();
  addActivePlan(r, 'a');
  const b = buildSddBridge(r, child);
  const ev = { sessionID: 'c2', agent: 'general', system: [], messages: [] };
  await b.onContext(ev);
  const text = ev.system.map((p) => p.text).join('\n');
  assert.match(text, /Plan: docs\/superpowers\/plans\/2026-11-05-a\.md/);
  assert.match(text, /Spec: docs\/superpowers\/specs\/2026-11-05-a-design\.md/);
});

await ok('lastUserMessage reads the latest user text part', () => {
  assert.deepEqual(lastUserMessage([
    { id: 'a', role: 'user', content: [{ type: 'text', text: 'one' }] },
    { id: 'b', role: 'assistant', content: [{ type: 'text', text: 'two' }] },
  ]), { id: 'a', text: 'one' });
  assert.equal(lastUserMessage(undefined), null);
});

console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
