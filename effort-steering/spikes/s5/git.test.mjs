// git.test.mjs — the hardened git spawn used by every S5 git call.
//
// Each hardening test sets the hazard in the PROCESS environment (or the repo) and checks
// that git() does not see it. A control run with plain git proves the hazard is live on
// this machine, so a pass cannot be a vacuous one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { git } from './git.mjs';
import { makeRepo } from './fixtures/make-repo.mjs';

const made = [];
const { dir } = makeRepo([{ label: 'a', subject: 'chore: a', date: '2026-10-01T10:00:00+00:00', files: { 'a.txt': 'hello\n' } }]);
made.push(dir);
const scratch = mkdtempSync(join(tmpdir(), 's5-fixture-'));
made.push(scratch);

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
// plain git with ONLY the variables given (plus PATH): the unhardened control.
const plain = (env, args) => spawnSync('git', ['-C', dir, ...args], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

t('returns the status and Buffers, and does not throw on a non-zero exit', () => {
  const ok = git(dir, ['rev-parse', '--is-inside-work-tree']);
  assert.equal(ok.status, 0);
  assert.ok(Buffer.isBuffer(ok.stdout) && Buffer.isBuffer(ok.stderr));
  assert.equal(ok.stdout.toString(), 'true\n');
  const bad = git(dir, ['rev-parse', '--verify', '-q', 'no-such-ref']);
  assert.notEqual(bad.status, 0);
  assert.ok(Buffer.isBuffer(bad.stderr));
});

t('input is fed to stdin', () => {
  // The well-known blob id of "hello\n".
  const r = git(dir, ['hash-object', '--stdin'], { input: Buffer.from('hello\n') });
  assert.equal(r.stdout.toString().trim(), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

t('runs in the directory given, not in the process cwd', () => {
  // The cwd is inside another git repository (this checkout); -C must win.
  const r = git(dir, ['rev-parse', '--show-toplevel']);
  assert.equal(r.stdout.toString().trim(), realpathSync(dir));
});

t('GIT_DIR in the process environment is ignored', () => {
  withEnv({ GIT_DIR: join(scratch, 'no-such-gitdir') }, () => {
    assert.notEqual(plain({ GIT_DIR: process.env.GIT_DIR }, ['rev-parse', '--show-toplevel']).status, 0);
    assert.equal(git(dir, ['rev-parse', '--show-toplevel']).stdout.toString().trim(), realpathSync(dir));
  });
});

t('GIT_CONFIG_COUNT/KEY/VALUE injection is ignored', () => {
  const inject = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 's5.probe', GIT_CONFIG_VALUE_0: 'injected' };
  assert.equal(plain(inject, ['config', '--get', 's5.probe']).stdout, 'injected\n');
  withEnv(inject, () => {
    const r = git(dir, ['config', '--get', 's5.probe']);
    assert.equal(r.status, 1);
    assert.equal(r.stdout.length, 0);
  });
});

t('global config under HOME and XDG_CONFIG_HOME is not read', () => {
  const home = join(scratch, 'home');
  const xdg = join(scratch, 'xdg');
  mkdirSync(home, { recursive: true });
  mkdirSync(join(xdg, 'git'), { recursive: true });
  writeFileSync(join(home, '.gitconfig'), '[s5]\n\tprobe = from-home\n');
  writeFileSync(join(xdg, 'git', 'config'), '[s5]\n\txdg = from-xdg\n');
  const vars = { HOME: home, XDG_CONFIG_HOME: xdg };
  assert.equal(plain(vars, ['config', '--get', 's5.probe']).stdout, 'from-home\n');
  assert.equal(plain(vars, ['config', '--get', 's5.xdg']).stdout, 'from-xdg\n');
  withEnv(vars, () => {
    assert.equal(git(dir, ['config', '--get', 's5.probe']).status, 1);
    assert.equal(git(dir, ['config', '--get', 's5.xdg']).status, 1);
  });
});

t('the child sees exactly the pinned variables, and no other GIT_* variable', () => {
  // A shell alias runs with git's own child environment.
  const alias = (name, body) => ['-c', `alias.${name}=!${body}`, name];
  const pinned = git(dir, alias('penv', 'printenv GIT_TERMINAL_PROMPT GIT_NO_LAZY_FETCH GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL HOME XDG_CONFIG_HOME'));
  assert.equal(pinned.stdout.toString(), '0\n1\n1\n/dev/null\n/nonexistent\n/nonexistent\n');
  withEnv({ GIT_S5_PROBE: 'leak', GIT_ALTERNATE_OBJECT_DIRECTORIES: '/nonexistent' }, () => {
    const leaked = git(dir, alias('lenv', 'printenv GIT_S5_PROBE GIT_ALTERNATE_OBJECT_DIRECTORIES'));
    assert.equal(leaked.stdout.length, 0);
  });
});

t('a repo-local core.fsmonitor command does not run', () => {
  const marker = join(scratch, 'fsmonitor-ran');
  assert.equal(git(dir, ['config', 'core.fsmonitor', `sh -c 'touch ${marker}'`]).status, 0);
  try {
    // Control: plain git runs the configured command.
    plain({}, ['status', '--porcelain']);
    assert.ok(existsSync(marker), 'control: plain git did not run the fsmonitor command, so this test proves nothing');
    rmSync(marker);
    git(dir, ['status', '--porcelain']);
    assert.equal(existsSync(marker), false);
  } finally {
    git(dir, ['config', '--unset', 'core.fsmonitor']);
  }
});

t('git replace refs are not honoured', () => {
  const blob = (s) => git(dir, ['hash-object', '-w', '--stdin'], { input: Buffer.from(s) }).stdout.toString().trim();
  const real = blob('real\n');
  const forged = blob('forged\n');
  const ref = `refs/replace/${real}`;
  assert.equal(git(dir, ['update-ref', ref, forged]).status, 0);
  try {
    assert.equal(plain({}, ['cat-file', '-p', real]).stdout, 'forged\n'); // control
    assert.equal(git(dir, ['cat-file', '-p', real]).stdout.toString(), 'real\n');
  } finally {
    git(dir, ['update-ref', '-d', ref]);
  }
});

t('a path in args is literal, not a glob', () => {
  assert.equal(plain({}, ['ls-files', '*.txt']).stdout, 'a.txt\n'); // control: the glob matches
  assert.equal(git(dir, ['ls-files', '*.txt']).stdout.length, 0);
  assert.equal(git(dir, ['ls-files', 'a.txt']).stdout.toString(), 'a.txt\n');
});

t('a missing directory is a non-zero status with a message; a git that cannot start or is killed throws', () => {
  const r = git(join(scratch, 'does-not-exist'), ['status']);
  assert.equal(r.status, 128);
  assert.match(r.stderr.toString(), /does-not-exist/);
  withEnv({ PATH: join(scratch, 'empty-path') }, () => {
    assert.throws(() => git(dir, ['status']), /could not run/);
  });
  // The alias shell kills its parent, git itself: spawnSync reports status null and a signal.
  assert.throws(() => git(dir, ['-c', 'alias.suicide=!kill -9 $PPID', 'suicide']), /signal SIGKILL/);
});

for (const d of made) rmSync(d, { recursive: true, force: true });
