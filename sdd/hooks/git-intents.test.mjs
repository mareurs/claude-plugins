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
