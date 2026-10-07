
// docker.test.mjs — the S5 container launcher, against a FAKE docker binary.
//
// Nothing here starts a real container or talks to a docker daemon: every dockerBin is a
// per-test wrapper around fixtures/fake-docker.mjs, which records each invocation (argv and
// the NAMES of its environment variables, never a value) and behaves as the test scripts it.
// The wrapper exists because dockerRun hands its docker process a whitelisted environment,
// so the fake cannot be steered through the parent's variables.
//
// The one test that omits dockerBin puts a wrapper NAMED `docker` first on PATH, so the
// default 'docker' still resolves to a fake and never to the real binary.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerRun, removeLabeled } from './docker.mjs';
import { ta } from './fixtures/testkit-async.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-docker.mjs');

const made = [];
process.on('exit', () => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

const shq = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// fakeDocker(config) -> { bin, calls(), dir }. `bin` is a wrapper script that exports the
// log and config paths and execs the fake; calls() reads the log back, one object per call.
function fakeDocker(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 's5-docker-test-'));
  made.push(dir);
  const log = join(dir, 'log.jsonl');
  const cfg = join(dir, 'config.json');
  writeFileSync(cfg, JSON.stringify(config));
  const bin = join(dir, 'docker');
  writeFileSync(bin, `#!/bin/sh\nexport FAKE_DOCKER_LOG=${shq(log)}\nexport FAKE_DOCKER_CONFIG=${shq(cfg)}\nexec ${shq(process.execPath)} ${shq(FAKE)} "$@"\n`);
  chmodSync(bin, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}

// Set process.env entries for the body (undefined deletes), then restore them.
async function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const base = (over = {}) => ({ image: 'img:1', name: 'run-1', timeoutMs: 20_000, stdin: 'null', ...over });
const subs = (f) => f.calls().map((c) => c.argv[0]);
// A timer left running after dockerRun returned would fire `docker kill <name>` late, on a name
// that may be a different run by then, and would hold the process open.
const timersLeft = () => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;

// The names a fresh wrapper adds on its own (the shell's PWD, SHLVL, ...; the two FAKE_
// control variables): a control run with an EMPTY environment. A leak is then any other name.
const WRAPPER_NAMES = (() => {
  const f = fakeDocker({});
  const r = spawnSync(f.bin, ['ps'], { env: {}, encoding: 'utf8' });
  assert.equal(r.status, 0, `control run of the wrapper failed: ${r.stderr}`);
  return new Set(f.calls()[0].envNames);
})();
const WHITELIST = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY'];

// ---- argv ------------------------------------------------------------------------------

await ta('argv carries --label s5=1, --label s5.run=<name>, --cpus, --memory <n>g, --network, and readonly on read-only mounts', async () => {
  const f = fakeDocker({ run: { stdout: 'out\n', stderr: 'err\n' } });
  const r = await dockerRun(
    base({
      labels: { 's5.task': 't1' },
      cpus: 2,
      memoryGb: 4,
      network: 'net-s5',
      mounts: [
        { host: '/h/a', container: '/c/a', readOnly: true },
        { host: '/h/b', container: '/c/b' },
      ],
      env: { A_ONE: 'value-one', B_TWO: 'value-two' },
      workdir: '/work',
      user: '1000:1000',
      cmd: ['sh', '-c', 'echo hi'],
    }),
    { dockerBin: f.bin },
  );
  const [run] = f.calls();
  assert.deepEqual(run.argv, [
    'run',
    '--name', 'run-1',
    '--label', 's5=1',
    '--label', 's5.run=run-1',
    '--label', 's5.task=t1',
    '--cpus', '2',
    '--memory', '4g',
    '--network', 'net-s5',
    '--user', '1000:1000',
    '--workdir', '/work',
    '--mount', 'type=bind,source=/h/a,target=/c/a,readonly',
    '--mount', 'type=bind,source=/h/b,target=/c/b',
    '-e', 'A_ONE',
    '-e', 'B_TWO',
    'img:1',
    'sh', '-c', 'echo hi',
  ]);
  for (const flag of ['-d', '--detach', '--rm', '-i', '-t', '-it', '--interactive', '--tty']) {
    assert.ok(!run.argv.includes(flag), `foreground run, no ${flag}`);
  }
  assert.equal(run.stdinKind, 'null', 'stdin is /dev/null');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'out\n');
  assert.equal(r.stderr, 'err\n');
  assert.equal(r.timedOut, false);
  assert.equal(r.oomKilled, false);
  assert.ok(Number.isInteger(r.wallMs) && r.wallMs >= 0, `wallMs ${r.wallMs}`);
});

