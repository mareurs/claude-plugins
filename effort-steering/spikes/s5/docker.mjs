
// docker.mjs — the S5 harness's container launcher. Every agent run, grade and task gate
// goes through dockerRun, and it decides two things the verdict depends on:
//
//   * a run that hit the wall clock (timedOut: a MODEL failure) versus one the kernel
//     killed for memory (oomKilled: an INFRASTRUCTURE failure). Both are reported, never
//     merged, and OOMKilled is read from `docker inspect` after EVERY run, because a timed-out
//     container can also have been OOM-killed;
//   * that a secret never appears in argv. A secret is passed as `-e NAME`, and its value
//     lives only in the environment of the `docker run` process.
//
// The host runs about 20 unrelated containers. Every container started here carries the label
// s5=1 (and s5.run=<name>), and removeLabeled refuses a label outside s5, so the runner has a
// way to find and remove its own containers and no way to sweep anyone else's. The kill,
// inspect and rm that follow a run address the container by NAME, which docker resolves across
// every tenant: a caller must pick names that no other tenant can hold, because a name collision
// would send the kill and the rm to that other container.
//
// Nothing here is shell-parsed: docker is spawned with an argv array.

import { spawn, spawnSync } from 'node:child_process';

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
// `s5`, `s5.<anything>`, either optionally followed by =<value>. Not `s50`, not `s5x`.
const LABEL_SCOPE_RE = /^s5([.=]|$)/;
const RESERVED_LABEL_KEYS = new Set(['s5', 's5.run']);
// The only variables a docker process inherits from this one.
const PASSTHROUGH = ['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY'];
const KILL_GRACE_MS = 30_000;

// docker's own environment: the whitelist and nothing else (no ANTHROPIC_*, no CLAUDE_*).
function baseEnv() {
  const env = {};
  for (const k of PASSTHROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const text = (s) => typeof s === 'string' && s !== '';

function optionalText(what, v) {
  if (v !== undefined && !text(v)) throw new TypeError(`dockerRun: ${what} must be a non-empty string when given, got ${JSON.stringify(v)}`);
}

// Validate the options and build the `docker run` argv. Throws TypeError before anything runs.
function plan(o) {
  if (o === null || typeof o !== 'object') throw new TypeError('dockerRun: an options object is required');
  const { image, name, labels = {}, cpus, memoryGb, network, mounts = [], env = {}, workdir, user, cmd = [], timeoutMs, stdin } = o;
  if (!text(image) || image.startsWith('-')) throw new TypeError(`dockerRun: image must be a non-empty string that is not an option, got ${JSON.stringify(image)}`);
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new TypeError(`dockerRun: name must match ${NAME_RE}, got ${JSON.stringify(name)}`);
  if (!positive(timeoutMs)) throw new TypeError(`dockerRun: timeoutMs must be a positive number, got ${JSON.stringify(timeoutMs)}`);
  if (stdin !== undefined && stdin !== 'null') throw new TypeError(`dockerRun: stdin must be 'null' when given, got ${JSON.stringify(stdin)}`);
  if (cpus !== undefined && !positive(cpus)) throw new TypeError(`dockerRun: cpus must be a positive number, got ${JSON.stringify(cpus)}`);
  if (memoryGb !== undefined && !positive(memoryGb)) throw new TypeError(`dockerRun: memoryGb must be a positive number, got ${JSON.stringify(memoryGb)}`);
  optionalText('network', network);
  optionalText('workdir', workdir);
  optionalText('user', user);
  if (!Array.isArray(cmd) || !cmd.every((c) => typeof c === 'string')) throw new TypeError('dockerRun: cmd must be an array of strings');

  const argv = ['run', '--name', name, '--label', 's5=1', '--label', `s5.run=${name}`];
  for (const [k, v] of Object.entries(labels)) {
    // The key may not contain `=` (it would split into another key) and may not be one of
    // ours: a later --label overrides an earlier one, which would undo s5=1.
    if (!NAME_RE.test(k) || RESERVED_LABEL_KEYS.has(k)) throw new TypeError(`dockerRun: label key ${JSON.stringify(k)} is invalid or reserved`);
    if (typeof v !== 'string') throw new TypeError(`dockerRun: label ${k} must be a string`);
    argv.push('--label', `${k}=${v}`);
  }
  if (cpus !== undefined) argv.push('--cpus', String(cpus));
  if (memoryGb !== undefined) argv.push('--memory', `${memoryGb}g`);
  if (network !== undefined) argv.push('--network', network);
  if (user !== undefined) argv.push('--user', user);
  if (workdir !== undefined) argv.push('--workdir', workdir);
  for (const m of mounts) {
    // A comma ends a field in the --mount grammar, so a path holding one would inject a key.
    if (!m || !text(m.host) || !text(m.container) || m.host.includes(',') || m.container.includes(',')) {
      throw new TypeError(`dockerRun: a mount needs a host and a container path without ',', got ${JSON.stringify(m)}`);
    }
    argv.push('--mount', `type=bind,source=${m.host},target=${m.container}${m.readOnly ? ',readonly' : ''}`);
  }
  const runEnv = baseEnv();
  for (const [k, v] of Object.entries(env)) {
    if (!ENV_KEY_RE.test(k)) throw new TypeError(`dockerRun: env key must match ${ENV_KEY_RE}, got ${JSON.stringify(k)}`);
    // An undefined value would make `-e NAME` forward nothing, and the secret would vanish.
    if (typeof v !== 'string') throw new TypeError(`dockerRun: env ${k} must be a string`);
    argv.push('-e', k);
    runEnv[k] = v;
  }
  argv.push(image, ...cmd);
  return { argv, name, timeoutMs, runEnv };
}

// `docker <args>` with the base environment only (the secrets stay with `docker run`).
// Never rejects: a docker that cannot start comes back as `error`.
function dockerCmd(bin, args) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: baseEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
    const out = [];
    child.stdout.on('data', (c) => out.push(c));
    child.once('error', (error) => resolve({ status: null, stdout: '', error }));
    child.once('close', (status) => resolve({ status, stdout: Buffer.concat(out).toString('utf8'), error: null }));
  });
}

