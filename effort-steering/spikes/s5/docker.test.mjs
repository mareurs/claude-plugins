
// docker.test.mjs — the S5 container launcher, against a FAKE docker binary.
//
// Nothing here starts a real container or talks to a docker daemon: every dockerBin is a
// per-test wrapper around fixtures/fake-docker.mjs, which records each invocation (argv and
// the NAMES of its environment variables, never a value) and behaves as the test scripts it.
// The wrapper exists because dockerRun hands its docker process a whitelisted environment,
// so the fake cannot be steered through the parent's variables.
//
// The fake also models container ownership: a config lists the containers of the "host",
// ours and foreign, and a kill, inspect or rm resolves its references the way docker does (a
// full ID, else a name, else an ID prefix) and records which containers it reached. That lets
// the ownership tests assert the thing that matters (a foreign container was never touched)
// rather than a particular argv.
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

const NAME = 's5-run-1';
const OURS_ID = 'ab'.repeat(32);
const TWIN_ID = 'cd'.repeat(32);
const FOREIGN_ID = 'f0'.repeat(32);
// A container of ours, as the lookup by label finds it; a foreign one, without our labels.
const ours = (name = NAME, over = {}) => ({ id: OURS_ID, name, labels: { s5: '1', 's5.run': name }, ...over });
const foreign = (name) => ({ id: FOREIGN_ID, name, labels: { 'com.example.owner': 'someone-else' } });

const base = (over = {}) => ({ image: 'img:1', name: NAME, timeoutMs: 20_000, stdin: 'null', ...over });
const subs = (f) => f.calls().map((c) => (c.argv[0] === 'container' ? `container ${c.argv[1]}` : c.argv[0]));
const touchedBy = (f) => f.calls().flatMap((c) => c.touched);
const NORMAL = ['run', 'ps', 'container inspect', 'rm'];
const TIMEOUT = ['run', 'ps', 'kill', 'ps', 'container inspect', 'rm'];
const OUTCOME = (r) => ({ created: r.created, oomKilled: r.oomKilled, inspectOk: r.inspectOk, rmOk: r.rmOk });
// A timer left running after dockerRun returned would fire `docker kill` late, and would hold
// the process open.
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
  const f = fakeDocker({ containers: [ours()], run: { stdout: 'out\n', stderr: 'err\n' } });
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
    '--pull=never',
    '--name', NAME,
    '--label', 's5=1',
    '--label', `s5.run=${NAME}`,
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
  assert.deepEqual(Object.keys(r).sort(), ['created', 'inspectOk', 'oomKilled', 'rmOk', 'status', 'stderr', 'stdout', 'timedOut', 'wallMs']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'out\n');
  assert.equal(r.stderr, 'err\n');
  assert.equal(r.timedOut, false);
  assert.deepEqual(OUTCOME(r), { created: true, oomKilled: false, inspectOk: true, rmOk: true });
  assert.ok(Number.isInteger(r.wallMs) && r.wallMs >= 0, `wallMs ${r.wallMs}`);
});

await ta('only the given options reach argv, and the two labels are always there', async () => {
  const f = fakeDocker({});
  await dockerRun({ image: 'img:1', name: 's5-n.1_x-y', timeoutMs: 5000 }, { dockerBin: f.bin });
  assert.deepEqual(f.calls()[0].argv, ['run', '--pull=never', '--name', 's5-n.1_x-y', '--label', 's5=1', '--label', 's5.run=s5-n.1_x-y', 'img:1']);
});

await ta('--pull=never is always passed, before the image, so a pull cannot eat the timeout window', async () => {
  const f = fakeDocker({});
  await dockerRun(base({ mounts: [{ host: '/h', container: '/c' }], cmd: ['--pull', 'always'] }), { dockerBin: f.bin });
  const { argv } = f.calls()[0];
  const at = argv.indexOf('--pull=never');
  assert.ok(at > 0 && at < argv.indexOf('img:1'), `--pull=never at ${at} in ${JSON.stringify(argv)}`);
  assert.equal(argv.filter((a) => a === '--pull=never').length, 1);
});

// ---- secrets ---------------------------------------------------------------------------

