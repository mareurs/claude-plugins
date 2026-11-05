import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitIntents } from './git-intents.mjs';

const kinds = (c) => gitIntents(c).map((i) => i.kind);

test('commit forms', () => {
  assert.deepEqual(kinds('git commit -m x'), ['commit']);
  assert.deepEqual(kinds('git -C ../w commit'), ['commit']);
  assert.deepEqual(kinds('git -c a=b commit'), ['commit']);
  assert.deepEqual(kinds('git --git-dir=/x/.git commit'), ['commit']);
  assert.deepEqual(kinds('npm test && git commit -am x'), ['commit']);
  assert.deepEqual(kinds('A=1 git commit'), ['commit']);
  assert.deepEqual(kinds('git add -A\ngit commit -m x'), ['commit']);
  assert.deepEqual(kinds('(git commit -m x)'), ['commit']);
  assert.deepEqual(kinds('echo $(git commit)'), ['commit']);
});

test('dir from -C, composed in order', () => {
  assert.equal(gitIntents('git -C ../w commit')[0].dir, '../w');
  assert.equal(gitIntents('git -C /a -C b commit')[0].dir, '/a/b');
  assert.equal(gitIntents('git commit')[0].dir, undefined);
});

test('quoted text is not an intent', () => {
  assert.deepEqual(kinds('echo "git commit"'), []);
  assert.deepEqual(kinds("echo 'git commit' && ls"), []);
  assert.deepEqual(kinds("echo $'git commit'"), []);
  assert.deepEqual(kinds('echo "a; git commit"'), []);
  assert.deepEqual(kinds('git log --grep="git push origin main"'), []);
  assert.deepEqual(kinds('# git commit'), []);
  assert.deepEqual(kinds('"git commit"'), []);
});

test('push targets', () => {
  assert.deepEqual(gitIntents('git push origin main'), [{ kind: 'push', pushRef: 'main' }]);
  assert.deepEqual(gitIntents('git push origin HEAD:main'), [{ kind: 'push', pushRef: 'main' }]);
  assert.deepEqual(gitIntents('git push -u origin +feat/x:refs/heads/main'), [{ kind: 'push', pushRef: 'main' }]);
  assert.deepEqual(gitIntents('git push'), [{ kind: 'push' }]);
  assert.deepEqual(gitIntents('git push origin'), [{ kind: 'push' }]);
  assert.deepEqual(gitIntents('git push origin a b').map((i) => i.pushRef), ['a', 'b']);
});

test('gh and merge', () => {
  assert.deepEqual(kinds('gh pr create --fill'), ['pr-create']);
  assert.deepEqual(kinds('gh pr merge 12'), ['pr-merge']);
  assert.deepEqual(kinds('gh -R o/r pr create'), ['pr-create']);
  assert.deepEqual(kinds('gh pr view 3'), []);
  assert.deepEqual(gitIntents('git merge feat/x'), [{ kind: 'merge', mergeRef: 'feat/x' }]);
  assert.deepEqual(gitIntents('git merge --no-ff -m msg feat/x'), [{ kind: 'merge', mergeRef: 'feat/x' }]);
  assert.deepEqual(kinds('git merge --abort'), []);
  assert.deepEqual(kinds('git status && git log'), []);
});

test('cd, pushd, checkout and -C are tracked across segments', () => {
  assert.equal(gitIntents('cd /m && git commit')[0].dir, '/m');
  assert.equal(gitIntents('pushd ../w; git commit')[0].dir, '../w');
  assert.equal(gitIntents('cd /m && cd sub && git commit')[0].dir, '/m/sub');
  assert.equal(gitIntents('cd /m && git -C sub commit')[0].dir, '/m/sub');
  for (const c of ['cd "$X"; git commit', 'cd ~u; git commit', 'cd $(pwd); git commit', 'cd; git commit', 'cd -; git commit']) {
    const i = gitIntents(c)[0];
    assert.equal(i.dirUnknown, true, c);
    assert.equal(i.dir, undefined, c);
  }
  assert.equal(gitIntents('cd /abs; git commit')[0].dirUnknown, undefined);
  assert.deepEqual(gitIntents('git checkout main && git merge feat/x'),
    [{ kind: 'merge', mergeRef: 'feat/x', assumedBranch: 'main' }]);
  assert.deepEqual(gitIntents('git switch -c n; git commit'), [{ kind: 'commit', assumedBranch: 'n', assumedNew: true }]);
  assert.deepEqual(gitIntents('git checkout -b n main; git commit'), [{ kind: 'commit', assumedBranch: 'n', assumedNew: true }]);
  assert.deepEqual(gitIntents('git checkout -- f; git commit'), [{ kind: 'commit' }]);
  // a checkout is per directory: a later cd drops it
  assert.deepEqual(gitIntents('git checkout b; cd /m; git commit'), [{ kind: 'commit', dir: '/m' }]);
});

test('shell keywords are skipped before the command word', () => {
  assert.deepEqual(kinds('if true; then git commit -m x; fi'), ['commit']);
  assert.deepEqual(kinds('{ git commit -m x; }'), ['commit']);
  assert.deepEqual(kinds('! git commit'), ['commit']);
  assert.deepEqual(kinds('echo a | xargs git commit'), ['commit']);
});

test('checkout with paths, -- or -p keeps the branch state', () => {
  for (const c of ['git checkout b -- f', 'git checkout b f', 'git checkout -p b', 'git checkout b -- .']) {
    assert.deepEqual(gitIntents(`${c}; git commit`), [{ kind: 'commit' }], c);
  }
  assert.deepEqual(gitIntents('git switch b; git commit'), [{ kind: 'commit', assumedBranch: 'b' }]);
  assert.deepEqual(gitIntents('git checkout b --; git commit'), [{ kind: 'commit', assumedBranch: 'b' }]);
});

test('( ) scopes cd; popd restores the pushd dir', () => {
  assert.deepEqual(gitIntents('(cd /w && git commit); git commit').map((i) => i.dir), ['/w', undefined]);
  assert.deepEqual(gitIntents('pushd /w; git commit; popd; git commit').map((i) => i.dir), ['/w', undefined]);
  assert.deepEqual(gitIntents('cd /a; (cd /b); git commit').map((i) => i.dir), ['/a']);
});
