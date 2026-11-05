import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewRecordPath } from './review-guard.mjs';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'review-guard.mjs');
const GIT = ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t'];
const git = (cwd, ...a) => execFileSync('git', [...GIT, ...a], { cwd, stdio: 'pipe' });

const dirs = [];
function tmp() {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'sdd-rg-')));
  dirs.push(d);
  return d;
}
function put(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
}
function repo({ config = { enforcement: 'strict', baseBranch: 'main' }, branch = 'main' } = {}) {
  const root = tmp();
  git(root, 'init', '-q', '-b', branch);
  if (config) put(root, '.sdd/config.json', JSON.stringify(config));
  put(root, 'README.md', 'x\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}
function worktree(root, branch) {
  const wt = tmp();
  rmSync(wt, { recursive: true });
  git(root, 'worktree', 'add', '-q', '-b', branch, wt);
  return wt;
}
function addActivePlan(root, name, branch, feature) {
  put(root, `docs/superpowers/specs/2026-11-05-${name}-design.md`, '---\nstatus: approved\n---\nspec\n');
  put(root, `docs/superpowers/plans/2026-11-05-${name}.md`,
    `---\nstatus: approved\n${branch ? `branch: ${branch}\n` : ''}${feature ? `feature: ${feature}\n` : ''}---\n**Spec:** docs/superpowers/specs/2026-11-05-${name}-design.md\n`);
}
function record(root, feature, text = '{"date":"2026-11-05"}') {
  put(root, `.git/sdd/approvals/${feature}.review.json`, text);
}
function run(payload, raw) {
  const r = spawnSync('node', [HOOK], { input: raw ?? JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(r.status, 0);
  return r.stdout;
}
const bash = (cwd, command, tool_name = 'Bash', extra = {}) => ({ cwd, tool_name, tool_input: { command, ...extra } });
const parse = (s) => JSON.parse(s).hookSpecificOutput;

after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test('reviewRecordPath is <commonDir>/sdd/approvals/<feature>.review.json', () => {
  assert.equal(reviewRecordPath('/r/.git', 'auth'), join('/r/.git', 'sdd', 'approvals', 'auth.review.json'));
});

test('no config, bad stdin, non-bash tool: silent', () => {
  const root = repo({ config: null });
  assert.equal(run(bash(root, 'git commit -m x')), '');
  assert.equal(run(null, 'not json'), '');
  assert.equal(run(null, ''), '');
  const r2 = repo();
  assert.equal(run({ cwd: r2, tool_name: 'Read', tool_input: { command: 'git commit' } }), '');
});

test('commit on a feature branch (worktree) passes', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  assert.equal(run(bash(wt, 'git commit -m x')), '');
});

test('commit on base: one active plan, record required', () => {
  const root = repo();
  addActivePlan(root, 'a');
  const out = parse(run(bash(root, 'git commit -m x')));
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /\/sdd:approve review a\b/);
  record(root, 'a');
  assert.equal(run(bash(root, 'git commit -m x')), '');
});

test('a record that is not valid JSON does not count', () => {
  const root = repo();
  addActivePlan(root, 'a');
  record(root, 'a', 'not json');
  assert.equal(parse(run(bash(root, 'git commit -m x'))).permissionDecision, 'deny');
});

test('feature name: frontmatter feature wins over the spec path', () => {
  const root = repo();
  addActivePlan(root, 'a', undefined, 'login');
  const out = parse(run(bash(root, 'git commit -m x')));
  assert.match(out.permissionDecisionReason, /\/sdd:approve review login\b/);
});

test('commit on base with two active plans: deny asking which feature', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/a');
  addActivePlan(root, 'b', 'feat/b');
  const out = parse(run(bash(root, 'git commit -m x')));
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /which feature/i);
});

test('no active plan: nothing to review, commit on base passes', () => {
  const root = repo();
  assert.equal(run(bash(root, 'git commit -m x')), '');
});

