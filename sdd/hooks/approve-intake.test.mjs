// Tests for approve-intake.mjs: user-only approval through UserPromptSubmit.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseApproval } from './approve-intake.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'approve-intake.mjs');
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function tmp() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-ai-')));
  dirs.push(d);
  return d;
}
function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');
function repo({ config = true } = {}) {
  const root = tmp();
  git(root, 'init', '-q', '-b', 'main');
  if (config) put(root, '.sdd/config.json', '{"enforcement":"strict"}');
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function run(root, prompt, extra = {}) {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ cwd: root, prompt, session_id: 'sess-1', ...extra }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  return r.stdout;
}
function ctx(out) {
  const h = JSON.parse(out).hookSpecificOutput;
  assert.equal(h.hookEventName, 'UserPromptSubmit');
  return h.additionalContext;
}

const SPEC = 'docs/superpowers/specs/2026-11-05-auth-login-design.md';
const PLAN = 'docs/superpowers/plans/2026-11-05-auth-login.md';
const SPEC_BODY = '---\ntitle: T\nstatus: draft\n---\n\n# Spec\n\nbody  \n';
const PLAN_BODY = (extra = '') => `---\ntitle: P\nstatus: draft\n${extra}---\n\n**Spec:** ${SPEC}\n\n# Plan\n`;

test('parseApproval: the three forms, whitespace, and non-matches', () => {
  assert.deepEqual(parseApproval('/sdd:approve spec auth'), { kind: 'spec', target: 'auth' });
  assert.deepEqual(parseApproval('  /approve plan auth  \n'), { kind: 'plan', target: 'auth' });
  assert.deepEqual(parseApproval('sdd approve review auth'), { kind: 'review', target: 'auth' });
  assert.deepEqual(parseApproval('/sdd:approve done auth'), { kind: 'done', target: 'auth' });
  assert.equal(parseApproval('please approve the spec'), null);
  assert.equal(parseApproval('/sdd:approve spec'), null);
  assert.equal(parseApproval('/sdd:approve bogus x'), null);
  assert.equal(parseApproval(undefined), null);
});

test('spec <path>: approves, sets feature/kind, leaves body bytes alone', () => {
  const root = repo();
  put(root, SPEC, SPEC_BODY);
  const out = run(root, `/sdd:approve spec ${SPEC}`);
  assert.match(ctx(out), /approved/);
  const t = read(root, SPEC);
  assert.match(t, /^---\n/);
  assert.match(t, /status: approved\n/);
  assert.match(t, new RegExp(`approved: ${today()}\\n`));
  assert.match(t, /feature: auth-login\n/);
  assert.match(t, /kind: spec\n/);
  assert.ok(t.endsWith('---\n\n# Spec\n\nbody  \n'));
});

test('spec <feature> resolves by feature: and by filename; unknown writes nothing', () => {
  const root = repo();
  put(root, 'docs/superpowers/specs/2026-11-05-zzz-design.md', '---\nstatus: draft\nfeature: other\n---\nz\n');
  put(root, SPEC, SPEC_BODY);
  run(root, '/sdd:approve spec other');
  assert.match(read(root, 'docs/superpowers/specs/2026-11-05-zzz-design.md'), /status: approved/);
  run(root, '/sdd:approve spec auth-login');
  assert.match(read(root, SPEC), /status: approved/);
  const before = read(root, SPEC);
  const out = run(root, '/sdd:approve spec nope');
  assert.match(ctx(out), /nope/);
  assert.equal(read(root, SPEC), before);
});

test('spec <path> traversal outside specs dir is refused', () => {
  const root = repo();
  put(root, 'docs/other.md', '---\nstatus: draft\n---\nx\n');
  const out = run(root, '/sdd:approve spec docs/superpowers/specs/../../other.md');
  assert.match(ctx(out), /not found|outside|specs/i);
  assert.equal(read(root, 'docs/other.md'), '---\nstatus: draft\n---\nx\n');
});

