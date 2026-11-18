import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, 'subagent-inject.mjs');
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe' });

const dirs = [];
function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function repo(config = '{"enforcement":"strict"}') {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-si-')));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  if (config !== null) put(root, '.sdd/config.json', config);
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function addActivePlan(root, name, branch) {
  put(root, `docs/superpowers/specs/2026-11-05-${name}-design.md`, '---\nstatus: approved\n---\nspec\n');
  put(root, `docs/superpowers/plans/2026-11-05-${name}.md`,
    `---\nstatus: approved\nfeature: ${name}\n${branch ? `branch: ${branch}\n` : ''}---\n**Spec:** docs/superpowers/specs/2026-11-05-${name}-design.md\n`);
}
function run(payload, raw) {
  const r = spawnSync('node', [HOOK], { input: raw ?? JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout;
}
const ctx = (s) => JSON.parse(s).hookSpecificOutput;

after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('implementer agent types get the active plan and spec paths', () => {
  const root = repo();
  addActivePlan(root, 'auth-login');
  for (const agent_type of ['general-purpose', 'Plan', 'claude']) {
    const out = ctx(run({ cwd: root, agent_type }));
    assert.equal(out.hookEventName, 'SubagentStart', agent_type);
    assert.match(out.additionalContext, /docs\/superpowers\/plans\/2026-11-05-auth-login\.md/);
    assert.match(out.additionalContext, /docs\/superpowers\/specs\/2026-11-05-auth-login-design\.md/);
    assert.match(out.additionalContext, /spec/i);
    assert.ok(!out.additionalContext.includes('symbols('), 'no tool-routing text');
  }
});

test('two active plans, no branch match: both listed', () => {
  const root = repo();
  addActivePlan(root, 'one', 'feat/one');
  addActivePlan(root, 'two', 'feat/two');
  const out = ctx(run({ cwd: root, agent_type: 'general-purpose' }));
  assert.match(out.additionalContext, /2026-11-05-one\.md/);
  assert.match(out.additionalContext, /2026-11-05-two\.md/);
});

test('current branch matches a plan branch: only that plan listed', () => {
  const root = repo();
  addActivePlan(root, 'one', 'feat/one');
  addActivePlan(root, 'two', 'feat/two');
  git(root, 'checkout', '-q', '-b', 'feat/two');
  const out = ctx(run({ cwd: root, agent_type: 'general-purpose' }));
  assert.match(out.additionalContext, /2026-11-05-two\.md/);
  assert.doesNotMatch(out.additionalContext, /2026-11-05-one\.md/);
});

test('Explore, Bash, missing type: silent', () => {
  const root = repo();
  addActivePlan(root, 'auth-login');
  assert.equal(run({ cwd: root, agent_type: 'Explore' }), '');
  assert.equal(run({ cwd: root, agent_type: 'Bash' }), '');
  assert.equal(run({ cwd: root }), '');
});

test('no config, no active plan, bad stdin: silent', () => {
  const none = repo(null);
  addActivePlan(none, 'x');
  assert.equal(run({ cwd: none, agent_type: 'general-purpose' }), '');
  const noPlan = repo();
  assert.equal(run({ cwd: noPlan, agent_type: 'general-purpose' }), '');
  assert.equal(run(null, 'not json'), '');
});

test('hooks.json: single-string node commands, files exist, nothing async, five hooks', () => {
  const j = JSON.parse(readFileSync(join(HERE, 'hooks.json'), 'utf8'));
  const cmds = [];
  for (const groups of Object.values(j.hooks)) {
    for (const g of groups) for (const h of g.hooks) {
      assert.equal(typeof h.command, 'string');
      assert.match(h.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.mjs"$/);
      assert.notEqual(h.async, true);
      cmds.push(h.command);
      assert.ok(existsSync(join(HERE, h.command.match(/hooks\/([a-z-]+\.mjs)/)[1])), h.command);
    }
  }
  assert.equal(new Set(cmds).size, 5);
  assert.equal(j.hooks.SessionStart[0].matcher, 'startup|resume|clear|compact');
  assert.equal(j.hooks.PreToolUse.length, 2);
  // exact matchers: a tool dropped from a matcher silently escapes its guard
  const script = (g) => g.hooks.map((h) => h.command.match(/hooks\/([a-z-]+\.mjs)/)[1]).join(',');
  const pre = Object.fromEntries(j.hooks.PreToolUse.map((g) => [script(g), g.matcher]));
  assert.deepEqual(pre, {
    'spec-guard.mjs': 'Write|Edit|MultiEdit|NotebookEdit|mcp__codescout__edit_file|mcp__codescout__edit_code|mcp__codescout__create_file|mcp__codescout__doc',
    'review-guard.mjs': 'Bash|mcp__codescout__run_command',
  });
  assert.ok(j.hooks.UserPromptSubmit && j.hooks.SubagentStart);
  for (const ev of ['UserPromptSubmit', 'SubagentStart']) {
    assert.equal(j.hooks[ev].length, 1, ev);
    assert.equal(j.hooks[ev][0].matcher, undefined, `${ev} has no matcher`);
  }
});
