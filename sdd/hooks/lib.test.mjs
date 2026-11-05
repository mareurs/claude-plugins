// sdd/hooks/lib.test.mjs
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as lib from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const COPIED = [
  'readInput', 'emit', 'denyPreToolUse', 'contextPreToolUse',
  'normalizedToolName', 'inputPath', 'isCodescoutTool', 'isWriteOperation',
];

function fnText(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) return null;
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 3);
}

const tmps = [];
function tmp() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-lib-')));
  tmps.push(d);
  return d;
}
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();

function write(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

after(() => { for (const d of tmps) rmSync(d, { recursive: true, force: true }); });

describe('copy parity with codescout-companion', () => {
  const ours = readFileSync(join(here, 'lib.mjs'), 'utf8');
  const theirs = readFileSync(join(here, '..', '..', 'codescout-companion', 'hooks', 'lib.mjs'), 'utf8');
  for (const name of COPIED) {
    test(name, () => {
      const a = fnText(ours, name);
      const b = fnText(theirs, name);
      assert.ok(b, `${name} missing in companion`);
      assert.equal(a, b);
    });
  }
});

describe('mainCheckout / currentBranch', () => {
  let main, wt, outside;
  before(() => {
    main = tmp();
    git(main, 'init', '-q', '-b', 'main');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'x');
    wt = join(main, 'wt-dir');
    git(main, 'worktree', 'add', '-q', '-b', 'feat/x', wt);
    outside = tmp();
  });

  test('from a worktree returns the main root', () => {
    const r = lib.mainCheckout(wt);
    assert.equal(r.root, main);
    assert.equal(r.commonDir, join(main, '.git'));
    assert.ok(r.gitDir.startsWith(join(main, '.git', 'worktrees')));
  });
  test('from a subdirectory of a worktree', () => {
    mkdirSync(join(wt, 'a', 'b'), { recursive: true });
    assert.equal(lib.mainCheckout(join(wt, 'a', 'b')).root, main);
  });
  test('from the main checkout returns itself', () => {
    const r = lib.mainCheckout(main);
    assert.equal(r.root, main);
    assert.equal(r.commonDir, join(main, '.git'));
    assert.equal(r.gitDir, join(main, '.git'));
  });
  test('separate git dir: root is the dir holding the .git file', () => {
    const base = tmp();
    const sep = join(base, 'sepgit');
    const work = join(base, 'sep');
    git(base, 'init', '-q', '-b', 'main', `--separate-git-dir=${sep}`, work);
    const r = lib.mainCheckout(work);
    assert.equal(r.root, work);
    assert.equal(r.gitDir, sep);
  });
  test('worktree of a separate-git-dir repo falls back to the worktree dir', () => {
    const base = tmp();
    const sep = join(base, 'sepgit');
    const work = join(base, 'sep');
    git(base, 'init', '-q', '-b', 'main', `--separate-git-dir=${sep}`, work);
    git(work, 'commit', '-q', '--allow-empty', '-m', 'x');
    const wt2 = join(base, 'wt2');
    git(work, 'worktree', 'add', '-q', '-b', 'f2', wt2);
    assert.equal(lib.mainCheckout(wt2).root, wt2);
  });
  test('outside a repo returns null', () => {
    assert.equal(lib.mainCheckout(outside), null);
  });
  test('currentBranch on a branch', () => {
    assert.equal(lib.currentBranch(lib.mainCheckout(main).gitDir), 'main');
    assert.equal(lib.currentBranch(lib.mainCheckout(wt).gitDir), 'feat/x');
  });
  test('currentBranch on detached HEAD is null', () => {
    const d = tmp();
    git(d, 'init', '-q', '-b', 'main');
    git(d, 'commit', '-q', '--allow-empty', '-m', 'x');
    git(d, 'checkout', '-q', '--detach');
    assert.equal(lib.currentBranch(join(d, '.git')), null);
  });
});

describe('loadConfig', () => {
  test('absent -> null', () => {
    assert.equal(lib.loadConfig(tmp()), null);
  });
  test('strict, no baseBranch', () => {
    const d = tmp();
    write(d, '.sdd/config.json', '{"enforcement":"strict"}');
    assert.deepEqual(lib.loadConfig(d), { enforcement: 'strict', baseBranch: null, error: null });
  });
  test('baseBranch passes through', () => {
    const d = tmp();
    write(d, '.sdd/config.json', '{"enforcement":"warn","baseBranch":"develop"}');
    assert.equal(lib.loadConfig(d).baseBranch, 'develop');
  });
  test('malformed -> warn + unreadable', () => {
    const d = tmp();
    write(d, '.sdd/config.json', 'not json');
    assert.deepEqual(lib.loadConfig(d), { enforcement: 'warn', baseBranch: null, error: 'unreadable' });
  });
});