test('plan <feature>: needs an approved spec; approves via Spec pointer', () => {
  const root = repo();
  put(root, SPEC, SPEC_BODY);
  put(root, PLAN, PLAN_BODY());
  const before = read(root, PLAN);
  const refused = run(root, '/sdd:approve plan auth-login');
  assert.match(ctx(refused), /spec/i);
  assert.equal(read(root, PLAN), before);

  run(root, '/sdd:approve spec auth-login');
  const out = run(root, '/sdd:approve plan auth-login');
  assert.match(ctx(out), /approved/);
  const t = read(root, PLAN);
  assert.match(t, /status: approved\n/);
  assert.match(t, new RegExp(`approved: ${today()}\\n`));
  assert.match(t, /kind: plan\n/);
  assert.match(t, /feature: auth-login\n/);
  assert.ok(t.endsWith('---\n\n**Spec:** ' + SPEC + '\n\n# Plan\n'));
});

test('plan resolves by its own feature: field', () => {
  const root = repo();
  put(root, SPEC, '---\nstatus: approved\n---\nspec\n');
  put(root, 'docs/superpowers/plans/2026-11-05-weird.md', `---\nstatus: draft\nfeature: auth-login\n---\n**Spec:** ${SPEC}\n`);
  run(root, '/sdd:approve plan auth-login');
  assert.match(read(root, 'docs/superpowers/plans/2026-11-05-weird.md'), /status: approved/);
});