await ta('only the given options reach argv, and the two labels are always there', async () => {
  const f = fakeDocker({});
  await dockerRun({ image: 'img:1', name: 'n.1_x-y', timeoutMs: 5000 }, { dockerBin: f.bin });
  assert.deepEqual(f.calls()[0].argv, ['run', '--name', 'n.1_x-y', '--label', 's5=1', '--label', 's5.run=n.1_x-y', 'img:1']);
});

// ---- secrets ---------------------------------------------------------------------------

await ta('env values never appear in argv; names appear as -e NAME and the value reaches the docker process environment', async () => {
  const secret = 'oauth-VALUE-8f3a91c2-do-not-leak';
  const other = 'second-VALUE-77b1';
  const f = fakeDocker({ expectEnv: { CLAUDE_CODE_OAUTH_TOKEN: secret, OTHER_KEY: other } });
  await dockerRun(base({ env: { CLAUDE_CODE_OAUTH_TOKEN: secret, OTHER_KEY: other }, cmd: ['claude', '-p'] }), { dockerBin: f.bin });
  const calls = f.calls();
  const run = calls[0];
  const at = (flagged) => run.argv.flatMap((a, i) => (a === flagged ? [run.argv[i + 1]] : []));
  assert.deepEqual(at('-e'), ['CLAUDE_CODE_OAUTH_TOKEN', 'OTHER_KEY']);
  for (const call of calls) {
    const text = JSON.stringify(call);
    assert.ok(!text.includes(secret) && !text.includes(other), `a value reached the log of 'docker ${call.argv[0]}'`);
  }
  assert.deepEqual(run.envMatches, { CLAUDE_CODE_OAUTH_TOKEN: true, OTHER_KEY: true }, 'the values are in the docker process environment');
  for (const call of calls.slice(1)) {
    assert.ok(!call.envNames.includes('CLAUDE_CODE_OAUTH_TOKEN') && !call.envNames.includes('OTHER_KEY'), `'docker ${call.argv[0]}' does not carry the secrets`);
  }
});

await ta('the docker process environment is a whitelist: nothing else from the parent leaks, the env option wins over the parent', async () => {
  const f = fakeDocker({ expectEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'child-token' } });
  const parent = {
    ANTHROPIC_API_KEY: 'leak-1',
    ANTHROPIC_BASE_URL: 'leak-2',
    CLAUDE_CODE_OAUTH_TOKEN: 'parent-token',
    CLAUDE_CONFIG_DIR: 'leak-3',
    S5_SOMETHING: 'leak-4',
    HOME: process.env.HOME ?? '/nonexistent-home',
    DOCKER_HOST: 'unix:///nonexistent.sock',
    DOCKER_CONFIG: '/nonexistent/docker-config',
    DOCKER_CONTEXT: 'a-context',
    DOCKER_CERT_PATH: '/nonexistent/certs',
    DOCKER_TLS_VERIFY: '1',
  };
  await withEnv(parent, () => dockerRun(base({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'child-token' } }), { dockerBin: f.bin }));
  const calls = f.calls();
  assert.deepEqual(subs(f), ['run', 'inspect', 'rm']);
  for (const call of calls) {
    const allowed = new Set([...WHITELIST, ...WRAPPER_NAMES, ...(call.argv[0] === 'run' ? ['CLAUDE_CODE_OAUTH_TOKEN'] : [])]);
    const leaked = call.envNames.filter((n) => !allowed.has(n));
    assert.deepEqual(leaked, [], `'docker ${call.argv[0]}' received parent variables outside the whitelist`);
    for (const name of WHITELIST) assert.ok(call.envNames.includes(name), `'docker ${call.argv[0]}' is missing ${name}`);
  }
  assert.deepEqual(calls[0].envMatches, { CLAUDE_CODE_OAUTH_TOKEN: true }, 'the option value, not the parent value');
  assert.ok(!calls[1].envNames.includes('CLAUDE_CODE_OAUTH_TOKEN'), 'inspect does not carry the secret');

  // A DOCKER_* variable that is unset in the parent is absent, not an empty string.
  const g = fakeDocker({});
  const unset = Object.fromEntries(WHITELIST.filter((n) => n.startsWith('DOCKER_')).map((n) => [n, undefined]));
  await withEnv(unset, () => dockerRun(base(), { dockerBin: g.bin }));
  for (const call of g.calls()) {
    for (const name of Object.keys(unset)) assert.ok(!call.envNames.includes(name), `${name} is absent when unset in the parent`);
  }
});