test('gh pr create from the feature branch needs the record', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  addActivePlan(root, 'b', 'feat/y');
  const wt = worktree(root, 'feat/x');
  const out = parse(run(bash(wt, 'gh pr create --fill')));
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /review a\b/);
  record(root, 'a');
  assert.equal(run(bash(wt, 'gh pr create --fill')), '');
  assert.equal(run(bash(wt, 'gh pr merge 12')), '');
  rmSync(join(root, '.git/sdd/approvals/a.review.json'));
  assert.equal(parse(run(bash(wt, 'gh pr merge 12'))).permissionDecision, 'deny');
});

test('push: to base is gated, without a ref from a feature branch passes', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  assert.equal(parse(run(bash(wt, 'git push origin main'))).permissionDecision, 'deny');
  assert.equal(parse(run(bash(wt, 'git push origin HEAD:main'))).permissionDecision, 'deny');
  assert.equal(run(bash(wt, 'git push')), '');
  assert.equal(run(bash(wt, 'git push origin feat/x')), '');
  assert.equal(parse(run(bash(root, 'git push'))).permissionDecision, 'deny');
  record(root, 'a');
  assert.equal(run(bash(wt, 'git push origin main')), '');
});

test('detached HEAD commit passes', () => {
  const root = repo();
  addActivePlan(root, 'a');
  git(root, 'checkout', '-q', '--detach');
  assert.equal(run(bash(root, 'git commit -m x')), '');
});

test('merge on base: the plan whose branch is the source decides', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/a');
  addActivePlan(root, 'b', 'feat/b');
  record(root, 'a');
  const out = parse(run(bash(root, 'git merge feat/b')));
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /review b\b/);
  assert.equal(run(bash(root, 'git merge feat/a')), '');
  record(root, 'b');
  assert.equal(run(bash(root, 'git merge feat/b')), '');
  // no branch match and two plans: ask which
  const other = parse(run(bash(root, 'git merge feat/zzz')));
  assert.match(other.permissionDecisionReason, /which feature/i);
});

test('merge on a feature branch passes', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  assert.equal(run(bash(wt, 'git merge main')), '');
});

test('git -C <main checkout> from a feature cwd is judged on the target dir branch', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  const out = parse(run(bash(wt, `git -C ${root} commit -m x`)));
  assert.equal(out.permissionDecision, 'deny');
  // and the reverse: from main, -C into the worktree is a feature-branch commit
  assert.equal(run(bash(root, `git -C ${wt} commit -m x`)), '');
});

test('approval tampering is denied in every mode', () => {
  for (const enforcement of ['strict', 'warn']) {
    const root = repo({ config: { enforcement } });
    for (const c of ['node sdd/hooks/mark-reviewed.mjs a', 'echo {} > .git/sdd/approvals/a.review.json', 'ls "x"; mark-reviewed']) {
      assert.equal(parse(run(bash(root, c))).permissionDecision, 'deny', `${enforcement}: ${c}`);
    }
  }
});

test('mcp__codescout__run_command behaves like Bash; workspace and cwd are honoured', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  const t = 'mcp__codescout__run_command';
  assert.equal(parse(run(bash(root, 'git commit -m x', t, { workspace: root }))).permissionDecision, 'deny');
  assert.equal(run(bash(root, 'git commit -m x', t, { workspace: wt })), '');
  assert.equal(run(bash(root, 'git commit -m x', t, { workspace: dirname(wt), cwd: wt.slice(dirname(wt).length + 1) })), '');
  assert.equal(parse(run(bash(wt, 'git push origin main', 'run_command'))).permissionDecision, 'deny');
});

test('quoted git text is not an intent', () => {
  const root = repo();
  addActivePlan(root, 'a');
  assert.equal(run(bash(root, 'echo "git commit" && ls')), '');
});

test('warn mode: context with the same text, no denial', () => {
  const root = repo({ config: { enforcement: 'warn', baseBranch: 'main' } });
  addActivePlan(root, 'a');
  const out = parse(run(bash(root, 'git commit -m x')));
  assert.equal(out.permissionDecision, undefined);
  assert.match(out.additionalContext, /\/sdd:approve review a\b/);
});