await ta('env values never appear in argv; names appear as -e NAME and the value reaches the docker process environment', async () => {
  const secret = 'oauth-VALUE-8f3a91c2-do-not-leak';
  const other = 'second-VALUE-77b1';
  const f = fakeDocker({ containers: [ours()], expectEnv: { CLAUDE_CODE_OAUTH_TOKEN: secret, OTHER_KEY: other } });
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
  assert.deepEqual(subs(f), NORMAL);
  for (const call of calls.slice(1)) {
    assert.ok(!call.envNames.includes('CLAUDE_CODE_OAUTH_TOKEN') && !call.envNames.includes('OTHER_KEY'), `'docker ${call.argv[0]}' does not carry the secrets`);
  }
});

await ta('a run that TIMES OUT: the kill and every helper process carry no secret either', async () => {
  const secret = 'tok-VALUE-31c9e0aa-do-not-leak';
  const f = fakeDocker({ containers: [ours()], expectEnv: { TOKEN: secret }, run: { sleepMs: 20_000 } });
  const r = await dockerRun(base({ env: { TOKEN: secret }, timeoutMs: 500 }), { dockerBin: f.bin });
  assert.equal(r.timedOut, true);
  assert.deepEqual(subs(f), TIMEOUT, 'the timeout path ran its kill and its helpers');
  const [run, ...helpers] = f.calls();
  assert.deepEqual(run.argv.filter((a) => a === 'TOKEN'), ['TOKEN']);
  assert.deepEqual(run.envMatches, { TOKEN: true }, 'the run process has the value');
  assert.ok(run.envNames.includes('TOKEN'));
  for (const call of helpers) {
    assert.ok(!call.envNames.includes('TOKEN'), `'docker ${call.argv[0]}' carries the secret`);
  }
  assert.ok(!JSON.stringify(f.calls()).includes(secret), 'the value is in no log line');
});

await ta('the docker process environment is a whitelist: nothing else from the parent leaks, the env option wins over the parent', async () => {
  const f = fakeDocker({ containers: [ours()], expectEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'child-token' } });
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
  assert.deepEqual(subs(f), NORMAL);
  for (const call of calls) {
    const allowed = new Set([...WHITELIST, ...WRAPPER_NAMES, ...(call.argv[0] === 'run' ? ['CLAUDE_CODE_OAUTH_TOKEN'] : [])]);
    const leaked = call.envNames.filter((n) => !allowed.has(n));
    assert.deepEqual(leaked, [], `'docker ${call.argv[0]}' received parent variables outside the whitelist`);
    for (const name of WHITELIST) assert.ok(call.envNames.includes(name), `'docker ${call.argv[0]}' is missing ${name}`);
  }
  assert.deepEqual(calls[0].envMatches, { CLAUDE_CODE_OAUTH_TOKEN: true }, 'the option value, not the parent value');

  // A DOCKER_* variable that is unset in the parent is absent, not an empty string.
  const g = fakeDocker({});
  const unset = Object.fromEntries(WHITELIST.filter((n) => n.startsWith('DOCKER_')).map((n) => [n, undefined]));
  await withEnv(unset, () => dockerRun(base(), { dockerBin: g.bin }));
  for (const call of g.calls()) {
    for (const name of Object.keys(unset)) assert.ok(!call.envNames.includes(name), `${name} is absent when unset in the parent`);
  }
});

await ta('an env value with a NUL byte is refused with a TypeError that names the key and never quotes the value', async () => {
  const f = fakeDocker({ containers: [ours()] });
  const secret = 'sekret-VALUE-9d2e41';
  await assert.rejects(dockerRun(base({ env: { TOKEN: `${secret}\0tail` } }), { dockerBin: f.bin }), (e) => {
    assert.ok(e instanceof TypeError, `${e}`);
    assert.ok(e.message.includes('TOKEN'), e.message);
    assert.ok(!`${e.message}\n${e.stack}`.includes(secret), 'the value is in the message or the stack');
    assert.ok(!`${e.message}\n${e.stack}`.includes('tail'), 'a part of the value is in the message or the stack');
    return true;
  });
  assert.deepEqual(f.calls(), [], 'nothing was spawned');
});

// ---- the normal run, timeout and cleanup -----------------------------------------------