// ---- timeout, OOM, cleanup -------------------------------------------------------------

await ta('a normal exit reports the container status, then reads OOMKilled and removes the container; no kill', async () => {
  const f = fakeDocker({ run: { status: 3, stdout: 'so', stderr: 'se' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 3);
  assert.equal(r.timedOut, false);
  assert.equal(r.stdout, 'so');
  assert.equal(r.stderr, 'se');
  assert.equal(timersLeft(), 0, 'the timeout timer is cleared when the run ends in time');
  assert.deepEqual(subs(f), ['run', 'inspect', 'rm']);
  const [, inspect, rm] = f.calls();
  assert.deepEqual(inspect.argv, ['inspect', '--format', '{{.State.OOMKilled}}', 'run-1']);
  assert.deepEqual(rm.argv, ['rm', '-f', 'run-1']);
});

await ta('a timeout kills the container by name and reports timedOut', async () => {
  const f = fakeDocker({ run: { sleepMs: 20_000, stdout: 'partial-out', stderr: 'partial-err' } });
  const r = await dockerRun(base({ name: 'slow.run-9', timeoutMs: 500 }), { dockerBin: f.bin });
  assert.equal(r.timedOut, true);
  assert.equal(r.status, 137, 'the run exits when the container is killed');
  assert.equal(r.stdout, 'partial-out', 'output written before the kill is kept');
  assert.equal(r.stderr, 'partial-err');
  assert.ok(r.wallMs >= 500 && r.wallMs < 10_000, `wallMs ${r.wallMs} covers the wait, not the 20 s sleep`);
  assert.equal(timersLeft(), 0, 'the grace timer is cleared once the run has exited');
  assert.deepEqual(subs(f), ['run', 'kill', 'inspect', 'rm']);
  const [, kill, inspect, rm] = f.calls();
  assert.deepEqual(kill.argv, ['kill', 'slow.run-9']);
  assert.deepEqual(inspect.argv, ['inspect', '--format', '{{.State.OOMKilled}}', 'slow.run-9']);
  assert.deepEqual(rm.argv, ['rm', '-f', 'slow.run-9']);
});

await ta('dockerRun waits for docker kill to finish before it returns', async () => {
  const f = fakeDocker({ run: { sleepMs: 20_000 }, kill: { sleepMs: 600 } });
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin });
  assert.equal(r.timedOut, true);
  assert.ok(existsSync(join(f.dir, 'log.jsonl.finished.kill')), 'the kill process was still running when dockerRun returned');
});