describe('frontmatter', () => {
  test('readFrontmatter LF, CRLF, BOM', () => {
    assert.deepEqual(lib.readFrontmatter('---\nstatus: approved\n---\nbody'), { status: 'approved' });
    assert.deepEqual(lib.readFrontmatter('---\r\nstatus: approved\r\n---\r\nbody'), { status: 'approved' });
    assert.deepEqual(lib.readFrontmatter('﻿---\nstatus: approved\n---\nbody'), { status: 'approved' });
  });
  test('readFrontmatter strips matching quotes', () => {
    assert.deepEqual(lib.readFrontmatter('---\na: "x y"\nb: \'z\'\n---\n'), { a: 'x y', b: 'z' });
  });
  test('readFrontmatter without a block -> {}', () => {
    assert.deepEqual(lib.readFrontmatter('no block'), {});
  });
  test('writeFrontmatterFields changes only the named key', () => {
    const d = tmp();
    const before = '---\ntitle: T\nstatus: draft\nowner: me\n---\n\n# Body\n';
    const p = write(d, 'a.md', before);
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), before.replace('status: draft', 'status: approved'));
  });
  test('writeFrontmatterFields inserts a missing key', () => {
    const d = tmp();
    const p = write(d, 'a.md', '---\ntitle: T\n---\nbody\n');
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), '---\ntitle: T\nstatus: approved\n---\nbody\n');
  });
  test('writeFrontmatterFields fills an empty block', () => {
    const d = tmp();
    const p = write(d, 'a.md', '---\n\n---\nbody\n');
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), '---\nstatus: approved\n---\nbody\n');
    assert.deepEqual(lib.readFrontmatter(readFileSync(p, 'utf8')), { status: 'approved' });
  });
  test('writeFrontmatterFields fills an empty-adjacent block', () => {
    const d = tmp();
    const p = write(d, 'a.md', '---\n---\nbody\n');
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), '---\nstatus: approved\n---\nbody\n');
  });
  test('writeFrontmatterFields ignores a later --- rule when no block exists', () => {
    const d = tmp();
    const p = write(d, 'a.md', '# T\n\n---\n\nx\n');
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), '---\nstatus: approved\n---\n# T\n\n---\n\nx\n');
  });
  test('writeFrontmatterFields creates a block when none', () => {
    const d = tmp();
    const p = write(d, 'a.md', '# Body\n');
    lib.writeFrontmatterFields(p, { status: 'approved' });
    assert.equal(readFileSync(p, 'utf8'), '---\nstatus: approved\n---\n# Body\n');
    assert.deepEqual(lib.readFrontmatter(readFileSync(p, 'utf8')), { status: 'approved' });
  });
});

describe('artifacts and activePlans', () => {
  const SPEC = 'docs/superpowers/specs/2026-11-05-auth-login-design.md';
  const PLAN = 'docs/superpowers/plans/2026-11-05-auth-login.md';
  const planBody = (s) => `---\nstatus: ${s}\n---\n# Plan\n\n**Spec:** ${SPEC}\n`;

  test('specPointer', () => {
    assert.equal(lib.specPointer(planBody('approved')), SPEC);
    assert.equal(lib.specPointer('# nothing'), null);
  });
  test('listArtifacts', () => {
    const d = tmp();
    write(d, SPEC, '---\nstatus: draft\n---\nS');
    write(d, 'docs/superpowers/specs/notes.txt', 'x');
    const l = lib.listArtifacts(d, 'specs');
    assert.equal(l.length, 1);
    assert.equal(l[0].path, join(d, SPEC));
    assert.equal(l[0].fm.status, 'draft');
    assert.ok(l[0].body.includes('S'));
    assert.deepEqual(lib.listArtifacts(d, 'plans'), []);
  });
  test('approved plan + approved spec is active', () => {
    const d = tmp();
    write(d, SPEC, '---\nstatus: approved\n---\nS');
    write(d, PLAN, planBody('approved'));
    const a = lib.activePlans(d);
    assert.equal(a.length, 1);
    assert.equal(a[0].path, join(d, PLAN));
    assert.equal(a[0].specPath, join(d, SPEC));
  });
  test('approved plan + draft spec is not active', () => {
    const d = tmp();
    write(d, SPEC, '---\nstatus: draft\n---\nS');
    write(d, PLAN, planBody('approved'));
    assert.deepEqual(lib.activePlans(d), []);
  });
  test('draft plan is not active', () => {
    const d = tmp();
    write(d, SPEC, '---\nstatus: approved\n---\nS');
    assert.deepEqual(lib.activePlans(d), []);
  });
  test('spec pointer outside docs/superpowers/specs is not active', () => {
    const d = tmp();
    write(d, 'notes/x.md', '---\nstatus: approved\n---\nS');
    write(d, PLAN, '---\nstatus: approved\n---\n# Plan\n\n**Spec:** notes/x.md\n');
    assert.deepEqual(lib.activePlans(d), []);
    write(d, PLAN, '---\nstatus: approved\n---\n# Plan\n\n**Spec:** docs/superpowers/specs/../../../notes/x.md\n');
    assert.deepEqual(lib.activePlans(d), []);
  });
});

describe('paths', () => {
  test('approvalsDir', () => {
    assert.equal(lib.approvalsDir('/r/.git'), join('/r/.git', 'sdd', 'approvals'));
  });
  test('featureFromSpecPath', () => {
    assert.equal(lib.featureFromSpecPath('docs/superpowers/specs/2026-11-05-auth-login-design.md'), 'auth-login');
    assert.equal(lib.featureFromSpecPath('docs/superpowers/plans/2026-11-05-auth-login.md'), 'auth-login');
  });
});