await ta('a normal exit reports the container status, then looks the container up by label, reads OOMKilled and removes it by ID; no kill', async () => {
  const f = fakeDocker({ containers: [ours()], run: { status: 3, stdout: 'so', stderr: 'se' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 3);
  assert.equal(r.timedOut, false);
  assert.equal(r.stdout, 'so');
  assert.equal(r.stderr, 'se');
  assert.equal(timersLeft(), 0, 'the timeout timer is cleared when the run ends in time');
  assert.deepEqual(subs(f), NORMAL);
  const [, ps, inspect, rm] = f.calls();
  assert.deepEqual(ps.argv, ['ps', '-aq', '--no-trunc', '--filter', `label=s5.run=${NAME}`]);
  assert.deepEqual(inspect.argv, ['container', 'inspect', '--format', '{{.State.OOMKilled}}', OURS_ID]);
  assert.deepEqual(rm.argv, ['rm', '-f', OURS_ID]);
  assert.deepEqual(touchedBy(f), [OURS_ID, OURS_ID], 'by ID, the same container both times');
  for (const call of [inspect, rm]) assert.ok(!call.argv.includes(NAME), `docker ${call.argv[0]} does not address the container by name`);
});

await ta('a timeout looks the container up by label, kills it by ID, and reports timedOut', async () => {
  const name = 's5-slow.run-9';
  const f = fakeDocker({ containers: [ours(name)], run: { sleepMs: 20_000, stdout: 'partial-out', stderr: 'partial-err' } });
  const r = await dockerRun(base({ name, timeoutMs: 500 }), { dockerBin: f.bin });
  assert.equal(r.timedOut, true);
  assert.equal(r.status, 137, 'the run exits when the container is killed');
  assert.equal(r.stdout, 'partial-out', 'output written before the kill is kept');
  assert.equal(r.stderr, 'partial-err');
  assert.ok(r.wallMs >= 500 && r.wallMs < 10_000, `wallMs ${r.wallMs} covers the wait, not the 20 s sleep`);
  assert.equal(timersLeft(), 0, 'the grace timer is cleared once the run has exited');
  assert.deepEqual(subs(f), TIMEOUT);
  const [, ps1, kill, ps2, inspect, rm] = f.calls();
  assert.deepEqual(ps1.argv, ['ps', '-aq', '--no-trunc', '--filter', `label=s5.run=${name}`], 'the lookup comes before the kill');
  assert.deepEqual(kill.argv, ['kill', OURS_ID]);
  assert.deepEqual(ps2.argv, ps1.argv);
  assert.deepEqual(inspect.argv, ['container', 'inspect', '--format', '{{.State.OOMKilled}}', OURS_ID]);
  assert.deepEqual(rm.argv, ['rm', '-f', OURS_ID]);
  for (const call of [kill, inspect, rm]) assert.ok(!call.argv.includes(name), `docker ${call.argv[0]} does not address the container by name`);
  assert.deepEqual(OUTCOME(r), { created: true, oomKilled: false, inspectOk: true, rmOk: true });
});

await ta('dockerRun waits for docker kill to finish before it returns', async () => {
  const f = fakeDocker({ containers: [ours()], run: { sleepMs: 20_000 }, kill: { sleepMs: 600 } });
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin });
  assert.equal(r.timedOut, true);
  assert.ok(existsSync(join(f.dir, 'log.jsonl.finished.kill')), 'the kill process was still running when dockerRun returned');
});

await ta('a docker run that ignores the kill is SIGKILLed after the grace period, and the cleanup still runs', async () => {
  const f = fakeDocker({ containers: [ours()], run: { sleepMs: 20_000, ignoreKill: true } });
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin, killGraceMs: 400 });
  assert.equal(r.timedOut, true);
  assert.equal(r.status, null, 'ended on a signal, so no exit status');
  assert.ok(r.wallMs >= 900 && r.wallMs < 10_000, `wallMs ${r.wallMs}: timeout plus grace, not the 20 s sleep`);
  assert.equal(timersLeft(), 0);
  assert.deepEqual(subs(f), TIMEOUT);
  assert.deepEqual(OUTCOME(r), { created: true, oomKilled: false, inspectOk: true, rmOk: true });
});