await ta('a docker run that ignores the kill is SIGKILLed after the grace period, and the cleanup still runs', async () => {
  const f = fakeDocker({ run: { sleepMs: 20_000, ignoreKill: true } });
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin, killGraceMs: 400 });
  assert.equal(r.timedOut, true);
  assert.equal(r.status, null, 'ended on a signal, so no exit status');
  assert.ok(r.wallMs >= 900 && r.wallMs < 10_000, `wallMs ${r.wallMs}: timeout plus grace, not the 20 s sleep`);
  assert.equal(timersLeft(), 0);
  assert.deepEqual(subs(f), ['run', 'kill', 'inspect', 'rm']);
});

await ta('OOMKilled true from inspect is reported, with or without a timeout', async () => {
  const f = fakeDocker({ run: { status: 137 }, inspect: { oomKilled: true } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.oomKilled, true);
  assert.equal(r.timedOut, false, 'an OOM kill is not a timeout');
  assert.equal(r.status, 137);

  const g = fakeDocker({ run: { sleepMs: 20_000 }, inspect: { oomKilled: true } });
  const t = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: g.bin });
  assert.equal(t.timedOut, true);
  assert.equal(t.oomKilled, true, 'inspect is read after a timeout too');

  const h = fakeDocker({ run: { status: 137 }, inspect: { oomKilled: false } });
  assert.equal((await dockerRun(base(), { dockerBin: h.bin })).oomKilled, false);
});

await ta('oomKilled is true only when the inspect output trims to exactly true', async () => {
  const cases = [
    ['true\n', true],
    ['  true \n', true],
    ['true', true],
    ['false\n', false],
    ['True\n', false],
    ['truex', false],
    ['', false],
    ['<no value>\n', false],
  ];
  for (const [stdout, want] of cases) {
    const f = fakeDocker({ inspect: { stdout } });
    const r = await dockerRun(base(), { dockerBin: f.bin });
    assert.equal(r.oomKilled, want, JSON.stringify(stdout));
  }
});

