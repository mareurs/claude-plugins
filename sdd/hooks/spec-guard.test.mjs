import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExempt, touchesApprovalFields } from './spec-guard.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'spec-guard.mjs');
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe' });

const dirs = [];
function tmp() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-sg-')));
  dirs.push(d);
  return d;
}
function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function repo({ config = { enforcement: 'strict' } } = {}) {
  const root = tmp();
  git(root, 'init', '-q', '-b', 'main');
  if (config) put(root, '.sdd/config.json', JSON.stringify(config));
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
const SPEC = 'docs/superpowers/specs/2026-11-05-a-design.md';
function addActivePlan(root, name, branch) {
  put(root, `docs/superpowers/specs/2026-11-05-${name}-design.md`, '---\nstatus: approved\n---\nspec\n');
  put(root, `docs/superpowers/plans/2026-11-05-${name}.md`,
    `---\nstatus: approved\n${branch ? `branch: ${branch}\n` : ''}---\n**Spec:** docs/superpowers/specs/2026-11-05-${name}-design.md\n`);
}
function run(payload, raw) {
  const r = spawnSync('node', [HOOK], { input: raw ?? JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout;
}
const parse = (s) => JSON.parse(s).hookSpecificOutput;
const write = (cwd, path, extra = {}) => ({ cwd, tool_name: 'Write', tool_input: { file_path: path, content: 'x', ...extra } });

after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('no config or bad stdin: silent exit 0', () => {
  const root = repo({ config: null });
  assert.equal(run(write(root, join(root, 'src/a.ts'))), '');
  assert.equal(run(null, 'not json'), '');
  assert.equal(run(null, ''), '');
});

test('strict, no active plan: denies every write tool, reason names /sdd:approve', () => {
  const root = repo();
  const cases = [
    { tool_name: 'Write', tool_input: { file_path: join(root, 'src/a.ts'), content: 'x' } },
    { tool_name: 'Edit', tool_input: { file_path: join(root, 'src/a.ts'), new_string: 'x' } },
    { tool_name: 'MultiEdit', tool_input: { file_path: join(root, 'src/a.ts'), edits: [{ new_string: 'x' }] } },
    { tool_name: 'NotebookEdit', tool_input: { notebook_path: join(root, 'src/a.ipynb'), new_source: 'x' } },
    { tool_name: 'mcp__codescout__edit_file', tool_input: { path: 'src/a.ts', new_string: 'x', workspace: root } },
    { tool_name: 'mcp__codescout__edit_code', tool_input: { path: 'src/a.ts', code: 'x', workspace: root } },
    { tool_name: 'mcp__codescout__create_file', tool_input: { path: 'src/a.ts', content: 'x' } },
  ];
  for (const c of cases) {
    const out = parse(run({ cwd: root, ...c }));
    assert.equal(out.hookEventName, 'PreToolUse', c.tool_name);
    assert.equal(out.permissionDecision, 'deny', c.tool_name);
    assert.match(out.permissionDecisionReason, /\/sdd:approve/, c.tool_name);
  }
});

test('warn mode: context, no decision', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  const out = parse(run(write(root, join(root, 'src/a.ts'))));
  assert.ok(out.additionalContext);
  assert.equal(out.permissionDecision, undefined);
});

test('exempt targets pass silently', () => {
  const root = repo();
  for (const p of ['docs/x.ts', '.sdd/x', '.claude/x', '.codescout/x', 'README.md', 'a.json', 'a.yaml', 'a.yml',
    'a.toml', 'a.ini', '.env', 'C:\\repo\\docs\\x.ts']) {
    assert.equal(run(write(root, p.startsWith('C:') ? p : join(root, p))), '', p);
  }
  assert.equal(isExempt('C:\\repo\\docs\\x.ts'), true);
  assert.equal(isExempt('src/a.ts'), false);
});

test('one active plan, main checkout: allowed; two: allowed', () => {
  const root = repo();
  addActivePlan(root, 'a');
  assert.equal(run(write(root, join(root, 'src/a.ts'))), '');
  addActivePlan(root, 'b');
  assert.equal(run(write(root, join(root, 'src/a.ts'))), '');
});

test('worktree on branch with a draft plan: denied even though another plan is active', () => {
  const root = repo();
  addActivePlan(root, 'a');
  put(root, 'docs/superpowers/plans/2026-11-05-x.md',
    '---\nstatus: draft\nbranch: feat/x\n---\n**Spec:** docs/superpowers/specs/2026-11-05-a-design.md\n');
  const wt = join(tmp(), 'wt');
  git(root, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
  const out = parse(run(write(wt, join(wt, 'src/a.ts'))));
  assert.equal(out.permissionDecision, 'deny');
  // main checkout still passes
  assert.equal(run(write(root, join(root, 'src/a.ts'))), '');
});

test('approval fields: denied in warn mode too; draft allowed', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  const p = join(root, SPEC);
  const calls = [
    { tool_name: 'Edit', tool_input: { file_path: p, new_string: 'status: approved' } },
    { tool_name: 'Write', tool_input: { file_path: p, content: '---\nstatus: approved\n---\n' } },
    { tool_name: 'Write', tool_input: { file_path: p, content: '---\napproved: 2026-11-05\n---\n' } },
    { tool_name: 'MultiEdit', tool_input: { file_path: p, edits: [{ new_string: 'status: done' }] } },
    { tool_name: 'mcp__codescout__edit_file', tool_input: { path: p, new_string: 'status: implemented' } },
    { tool_name: 'mcp__codescout__edit_file', tool_input: { path: p, edits: [{ old_string: 'a', new_string: 'status: approved' }] } },
    { tool_name: 'mcp__codescout__edit_file', tool_input: { path: SPEC, workspace: root, frontmatter: { set: { status: 'approved' } } } },
    { tool_name: 'mcp__codescout__create_file', tool_input: { path: p, content: '---\nstatus: "approved"\n---\n' } },
  ];
  for (const c of calls) {
    const out = parse(run({ cwd: root, ...c }));
    assert.equal(out.permissionDecision, 'deny', JSON.stringify(c));
    assert.match(out.permissionDecisionReason, /\/sdd:approve/);
  }
  assert.equal(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: p, new_string: 'status: draft' } }), '');
  assert.equal(run({ cwd: root, tool_name: 'mcp__codescout__edit_file',
    tool_input: { path: SPEC, workspace: root, frontmatter: { set: { status: 'draft' } } } }), '');
  assert.equal(touchesApprovalFields({ tool_name: 'Edit', tool_input: { new_string: 'status: draft' } }), false);
  assert.equal(touchesApprovalFields({ tool_name: 'Edit', tool_input: { old_string: 'a', new_string: 'status: approved' } }), true); // unreadable file: text fallback
});

