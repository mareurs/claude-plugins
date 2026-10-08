#!/usr/bin/env node
// fake-docker.mjs — a scripted stand-in for the `docker` CLI. It never talks to a daemon and
// never starts anything: every behaviour comes from a JSON config file.
//
// It is meant to be run through a tiny wrapper that exports the two control variables
// (dockerRun hands its docker process a whitelisted environment, so a test cannot set them
// any other way):
//
//   FAKE_DOCKER_LOG     file the fake appends to, one JSON line per invocation:
//                         { argv, envNames, envMatches, stdinKind, touched }
//                       argv is everything after the program name. envNames is the SORTED
//                       NAMES of the environment variables, never a value. envMatches maps
//                       each name in config.expectEnv to true or false (does the variable
//                       equal the expected value?), so a test can prove a secret reached
//                       the process without the log ever holding it. stdinKind is 'null'
//                       (/dev/null), 'pipe', 'tty' or 'other'. touched is the list of container
//                       IDs the call's references resolved to (kill, rm, inspect), so a test
//                       can prove a container was, or was never, reached.
//   FAKE_DOCKER_CONFIG  JSON file, all keys optional:
//     { "expectEnv": { "NAME": "value" },
//       "containers": [ { "id": "<64 hex>", "name": "s5-x", "labels": { "s5": "1" }, "oomKilled": false } ],
//       "run":     { "status": 0, "sleepMs": 0, "stdout": "", "stderr": "", "ignoreKill": false,
//                    "gen": { "unit": "...", "repeat": 1, "chunkBytes": 65536, "pauseMs": 0 } },
//       "inspect": { "status": 0, "stdout": null, "sleepMs": 0 },
//       "kill":    { "status": 0, "sleepMs": 0 },
//       "rm":      { "status": 0, "stderr": "", "sleepMs": 0 },
//       "ps":      { "status": 0, "stderr": "", "sleepMs": 0, "answers": [["<id>"], []] } }
//
//   The key under the top level is the first argv word (`docker container inspect` is
//   `inspect`). `status` is the exit status (default 0); `stdout` and `stderr` are printed.
//
//   The fake models the part of a docker daemon that matters for ownership. `containers` is
//   the world: foreign ones and ours. `ps -aq [--no-trunc] --filter label=K[=V]...` lists the
//   IDs (12 characters unless --no-trunc) of the containers whose labels match every filter.
//   `kill`, `rm -f` and `container inspect` resolve each reference the way docker does: a full
//   ID, else a container NAME, else a unique ID PREFIX. A reference that resolves to nothing
//   makes the call exit 1 ("No such container"). `inspect` prints "<oomKilled>\n" per resolved
//   container, unless `stdout` is given. The `run` fake is the container named by its --name,
//   when `containers` has one: it leaves early with 137 (what docker reports for a SIGKILLed
//   container) once that container has been killed, unless `ignoreKill` is set, and otherwise
//   sleeps `sleepMs` and exits `status`. `gen` makes `run` print `unit` repeated `repeat` times
//   as UTF-8 bytes, in writes of `chunkBytes` bytes with `pauseMs` between them, so a chunk
//   boundary can fall inside a multibyte character. `kill` takes effect at once, then sleeps
//   `sleepMs` and creates `<FAKE_DOCKER_LOG>.finished.kill` as its last act, so a test can tell
//   whether the caller waited for it. `run.tailAfterExit` { text, delayMs } leaves a detached
//   grandchild holding the stdout pipe, which writes `text` after `delayMs`, so that `run` has
//   EXITED while its stdout is still open. `run.results` { "<file>": "<text>" } writes each file into the host
//   directory bound at /results (the `--mount ...,target=/results` argument), and `run.resultLinks`
//   { "<file>": "<target>" } makes a symlink there, so a test can script what a container's driver left
//   behind without starting one. `run.calls` is a list of per-call overrides: the i-th `run` call (the last entry
//   repeats) takes that entry's keys (status, stdout, stderr, sleepMs, results, ...) over `run`'s own, so a test can make
//   one container of two fail. `ps.answers` is a list of ID lists: the i-th `ps` call
//   prints answers[i] (the last answer repeats) whatever its filters say, so a test can make a
//   container appear, or vanish, between two lookups. A first word with no known behaviour exits 99.

import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, fstatSync, readFileSync, statSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';

const LOG = process.env.FAKE_DOCKER_LOG;
const CONFIG = process.env.FAKE_DOCKER_CONFIG;
if (!LOG || !CONFIG) {
  process.stderr.write('fake-docker: FAKE_DOCKER_LOG and FAKE_DOCKER_CONFIG are required\n');
  process.exit(98);
}

const argv = process.argv.slice(2);
const isContainerGroup = argv[0] === 'container';
const op = isContainerGroup ? argv[1] : argv[0];
const rest = argv.slice(isContainerGroup ? 2 : 1);
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const baseSpec = config[op] ?? {};
const containers = config.containers ?? [];
const killMarker = (id) => `${LOG}.killed.${id}`;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms);

function writeAll(fd, buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  for (let off = 0; off < b.length; ) off += writeSync(fd, b, off);
}

function stdinKind() {
  const st = fstatSync(0);
  if (st.isFIFO()) return 'pipe';
  if (st.isCharacterDevice()) return st.rdev === statSync('/dev/null').rdev ? 'null' : 'tty';
  return 'other';
}

