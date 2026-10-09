
// docker.mjs — the S5 harness's container launcher. Every agent run, grade and task gate
// goes through dockerRun, and it decides two things the verdict depends on:
//
//   * a run that hit the wall clock (timedOut: a MODEL failure) versus one the kernel
//     killed for memory (oomKilled: an INFRASTRUCTURE failure). Both are reported, never
//     merged, and OOMKilled is read from `docker container inspect` after EVERY run that
//     created a container, because a timed-out container can also have been OOM-killed. When
//     docker could not answer, the answer is null and `inspectOk` is false: "unknown" is never
//     reported as "no OOM";
//   * that a secret never appears in argv. A secret is passed as `-e NAME`, and its value
//     lives only in the environment of the `docker run` process.
//
// The host runs about 20 unrelated containers, so this file never addresses a container by
// NAME after the run has started. Docker resolves a name across every tenant (and a name that
// matches nothing is tried as an ID prefix), so a kill, inspect or rm by name can reach a
// container that is not ours. Instead the container is looked up by its label,
// `docker ps -aq --no-trunc --filter label=s5.run=<name>`, and everything after that acts on
// the full IDs that lookup returned. A name that docker refused because another tenant holds
// it finds no labelled container, so nothing is inspected, killed or removed.
// Every container started here carries the label s5=1, and removeLabeled refuses a label
// outside s5.
//
// Nothing here is shell-parsed: docker is spawned with an argv array.

import { spawn, spawnSync } from 'node:child_process';

// The `s5-` prefix keeps a name from being read as a hex ID prefix of someone else's container.
const NAME_RE = /^s5-[a-zA-Z0-9_.-]+$/;
const LABEL_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
// `s5`, `s5.<anything>`, either optionally followed by =<value>. Not `s50`, not `s5x`.
const LABEL_SCOPE_RE = /^s5([.=]|$)/;
const RESERVED_LABEL_KEYS = new Set(['s5', 's5.run']);
// The only variables a docker process inherits from this one (exported: run.mjs's batch preflight runs docker too, with the same list).
export const DOCKER_PASSTHROUGH = Object.freeze(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY']);
const KILL_GRACE_MS = 30_000;
const HELPER_TIMEOUT_MS = 60_000;

// docker's own environment: the whitelist and nothing else (no ANTHROPIC_*, no CLAUDE_*).
function baseEnv() {
  const env = {};
  for (const k of DOCKER_PASSTHROUGH) if (process.env[k] !== undefined) env[k] = process.env[k];
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

  // --pull=never: the timeout window must not include a pull, and a missing image must fail
  // fast (exit 125, no container) instead of fetching one. Images are built locally.
  const argv = ['run', '--pull=never', '--name', name, '--label', 's5=1', '--label', `s5.run=${name}`];
  for (const [k, v] of Object.entries(labels)) {
    // The key may not contain `=` (it would split into another key) and may not be one of
    // ours: a later --label overrides an earlier one, which would undo s5=1.
    if (!LABEL_KEY_RE.test(k) || RESERVED_LABEL_KEYS.has(k)) throw new TypeError(`dockerRun: label key ${JSON.stringify(k)} is invalid or reserved`);
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
    // Every message below names the KEY only: an env value is a secret, and no error, log or
    // row may carry it.
    if (!ENV_KEY_RE.test(k)) throw new TypeError(`dockerRun: env key must match ${ENV_KEY_RE}, got ${JSON.stringify(k)}`);
    // An undefined value would make `-e NAME` forward nothing, and the secret would vanish.
    if (typeof v !== 'string') throw new TypeError(`dockerRun: env ${k} must be a string`);
    // spawn() refuses a NUL byte, and its error message quotes the whole value.
    if (v.includes('\0')) throw new TypeError(`dockerRun: env ${k} must not contain a NUL byte`);
    argv.push('-e', k);
    runEnv[k] = v;
  }
  argv.push(image, ...cmd);
  return { argv, name, timeoutMs, runEnv };
}

// `docker <args>` with the base environment only (the secrets stay with `docker run`), and a
// timeout of its own: a helper that does not answer within timeoutMs is SIGKILLed and counts
// as failed (status null, timedOut true). Never rejects: a docker that cannot start comes
// back as `error`.
function dockerCmd(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timer;
    const out = [];
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...r, timedOut });
    };
    let child;
    try {
      child = spawn(bin, args, { env: baseEnv(), stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (error) {
      finish({ status: null, stdout: '', error });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (c) => out.push(c));
    child.once('error', (error) => finish({ status: null, stdout: '', error }));
    child.once('close', (status) => finish({ status, stdout: Buffer.concat(out).toString('utf8'), error: null }));
  });
}

// Our container, found by its label and nothing else. { ok, ids }: ok is false when docker did
// not answer (failed, hung, could not start), which is not the same as "no container".
async function findOurs(bin, name, timeoutMs) {
  const r = await dockerCmd(bin, ['ps', '-aq', '--no-trunc', '--filter', `label=s5.run=${name}`], timeoutMs);
  if (r.status !== 0) return { ok: false, ids: [] };
  return { ok: true, ids: r.stdout.split(/\s+/).filter(Boolean) };
}