test('approval-record directory: denied, except <feature>.report.json', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  const ad = join(root, '.git', 'sdd', 'approvals');
  assert.equal(parse(run(write(root, join(ad, 'x')))).permissionDecision, 'deny');
  assert.equal(parse(run(write(root, join(ad, 'x.json')))).permissionDecision, 'deny');
  assert.equal(parse(run(write(root, join(ad, 'sub', 'x.report.json')))).permissionDecision, 'deny');
  assert.equal(run(write(root, join(ad, 'feat.report.json'))), '');
});

const PLANP = 'docs/superpowers/plans/2026-11-05-a.md';
const DRAFT_SPEC_BODY = '---\nstatus: draft\ntitle: T\n---\n\n# Spec\n';
const denied = (out, msg) => {
  const o = parse(out);
  assert.equal(o.permissionDecision, 'deny', msg);
  assert.match(o.permissionDecisionReason, /\/sdd:approve/, msg);
};

test('value-only edits that flip draft to approved are denied (before/after compare)', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  put(root, SPEC, DRAFT_SPEC_BODY);
  const p = join(root, SPEC);
  denied(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: p, old_string: 'draft', new_string: 'approved' } }), 'Edit');
  denied(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: p, old_string: 'draft\ntitle', new_string: 'approved\ntitle' } }), 'Edit multi-line');
  denied(run({ cwd: root, tool_name: 'MultiEdit', tool_input: { file_path: p, edits: [{ old_string: 'T', new_string: 'U' }, { old_string: 'draft', new_string: 'approved' }] } }), 'MultiEdit');
  denied(run({ cwd: root, tool_name: 'mcp__codescout__edit_file', tool_input: { path: SPEC, workspace: root, old_string: 'us: draft', new_string: 'us: approved' } }), 'edit_file');
  denied(run({ cwd: root, tool_name: 'mcp__codescout__edit_file', tool_input: { path: SPEC, workspace: root, edits: [{ old_string: 'draft', new_string: 'done' }] } }), 'edit_file edits[]');
  // unreadable file: text fallback only
  assert.equal(touchesApprovalFields({ tool_input: { old_string: 'a', new_string: 'status: approved' } }, join(tmpdir(), 'no-such-file.md')), true);
  // an edit that leaves the status alone passes
  assert.equal(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: p, old_string: 'T\n', new_string: 'U\n' } }), '');
});

test('unchanged approval or quoted text in a body is allowed; a changing Write is denied', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  put(root, PLANP, '---\nstatus: approved\n---\nplan\n');
  const p = join(root, PLANP);
  assert.equal(run({ cwd: root, tool_name: 'Write', tool_input: { file_path: p, content: '---\nstatus: approved\n---\nplan v2\n' } }), '');
  assert.equal(run({ cwd: root, tool_name: 'Write', tool_input: { file_path: p, content: '---\nstatus: approved\n---\nplan\n```\nstatus: approved\n```\n' } }), '');
  put(root, SPEC, DRAFT_SPEC_BODY);
  assert.equal(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, SPEC), old_string: '# Spec', new_string: '# Spec\n\nExample:\nstatus: approved\n' } }), '');
  denied(run({ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, SPEC), content: '---\nstatus: approved\n---\n' } }), 'Write draft->approved');
  denied(run({ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'docs/superpowers/specs/new.md'), content: '---\nstatus: approved\n---\n' } }), 'new file');
});