// docker's lookup order: full ID, then name, then a unique ID prefix.
function resolveRef(ref) {
  if (ref === '') return undefined;
  const bare = ref.replace(/^\//, '');
  const prefixed = containers.filter((c) => c.id.startsWith(ref));
  return (containers.find((c) => c.id === ref) ?? containers.find((c) => c.name === bare) ?? (prefixed.length === 1 ? prefixed[0] : undefined))?.id;
}

function refsOf() {
  if (op === 'kill' || op === 'rm') return rest.filter((a) => !a.startsWith('-'));
  if (op === 'inspect') {
    const f = rest.indexOf('--format');
    return rest.filter((a, i) => !a.startsWith('-') && i !== f + 1);
  }
  return [];
}

function psIds() {
  const full = rest.includes('--no-trunc');
  const shown = (ids) => ids.map((id) => (full ? id : id.slice(0, 12)));
  // A scripted answer: the i-th `ps` call gets answers[i] (the last one repeats), whatever the
  // filters say. This is how a test makes a container APPEAR between two lookups.
  if (spec.answers) return shown(spec.answers[Math.min(psIndex, spec.answers.length - 1)]);
  const filters = rest.flatMap((a, i) => (a === '--filter' ? [rest[i + 1]] : []));
  const matches = (c, f) => {
    const [kind, key, ...value] = f.split('=');
    if (kind !== 'label') return false; // only label filters are modelled
    const labels = c.labels ?? {};
    return Object.hasOwn(labels, key) && (value.length === 0 || labels[key] === value.join('='));
  };
  return shown(containers.filter((c) => filters.every((f) => matches(c, f))).map((c) => c.id));
}

// How many `ps` calls came before this one, read from the log BEFORE this call is appended.
function priorPsCalls() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).filter((l) => JSON.parse(l).argv[0] === 'ps').length;
}
// The same for `run` calls: how many came before this one.
function priorRunCalls() {
  if (!existsSync(LOG)) return 0;
  return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).filter((l) => JSON.parse(l).argv[0] === 'run').length;
}

const refs = refsOf();
const psIndex = op === 'ps' ? priorPsCalls() : 0;
// `run.calls` scripts the i-th `run` call: its keys are laid over `run` (the last entry repeats).
const spec = op === 'run' && baseSpec.calls ? { ...baseSpec, ...baseSpec.calls[Math.min(priorRunCalls(), baseSpec.calls.length - 1)] } : baseSpec;
const touched = refs.map(resolveRef).filter(Boolean);
const missing = refs.filter((r) => !resolveRef(r));
const envMatches = Object.fromEntries(Object.entries(config.expectEnv ?? {}).map(([k, v]) => [k, process.env[k] === v]));
appendFileSync(LOG, `${JSON.stringify({ argv, envNames: Object.keys(process.env).sort(), envMatches, stdinKind: stdinKind(), touched })}\n`);

if (!['run', 'inspect', 'kill', 'rm', 'ps'].includes(op)) {
  process.stderr.write(`fake-docker: no behaviour for '${argv[0]}'\n`);
  process.exit(99);
}

let stdout = spec.stdout ?? '';
if (op === 'ps') stdout = psIds().map((id) => `${id}\n`).join('');
if (op === 'inspect' && spec.stdout == null) stdout = touched.map((id) => `${containers.find((c) => c.id === id).oomKilled === true}\n`).join('');
if (stdout) writeAll(1, stdout);
if (spec.stderr) writeAll(2, spec.stderr);
for (const ref of missing) writeAll(2, `Error response from daemon: No such container: ${ref}\n`);

if (op === 'kill') {
  for (const id of touched) writeFileSync(killMarker(id), '');
  sleep(spec.sleepMs ?? 0);
  writeFileSync(`${LOG}.finished.kill`, '');
}

if (op === 'ps' || op === 'inspect' || op === 'rm') sleep(spec.sleepMs ?? 0);

if (op === 'run') {
  if (spec.results || spec.resultLinks) {
    const mount = argv.find((a) => a.startsWith('type=bind,') && a.split(',').includes('target=/results'));
    const source = mount?.split(',').find((f) => f.startsWith('source='))?.slice('source='.length);
    if (!source) {
      process.stderr.write('fake-docker: run.results needs a --mount with target=/results\n');
      process.exit(97);
    }
    for (const [name, content] of Object.entries(spec.results ?? {})) writeFileSync(`${source}/${name}`, content);
    for (const [name, target] of Object.entries(spec.resultLinks ?? {})) symlinkSync(target, `${source}/${name}`);
  }
  if (spec.gen) {
    const bytes = Buffer.from(spec.gen.unit.repeat(spec.gen.repeat), 'utf8');
    for (let off = 0; off < bytes.length; off += spec.gen.chunkBytes) {
      writeAll(1, bytes.subarray(off, off + spec.gen.chunkBytes));
      sleep(spec.gen.pauseMs ?? 0);
    }
  }
  if (spec.tailAfterExit) {
    const { text, delayMs } = spec.tailAfterExit;
    const script = 'setTimeout(() => process.stdout.write(process.argv[1]), Number(process.argv[2]))';
    spawn(process.execPath, ['-e', script, text, String(delayMs)], { stdio: ['ignore', 1, 'ignore'], detached: true }).unref();
  }
  const mine = containers.find((c) => c.name === argv[argv.indexOf('--name') + 1])?.id;
  const deadline = Date.now() + (spec.sleepMs ?? 0);
  while (Date.now() < deadline) {
    if (!spec.ignoreKill && mine && existsSync(killMarker(mine))) process.exit(137);
    sleep(10);
  }
}

process.exit(missing.length > 0 ? 1 : (spec.status ?? 0));