await ta('the container is removed in every case: non-zero exit, a failing inspect', async () => {
  const f = fakeDocker({ run: { status: 125, stderr: 'docker: Error response from daemon' }, inspect: { status: 1, stdout: '' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 125);
  assert.equal(r.oomKilled, false);
  assert.equal(r.stderr, 'docker: Error response from daemon');
  assert.deepEqual(subs(f), ['run', 'inspect', 'rm']);
  assert.deepEqual(f.calls()[2].argv, ['rm', '-f', 'run-1']);
});

await ta('a docker binary that cannot start rejects with an error naming the run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's5-docker-test-'));
  made.push(dir);
  await assert.rejects(dockerRun(base(), { dockerBin: join(dir, 'no-such-docker') }), /run-1 could not start: .*ENOENT/);
});

await ta('dockerBin defaults to docker, found on PATH, which the whitelist passes through', async () => {
  const f = fakeDocker({});
  await withEnv({ PATH: `${f.dir}${delimiter}${process.env.PATH}` }, async () => {
    await dockerRun(base());
    assert.deepEqual(subs(f), ['run', 'inspect', 'rm']);
    assert.equal(removeLabeled(), 0, 'the default ps answers with no ids');
  });
  assert.deepEqual(subs(f), ['run', 'inspect', 'rm', 'ps']);
});

// ---- validation ------------------------------------------------------------------------

await ta('invalid input is a TypeError and docker is never called', async () => {
  const bad = {
    'name with a leading dash': { name: '-x' },
    'name with a space': { name: 'a b' },
    'name with a slash': { name: 'a/b' },
    'empty name': { name: '' },
    'lowercase env key': { env: { lower: 'v' } },
    'env key with a dash': { env: { 'A-B': 'v' } },
    'env key starting with a digit': { env: { '1A': 'v' } },
    'non-string env value': { env: { GOOD_KEY: undefined } },
    'comma in a mount host path': { mounts: [{ host: '/h/a,b', container: '/c' }] },
    'comma in a mount container path': { mounts: [{ host: '/h', container: '/c,readonly' }] },
    'label key s5': { labels: { s5: '0' } },
    'label key s5.run': { labels: { 's5.run': 'other' } },
    'label key with =': { labels: { 's5=0': 'x' } },
    'image that reads as a flag': { image: '--privileged' },
    'no timeout': { timeoutMs: undefined },
    'zero timeout': { timeoutMs: 0 },
    'stdin other than null': { stdin: 'inherit' },
    'negative cpus': { cpus: -1 },
    'non-numeric memory': { memoryGb: 'lots' },
  };
  const f = fakeDocker({});
  for (const [what, over] of Object.entries(bad)) {
    await assert.rejects(dockerRun(base(over), { dockerBin: f.bin }), TypeError, what);
  }
  assert.deepEqual(f.calls(), [], 'no docker call was made for any of them');
});

// ---- removeLabeled ---------------------------------------------------------------------

await ta('removeLabeled filters on the label s5=1 only', async () => {
  const f = fakeDocker({ ps: { stdout: 'aaa111\nbbb222\n' } });
  assert.equal(removeLabeled('s5=1', { dockerBin: f.bin }), 2);
  assert.deepEqual(f.calls().map((c) => c.argv), [
    ['ps', '-aq', '--filter', 'label=s5=1'],
    ['rm', '-f', 'aaa111', 'bbb222'],
  ]);

  const g = fakeDocker({ ps: { stdout: 'ccc333\n' } });
  assert.equal(removeLabeled(undefined, { dockerBin: g.bin }), 1);
  assert.deepEqual(g.calls()[0].argv, ['ps', '-aq', '--filter', 'label=s5=1'], 's5=1 is the default');

  const h = fakeDocker({ ps: { stdout: 'ddd444\n' } });
  assert.equal(removeLabeled('s5.run=run-7', { dockerBin: h.bin }), 1);
  assert.deepEqual(h.calls()[0].argv, ['ps', '-aq', '--filter', 'label=s5.run=run-7']);
});

await ta('removeLabeled removes nothing and returns 0 when no container carries the label', async () => {
  const f = fakeDocker({ ps: { stdout: '\n' } });
  assert.equal(removeLabeled('s5=1', { dockerBin: f.bin }), 0);
  assert.deepEqual(subs(f), ['ps'], 'no rm without ids');
});

await ta('removeLabeled refuses a label outside s5: this host runs other people\'s containers', async () => {
  const f = fakeDocker({ ps: { stdout: 'zzz999\n' } });
  const foreign = ['', 'com.docker.compose.project=x', 'foo=s5', 'S5=1', 'x.s5=1', 's50=1', 's5x', 'label=s5=1'];
  for (const label of foreign) {
    assert.throws(() => removeLabeled(label, { dockerBin: f.bin }), TypeError, JSON.stringify(label));
  }
  assert.throws(() => removeLabeled(7, { dockerBin: f.bin }), TypeError);
  assert.deepEqual(f.calls(), [], 'docker was never called');
  for (const ok of ['s5', 's5=1', 's5.run=x', 's5.task']) {
    assert.doesNotThrow(() => removeLabeled(ok, { dockerBin: fakeDocker({}).bin }), ok);
  }
});

await ta('removeLabeled throws when ps fails and does not go on to rm', async () => {
  const f = fakeDocker({ ps: { status: 1, stdout: 'aaa111\n', stderr: 'Cannot connect to the Docker daemon' } });
  assert.throws(() => removeLabeled('s5=1', { dockerBin: f.bin }), /ps failed \(exit 1\): Cannot connect/);
  assert.deepEqual(subs(f), ['ps']);

  const g = fakeDocker({ ps: { stdout: 'aaa111\n' }, rm: { status: 1, stderr: 'boom' } });
  assert.throws(() => removeLabeled('s5=1', { dockerBin: g.bin }), /rm failed \(exit 1\): boom/);
});

await ta('removeLabeled throws when the docker binary cannot run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's5-docker-test-'));
  made.push(dir);
  assert.throws(() => removeLabeled('s5=1', { dockerBin: join(dir, 'no-such-docker') }), /ps could not run: .*ENOENT/);
});