await ta('a timeout while no container of ours exists kills nothing: there is no fall back to the name', async () => {
  for (const world of [[], [foreign(NAME)]]) {
    const f = fakeDocker({ containers: world, run: { sleepMs: 20_000 } });
    const r = await dockerRun(base({ timeoutMs: 400 }), { dockerBin: f.bin, killGraceMs: 300 });
    assert.equal(r.timedOut, true);
    assert.equal(r.status, null, 'the client was SIGKILLed after the grace period');
    assert.deepEqual(subs(f), ['run', 'ps', 'ps'], 'two lookups, no kill, no inspect, no rm');
    assert.deepEqual(OUTCOME(r), { created: false, oomKilled: null, inspectOk: false, rmOk: true });
    assert.deepEqual(touchedBy(f), []);
  }
});

await ta('every container carrying our label is killed, inspected and removed, each by its own ID', async () => {
  const twin = { id: TWIN_ID, name: `${NAME}-twin`, labels: { s5: '1', 's5.run': NAME }, oomKilled: true };
  const f = fakeDocker({ containers: [ours(NAME, { oomKilled: false }), twin], run: { sleepMs: 20_000 } });
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin });
  assert.deepEqual(subs(f), TIMEOUT);
  const [, , kill, , inspect, rm] = f.calls();
  assert.deepEqual(kill.argv, ['kill', OURS_ID, TWIN_ID]);
  assert.deepEqual(inspect.argv, ['container', 'inspect', '--format', '{{.State.OOMKilled}}', OURS_ID, TWIN_ID]);
  assert.deepEqual(rm.argv, ['rm', '-f', OURS_ID, TWIN_ID]);
  assert.equal(r.oomKilled, true, 'one of them was OOM-killed');
});

// ---- OOM -------------------------------------------------------------------------------

await ta('OOMKilled true from inspect is reported, with or without a timeout', async () => {
  const f = fakeDocker({ containers: [ours(NAME, { oomKilled: true })], run: { status: 137 } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.oomKilled, true);
  assert.equal(r.timedOut, false, 'an OOM kill is not a timeout');
  assert.equal(r.status, 137);

  const g = fakeDocker({ containers: [ours(NAME, { oomKilled: true })], run: { sleepMs: 20_000 } });
  const t = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: g.bin });
  assert.equal(t.timedOut, true);
  assert.equal(t.oomKilled, true, 'inspect is read after a timeout too');

  const h = fakeDocker({ containers: [ours(NAME, { oomKilled: false })], run: { status: 137 } });
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
    const f = fakeDocker({ containers: [ours()], inspect: { stdout } });
    const r = await dockerRun(base(), { dockerBin: f.bin });
    assert.equal(r.oomKilled, want, JSON.stringify(stdout));
    assert.equal(r.inspectOk, true);
  }
});