function reviewFixture({ report, planBranch = true } = {}) {
  const root = repo();
  put(root, SPEC, '---\nstatus: approved\nfeature: auth-login\n---\nspec\n');
  put(root, PLAN, `---\nstatus: approved\n${planBranch ? 'branch: feat/auth\n' : ''}---\n**Spec:** ${SPEC}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'docs');
  git(root, 'branch', 'feat/auth');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'main moves on');
  const ad = join(root, '.git', 'sdd', 'approvals');
  if (report !== undefined) {
    mkdirSync(ad, { recursive: true });
    writeFileSync(join(ad, 'auth-login.report.json'), typeof report === 'string' ? report : JSON.stringify(report));
  }
  return { root, rec: join(ad, 'auth-login.review.json') };
}

test('review: refused with no report, bad report, no-go, or drift no-go', () => {
  for (const report of [undefined, '{nope', { outcome: 'no-go', drift_outcome: 'go' }, { outcome: 'go', drift_outcome: 'no-go' }, { outcome: 'go' }]) {
    const { root, rec } = reviewFixture({ report });
    const out = run(root, '/sdd:approve review auth-login');
    assert.match(ctx(out), /review|report/i);
    assert.equal(existsSync(rec), false);
  }
});

test('review: go/go writes the record with the plan branch tip as head', () => {
  const { root, rec } = reviewFixture({ report: { outcome: 'go', drift_outcome: 'go', date: '2026-11-05' } });
  const out = run(root, '/sdd:approve review auth-login');
  assert.match(ctx(out), /review/i);
  const j = JSON.parse(readFileSync(rec, 'utf8'));
  assert.equal(j.feature, 'auth-login');
  assert.equal(j.date, today());
  assert.equal(j.session_id, 'sess-1');
  assert.equal(j.head, git(root, 'rev-parse', 'feat/auth'));
  assert.notEqual(j.head, git(root, 'rev-parse', 'HEAD'));
});

test('review: without a plan branch, head is the cwd HEAD (also from a packed ref)', () => {
  const { root, rec } = reviewFixture({ report: { outcome: 'go', drift_outcome: 'go' }, planBranch: false });
  run(root, '/sdd:approve review auth-login');
  assert.equal(JSON.parse(readFileSync(rec, 'utf8')).head, git(root, 'rev-parse', 'HEAD'));

  const f2 = reviewFixture({ report: { outcome: 'go', drift_outcome: 'go' } });
  git(f2.root, 'pack-refs', '--all');
  run(f2.root, '/sdd:approve review auth-login');
  assert.equal(JSON.parse(readFileSync(f2.rec, 'utf8')).head, git(f2.root, 'rev-parse', 'feat/auth'));
});

test('done <feature>: spec implemented, plan done', () => {
  const root = repo();
  put(root, SPEC, '---\nstatus: approved\nfeature: auth-login\n---\nspec\n');
  put(root, PLAN, `---\nstatus: approved\n---\n**Spec:** ${SPEC}\n`);
  const out = run(root, '/sdd:approve done auth-login');
  assert.match(ctx(out), /done|implemented/);
  assert.match(read(root, SPEC), /status: implemented/);
  assert.match(read(root, PLAN), /status: done/);
});

test('not initialised: context only, no write; unparsed prompt: silent', () => {
  const root = repo({ config: false });
  put(root, SPEC, SPEC_BODY);
  const out = run(root, '/sdd:approve spec auth-login');
  assert.match(ctx(out), /not initiali[sz]ed/);
  assert.equal(read(root, SPEC), SPEC_BODY);
  assert.equal(run(root, 'hello there'), '');
  assert.equal(run(root, '/sdd:approve spec'), '');
});

test('garbage stdin: silent exit 0', () => {
  const r = spawnSync('node', [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

// ---- fix round 1 ------------------------------------------------------------

test('spec <feature>: only draft candidates; superseded/implemented skipped, ambiguity refused', () => {
  const root = repo();
  const old = 'docs/superpowers/specs/2026-01-01-auth-design.md';
  const neu = 'docs/superpowers/specs/2026-11-05-auth-v2-design.md';
  put(root, old, '---\nstatus: superseded\nfeature: auth\n---\nold\n');
  put(root, neu, '---\nstatus: draft\nfeature: auth\n---\nnew\n');
  const oldBytes = read(root, old);
  run(root, '/sdd:approve spec auth');
  assert.equal(read(root, old), oldBytes);
  assert.match(read(root, neu), /status: approved/);

  // implemented spec is not re-approved
  const r2 = repo();
  put(r2, old, '---\nstatus: implemented\nfeature: auth\n---\nold\n');
  const b2 = read(r2, old);
  assert.match(ctx(run(r2, '/sdd:approve spec auth')), /status|implemented/i);
  assert.equal(read(r2, old), b2);

  // two drafts: refused, both paths listed
  const r3 = repo();
  put(r3, old, '---\nstatus: draft\nfeature: auth\n---\na\n');
  put(r3, neu, '---\nstatus: draft\nfeature: auth\n---\nb\n');
  const msg = ctx(run(r3, '/sdd:approve spec auth'));
  assert.match(msg, /2026-01-01-auth-design/);
  assert.match(msg, /2026-11-05-auth-v2-design/);
  assert.match(read(r3, old), /status: draft/);
  assert.match(read(r3, neu), /status: draft/);

  // explicit path to a non-draft spec is refused too
  const r4 = repo();
  put(r4, old, '---\nstatus: superseded\n---\nx\n');
  const b4 = read(r4, old);
  run(r4, `/sdd:approve spec ${old}`);
  assert.equal(read(r4, old), b4);
});

test('plan <feature>: a done plan is not re-activated; the draft is approved', () => {
  const root = repo();
  put(root, SPEC, '---\nstatus: approved\nfeature: q\n---\nspec\n');
  const donePlan = 'docs/superpowers/plans/2026-01-01-q.md';
  const draftPlan = 'docs/superpowers/plans/2026-11-05-q2.md';
  put(root, donePlan, `---\nstatus: done\n---\n**Spec:** ${SPEC}\n`);
  put(root, draftPlan, `---\nstatus: draft\n---\n**Spec:** ${SPEC}\n`);
  const doneBytes = read(root, donePlan);
  run(root, '/sdd:approve plan q');
  assert.equal(read(root, donePlan), doneBytes);
  assert.match(read(root, draftPlan), /status: approved/);
});

test('targets: non-path features must be a plain slug; nothing read or written outside', () => {
  const root = repo();
  const ad = join(root, '.git', 'sdd', 'approvals');
  mkdirSync(ad, { recursive: true });
  writeFileSync(join(root, '.git', 'x.report.json'), '{"outcome":"go","drift_outcome":"go"}');
  writeFileSync(join(ad, 'a.report.json'), '{"outcome":"go","drift_outcome":"go"}');
  for (const t of ['../../x', 'a/b', '..', '.hidden', 'a..b', 'a\\b']) {
    const out = run(root, `/sdd:approve review ${t}`);
    assert.match(ctx(out), /invalid|refused/i);
  }
  assert.equal(existsSync(join(root, '.git', 'x.review.json')), false);
  assert.equal(existsSync(join(ad, 'a', 'b.review.json')), false);
  for (const k of ['plan', 'done']) assert.match(ctx(run(root, `/sdd:approve ${k} ../x`)), /invalid|outside|not inside|refused|not found/i);
});

test('symlink in specs/ pointing outside the tree is not written through', () => {
  const root = repo();
  put(root, 'src/victim.md', 'victim\n');
  mkdirSync(join(root, 'docs/superpowers/specs'), { recursive: true });
  symlinkSync(join(root, 'src/victim.md'), join(root, 'docs/superpowers/specs/2026-11-05-evil-design.md'));
  run(root, '/sdd:approve spec evil');
  run(root, '/sdd:approve spec docs/superpowers/specs/2026-11-05-evil-design.md');
  assert.equal(read(root, 'src/victim.md'), 'victim\n');
});

test('done: refuses unless spec and plan are approved; draft spec writes nothing', () => {
  const root = repo();
  put(root, SPEC, SPEC_BODY);
  put(root, PLAN, `---\nstatus: approved\n---\n**Spec:** ${SPEC}\n`);
  const a = read(root, SPEC), b = read(root, PLAN);
  run(root, '/sdd:approve done auth-login');
  assert.equal(read(root, SPEC), a);
  assert.equal(read(root, PLAN), b);

  const r2 = repo();
  put(r2, SPEC, '---\nstatus: approved\n---\nspec\n');
  put(r2, PLAN, `---\nstatus: draft\n---\n**Spec:** ${SPEC}\n`);
  const c = read(r2, SPEC), d = read(r2, PLAN);
  run(r2, '/sdd:approve done auth-login');
  assert.equal(read(r2, SPEC), c);
  assert.equal(read(r2, PLAN), d);
});

test('done <path> derives the feature from the resolved spec', () => {
  const root = repo();
  put(root, SPEC, '---\nstatus: approved\nfeature: custom\n---\nspec\n');
  put(root, PLAN, `---\nstatus: approved\n---\n**Spec:** ${SPEC}\n`);
  run(root, `/sdd:approve done ${SPEC}`);
  assert.match(read(root, SPEC), /status: implemented/);
  assert.match(read(root, PLAN), /status: done/);
});

test('bare *.md target resolves inside specs/ and plans/', () => {
  const root = repo();
  put(root, SPEC, SPEC_BODY);
  run(root, '/sdd:approve spec 2026-11-05-auth-login-design.md');
  assert.match(read(root, SPEC), /status: approved/);
  put(root, PLAN, PLAN_BODY());
  run(root, '/sdd:approve plan 2026-11-05-auth-login.md');
  assert.match(read(root, PLAN), /status: approved/);
});

test('CRLF + BOM files keep every non-frontmatter byte and their line endings', () => {
  const root = repo();
  const spec = '﻿---\r\ntitle: T\r\nstatus: draft\r\n---\r\n\r\n# Spec\r\n\r\nbody\r\n';
  const plan = `﻿---\r\nstatus: draft\r\n---\r\n\r\n**Spec:** ${SPEC}\r\n\r\n# Plan\r\n`;
  put(root, SPEC, spec);
  put(root, PLAN, plan);
  run(root, '/sdd:approve spec auth-login');
  run(root, '/sdd:approve plan auth-login');
  for (const [rel, orig] of [[SPEC, spec], [PLAN, plan]]) {
    const t = read(root, rel);
    assert.ok(t.startsWith('﻿---\r\n'));
    assert.match(t, /status: approved\r\n/);
    const tail = orig.slice(orig.indexOf('---\r\n\r\n') + 3);
    assert.ok(t.endsWith(tail));
    assert.equal(/(?<!\r)\n/.test(t), false);
  }
});