// dockerRun(options, { dockerBin, killGraceMs }) -> { status, stdout, stderr, timedOut, oomKilled, wallMs }
// (killGraceMs is a seam for tests, so the SIGKILL fallback need not wait 30 s.)
//
// Runs `docker run` in the foreground (no --rm, -d, -i or -t, stdin /dev/null) and waits for it.
//   status    the container's exit status, or null when the docker process ended on a signal
//   timedOut  the run hit timeoutMs and was `docker kill`ed by name. If the docker process is
//             still alive killGraceMs (30 s) after the kill it is SIGKILLed, so a wedged
//             client cannot hold the harness.
//   oomKilled `docker inspect` said .State.OOMKilled is true (read after every run)
//   wallMs    start of the run to its end, kill included; the cleanup is not counted
// The container is always removed afterwards (`docker rm -f`), whatever happened.
// Rejects (TypeError) on bad options before anything runs, and (Error) when docker cannot start.
export async function dockerRun(options, { dockerBin = 'docker', killGraceMs = KILL_GRACE_MS } = {}) {
  const { argv, name, timeoutMs, runEnv } = plan(options);
  const started = performance.now();
  const child = spawn(dockerBin, argv, { env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  const err = [];
  child.stdout.on('data', (c) => out.push(c));
  child.stderr.on('data', (c) => err.push(c));
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status) => resolve(status));
  });

  let timedOut = false;
  let killed = Promise.resolve();
  let graceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    killed = dockerCmd(dockerBin, ['kill', name]);
    graceTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
  }, timeoutMs);

  let status;
  try {
    status = await closed;
  } catch (e) {
    throw new Error(`${dockerBin} run ${name} could not start: ${e.message}`);
  } finally {
    clearTimeout(timer);
    clearTimeout(graceTimer);
  }
  const wallMs = Math.round(performance.now() - started);

  await killed;
  const inspect = await dockerCmd(dockerBin, ['inspect', '--format', '{{.State.OOMKilled}}', name]);
  await dockerCmd(dockerBin, ['rm', '-f', name]);
  return {
    status,
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
    timedOut,
    oomKilled: inspect.stdout.trim() === 'true',
    wallMs,
  };
}

function runSync(bin, args) {
  const r = spawnSync(bin, args, { env: baseEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.error) throw new Error(`${bin} ${args[0]} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed (${r.status === null ? `signal ${r.signal}` : `exit ${r.status}`}): ${r.stderr.trim()}`);
  return r.stdout;
}

// removeLabeled(label = 's5=1', { dockerBin }) -> the number of containers removed.
// Removes every container (running or not) that carries the label. The label must be an s5
// label: this host runs other people's containers, and nothing here may touch them.
export function removeLabeled(label = 's5=1', { dockerBin = 'docker' } = {}) {
  if (typeof label !== 'string' || !LABEL_SCOPE_RE.test(label)) {
    throw new TypeError(`removeLabeled: label must be s5 or s5.<name>, optionally =<value>, got ${JSON.stringify(label)}`);
  }
  const ids = runSync(dockerBin, ['ps', '-aq', '--filter', `label=${label}`]).split(/\s+/).filter(Boolean);
  if (ids.length === 0) return 0;
  runSync(dockerBin, ['rm', '-f', ...ids]);
  return ids.length;
}