await ta('a failed inspect is "unknown", never "no OOM": oomKilled null, inspectOk false, and the container is still removed', async () => {
  const f = fakeDocker({ containers: [ours()], run: { status: 0 }, inspect: { status: 1, stdout: 'true\n', stderr: 'daemon hiccup' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.deepEqual(OUTCOME(r), { created: true, oomKilled: null, inspectOk: false, rmOk: true });
  assert.deepEqual(subs(f), NORMAL, 'rm runs after a failed inspect');
  assert.deepEqual(f.calls()[3].argv, ['rm', '-f', OURS_ID]);
});

await ta('a failed rm is reported: rmOk false, while the inspect answer is kept', async () => {
  const f = fakeDocker({ containers: [ours(NAME, { oomKilled: true })], run: { status: 137 }, rm: { status: 1, stderr: 'boom' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.deepEqual(OUTCOME(r), { created: true, oomKilled: true, inspectOk: true, rmOk: false });
});

await ta('the container is removed whatever the run exit status was', async () => {
  const f = fakeDocker({ containers: [ours()], run: { status: 125, stderr: 'docker: Error response from daemon' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 125);
  assert.equal(r.stderr, 'docker: Error response from daemon');
  assert.deepEqual(subs(f), NORMAL, 'a labelled container exists, so it is inspected and removed even after a 125');
  assert.deepEqual(r.rmOk, true);
});

// ---- ownership: a container that is not ours is never reached --------------------------

await ta('control: by NAME or by ID PREFIX the fake reaches a foreign container, as docker does, and a label lookup does not', () => {
  const f = fakeDocker({ containers: [foreign(NAME)] });
  const call = (...args) => spawnSync(f.bin, args, { env: {}, encoding: 'utf8' });
  assert.equal(call('container', 'inspect', '--format', '{{.State.OOMKilled}}', NAME).status, 0);
  assert.equal(call('kill', FOREIGN_ID.slice(0, 8)).status, 0);
  assert.equal(call('rm', '-f', NAME).status, 0);
  assert.deepEqual(touchedBy(f), [FOREIGN_ID, FOREIGN_ID, FOREIGN_ID], 'name and prefix both resolve to it');
  assert.equal(call('ps', '-aq', '--no-trunc', '--filter', `label=s5.run=${NAME}`).stdout, '', 'the label lookup does not find it');
  assert.equal(call('kill', 'no-such-ref').status, 1);
});

await ta('another tenant holding the name: docker run fails 125, and the foreign container is never inspected, killed or removed', async () => {
  const f = fakeDocker({
    containers: [foreign(NAME)],
    run: { status: 125, stderr: `docker: Error response from daemon: Conflict. The container name "/${NAME}" is already in use by container "${FOREIGN_ID}".` },
  });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 125);
  assert.equal(r.timedOut, false);
  assert.deepEqual(OUTCOME(r), { created: false, oomKilled: null, inspectOk: false, rmOk: true });
  assert.deepEqual(subs(f), ['run', 'ps'], 'the lookup found nothing of ours, so nothing was inspected or removed');
  assert.deepEqual(touchedBy(f), [], 'the foreign container was never reached');
});

await ta('a create failure (the image is missing) reports created false and runs no inspect and no rm', async () => {
  const f = fakeDocker({ containers: [], run: { status: 125, stderr: 'docker: Unable to find image locally' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 125);
  assert.deepEqual(OUTCOME(r), { created: false, oomKilled: null, inspectOk: false, rmOk: true });
  assert.deepEqual(subs(f), ['run', 'ps']);
});

await ta('a failed lookup is unknown: created false, oomKilled null, rmOk false, and nothing is inspected or removed by name', async () => {
  const f = fakeDocker({ containers: [ours()], ps: { status: 1, stderr: 'Cannot connect to the Docker daemon' } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.deepEqual(OUTCOME(r), { created: false, oomKilled: null, inspectOk: false, rmOk: false });
  assert.deepEqual(subs(f), ['run', 'ps']);
});

// ---- helpers that hang -----------------------------------------------------------------

await ta('a helper that hangs is SIGKILLed after helperTimeoutMs and counts as failed, instead of blocking the harness', async () => {
  const cases = [
    ['ps', { ps: { sleepMs: 20_000 } }, { created: false, oomKilled: null, inspectOk: false, rmOk: false }],
    ['inspect', { inspect: { sleepMs: 20_000 } }, { created: true, oomKilled: null, inspectOk: false, rmOk: true }],
    ['rm', { rm: { sleepMs: 20_000 } }, { created: true, oomKilled: false, inspectOk: true, rmOk: false }],
  ];
  for (const [which, hang, want] of cases) {
    const f = fakeDocker({ containers: [ours()], ...hang });
    const t0 = Date.now();
    const r = await dockerRun(base(), { dockerBin: f.bin, helperTimeoutMs: 300 });
    assert.ok(Date.now() - t0 < 10_000, `${which} hang: dockerRun took ${Date.now() - t0} ms`);
    assert.deepEqual(OUTCOME(r), want, which);
  }
  // A kill that hangs: the run still ends, and dockerRun does not wait the 20 s.
  const f = fakeDocker({ containers: [ours()], run: { sleepMs: 20_000 }, kill: { sleepMs: 20_000 } });
  const t0 = Date.now();
  const r = await dockerRun(base({ timeoutMs: 500 }), { dockerBin: f.bin, helperTimeoutMs: 300 });
  assert.ok(Date.now() - t0 < 10_000, `kill hang: dockerRun took ${Date.now() - t0} ms`);
  assert.equal(r.timedOut, true);
  assert.ok(!existsSync(join(f.dir, 'log.jsonl.finished.kill')), 'the hung kill was cut short');
});

// ---- output ----------------------------------------------------------------------------

await ta('about 1 MB of multibyte UTF-8 stdout, in chunks that split characters, comes back byte for byte', async () => {
  const unit = 'héllo wörld → 日本語 😀\n';
  const repeat = Math.ceil(1_000_000 / Buffer.byteLength(unit));
  const expected = unit.repeat(repeat);
  const bytes = Buffer.from(expected, 'utf8');
  const midChar = (n) => {
    let count = 0;
    for (let off = n; off < bytes.length; off += n) if ((bytes[off] & 0xc0) === 0x80) count += 1;
    return count;
  };
  let chunkBytes = 65_536;
  while (midChar(chunkBytes) < 5) chunkBytes += 1;
  assert.ok(bytes.length >= 1_000_000, `${bytes.length} bytes`);

  const f = fakeDocker({ containers: [ours()], run: { gen: { unit, repeat, chunkBytes, pauseMs: 3 } } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.status, 0);
  assert.equal(Buffer.byteLength(r.stdout), bytes.length, 'every byte arrived');
  assert.ok(!r.stdout.includes('�'), 'no character was cut in two');
  assert.ok(r.stdout === expected, 'stdout differs from what was printed');
  assert.equal(r.stderr, '');
});

await ta('stdout is complete when the stdio streams close, not when the process exits: a write after the exit is kept', async () => {
  const f = fakeDocker({ containers: [ours()], run: { stdout: 'head|', tailAfterExit: { text: '|tail-after-exit', delayMs: 1000 } } });
  const r = await dockerRun(base(), { dockerBin: f.bin });
  assert.equal(r.stdout, 'head||tail-after-exit');
  assert.ok(r.wallMs >= 900, `wallMs ${r.wallMs}: the run is over when its output is complete`);
});

await ta('a docker binary that cannot start rejects with an error naming the run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's5-docker-test-'));
  made.push(dir);
  await assert.rejects(dockerRun(base(), { dockerBin: join(dir, 'no-such-docker') }), new RegExp(`${NAME} could not start: .*ENOENT`));
});

await ta('dockerBin defaults to docker, found on PATH, which the whitelist passes through', async () => {
  const f = fakeDocker({ containers: [ours()] });
  await withEnv({ PATH: `${f.dir}${delimiter}${process.env.PATH}` }, async () => {
    await dockerRun(base());
    assert.deepEqual(subs(f), NORMAL);
    assert.equal(removeLabeled(), 1, 'the default ps answers with the one s5=1 container');
  });
  assert.deepEqual(subs(f), [...NORMAL, 'ps', 'rm']);
});

// ---- validation ------------------------------------------------------------------------

await ta('invalid input is a TypeError and docker is never called', async () => {
  const bad = {
    'name without the s5- prefix': { name: 'run-1' },
    'name that is a hex ID prefix': { name: FOREIGN_ID.slice(0, 12) },
    'name that is only the prefix': { name: 's5-' },
    'name with a capital prefix': { name: 'S5-x' },
    'name with a leading dash': { name: '-x' },
    'name with a space': { name: 's5-a b' },
    'name with a slash': { name: 's5-a/b' },
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
  // The next line of validation would also throw a TypeError on an undefined value, by accident:
  // pin the message of the check that is meant to refuse it.
  await assert.rejects(dockerRun(base({ env: { GOOD_KEY: undefined } }), { dockerBin: f.bin }), /env GOOD_KEY must be a string/);
});

// ---- removeLabeled ---------------------------------------------------------------------

const S5A = { id: 'aa'.repeat(32), name: 's5-a', labels: { s5: '1' } };
const S5B = { id: 'bb'.repeat(32), name: 's5-b', labels: { s5: '1', 's5.run': 's5-b' } };
const OTHER = { id: 'cc'.repeat(32), name: 'someone-elses', labels: { 'com.example.owner': 'x' } };
const RUN_ONLY = { id: 'dd'.repeat(32), name: 's5-d', labels: { 's5.run': 'zzz' } };

await ta('removeLabeled filters on the label s5=1 only', async () => {
  const f = fakeDocker({ containers: [S5A, S5B, OTHER, RUN_ONLY] });
  assert.equal(removeLabeled('s5=1', { dockerBin: f.bin }), 2);
  assert.deepEqual(f.calls().map((c) => c.argv), [
    ['ps', '-aq', '--filter', 'label=s5=1'],
    ['rm', '-f', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb'],
  ]);
  assert.deepEqual(touchedBy(f), [S5A.id, S5B.id], 'the foreign and the s5.run-only containers were not reached');

  const g = fakeDocker({ containers: [S5A, OTHER] });
  assert.equal(removeLabeled(undefined, { dockerBin: g.bin }), 1);
  assert.deepEqual(g.calls()[0].argv, ['ps', '-aq', '--filter', 'label=s5=1'], 's5=1 is the default');

  const h = fakeDocker({ containers: [S5A, S5B, OTHER] });
  assert.equal(removeLabeled('s5.run=s5-b', { dockerBin: h.bin }), 1);
  assert.deepEqual(h.calls().map((c) => c.argv), [
    ['ps', '-aq', '--filter', 'label=s5.run=s5-b'],
    ['rm', '-f', 'bbbbbbbbbbbb'],
  ]);
});

await ta('removeLabeled removes nothing and returns 0 when no container carries the label', async () => {
  const f = fakeDocker({ containers: [OTHER] });
  assert.equal(removeLabeled('s5=1', { dockerBin: f.bin }), 0);
  assert.deepEqual(subs(f), ['ps'], 'no rm without ids');
});

await ta('removeLabeled refuses a label outside s5: this host runs other people\'s containers', async () => {
  const f = fakeDocker({ containers: [S5A] });
  const foreignLabels = ['', 'com.docker.compose.project=x', 'foo=s5', 'S5=1', 'x.s5=1', 's50=1', 's5x', 'label=s5=1'];
  for (const label of foreignLabels) {
    assert.throws(() => removeLabeled(label, { dockerBin: f.bin }), TypeError, JSON.stringify(label));
  }
  assert.throws(() => removeLabeled(7, { dockerBin: f.bin }), TypeError);
  assert.deepEqual(f.calls(), [], 'docker was never called');
  for (const ok of ['s5', 's5=1', 's5.run=x', 's5.task']) {
    assert.doesNotThrow(() => removeLabeled(ok, { dockerBin: fakeDocker({}).bin }), ok);
  }
});

await ta('removeLabeled throws when ps fails and does not go on to rm', async () => {
  const f = fakeDocker({ containers: [S5A], ps: { status: 1, stderr: 'Cannot connect to the Docker daemon' } });
  assert.throws(() => removeLabeled('s5=1', { dockerBin: f.bin }), /ps failed \(exit 1\)/);
  assert.deepEqual(subs(f), ['ps']);

  const g = fakeDocker({ containers: [S5A], rm: { status: 1, stderr: 'boom' } });
  assert.throws(() => removeLabeled('s5=1', { dockerBin: g.bin }), /rm failed \(exit 1\): boom/);
});

await ta('removeLabeled does not block forever: each docker call has its own timeout', async () => {
  const f = fakeDocker({ containers: [S5A], ps: { sleepMs: 20_000 } });
  let t0 = Date.now();
  assert.throws(() => removeLabeled('s5=1', { dockerBin: f.bin, helperTimeoutMs: 300 }), /ps timed out after 300 ms/);
  assert.ok(Date.now() - t0 < 10_000, `ps hang: ${Date.now() - t0} ms`);
  assert.deepEqual(subs(f), ['ps']);

  const g = fakeDocker({ containers: [S5A], rm: { sleepMs: 20_000 } });
  t0 = Date.now();
  assert.throws(() => removeLabeled('s5=1', { dockerBin: g.bin, helperTimeoutMs: 300 }), /rm timed out after 300 ms/);
  assert.ok(Date.now() - t0 < 10_000, `rm hang: ${Date.now() - t0} ms`);
});

await ta('removeLabeled throws when the docker binary cannot run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's5-docker-test-'));
  made.push(dir);
  assert.throws(() => removeLabeled('s5=1', { dockerBin: join(dir, 'no-such-docker') }), /ps could not run: .*ENOENT/);
});