test('every carrier is covered, on spec and plan paths', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  for (const rel of [SPEC, PLANP]) {
    const p = join(root, rel);
    for (const c of [
      { tool_name: 'NotebookEdit', tool_input: { notebook_path: p, new_source: 'status: approved' } },
      { tool_name: 'mcp__codescout__edit_file', tool_input: { path: p, edits: [{ content: 'status: approved' }] } },
      { tool_name: 'mcp__codescout__edit_code', tool_input: { path: p, code: 'status: approved' } },
      { tool_name: 'mcp__codescout__edit_code', tool_input: { path: p, new_code: 'approved: 2026-11-05' } },
      { tool_name: 'mcp__codescout__create_file', tool_input: { path: p, content: '---\nstatus: done\n---\n' } },
    ]) denied(run({ cwd: root, ...c }), `${rel} ${c.tool_name}`);
  }
});

test('strict mode: approval-field deny wins even with an active plan', () => {
  const root = repo();
  addActivePlan(root, 'a');
  denied(run({ cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, SPEC), old_string: 'approved', new_string: 'approved\napproved: x' } }), 'strict');
  denied(run({ cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'docs/superpowers/plans/2026-11-05-new.md'), content: '---\nstatus: approved\n---\n' } }), 'strict write');
});

test('report.json from a worktree is allowed, other approvals files denied', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  const wt = join(tmp(), 'wt');
  git(root, 'worktree', 'add', '-q', '-b', 'feat/y', wt);
  const ad = join(root, '.git', 'sdd', 'approvals');
  assert.equal(run({ cwd: wt, tool_name: 'mcp__codescout__create_file', tool_input: { path: join(ad, 'f.report.json'), content: '{}' } }), '');
  denied(run({ cwd: wt, tool_name: 'mcp__codescout__create_file', tool_input: { path: join(ad, 'f.json'), content: '{}' } }), 'other file');
  // relative path, no workspace, cwd in the worktree (wt/.git is a file)
  denied(run({ cwd: wt, tool_name: 'mcp__codescout__create_file', tool_input: { path: '.git/sdd/approvals/x.review.json', content: '{}' } }), 'relative');
  assert.equal(run({ cwd: wt, tool_name: 'mcp__codescout__create_file', tool_input: { path: '.git/sdd/approvals/x.report.json', content: '{}' } }), '');
});

test('paths with spaces and backslashes', () => {
  const root = repo();
  assert.equal(run(write(root, join(root, 'docs', 'sub dir', 'x.ts'))), '');
  assert.equal(parse(run(write(root, join(root, 'src dir', 'a b.ts')))).permissionDecision, 'deny');
  assert.equal(run({ cwd: root, tool_name: 'mcp__codescout__edit_file', tool_input: { path: 'docs\\x.ts', new_string: 'x' } }), '');
  assert.equal(parse(run({ cwd: root, tool_name: 'mcp__codescout__edit_file', tool_input: { path: 'src\\a.ts', new_string: 'x' } })).permissionDecision, 'deny');
  const ad = join(root, '.git', 'sdd', 'approvals', 'x').replace(/\//g, '\\');
  denied(run(write(root, ad)), 'backslashed approvals');
});

test('codescout doc: update/create setting an approval field is denied; find and others pass', () => {
  const root = repo({ config: { enforcement: 'warn' } });
  const d = (tool_input) => run({ cwd: root, tool_name: 'mcp__codescout__doc', tool_input });
  denied(d({ action: 'update', id: 'abc', patch: { status: 'approved' } }), 'patch.status');
  assert.equal(d({ action: 'update', id: 'abc', patch: { status: 'done' } }), '');
  assert.equal(d({ action: 'update', id: 'abc', patch: { status: 'implemented' } }), '');
  denied(d({ action: 'update', id: 'abc', patch: { extra: { approved: '2026-11-05' } } }), 'extra.approved');
  denied(d({ action: 'create', kind: 'spec', title: 't', rel_path: 'docs/superpowers/specs/x.md', status: 'approved' }), 'create');
  assert.equal(d({ action: 'update', id: 'abc', patch: { status: 'draft' } }), '');
  assert.equal(d({ action: 'update', id: 'abc', patch: { body: 'text mentioning status: approved' } }), '');
  assert.equal(d({ action: 'find', filter: { status: { eq: 'approved' } } }), '');
  assert.equal(d({ action: 'find', kind: 'spec', status: 'approved' }), '');
  assert.equal(d({ action: 'get', id: 'abc' }), '');
  const none = repo({ config: null });
  assert.equal(run({ cwd: none, tool_name: 'mcp__codescout__doc', tool_input: { action: 'update', id: 'a', patch: { status: 'approved' } } }), '');
});