// dockerRun(options, { dockerBin, killGraceMs, helperTimeoutMs })
//   -> { status, stdout, stderr, timedOut, created, oomKilled, inspectOk, rmOk, wallMs }
// (killGraceMs and helperTimeoutMs are seams for tests, so they need not wait 30 s and 60 s.)
//
// Runs `docker run --pull=never` in the foreground (no --rm, -d, -i or -t, stdin /dev/null) and
// waits for it.
//   status      the container's exit status, or null when the docker process ended on a signal.
//               125 is docker's own failure (no image, name taken, bad flag): see `created`.
//   timedOut    the run hit timeoutMs. Our container is looked up by label and `docker kill`ed
//               by ID (nothing is killed when it is not found). If the docker process is still
//               alive killGraceMs (30 s) after the timeout it is SIGKILLed, so a wedged client
//               cannot hold the harness.
//   created     after the run, a container carrying our label s5.run=<name> existed. False when
//               docker refused to create one (125), and also when the lookup itself failed.
//   oomKilled   true | false from `docker container inspect` (.State.OOMKilled), read after every
//               run that created a container, whatever the exit; null when no container was
//               created or the inspect failed. null is "unknown", never "no".
//   inspectOk   the inspect ran and exited 0
//   rmOk        nothing of ours is left behind: either no container needed removing, or
//               `docker rm -f` exited 0. False when the lookup, or the rm, failed.
//   wallMs      start of the run to its end, the lookup and kill included; the inspect and rm
//               are not counted
// Every helper (ps, kill, inspect, rm) has its own helperTimeoutMs, 60 s by default.
// Rejects (TypeError) on bad options before anything runs, and (Error) when docker cannot start.
export async function dockerRun(options, { dockerBin = 'docker', killGraceMs = KILL_GRACE_MS, helperTimeoutMs = HELPER_TIMEOUT_MS } = {}) {
  const { argv, name, timeoutMs, runEnv } = plan(options);
  const started = performance.now();
  // detached: the client gets a process group of its own (R131). A terminal's Ctrl+C goes to the whole foreground group; the harness
  // takes it as "stop starting runs, let the ones in flight finish" (R119), and an agent container that received the same signal through
  // `docker run`'s default --sig-proxy would be cut off mid-run. --sig-proxy=false is not the cure: a container would keep running when
  // its client died. A second signal ends the harness only; the clients and containers left are swept by the next batch (R122).
  const child = spawn(dockerBin, argv, { env: runEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
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
    graceTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    killed = (async () => {
      const found = await findOurs(dockerBin, name, helperTimeoutMs);
      if (found.ids.length > 0) await dockerCmd(dockerBin, ['kill', ...found.ids], helperTimeoutMs);
    })();
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
  const found = await findOurs(dockerBin, name, helperTimeoutMs);
  const created = found.ids.length > 0;
  let oomKilled = null;
  let inspectOk = false;
  let rmOk = found.ok;
  if (created) {
    const inspect = await dockerCmd(dockerBin, ['container', 'inspect', '--format', '{{.State.OOMKilled}}', ...found.ids], helperTimeoutMs);
    inspectOk = inspect.status === 0;
    if (inspectOk) oomKilled = inspect.stdout.split('\n').some((line) => line.trim() === 'true');
    const rm = await dockerCmd(dockerBin, ['rm', '-f', ...found.ids], helperTimeoutMs);
    rmOk = rm.status === 0;
  }
  return {
    status,
    stdout: Buffer.concat(out).toString('utf8'),
    stderr: Buffer.concat(err).toString('utf8'),
    timedOut,
    created,
    oomKilled,
    inspectOk,
    rmOk,
    wallMs,
  };
}

function runSync(bin, args, timeoutMs) {
  const r = spawnSync(bin, args, { env: baseEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${bin} ${args[0]} timed out after ${timeoutMs} ms`);
  if (r.error) throw new Error(`${bin} ${args[0]} could not run: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${bin} ${args[0]} failed (${r.status === null ? `signal ${r.signal}` : `exit ${r.status}`}): ${r.stderr.trim()}`);
  return r.stdout;
}

// removeLabeled(label = 's5=1', { dockerBin, helperTimeoutMs }) -> the number of containers removed.
// Removes every container (running or not) that carries the label. The label must be an s5
// label: this host runs other people's containers, and nothing here may touch them. Each of the
// two docker calls has its own helperTimeoutMs (60 s) and throws when it is exceeded.
// removeLabeled(labels = 's5=1', { dockerBin, helperTimeoutMs }) -> the number of containers removed.
// Removes every container (running or not) that carries the label, or ALL of the labels when an array is given (each becomes its own
// `--filter label=`, which docker ANDs). Every label must be an s5 label: this host runs other people's containers, and nothing here
// may touch them. Each of the two docker calls has its own helperTimeoutMs (60 s) and throws when it is exceeded.
export function removeLabeled(labels = 's5=1', { dockerBin = 'docker', helperTimeoutMs = HELPER_TIMEOUT_MS } = {}) {
  const list = Array.isArray(labels) ? labels : [labels];
  if (list.length === 0 || !list.every((label) => typeof label === 'string' && LABEL_SCOPE_RE.test(label))) {
    throw new TypeError(`removeLabeled: a label must be s5 or s5.<name>, optionally =<value> (or a non-empty array of them), got ${JSON.stringify(labels)}`);
  }
  const filters = list.flatMap((label) => ['--filter', `label=${label}`]);
  const ids = runSync(dockerBin, ['ps', '-aq', ...filters], helperTimeoutMs).split(/\s+/).filter(Boolean);
  if (ids.length === 0) return 0;
  runSync(dockerBin, ['rm', '-f', ...ids], helperTimeoutMs);
  return ids.length;
}