test('baseBranch absent: main if it exists, else master', () => {
  const m = repo({ config: { enforcement: 'strict' } });
  addActivePlan(m, 'a');
  assert.equal(parse(run(bash(m, 'git commit -m x'))).permissionDecision, 'deny');
  const wt = worktree(m, 'feat/x');
  assert.equal(parse(run(bash(wt, 'git push origin main'))).permissionDecision, 'deny');
  assert.equal(run(bash(wt, 'git push origin master')), '');

  const ms = repo({ config: { enforcement: 'strict' }, branch: 'master' });
  addActivePlan(ms, 'a');
  assert.equal(parse(run(bash(ms, 'git commit -m x'))).permissionDecision, 'deny');
  const wt2 = worktree(ms, 'feat/x');
  assert.equal(parse(run(bash(wt2, 'git push origin master'))).permissionDecision, 'deny');
  assert.equal(run(bash(wt2, 'git push origin main')), '');
});

const OPTION1 = 'MAIN_ROOT=$(git -C "$(git rev-parse --git-common-dir)/.." rev-parse --show-toplevel)\ncd "$MAIN_ROOT"\ngit checkout main\ngit pull\ngit merge feat/x';
const denies = (o) => assert.equal(parse(o).permissionDecision, 'deny');

test('cd / checkout earlier in the command: the merge is still gated', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  denies(run(bash(wt, OPTION1)));
  denies(run(bash(wt, `cd ${root} && git merge feat/x`)));
  denies(run(bash(wt, `cd ${root} && git commit -m x`)));
  denies(run(bash(wt, 'git checkout main && git merge feat/x')));
  denies(run(bash(wt, 'git switch main; git merge --no-ff feat/x')));
  record(root, 'a');
  assert.equal(run(bash(wt, OPTION1)), '');
  assert.equal(run(bash(wt, `cd ${root} && git merge feat/x`)), '');
  assert.equal(run(bash(wt, 'git checkout main && git merge feat/x')), '');
  assert.equal(run(bash(wt, 'git switch main; git merge --no-ff feat/x')), '');
});

test('merge ref is normalised: refs/heads/ and <remote>/ prefixes', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/a');
  addActivePlan(root, 'b', 'feat/b');
  for (const ref of ['feat/a', 'refs/heads/feat/a', 'origin/feat/a']) {
    const out = parse(run(bash(root, `git merge ${ref}`)));
    assert.equal(out.permissionDecision, 'deny', ref);
    assert.match(out.permissionDecisionReason, /review a\b/, ref);
  }
});

test('merging a plan branch from a stale cwd on that branch is gated', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  denies(run(bash(wt, 'git merge feat/x')));
});

test('merging a plan branch while known to be on another feature branch passes', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  git(root, 'branch', 'feat/y');
  assert.equal(run(bash(root, 'git checkout feat/y && git merge feat/x')), '');
  assert.equal(run(bash(root, 'git checkout -b feat/z && git merge feat/x')), '');
  const wt = worktree(root, 'feat/w');
  assert.equal(run(bash(wt, 'git merge feat/x')), '');
});

test('checkout of a path that is not a branch does not lift the base-branch gate', () => {
  const root = repo();
  addActivePlan(root, 'a');
  denies(run(bash(root, 'git checkout README.md && git commit -m x')));
});

test('tamper check is on tokens: mentions and reads pass, writes and mark-reviewed deny', () => {
  const root = repo({ config: { enforcement: 'strict' } });
  for (const c of ['git commit -m "fix mark-reviewed docs"', 'git log -- sdd/approvals', 'cat .git/sdd/approvals/a.review.json', 'echo "sdd/approvals"']) {
    assert.equal(run(bash(root, c)), '', c);
  }
  for (const c of ['echo x > .git/sdd/approvals/a.review.json', 'echo x >> .git/sdd/approvals/a.review.json',
    'echo x | tee .git/sdd/approvals/a.review.json', 'cp a .git/sdd/approvals/a.review.json',
    'rm .git/sdd/approvals/a.review.json', './scripts/mark-reviewed.sh', 'echo x >".git/sdd/approvals/a"']) {
    assert.equal(parse(run(bash(root, c))).permissionDecision, 'deny', c);
  }
});

