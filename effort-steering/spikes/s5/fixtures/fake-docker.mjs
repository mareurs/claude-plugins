#!/usr/bin/env node
// fake-docker.mjs — a scripted stand-in for the `docker` CLI. It never talks to a daemon and
// never starts anything: every behaviour comes from a JSON config file.
//
// It is meant to be run through a tiny wrapper that exports the two control variables
// (dockerRun hands its docker process a whitelisted environment, so a test cannot set them
// any other way):
//
//   FAKE_DOCKER_LOG     file the fake appends to, one JSON line per invocation:
//                         { argv, envNames, envMatches, stdinKind }
//                       argv is everything after the program name. envNames is the SORTED
//                       NAMES of the environment variables, never a value. envMatches maps
//                       each name in config.expectEnv to true or false (does the variable
//                       equal the expected value?), so a test can prove a secret reached
//                       the process without the log ever holding it. stdinKind is 'null'
//                       (/dev/null), 'pipe', 'tty' or 'other'.
//   FAKE_DOCKER_CONFIG  JSON file, all keys optional:
//     { "expectEnv": { "NAME": "value" },
//       "run":     { "status": 0, "sleepMs": 0, "stdout": "", "stderr": "", "ignoreKill": false },
//       "inspect": { "status": 0, "oomKilled": false, "stdout": null },
//       "kill":    { "status": 0, "sleepMs": 0 },   "rm": { "status": 0 },   "ps": { "stdout": "id1\nid2\n" } }
//     The key is the first argv word. `status` is the exit status (default 0). `stdout` and
//     `stderr` are printed at once. `run` then sleeps `sleepMs`, and leaves early with 137
//     (what docker reports for a SIGKILLed container) once `docker kill <its --name>` has
//     run, unless `ignoreKill` is set. `kill` takes effect at once, then sleeps `sleepMs` and
//     creates `<FAKE_DOCKER_LOG>.finished.kill` as its last act, so a test can tell whether the
//     caller waited for it. `inspect` prints "<oomKilled>\n" unless `stdout` is given. A first
//     word with no known behaviour exits 99.

import { appendFileSync, existsSync, fstatSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';

const LOG = process.env.FAKE_DOCKER_LOG;
const CONFIG = process.env.FAKE_DOCKER_CONFIG;
if (!LOG || !CONFIG) {
  process.stderr.write('fake-docker: FAKE_DOCKER_LOG and FAKE_DOCKER_CONFIG are required\n');
  process.exit(98);
}

const argv = process.argv.slice(2);
const sub = argv[0];
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
const spec = config[sub] ?? {};
const killMarker = (name) => `${LOG}.killed.${name}`;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms);

function stdinKind() {
  const st = fstatSync(0);
  if (st.isFIFO()) return 'pipe';
  if (st.isCharacterDevice()) return st.rdev === statSync('/dev/null').rdev ? 'null' : 'tty';
  return 'other';
}

const envMatches = Object.fromEntries(Object.entries(config.expectEnv ?? {}).map(([k, v]) => [k, process.env[k] === v]));
appendFileSync(LOG, `${JSON.stringify({ argv, envNames: Object.keys(process.env).sort(), envMatches, stdinKind: stdinKind() })}\n`);

if (!['run', 'inspect', 'kill', 'rm', 'ps'].includes(sub)) {
  process.stderr.write(`fake-docker: no behaviour for '${sub}'\n`);
  process.exit(99);
}

const stdout = sub === 'inspect' && spec.stdout == null ? `${spec.oomKilled === true}\n` : (spec.stdout ?? '');
if (stdout) writeSync(1, stdout);
if (spec.stderr) writeSync(2, spec.stderr);

if (sub === 'kill') {
  writeFileSync(killMarker(argv[1]), '');
  sleep(spec.sleepMs ?? 0);
  writeFileSync(`${LOG}.finished.kill`, '');
}

if (sub === 'run') {
  const name = argv[argv.indexOf('--name') + 1];
  const deadline = Date.now() + (spec.sleepMs ?? 0);
  while (Date.now() < deadline) {
    if (!spec.ignoreKill && existsSync(killMarker(name))) process.exit(137);
    sleep(10);
  }
}

process.exit(spec.status ?? 0);