test('shell keywords before a command word do not hide it', () => {
  const root = repo();
  addActivePlan(root, 'a');
  denies(run(bash(root, 'if true; then git commit -m x; fi')));
  denies(run(bash(root, '{ git commit -m x; }')));
  denies(run(bash(root, 'for i in 1; do git commit -m x; done')));
  denies(run(bash(root, 'echo a | xargs git commit -m x')));
});

test('N1: a checkout with paths, -- or -p is not a branch switch', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  git(root, 'branch', 'feat/x');
  for (const c of ['git checkout feat/x -- README.md && git commit -m x', 'git checkout feat/x README.md && git commit -m x',
    'git checkout feat/x -- . && git commit -m x', 'git checkout -p feat/x && git commit -m x', 'git checkout feat/x -- . && git push']) {
    denies(run(bash(root, c)));
  }
  // a real branch switch still lifts the gate
  assert.equal(run(bash(root, 'git checkout feat/x && git commit -m x')), '');
});

test('N2: cd inside ( ) is scoped; popd restores the pushd dir', () => {
  const root = repo();
  addActivePlan(root, 'a');
  const wt = worktree(root, 'feat/w');
  denies(run(bash(root, `(cd ${wt} && git status) && git commit -m x`)));
  denies(run(bash(root, `pushd ${wt} && git status && popd && git commit -m x`)));
  assert.equal(run(bash(root, `(cd ${wt} && git commit -m x)`)), '');
  assert.equal(run(bash(root, `pushd ${wt} && git commit -m x`)), '');
});

test('N3: writers and redirects into the approval directory, including via cwd', () => {
  const root = repo({ config: { enforcement: 'strict' } });
  const ap = join(root, '.git/sdd/approvals');
  mkdirSync(ap, { recursive: true });
  for (const c of [`cd ${ap} && echo {} > a.review.json`, `sed -i s/a/b/ ${ap}/a.review.json`, `rsync x ${ap}/`,
    `truncate -s0 ${ap}/a`, `dd of=${ap}/a`, `cd ${ap} && touch a`, `(cd ${ap}; echo x >> b)`]) {
    denies(run(bash(root, c)));
  }
  assert.equal(run(bash(root, `(cd ${ap}) && echo x > out.txt`)), '');
});

test('N4: merging origin/<branch> on that branch is a remote sync; the bare branch from a stale cwd is gated', () => {
  const root = repo();
  addActivePlan(root, 'a', 'feat/x');
  const wt = worktree(root, 'feat/x');
  assert.equal(run(bash(wt, 'git merge origin/feat/x')), '');
  assert.equal(run(bash(wt, 'git merge refs/remotes/origin/feat/x')), '');
  denies(run(bash(wt, 'git merge feat/x')));
  denies(run(bash(root, 'git merge origin/feat/x')));
});

test('N5: mark-reviewed only as the command word or an interpreter script', () => {
  const root = repo({ config: { enforcement: 'strict' } });
  for (const c of ['git commit -m "mark-reviewed: fix docs"', 'git log -- sdd/scripts/mark-reviewed.mjs', 'git add sdd/scripts/mark-reviewed.mjs']) {
    assert.equal(run(bash(root, c)), '', c);
  }
  for (const c of ['node sdd/scripts/mark-reviewed.mjs', './mark-reviewed.sh', 'bash -x mark-reviewed.sh a', 'FOO=1 node mark-reviewed.mjs']) {
    denies(run(bash(root, c)));
  }
});

test('a refs/heads/<name> directory is not a branch', () => {
  const root = repo();
  addActivePlan(root, 'a');
  mkdirSync(join(root, '.git/refs/heads/feat'), { recursive: true });
  // `feat` exists only as a directory (feat/x would be a file inside it)
  denies(run(bash(root, 'git checkout feat && git commit -m x')));
});
