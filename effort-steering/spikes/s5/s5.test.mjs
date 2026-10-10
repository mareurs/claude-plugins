// s5.test.mjs — the S5 CLI (s5.mjs), unit mode: no Docker, no model, no network.
//
// Every module the CLI calls is injected through io.modules. The harness below replaces ALL of them with a function that throws, then puts
// the test's own fakes over the ones it expects to be called, so a test that reaches a real module (and with it Docker, git or a model)
// fails instead of running it. The only real processes started here are `node s5.mjs` itself (--help, an unknown subcommand), a fake
// images/build.sh in a temp directory, and git in a throwaway repository (for the committed registration the real loader demands). The
// token in these tests is a sentinel: it is checked to be in neither stdout, stderr, the options handed to runBatch nor any file under the
// temp root other than the token files these tests wrote.
//
// The temp root is under os.tmpdir() and holds tiny fixtures only; it is removed when the process exits, a failed test included.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  basename, join, resolve,
} from 'node:path';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { t } from '../../core/testkit.mjs';
import { ta } from './fixtures/testkit-async.mjs';
import { selectCalibrated, simulate as realSimulate } from './analyze.mjs';
import { DEFAULT_WORK_ROOT } from './proxy.mjs';
import { loadS5Config, loadS5Prereg } from './prereg.mjs';
import { TOKEN_ENV as RUN_TOKEN_ENV } from './run.mjs';
import { main } from './s5.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const S5 = join(HERE, 's5.mjs');
const ROOT = mkdtempSync(join(tmpdir(), 's5-cli-'));
process.on('exit', () => rmSync(ROOT, { recursive: true, force: true }));

const SUBCOMMANDS = ['mine', 'build', 'warm', 'gate', 'images', 'proxy', 'run', 'grade', 'select', 'analyze', 'simulate'];
const MODULE_NAMES = [
  'mineCommits', 'buildTask', 'warmTask', 'gateTask', 'proxyUp', 'proxyDown', 'proxyLog', 'loadS5Prereg', 'loadS5Config', 'runBatch', 'gradeTree',
  'analyzeS5', 'selectCalibrated', 'simulate',
];
const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
const SENTINEL = 'sk-ant-oat01-SENTINEL-d41d8cd98f00b204e9800998ecf8427e';
// The files in which these tests put the sentinel on purpose.
const TOKEN_FILE_NAMES = ['token', 'real-token', 'my-token'];

let dirNo = 0;
const freshDir = (name = 'd') => {
  const d = join(ROOT, `${name}${dirNo++}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// ---- the harness ----

const DENY = Object.fromEntries(MODULE_NAMES.map((name) => [name, () => {
  throw new Error(`the real module ${name} was called`);
}]));

// Runs the CLI in process. `modules` are the fakes; `env` is the environment object the CLI sees (the real one is process.env).
async function cli(argv, { modules = {}, env = {}, cwd = ROOT, home = join(ROOT, 'nohome'), ...rest } = {}) {
  const out = [];
  const err = [];
  const io = {
    stdout: { write: (s) => { out.push(String(s)); return true; } },
    stderr: { write: (s) => { err.push(String(s)); return true; } },
    env,
    cwd,
    home,
    modules: { ...DENY, ...modules },
    ...rest,
  };
  const code = await main(argv, io);
  return { code, stdout: out.join(''), stderr: err.join(''), io };
}

const SUMMARY = {
  mode: 'pilot', planned: 3, skippedFinal: 0, ran: 3, attempts: 3, infraAttempts: 0, exhausted: 0, retriedExhausted: 0, costUsd: 1.5, stopped: null, rowsFile: '/x', smoke: null, scrubbed: { dirs: 0, files: 0 }, tornLine: false,
};
const PREREG_STUB = { model: 'claude-sonnet-5-5', tasks: [{ id: 't1' }], proxyAllowlist: ['api.anthropic.com', 'statsig.anthropic.com'] };

// Fakes that record every call. `env` is the environment object given to cli(), so runBatch can report what it saw there.
function fakes(env, { summary = SUMMARY, runBatch } = {}) {
  const calls = [];
  const modules = {
    loadS5Prereg: (file) => {
      calls.push(['loadS5Prereg', file]);
      return { ...PREREG_STUB, registered: true };
    },
    loadS5Config: (file, options) => {
      calls.push(['loadS5Config', file, options]);
      return { ...PREREG_STUB, registered: false };
    },
    runBatch: async (prereg, options) => {
      calls.push(['runBatch', prereg, options, env[TOKEN_ENV]]);
      if (runBatch) return runBatch(prereg, options);
      return summary;
    },
  };
  return { calls, modules, of: (name) => calls.filter((c) => c[0] === name) };
}

const noStdout = (r) => assert.equal(r.stdout, '', `stdout must be empty, got ${r.stdout}`);
const asJson = (r) => JSON.parse(r.stdout);
const canonical = (obj) => `${JSON.stringify(obj, null, 2)}\n`;

// ---- the real process: --help, an unknown subcommand, the entry-point idiom ----

t('--help lists every subcommand (real process: also proves that importing s5.mjs does not run main)', () => {
  const r = spawnSync(process.execPath, [S5, '--help'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  for (const name of SUBCOMMANDS) assert.match(r.stdout, new RegExp(`^\\s*${name}\\b`, 'm'), `${name} missing from --help`);
  assert.equal(r.stderr, '');
});

t('an unknown subcommand exits 64 with an empty stdout (real process)', () => {
  const r = spawnSync(process.execPath, [S5, 'frobnicate'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 64);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /usage/i);
});

t('the entry point also runs when the file is started through a symlink', () => {
  const link = join(freshDir(), 'link.mjs');
  symlinkSync(S5, link);
  const r = spawnSync(process.execPath, [link, 'help'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /simulate/);
});

// ---- usage ----

await ta('help, --help and -h return 0 and list every subcommand; a subcommand followed by --help as well', async () => {
  for (const argv of [['--help'], ['help'], ['-h'], ['run', '--help']]) {
    const r = await cli(argv);
    assert.equal(r.code, 0, argv.join(' '));
    assert.equal(r.stderr, '');
    const lines = r.stdout.split('\n');
    for (const name of SUBCOMMANDS) assert.equal(lines.some((l) => new RegExp(`^\\s+${name}\\b`).test(l)), true, `${argv.join(' ')}: ${name}`);
  }
});

await ta('an unknown subcommand and no subcommand at all return 64, print usage on stderr and nothing on stdout', async () => {
  for (const argv of [['frobnicate'], [], ['--prereg', 'x']]) {
    const r = await cli(argv);
    assert.equal(r.code, 64, JSON.stringify(argv));
    noStdout(r);
    assert.match(r.stderr, /usage/i);
  }
});

await ta('run without --prereg exits 64', async () => {
  const r = await cli(['run', '--mode', 'pilot']);
  assert.equal(r.code, 64);
  noStdout(r);
  assert.match(r.stderr, /--prereg/);
});

// Each of these is a usage error: 64, an empty stdout, and no module reached (every module is a throwing fake, which would be exit 1).
const USAGE_ERRORS = [
  ['mine'],
  ['mine', '--repo', 'no-equals-sign'],
  ['mine', '--repo', '=dir'],
  ['mine', '--repo', 'a=x', '--repo', 'a=y'],
  ['mine', '--repo', 'a=x', '--since'],
  ['build'],
  ['build', 'a', 'b'],
  ['warm'],
  ['warm', '../escape'],
  ['gate'],
  ['gate', 'Upper'],
  ['grade'],
  ['grade', 'not-a-run-id'],
  ['grade', 'task.Z.x'],
  ['images', 'extra'],
  ['proxy'],
  ['proxy', 'sideways'],
  ['proxy', 'up'],
  ['proxy', 'up', '--log-all', '--prereg', 'f.json'],
  ['proxy', 'up', '--log-all', '--mode', 'pilot'],
  ['proxy', 'up', '--prereg', 'f.json', '--mode', 'bogus'],
  ['proxy', 'down', 'extra'],
  ['proxy', 'log', '--prereg', 'f.json'],
  ['run'],
  ['run', '--mode', 'measure'],
  ['run', '--prereg', 'f.json'],
  ['run', '--mode', 'bogus', '--prereg', 'f.json'],
  ['run', '--mode'],
  ['run', '--mode', 'pilot', '--prereg'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--concurrency', '0'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--concurrency', '1.5'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--stop-at-cost', '0'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--stop-at-cost', 'lots'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--tasks', 'a,,b'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--keep-run-dirs=yes'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--prereg', 'g.json'],
  ['run', '--mode', 'measure', '--prereg', 'f.json', '--open-network'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', 'stray'],
  ['run', '--mode', 'pilot', '--prereg', 'f.json', '--bogus'],
  ['select'],
  ['select', '--rows', 'r.jsonl', '--bogus', 'x'],
  ['select', '--rows', 'r.jsonl', '--work-root', 'w'],
  ['analyze'],
  ['analyze', '--prereg', 'p.json'],
  ['analyze', '--rows', 'r.jsonl'],
  ['simulate', '--method', 'bogus'],
  ['simulate', '--trials', 'abc'],
  ['simulate', '--seed'],
];
await ta(`${USAGE_ERRORS.length} malformed command lines are usage errors: 64, usage on stderr, nothing on stdout, no module reached`, async () => {
  for (const argv of USAGE_ERRORS) {
    const r = await cli(argv, { env: { [TOKEN_ENV]: SENTINEL } });
    assert.equal(r.code, 64, `${argv.join(' ')} -> ${r.code}: ${r.stderr}`);
    noStdout(r);
    assert.match(r.stderr, /usage/i, argv.join(' '));
    assert.equal(r.stderr.includes(SENTINEL), false);
  }
});

await ta('an io.modules key that names no module is refused loudly (a typo must not fall back to the real module)', async () => {
  await assert.rejects(() => cli(['help'], { modules: { runbatch: () => {} } }), /runbatch/);
});

// ---- run: which loader, which options ----

const REG = ['run', '--mode', 'measure', '--prereg', 'reg.json'];

await ta('run --mode measure loads the file with loadS5Prereg and hands the registered object to runBatch; the config loader is not called', async () => {
  const work = freshDir('w');
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli([...REG, '--work-root', work], { env, modules: f.modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(f.of('loadS5Prereg'), [['loadS5Prereg', resolve(ROOT, 'reg.json')]]);
  assert.equal(f.of('loadS5Config').length, 0);
  const [, prereg, options] = f.of('runBatch')[0];
  assert.equal(prereg.registered, true);
  assert.equal(options.mode, 'measure');
});

for (const mode of ['smoke', 'pilot', 'calibrate']) {
  await ta(`run --mode ${mode} loads the file with loadS5Config(file, { mode }) and reaches runBatch with registered: false; loadS5Prereg is not called`, async () => {
    const env = { [TOKEN_ENV]: SENTINEL };
    const f = fakes(env);
    const r = await cli(['run', '--mode', mode, '--prereg', 'cfg.json', '--work-root', freshDir('w')], { env, modules: f.modules });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(f.of('loadS5Config'), [['loadS5Config', resolve(ROOT, 'cfg.json'), { mode }]]);
    assert.equal(f.of('loadS5Prereg').length, 0);
    const [, prereg, options] = f.of('runBatch')[0];
    assert.equal(prereg.registered, false);
    assert.equal(options.mode, mode);
  });
}

await ta('the rows file defaults to <workRoot>/rows-<mode>.jsonl, one per mode, and --rows overrides it', async () => {
  const work = freshDir('w');
  for (const mode of ['measure', 'smoke', 'pilot', 'calibrate']) {
    const env = { [TOKEN_ENV]: SENTINEL };
    const f = fakes(env);
    await cli(['run', '--mode', mode, '--prereg', 'p.json', '--work-root', work], { env, modules: f.modules });
    assert.equal(f.of('runBatch')[0][2].rowsFile, join(work, `rows-${mode}.jsonl`), mode);
  }
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  await cli(['run', '--mode', 'pilot', '--prereg', 'p.json', '--work-root', work, '--rows', 'mine.jsonl'], { env, modules: f.modules });
  assert.equal(f.of('runBatch')[0][2].rowsFile, resolve(ROOT, 'mine.jsonl'));
});

await ta('run options: defaults are the booleans false, no taskIds, no concurrency and no cost limit (runBatch takes them from the prereg)', async () => {
  const work = freshDir('w');
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', work], { env, modules: f.modules });
  assert.deepEqual(f.of('runBatch')[0][2], {
    mode: 'calibrate', workRoot: work, rowsFile: join(work, 'rows-calibrate.jsonl'), retryExhausted: false, ctx: { keepRunDirs: false },
  });
});

await ta('run options: --tasks, --concurrency, --stop-at-cost, --retry-exhausted and --keep-run-dirs reach runBatch unchanged (--flag=value too)', async () => {
  const work = freshDir('w');
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli(
    ['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', work, '--tasks', 'alpha,beta-2', '--concurrency=3', '--stop-at-cost', '12.5', '--retry-exhausted', '--keep-run-dirs'],
    { env, modules: f.modules },
  );
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(f.of('runBatch')[0][2], {
    mode: 'calibrate',
    workRoot: work,
    rowsFile: join(work, 'rows-calibrate.jsonl'),
    taskIds: ['alpha', 'beta-2'],
    concurrency: 3,
    stopAtCostUsd: 12.5,
    retryExhausted: true,
    ctx: { keepRunDirs: true },
  });
});

await ta('--open-network (the pilot proxy control) puts the run on the bridge network with no proxy, and only in pilot mode', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli(['run', '--mode', 'pilot', '--prereg', 'p.json', '--work-root', freshDir('w'), '--tasks', 't1', '--open-network'], { env, modules: f.modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(f.of('runBatch')[0][2].ctx, { keepRunDirs: false, network: 'bridge', proxyUrl: null });
  // measure with --open-network is in USAGE_ERRORS; the others are refused too.
  for (const mode of ['smoke', 'calibrate']) {
    const g = fakes(env);
    const bad = await cli(['run', '--mode', mode, '--prereg', 'p.json', '--open-network'], { env, modules: g.modules });
    assert.equal(bad.code, 64, mode);
    assert.equal(g.calls.length, 0);
  }
});

await ta('--work-root defaults to DEFAULT_WORK_ROOT and a relative one is resolved against the cwd', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  await cli(['run', '--mode', 'pilot', '--prereg', 'p.json'], { env, modules: f.modules });
  const opts = f.of('runBatch')[0][2];
  assert.equal(opts.workRoot, DEFAULT_WORK_ROOT);
  assert.equal(opts.rowsFile, join(DEFAULT_WORK_ROOT, 'rows-pilot.jsonl'));
  const g = fakes(env);
  await cli(['run', '--mode', 'pilot', '--prereg', 'p.json', '--work-root', 'rel/w'], { env, modules: g.modules, cwd: ROOT });
  assert.equal(g.of('runBatch')[0][2].workRoot, join(ROOT, 'rel', 'w'));
});

// ---- run: exit codes, the printed Summary ----

await ta('run prints the Summary as JSON on stdout and returns 0, also when the batch stopped by a rule', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const stopped = { ...SUMMARY, stopped: { reason: 'cost', costUsd: 101, limit: 100 }, ran: 1 };
  const f = fakes(env, { summary: stopped });
  const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env, modules: f.modules });
  assert.equal(r.code, 0);
  assert.deepEqual(asJson(r), stopped);
  for (const reason of ['infra_streak', 'signal', 'hidden_changed']) {
    const g = fakes(env, { summary: { ...SUMMARY, stopped: { reason } } });
    const s = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env, modules: g.modules });
    assert.equal(s.code, 0, reason);
    assert.equal(asJson(s).stopped.reason, reason);
  }
});

await ta('run returns 1 and prints the message on stderr when runBatch throws; stdout stays empty', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env, { runBatch: () => { throw new Error('runBatch: preflight item 3: the image moved'); } });
  const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env, modules: f.modules });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /preflight item 3: the image moved/);
});

await ta('run returns 1 when the loader refuses the file; runBatch is not called and the token is not read', async () => {
  const env = {};
  const f = fakes(env);
  f.modules.loadS5Prereg = () => { throw new Error('prereg: /x/reg.json is not committed'); };
  const r = await cli(REG, { env, modules: f.modules, home: freshDir('home') });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /not committed/);
  assert.equal(f.of('runBatch').length, 0);
  assert.doesNotMatch(r.stderr, /token/i);
});

// ---- run with the real loaders: a config is never a registration ----

const hex = (n) => n.toString(16).padStart(64, '0');
const digest = (n) => `sha256:${hex(n)}`;
const VALID = {
  model: 'claude-sonnet-5-5',
  cli: { version: '2.1.292', sha256: digest(0xc11) },
  arms: {
    A: { effort: 'xhigh', steer: false, runs: 3 },
    B: { effort: 'xhigh', steer: true, runs: 3 },
    C: { effort: 'low', steer: false, runs: 2 },
  },
  tasks: Array.from({ length: 8 }, (_, i) => ({ id: `task-${i + 1}`, treeHash: hex(0x100 + i), hiddenHash: hex(0x200 + i), promptHash: hex(0x300 + i) })),
  margin: 0.15,
  alpha: 0.05,
  bound: { method: 'paired-t', resamples: 0, seed: 7 },
  orderSeed: 11,
  mechanism: { alpha: 0.05, permutations: 1000, seed: 13, effectSizeThinkingTokens: 500 },
  limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 },
  images: { codescout: digest(0x1), 'claude-plugins': digest(0x2), proxy: digest(0x3) },
  proxyAllowlist: ['api.anthropic.com', 'statsig.anthropic.com'],
  stopAtCostUsd: 100,
};
// A throwaway git repository for the committed registration (loadS5Prereg demands the bytes of the HEAD blob).
const GIT_ENV = { ...process.env, HOME: ROOT, GIT_CONFIG_NOSYSTEM: '1' };
for (const k of Object.keys(GIT_ENV)) if (k.startsWith('GIT_') && k !== 'GIT_CONFIG_NOSYSTEM') delete GIT_ENV[k];
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const REPO = join(ROOT, 'repo');
mkdirSync(REPO);
git(REPO, 'init', '-q');
git(REPO, 'commit', '-q', '--allow-empty', '-m', 'init');
const COMMITTED = join(REPO, 's5-prereg.json');
writeFileSync(COMMITTED, canonical(VALID));
git(REPO, 'add', '--', COMMITTED);
git(REPO, 'commit', '-q', '-m', 'register');
// A config for a pilot: one task, an arm with no runs. It is valid for loadS5Config and never for loadS5Prereg. Not committed.
const CONFIG = join(REPO, 'pilot-config.json');
writeFileSync(CONFIG, canonical({ ...VALID, tasks: VALID.tasks.slice(0, 1), arms: { ...VALID.arms, B: { ...VALID.arms.B, runs: 0 } } }));
const REAL_LOADERS = { loadS5Prereg, loadS5Config };

await ta('real loaders: a measure run with a committed registration reaches runBatch with registered: true', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli(['run', '--mode', 'measure', '--prereg', COMMITTED, '--work-root', freshDir('w')], { env, modules: { ...f.modules, ...REAL_LOADERS } });
  assert.equal(r.code, 0, r.stderr);
  const prereg = f.of('runBatch')[0][1];
  assert.equal(prereg.registered, true);
  assert.equal(prereg.tasks.length, 8);
});

await ta('real loaders: a measure run with a config file (one task, an arm with no runs, not committed) is refused with 1 and never reaches runBatch', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli(['run', '--mode', 'measure', '--prereg', CONFIG, '--work-root', freshDir('w')], { env, modules: { ...f.modules, ...REAL_LOADERS } });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /prereg/);
  assert.equal(f.of('runBatch').length, 0);
});

await ta('real loaders: the same config file runs in pilot mode with registered: false', async () => {
  const env = { [TOKEN_ENV]: SENTINEL };
  const f = fakes(env);
  const r = await cli(['run', '--mode', 'pilot', '--prereg', CONFIG, '--work-root', freshDir('w')], { env, modules: { ...f.modules, ...REAL_LOADERS } });
  assert.equal(r.code, 0, r.stderr);
  const prereg = f.of('runBatch')[0][1];
  assert.equal(prereg.registered, false);
  assert.equal(prereg.arms.B.runs, 0);
});

// ---- the token ----

// A home directory with ~/.config/s5/token as `content` and `mode` (content null: no file). Returns { home, file }.
function tokenHome(content, mode) {
  const home = freshDir('home');
  const dir = join(home, '.config', 's5');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'token');
  if (content !== null) {
    writeFileSync(file, content);
    chmodSync(file, mode);
  }
  return { home, file };
}

// Every regular file under ROOT that holds `needle`, except the token files these tests wrote on purpose.
function filesHolding(needle) {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && !TOKEN_FILE_NAMES.includes(basename(p)) && readFileSync(p).includes(needle)) hits.push(p);
    }
  };
  walk(ROOT);
  return hits;
}

async function runWithToken(home, { extra = [], env = {} } = {}) {
  const e = { ...env };
  const f = fakes(e);
  const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w'), ...extra], { env: e, modules: f.modules, home });
  return { ...r, f, env: e };
}

await ta('token: a file with mode 0600 works; the value reaches runBatch through the environment only and is gone again afterwards', async () => {
  const { home } = tokenHome(SENTINEL, 0o600);
  const r = await runWithToken(home);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.f.of('runBatch')[0][3], SENTINEL, 'runBatch saw the token in the environment');
  assert.equal(TOKEN_ENV in r.env, false, 'the CLI removes what it set');
  assert.equal(r.stdout.includes(SENTINEL) || r.stderr.includes(SENTINEL), false);
  const [, prereg, options] = r.f.of('runBatch')[0];
  assert.equal(JSON.stringify({ prereg, options }).includes(SENTINEL), false, 'not in what runBatch received');
  assert.deepEqual(filesHolding(SENTINEL), []);
});

await ta('token: mode 0400 works; ALL trailing whitespace is dropped (1, 2 and 3 newlines, a trailing space, CRLF, two spaces); a file without any is read as it is', async () => {
  const cases = [[`${SENTINEL}\n`, 0o400], [SENTINEL, 0o600], [`${SENTINEL}\n\n`, 0o600], [`${SENTINEL}\n\n\n`, 0o600], [`${SENTINEL} \n`, 0o600], [`${SENTINEL}\r\n`, 0o600], [`${SENTINEL}  `, 0o600]];
  for (const [content, mode] of cases) {
    const { home } = tokenHome(content, mode);
    const r = await runWithToken(home);
    assert.equal(r.code, 0, `${JSON.stringify(content)}: ${r.stderr}`);
    assert.equal(r.f.of('runBatch')[0][3], SENTINEL, JSON.stringify(content));
  }
});

await ta('token: whitespace or a control character INSIDE the value is refused, naming the path and never the value (R143)', async () => {
  for (const content of [`${SENTINEL} x`, `${SENTINEL}\nx`, `${SENTINEL}\tx`, `${SENTINEL}\u0000x`, `${SENTINEL}\u0007`, `x\n${SENTINEL}\n`]) {
    const { home, file } = tokenHome(content, 0o600);
    const r = await runWithToken(home);
    assert.equal(r.code, 1, JSON.stringify(content));
    noStdout(r);
    assert.ok(r.stderr.includes(file), r.stderr);
    assert.match(r.stderr, /whitespace|control/i);
    assert.equal(r.stderr.includes(SENTINEL), false, JSON.stringify(content));
    assert.equal(r.f.of('runBatch').length, 0);
    assert.equal(TOKEN_ENV in r.env, false);
  }
});

await ta('token: --token-file overrides the default path', async () => {
  const { home } = tokenHome('wrong-default-file', 0o600);
  const other = join(freshDir('o'), 'my-token');
  writeFileSync(other, `${SENTINEL}\n`);
  chmodSync(other, 0o600);
  const r = await runWithToken(home, { extra: ['--token-file', other] });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.f.of('runBatch')[0][3], SENTINEL);
});

for (const mode of [0o644, 0o640, 0o604, 0o660, 0o606, 0o666, 0o610, 0o601]) {
  await ta(`token: a file with mode ${mode.toString(8).padStart(4, '0')} (a group or other permission bit) is refused with the path and the mode, never the value`, async () => {
    const { home, file } = tokenHome(SENTINEL, mode);
    const r = await runWithToken(home);
    assert.equal(r.code, 1);
    noStdout(r);
    assert.ok(r.stderr.includes(file), `the message names the path: ${r.stderr}`);
    assert.ok(r.stderr.includes(mode.toString(8).padStart(4, '0')), `the message names the mode: ${r.stderr}`);
    assert.equal(r.stderr.includes(SENTINEL), false);
    assert.equal(r.f.of('runBatch').length, 0);
    assert.equal(TOKEN_ENV in r.env, false);
  });
}

await ta('token: a symlink is refused, even one that points at a 0600 file', async () => {
  const real = join(freshDir('o'), 'real-token');
  writeFileSync(real, SENTINEL);
  chmodSync(real, 0o600);
  const { home, file } = tokenHome(null, 0);
  symlinkSync(real, file);
  const r = await runWithToken(home);
  assert.equal(r.code, 1);
  noStdout(r);
  assert.ok(r.stderr.includes(file));
  assert.match(r.stderr, /symlink/i);
  assert.equal(r.stderr.includes(SENTINEL), false);
  assert.equal(r.f.of('runBatch').length, 0);
});

await ta('token: an empty file and a file holding only a newline are refused', async () => {
  for (const content of ['', '\n']) {
    const { home, file } = tokenHome(content, 0o600);
    const r = await runWithToken(home);
    assert.equal(r.code, 1, JSON.stringify(content));
    noStdout(r);
    assert.ok(r.stderr.includes(file));
    assert.match(r.stderr, /empty/i);
    assert.equal(r.f.of('runBatch').length, 0);
  }
});

await ta('token: a missing file, and a directory in its place, are refused with the path', async () => {
  const { home, file } = tokenHome(null, 0);
  const missing = await runWithToken(home);
  assert.equal(missing.code, 1);
  assert.ok(missing.stderr.includes(file));
  assert.match(missing.stderr, /does not exist/i);
  mkdirSync(file);
  const dir = await runWithToken(home);
  assert.equal(dir.code, 1);
  assert.ok(dir.stderr.includes(file));
  assert.match(dir.stderr, /regular file/i);
  assert.equal(dir.f.of('runBatch').length, 0);
});

await ta('token: a token already in the environment is used without reading the file (a bad file does not matter), and stays there afterwards', async () => {
  const { home } = tokenHome('FILE-VALUE-NOT-USED', 0o644);
  const r = await runWithToken(home, { env: { [TOKEN_ENV]: SENTINEL } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.f.of('runBatch')[0][3], SENTINEL);
  assert.equal(r.env[TOKEN_ENV], SENTINEL);
});

await ta('token: an empty variable in the environment does not count as set', async () => {
  const { home } = tokenHome(SENTINEL, 0o600);
  const r = await runWithToken(home, { env: { [TOKEN_ENV]: '' } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.f.of('runBatch')[0][3], SENTINEL);
});

await ta('token: the variable is removed when runBatch throws, and no output carries the value even when the error message does', async () => {
  const { home } = tokenHome(SENTINEL, 0o600);
  const e = {};
  const f = fakes(e, { runBatch: () => { throw new Error(`docker said: token ${SENTINEL} rejected`); } });
  const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env: e, modules: f.modules, home });
  assert.equal(r.code, 1);
  assert.equal(r.stderr.includes(SENTINEL), false);
  assert.match(r.stderr, /\[REDACTED\]/);
  assert.equal(TOKEN_ENV in e, false);
});

await ta('token: a Summary that would carry the value is printed redacted (also when the file ended in newlines)', async () => {
  for (const content of [SENTINEL, `${SENTINEL}\n\n`]) {
    const { home } = tokenHome(content, 0o600);
    const e = {};
    const f = fakes(e, { summary: { ...SUMMARY, note: `leaked ${SENTINEL} here` } });
    const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env: e, modules: f.modules, home });
    assert.equal(r.code, 0);
    assert.equal(r.stdout.includes(SENTINEL), false, JSON.stringify(content));
    assert.match(r.stdout, /\[REDACTED\]/);
  }
});

await ta('token: an environment token that ends in a newline is redacted without it as well', async () => {
  const e = { [TOKEN_ENV]: `${SENTINEL}\n` };
  const f = fakes(e, { summary: { ...SUMMARY, note: `leaked ${SENTINEL} here` } });
  const r = await cli(['run', '--mode', 'calibrate', '--prereg', 'p.json', '--work-root', freshDir('w')], { env: e, modules: f.modules });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.includes(SENTINEL), false);
});

await ta('token: an environment token gets the same check (R145): trailing whitespace is dropped and runBatch sees the trimmed value; inner whitespace, a control character and whitespace only are refused naming the variable, never the value', async () => {
  const { home } = tokenHome(null, 0);
  for (const content of [`${SENTINEL}\n`, `${SENTINEL}\n\n\n`, `${SENTINEL} `, `${SENTINEL}\r\n`]) {
    const r = await runWithToken(home, { env: { [TOKEN_ENV]: content } });
    assert.equal(r.code, 0, `${JSON.stringify(content)}: ${r.stderr}`);
    assert.equal(r.f.of('runBatch')[0][3], SENTINEL, `runBatch sees the validated value: ${JSON.stringify(content)}`);
    assert.equal(r.env[TOKEN_ENV], content, 'the operator\'s own value is put back');
    assert.equal(r.stdout.includes(SENTINEL), false);
  }
  for (const content of [`${SENTINEL} x`, `${SENTINEL}\nx`, `${SENTINEL}\tx`, `${SENTINEL}\u0000x`, `${SENTINEL}\u0007`, ' \n', '\n\n']) {
    const r = await runWithToken(home, { env: { [TOKEN_ENV]: content } });
    assert.equal(r.code, 1, JSON.stringify(content));
    noStdout(r);
    assert.ok(r.stderr.includes(TOKEN_ENV), r.stderr);
    assert.equal(r.stderr.includes(SENTINEL), false, JSON.stringify(content));
    assert.equal(r.f.of('runBatch').length, 0);
    assert.equal(r.env[TOKEN_ENV], content, 'untouched');
  }
});

await ta('token: a FIFO at the token path is refused as not a regular file, and the open does not block (O_NONBLOCK)', async () => {
  const { home, file } = tokenHome(null, 0);
  execFileSync('mkfifo', [file]);
  const code = `
import { main } from ${JSON.stringify(pathToFileURL(S5).href)};
const out = [];
const err = [];
const reached = () => { throw new Error('a module was reached'); };
const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, env: {}, cwd: ${JSON.stringify(ROOT)}, home: ${JSON.stringify(home)}, modules: { loadS5Config: () => ({ registered: false }), runBatch: reached } };
const c = await main(['run', '--mode', 'pilot', '--prereg', 'p.json'], io);
console.log(JSON.stringify({ c, out: out.join(''), err: err.join('') }));
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH } });
  assert.equal(r.error, undefined, `the CLI blocked on the FIFO: ${r.error}`);
  const result = JSON.parse(r.stdout);
  assert.equal(result.c, 1);
  assert.equal(result.out, '');
  assert.ok(result.err.includes(file));
  assert.match(result.err, /regular file/);
});

await ta('token: no other subcommand reads the token file (a bad one in the default place changes nothing)', async () => {
  const { home } = tokenHome(SENTINEL, 0o666);
  const work = freshDir('w');
  mkdirSync(join(work, 'tasks', 't1'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't1', 'manifest.json'), JSON.stringify({ id: 't1', repo: 'codescout', def: { testRunner: 'cargo' } }));
  const rows = join(freshDir('r'), 'rows.jsonl');
  writeFileSync(rows, '');
  const modules = {
    mineCommits: () => [],
    buildTask: () => ({ id: 't1', def: {} }),
    gateTask: async () => ({ ok: true, reasons: [] }),
    warmTask: async () => ({ skipped: 'not cargo' }),
    proxyDown: async () => ({ removedContainers: 0, network: 'absent' }),
    proxyLog: async () => 'log\n',
    loadS5Prereg: () => PREREG_STUB,
    analyzeS5: () => ({ excluded: [], mechanism: {} }),
    selectCalibrated,
    simulate: () => ({ niRate: 0, gateRate: 0 }),
  };
  const lines = [
    ['mine', '--repo', 'a=x', '--out', join(freshDir('m'), 'c.json')],
    ['build', 'somewhere', '--work-root', work],
    ['gate', 't1', '--work-root', work],
    ['warm', 't1', '--work-root', work],
    ['proxy', 'down'],
    ['proxy', 'log'],
    ['select', '--rows', rows],
    ['analyze', '--prereg', 'p.json', '--rows', rows],
    ['simulate', '--trials', '1'],
  ];
  for (const argv of lines) {
    const r = await cli(argv, { modules, home, env: {} });
    assert.equal(r.code, 0, `${argv.join(' ')}: ${r.stderr}`);
    assert.equal(r.stderr.includes('token'), false, argv.join(' '));
  }
});

// ---- grade ----

function gradeWorld() {
  const work = freshDir('w');
  const manifest = { id: 't1', repo: 'codescout', fix: 'f', parent: 'p', baseCommit: 'b', treeHash: '1', hiddenHash: '2', promptHash: '3', taskMdHash: '4', def: { testRunner: 'cargo' } };
  mkdirSync(join(work, 'tasks', 't1'), { recursive: true });
  writeFileSync(join(work, 'tasks', 't1', 'manifest.json'), JSON.stringify(manifest));
  return { work, manifest };
}
const makeRunDir = (work, name, { withWork = true } = {}) => {
  const dir = join(work, 'runs', name);
  mkdirSync(join(dir, 'config'), { recursive: true });
  if (withWork) {
    mkdirSync(join(dir, 'work'));
    writeFileSync(join(dir, 'work', 'marker.txt'), name);
  }
  return dir;
};

await ta('grade re-grades the work dir of the highest attempt that still has one, prints the grade and writes no rows file', async () => {
  const { work, manifest } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  makeRunDir(work, 't1.A.0-a2');
  makeRunDir(work, 't1.A.0-a3', { withWork: false });
  makeRunDir(work, 't1.A.1-a7'); // another run of the same task
  makeRunDir(work, 't1.A.0-a5-extra'); // not an attempt directory
  const calls = [];
  const g = { pass: true, infra: null, f2p: { passed: ['x'], failed: [], notRun: [] } };
  const modules = { gradeTree: async (...a) => { calls.push(a); return g; } };
  const before = readdirSync(work).sort();
  const r = await cli(['grade', 't1.A.0', '--work-root', work], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(asJson(r), g);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], manifest);
  assert.equal(calls[0][1], join(work, 'runs', 't1.A.0-a2', 'work'));
  assert.deepEqual(calls[0][2], { workRoot: work, image: 's5/codescout' });
  assert.deepEqual(readdirSync(work).sort(), before, 'nothing new in the work root (no rows file)');
  assert.equal(readFileSync(join(work, 'runs', 't1.A.0-a2', 'work', 'marker.txt'), 'utf8'), 't1.A.0-a2');
});

await ta("grade picks the image of the manifest's repo", async () => {
  const { work } = gradeWorld();
  writeFileSync(join(work, 'tasks', 't1', 'manifest.json'), JSON.stringify({ id: 't1', repo: 'claude-plugins', def: {} }));
  makeRunDir(work, 't1.C.1-a1');
  const calls = [];
  await cli(['grade', 't1.C.1', '--work-root', work], { modules: { gradeTree: async (...a) => { calls.push(a); return {}; } } });
  assert.equal(calls[0][2].image, 's5/plugins');
});

await ta('grade refuses and names --keep-run-dirs when no attempt has a work dir left, or when no run directory exists', async () => {
  const { work } = gradeWorld();
  makeRunDir(work, 't1.B.2-a1', { withWork: false });
  makeRunDir(work, 't1.B.2-a2', { withWork: false });
  for (const runId of ['t1.B.2', 't1.A.9']) {
    let called = 0;
    const r = await cli(['grade', runId, '--work-root', work], { modules: { gradeTree: async () => { called += 1; return {}; } } });
    assert.equal(r.code, 1, runId);
    noStdout(r);
    assert.match(r.stderr, /--keep-run-dirs/);
    assert.equal(called, 0);
  }
});

await ta('grade does not follow a symlinked work dir: the highest REAL work dir is used, and a run with only a symlinked one is refused', async () => {
  const { work } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  const elsewhere = join(freshDir('o'), 'work');
  mkdirSync(elsewhere);
  writeFileSync(join(elsewhere, 'marker.txt'), 'planted');
  const linked = makeRunDir(work, 't1.A.0-a2', { withWork: false });
  symlinkSync(elsewhere, join(linked, 'work'));
  const calls = [];
  const modules = { gradeTree: async (...a) => { calls.push(a); return {}; } };
  const r = await cli(['grade', 't1.A.0', '--work-root', work], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(calls[0][1], join(work, 'runs', 't1.A.0-a1', 'work'));
  const onlyLinked = makeRunDir(work, 't1.B.0-a1', { withWork: false });
  symlinkSync(elsewhere, join(onlyLinked, 'work'));
  const refused = await cli(['grade', 't1.B.0', '--work-root', work], { modules });
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--keep-run-dirs/);
  assert.equal(calls.length, 1);
});

await ta('grade: a missing manifest and a throwing grader are exit 1', async () => {
  const { work } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  const noManifest = await cli(['grade', 'ghost.A.0', '--work-root', work], { modules: { gradeTree: async () => ({}) } });
  assert.equal(noManifest.code, 1);
  assert.match(noManifest.stderr, /manifest/);
  const boom = await cli(['grade', 't1.A.0', '--work-root', work], { modules: { gradeTree: async () => { throw new Error('docker is down'); } } });
  assert.equal(boom.code, 1);
  assert.match(boom.stderr, /docker is down/);
});

// ---- build, warm, gate ----

await ta('build hands the task directory (resolved against the cwd) and the work root to buildTask and prints the hashes, not the definition', async () => {
  const work = freshDir('w');
  const calls = [];
  const modules = { buildTask: (dir, options) => { calls.push([dir, options]); return { id: 't1', repo: 'codescout', fix: 'f', parent: 'p', baseCommit: 'b', treeHash: 'T', hiddenHash: 'H', promptHash: 'P', taskMdHash: 'M', def: { secret: 'internal' } }; } };
  const r = await cli(['build', 'tasks/t1', '--work-root', work], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls, [[join(ROOT, 'tasks', 't1'), { workRoot: work }]]);
  const out = asJson(r);
  assert.deepEqual([out.id, out.treeHash, out.hiddenHash, out.promptHash], ['t1', 'T', 'H', 'P']);
  assert.equal('def' in out, false);
});

await ta('build: buildTask throwing is exit 1 with the message', async () => {
  const r = await cli(['build', 'd', '--work-root', freshDir('w')], { modules: { buildTask: () => { throw new Error('buildTask: /w/tasks/t1 already exists'); } } });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /already exists/);
});

await ta('gate reads the manifest from <workRoot>/tasks/<id>/manifest.json, exits 0 when ok and prints the reasons', async () => {
  const { work, manifest } = gradeWorld();
  const calls = [];
  const r = await cli(['gate', 't1', '--work-root', work], { modules: { gateTask: async (...a) => { calls.push(a); return { ok: true, reasons: ['manual_review_needed'], gatedAt: 'now', leftover: null }; } } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls, [[manifest, { workRoot: work }]]);
  const out = asJson(r);
  assert.equal(out.ok, true);
  assert.deepEqual(out.reasons, ['manual_review_needed']);
});

await ta('gate exits 1 when the gate is not ok and prints every reason; an unreadable manifest and a throwing gate are exit 1', async () => {
  const { work } = gradeWorld();
  const r = await cli(['gate', 't1', '--work-root', work], { modules: { gateTask: async () => ({ ok: false, reasons: ['fails_at_fix', 'flaky_at_fix'], gatedAt: 'now', leftover: null }) } });
  assert.equal(r.code, 1);
  assert.deepEqual(asJson(r).reasons, ['fails_at_fix', 'flaky_at_fix']);
  assert.equal(asJson(r).ok, false);
  const none = await cli(['gate', 'nothing-here', '--work-root', work], { modules: { gateTask: async () => ({ ok: true, reasons: [] }) } });
  assert.equal(none.code, 1);
  assert.match(none.stderr, /manifest/);
  const boom = await cli(['gate', 't1', '--work-root', work], { modules: { gateTask: async () => { throw new Error('gateTask: tree is not a directory'); } } });
  assert.equal(boom.code, 1);
  assert.match(boom.stderr, /not a directory/);
});

await ta('warm: ok and "not cargo" exit 0, a failed warm build exits 1; the result is printed', async () => {
  const { work, manifest } = gradeWorld();
  const seen = [];
  for (const [result, code] of [[{ ok: true, target: '/t' }, 0], [{ skipped: 'not cargo' }, 0], [{ ok: false, target: null }, 1]]) {
    const r = await cli(['warm', 't1', '--work-root', work], { modules: { warmTask: async (...a) => { seen.push(a); return result; } } });
    assert.equal(r.code, code, JSON.stringify(result));
    assert.deepEqual(asJson(r), result);
  }
  assert.deepEqual(seen[0], [manifest, { workRoot: work }]);
});

// ---- R150: warm, gate and grade run under the same CPU and memory limits as the measured runs ----
//
// The gate's flaky filter (3 x at C) and its build-timeout check, and the warm build, are measurements. On an unconstrained host they are
// a different instrument from the grades that run with `--cpus` and `--memory`. `--prereg <file> [--mode <m>]` reads the limits from the
// registration or config (loaded the way `run` does), `--cpus <n>` and `--memory-gb <n>` give them directly, and an explicit flag wins.

const LIMITS_PREREG = { ...PREREG_STUB, limits: { timeoutMinutes: 90, cpus: 4, memoryGb: 16, concurrency: 2, infraRetries: 2 } };
const limitFakes = (prereg = LIMITS_PREREG) => {
  const f = fakes({});
  f.modules.loadS5Prereg = (file) => { f.calls.push(['loadS5Prereg', file]); return { ...prereg, registered: true }; };
  f.modules.loadS5Config = (file, options) => { f.calls.push(['loadS5Config', file, options]); return { ...prereg, registered: false }; };
  f.modules.gateTask = async (...a) => { f.calls.push(['gateTask', ...a]); return { ok: true, reasons: [], gatedAt: 'now', leftover: null }; };
  f.modules.warmTask = async (...a) => { f.calls.push(['warmTask', ...a]); return { ok: true, target: '/t' }; };
  f.modules.gradeTree = async (...a) => { f.calls.push(['gradeTree', ...a]); return { pass: true, infra: null }; };
  return f;
};

await ta('R150: gate, warm and grade pass the limits of --prereg (the registration, or a config with --mode) to gateTask, warmTask and gradeTree', async () => {
  const { work, manifest } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  const f = limitFakes();
  const reg = resolve(ROOT, 'reg.json');
  const cfg = resolve(ROOT, 'cfg.json');
  for (const [argv, loaded] of [
    [['--prereg', 'reg.json'], ['loadS5Prereg', reg]],
    [['--prereg', 'cfg.json', '--mode', 'pilot'], ['loadS5Config', cfg, { mode: 'pilot' }]],
    [['--prereg', 'cfg.json', '--mode', 'calibrate'], ['loadS5Config', cfg, { mode: 'calibrate' }]],
  ]) {
    f.calls.length = 0;
    const g = await cli(['gate', 't1', ...argv, '--work-root', work], { modules: f.modules });
    assert.equal(g.code, 0, g.stderr);
    assert.deepEqual(f.calls, [loaded, ['gateTask', manifest, { workRoot: work, cpus: 4, memoryGb: 16 }]], `gate ${argv.join(' ')}`);
    f.calls.length = 0;
    const w = await cli(['warm', 't1', ...argv, '--work-root', work], { modules: f.modules });
    assert.equal(w.code, 0, w.stderr);
    assert.deepEqual(f.calls, [loaded, ['warmTask', manifest, { workRoot: work, cpus: 4, memoryGb: 16 }]], `warm ${argv.join(' ')}`);
    f.calls.length = 0;
    const r = await cli(['grade', 't1.A.0', ...argv, '--work-root', work], { modules: f.modules });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(f.calls, [loaded, ['gradeTree', manifest, join(work, 'runs', 't1.A.0-a1', 'work'), { workRoot: work, image: 's5/codescout', cpus: 4, memoryGb: 16 }]], `grade ${argv.join(' ')}`);
  }
});

await ta('R150: --cpus and --memory-gb give the limits directly, each one alone too, and an explicit flag wins over the registration; with none, nothing is passed', async () => {
  const { work, manifest } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  const f = limitFakes();
  const tree = join(work, 'runs', 't1.A.0-a1', 'work');
  const cases = [
    [['--cpus', '2', '--memory-gb', '8'], { cpus: 2, memoryGb: 8 }, false],
    [['--cpus', '0.5'], { cpus: 0.5 }, false],
    [['--memory-gb', '12'], { memoryGb: 12 }, false],
    [['--prereg', 'reg.json', '--cpus', '2'], { cpus: 2, memoryGb: 16 }, true],
    [['--prereg', 'reg.json', '--memory-gb', '8'], { cpus: 4, memoryGb: 8 }, true],
    [['--prereg', 'reg.json', '--cpus', '2', '--memory-gb', '8'], { cpus: 2, memoryGb: 8 }, true],
    [[], {}, false],
  ];
  for (const [argv, limits, loads] of cases) {
    for (const [command, id, expected] of [
      ['gate', 't1', (opts) => ['gateTask', manifest, { workRoot: work, ...opts }]],
      ['warm', 't1', (opts) => ['warmTask', manifest, { workRoot: work, ...opts }]],
      ['grade', 't1.A.0', (opts) => ['gradeTree', manifest, tree, { workRoot: work, image: 's5/codescout', ...opts }]],
    ]) {
      f.calls.length = 0;
      const r = await cli([command, id, ...argv, '--work-root', work], { modules: f.modules });
      assert.equal(r.code, 0, `${command} ${argv.join(' ')}: ${r.stderr}`);
      assert.equal(f.of('loadS5Prereg').length, loads ? 1 : 0, `${command} ${argv.join(' ')}: the registration is loaded only when --prereg is given`);
      assert.deepEqual(f.calls.at(-1), expected(limits), `${command} ${argv.join(' ')}`);
    }
  }
});

await ta('R150: a malformed limit, --mode without --prereg, an unknown mode and a registration without limits are refused before the manifest is read or any module runs', async () => {
  const { work } = gradeWorld();
  makeRunDir(work, 't1.A.0-a1');
  const f = limitFakes();
  const bad = [
    ['--cpus', '0'], ['--cpus', '-1'], ['--cpus', 'many'], ['--cpus', '1e999'], ['--memory-gb', '0'], ['--memory-gb', '0x10'], ['--memory-gb', 'lots'],
    ['--mode', 'pilot'], ['--prereg', 'reg.json', '--mode', 'bogus'],
  ];
  for (const command of [['gate', 't1'], ['warm', 't1'], ['grade', 't1.A.0']]) {
    for (const argv of bad) {
      f.calls.length = 0;
      const r = await cli([...command, ...argv, '--work-root', work], { modules: f.modules });
      assert.equal(r.code, 64, `${command[0]} ${argv.join(' ')}`);
      noStdout(r);
      assert.deepEqual(f.calls, [], `${command[0]} ${argv.join(' ')}: no module was called`);
    }
    // A registration that carries no usable limits is not guessed at: exit 1, nothing run.
    for (const limits of [undefined, {}, { cpus: 4 }, { memoryGb: 16 }, { cpus: 0, memoryGb: 16 }, { cpus: 4, memoryGb: '16' }]) {
      const g = limitFakes({ ...PREREG_STUB, limits });
      const r = await cli([...command, '--prereg', 'reg.json', '--work-root', work], { modules: g.modules });
      assert.equal(r.code, 1, `${command[0]} limits ${JSON.stringify(limits)}`);
      assert.match(r.stderr, /limits/);
      assert.deepEqual(g.calls.map((c) => c[0]), ['loadS5Prereg'], 'loaded, then refused: the gate, the warm build and the grade never ran');
    }
  }
});

// ---- proxy ----

await ta('proxy up --log-all starts the proxy in log-all mode with no allowlist and prints the result', async () => {
  const work = freshDir('w');
  const calls = [];
  const modules = { proxyUp: async (o) => { calls.push(o); return { id: 'i', mode: o.mode, network: 's5-internal', url: 'http://s5-proxy:8888', dir: '/d' }; } };
  const r = await cli(['proxy', 'up', '--log-all', '--work-root', work], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls, [{ mode: 'log-all', workRoot: work }]);
  assert.equal(asJson(r).mode, 'log-all');
});

await ta('proxy up --prereg: the allowlist comes from the registration (measure) or from a config (--mode pilot)', async () => {
  const work = freshDir('w');
  const calls = [];
  const f = fakes({});
  const modules = { ...f.modules, proxyUp: async (o) => { calls.push(o); return { mode: o.mode }; } };
  const a = await cli(['proxy', 'up', '--prereg', 'reg.json', '--work-root', work], { modules });
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(f.of('loadS5Prereg'), [['loadS5Prereg', resolve(ROOT, 'reg.json')]]);
  assert.deepEqual(calls[0], { mode: 'allowlist', allowlist: PREREG_STUB.proxyAllowlist, workRoot: work });
  const b = await cli(['proxy', 'up', '--prereg', 'cfg.json', '--mode', 'pilot', '--work-root', work], { modules });
  assert.equal(b.code, 0, b.stderr);
  assert.deepEqual(f.of('loadS5Config'), [['loadS5Config', resolve(ROOT, 'cfg.json'), { mode: 'pilot' }]]);
  assert.deepEqual(calls[1].allowlist, PREREG_STUB.proxyAllowlist);
});

await ta('proxy down prints what was removed; proxy log prints the log text unchanged; a failing module is exit 1', async () => {
  const down = await cli(['proxy', 'down'], { modules: { proxyDown: async () => ({ removedContainers: 1, network: 'removed' }) } });
  assert.equal(down.code, 0);
  assert.deepEqual(asJson(down), { removedContainers: 1, network: 'removed' });
  const log = await cli(['proxy', 'log'], { modules: { proxyLog: async () => 'CONNECT api.anthropic.com:443\nCONNECT other.example:443\n' } });
  assert.equal(log.code, 0);
  assert.equal(log.stdout, 'CONNECT api.anthropic.com:443\nCONNECT other.example:443\n');
  const bad = await cli(['proxy', 'log'], { modules: { proxyLog: async () => { throw new Error('expected exactly one s5-proxy container of ours, found 0'); } } });
  assert.equal(bad.code, 1);
  noStdout(bad);
  assert.match(bad.stderr, /found 0/);
  const bad2 = await cli(['proxy', 'up', '--log-all'], { modules: { proxyUp: async () => { throw new Error('a container named s5-proxy already exists'); } } });
  assert.equal(bad2.code, 1);
});

// ---- mine ----

await ta('mine runs mineCommits over every --repo for the spec window and writes the concatenated candidates; --since and --out override', async () => {
  const here = freshDir('here');
  const calls = [];
  const lists = { codescout: [{ repo: 'codescout', fix: 'a' }, { repo: 'codescout', fix: 'b' }], 'claude-plugins': [{ repo: 'claude-plugins', fix: 'c' }] };
  const modules = { mineCommits: (dir, options) => { calls.push([dir, options]); return lists[options.repo]; } };
  const r = await cli(['mine', '--repo', 'codescout=../cs', '--repo', 'claude-plugins=/abs/cp'], { modules, here });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls, [
    [resolve(ROOT, '..', 'cs'), { since: '2026-09-28', repo: 'codescout' }],
    ['/abs/cp', { since: '2026-09-28', repo: 'claude-plugins' }],
  ]);
  const out = join(here, 'tasks', 'candidates.json');
  assert.equal(readFileSync(out, 'utf8'), canonical([...lists.codescout, ...lists['claude-plugins']]));
  assert.deepEqual(asJson(r), { out, count: 3, perRepo: { codescout: 2, 'claude-plugins': 1 } });

  const target = join(freshDir('o'), 'sub', 'c.json');
  const g = await cli(['mine', '--repo', 'codescout=x', '--since', '2026-10-01', '--out', target], { modules, here });
  assert.equal(g.code, 0, g.stderr);
  assert.equal(calls.at(-1)[1].since, '2026-10-01');
  assert.equal(readFileSync(target, 'utf8'), canonical(lists.codescout));
});

await ta('mine: a throwing mineCommits is exit 1 and writes no file', async () => {
  const here = freshDir('here');
  const r = await cli(['mine', '--repo', 'a=x'], { modules: { mineCommits: () => { throw new TypeError('mineCommits: since must be a date string'); } }, here });
  assert.equal(r.code, 1);
  assert.equal(existsSync(join(here, 'tasks', 'candidates.json')), false);
});

// ---- images ----

function imagesDir(script, digests = '{\n  "s5/codescout": "sha256:aa"\n}\n') {
  const dir = freshDir('images');
  writeFileSync(join(dir, 'build.sh'), script);
  writeFileSync(join(dir, 'digests.json'), digests);
  return dir;
}

await ta("images runs build.sh (a real spawn of a fake script), forwards its stderr and prints digests.json; the token is not in the script's environment", async () => {
  const dir = imagesDir('#!/bin/bash\necho "== build s5/fake" >&2\nprintf "%s" "${CLAUDE_CODE_OAUTH_TOKEN-unset}" > "$(dirname "$0")/seen-token"\nprintf "%s" "${PATH:+path}" > "$(dirname "$0")/seen-path"\n');
  const r = await cli(['images'], { imagesDir: dir, env: { [TOKEN_ENV]: SENTINEL, PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /== build s5\/fake/);
  assert.equal(r.stdout, '{\n  "s5/codescout": "sha256:aa"\n}\n');
  assert.equal(readFileSync(join(dir, 'seen-token'), 'utf8'), 'unset');
  assert.equal(readFileSync(join(dir, 'seen-path'), 'utf8'), 'path');
});

await ta('images: a build.sh that fails is exit 1 with its status, and digests.json is not printed', async () => {
  const dir = imagesDir('#!/bin/bash\necho "docker: no daemon" >&2\nexit 3\n');
  const r = await cli(['images'], { imagesDir: dir, env: { PATH: process.env.PATH } });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /docker: no daemon/);
  assert.match(r.stderr, /exit 3|status 3/);
});

// ---- select ----

// Rows carry their mode (R133): `row` is a measured row, `crow` a calibration row; extra may override the mode or (with undefined) drop it.
const row = (taskId, arm, rep, pass, extra = {}) => ({ runId: `${taskId}.${arm}.${rep}`, taskId, arm, final: true, infra: null, grade: { pass }, mode: 'measure', ...extra });
const crow = (taskId, arm, rep, pass, extra = {}) => row(taskId, arm, rep, pass, { mode: 'calibrate', ...extra });
const jsonl = (lines) => `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`;

await ta('select applies selectCalibrated to the rows (typed lines and lines without a runId are not rows) and prints kept and dropped with reasons', async () => {
  const file = join(freshDir('r'), 'rows-calibrate.jsonl');
  writeFileSync(file, jsonl([
    { type: 'stopped', reason: 'cost', mode: 'calibrate' },
    crow('hard', 'A', 0, false), crow('hard', 'A', 1, false), crow('hard', 'C', 0, false),
    crow('easy', 'A', 0, true), crow('easy', 'A', 1, true), crow('easy', 'C', 0, true),
    crow('mid', 'A', 0, true), crow('mid', 'A', 1, false), crow('mid', 'C', 0, false),
    crow('lonely', 'A', 0, true), crow('lonely', 'A', 1, true),
    { note: 'a line without a run id', taskId: 'mid', arm: 'A', final: true, infra: null, grade: { pass: false }, mode: 'pilot' },
  ]));
  const r = await cli(['select', '--rows', file], { modules: { selectCalibrated } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(asJson(r), {
    kept: ['mid'],
    dropped: [
      { taskId: 'easy', reason: 'effort_idle' },
      { taskId: 'hard', reason: 'never_solved' },
      { taskId: 'lonely', reason: 'not_measured' },
    ],
  });
});

await ta('select: a missing rows file and a damaged one (a bad line that is not the last) are exit 1; a torn last line is ignored and said', async () => {
  const dir = freshDir('r');
  const missing = await cli(['select', '--rows', join(dir, 'nope.jsonl')], { modules: { selectCalibrated } });
  assert.equal(missing.code, 1);
  noStdout(missing);
  const damaged = join(dir, 'damaged.jsonl');
  writeFileSync(damaged, jsonl([crow('a', 'A', 0, true), '{"runId": oops', crow('a', 'C', 0, true)]));
  const d = await cli(['select', '--rows', damaged], { modules: { selectCalibrated } });
  assert.equal(d.code, 1);
  noStdout(d);
  assert.match(d.stderr, /line 2/);
  const torn = join(dir, 'torn.jsonl');
  writeFileSync(torn, `${jsonl([crow('a', 'A', 0, true), crow('a', 'A', 1, false), crow('a', 'C', 0, false)])}{"runId":"a.C.1","tas`);
  const seen = [];
  const t2 = await cli(['select', '--rows', torn], { modules: { selectCalibrated: (rows) => { seen.push(rows); return { kept: [], dropped: [] }; } } });
  assert.equal(t2.code, 0, t2.stderr);
  assert.equal(seen[0].length, 3);
  assert.match(t2.stderr, /torn/i);
});

await ta('select: a row whose mode is not calibrate (a measure row, a row with no mode) is refused with the line and the mode; a typed line of another mode is not a row (R142)', async () => {
  const dir = freshDir('r');
  const mk = (lines) => {
    const f = join(dir, `m${dirNo++}.jsonl`);
    writeFileSync(f, jsonl(lines));
    return f;
  };
  let called = 0;
  const modules = { selectCalibrated: () => { called += 1; return { kept: [], dropped: [] }; } };
  const mixed = await cli(['select', '--rows', mk([crow('a', 'A', 0, true), { type: 'stopped', mode: 'pilot', reason: 'cost' }, row('a', 'C', 0, true)])], { modules });
  assert.equal(mixed.code, 1);
  noStdout(mixed);
  assert.match(mixed.stderr, /line 3/);
  assert.match(mixed.stderr, /measure/);
  const none = await cli(['select', '--rows', mk([crow('a', 'A', 0, true), crow('a', 'C', 0, true, { mode: undefined })])], { modules });
  assert.equal(none.code, 1);
  noStdout(none);
  assert.match(none.stderr, /line 2/);
  assert.match(none.stderr, /no mode/);
  assert.equal(called, 0, 'selectCalibrated is not reached');
  const ok = await cli(['select', '--rows', mk([{ type: 'stopped', mode: 'pilot', reason: 'cost' }, crow('a', 'A', 0, true), crow('a', 'C', 0, true)])], { modules });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(called, 1);
});

await ta('select and analyze: a damaged middle line plus a torn last line is refused (only ONE bad line, the last, can be torn)', async () => {
  const dir = freshDir('r');
  const file = join(dir, 'two-bad.jsonl');
  writeFileSync(file, `${jsonl([crow('a', 'A', 0, true), '{"runId": oops', crow('a', 'C', 0, true)])}{"runId":"a.C.1","tas`);
  const f = fakes({});
  const modules = { ...f.modules, selectCalibrated: () => ({ kept: [], dropped: [] }), analyzeS5: () => ({ excluded: [], mechanism: {} }) };
  for (const argv of [['select', '--rows', file], ['analyze', '--prereg', 'p', '--rows', file]]) {
    const r = await cli(argv, { modules });
    assert.equal(r.code, 1, argv[0]);
    noStdout(r);
    assert.match(r.stderr, /line 2/);
  }
});

await ta('select: a torn last line is ignored and said', async () => {
  const torn = join(freshDir('r'), 'torn2.jsonl');
  writeFileSync(torn, `${jsonl([crow('a', 'A', 0, true)])}{"runId":"a.C.1","mode":"pil`);
  const r = await cli(['select', '--rows', torn], { modules: { selectCalibrated: () => ({ kept: [], dropped: [] }) } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /torn/i);
});

// ---- analyze ----

await ta('analyze loads the prereg with loadS5Prereg, passes only the rows, prints the whole Report with excluded in full, and prints mechanism.output and .total as signedDelta and pValue only', async () => {
  const dir = freshDir('r');
  const rows = [row('a', 'A', 0, true), row('a', 'B', 0, true, { mode: 'measure' }), row('b', 'C', 0, false)];
  const file = join(dir, 'rows-measure.jsonl');
  writeFileSync(file, jsonl([
    { type: 'stopped', at: 'x', reason: 'cost' },
    rows[0],
    '',
    { taskId: 'a', arm: 'A', final: true, infra: null, grade: { pass: true }, note: 'no runId' },
    rows[1],
    { type: 'stopped', at: 'y', reason: 'signal' },
    rows[2],
  ]));
  const excluded = Array.from({ length: 7 }, (_, i) => ({ taskId: `gone-${i}`, reason: i === 0 ? 'no_counted_run_in_A_B_C' : 'no_counted_run_in_C' }));
  const report = {
    margin: 0.15,
    verdict: 'uninformative',
    excluded,
    mechanism: {
      thinking: { verdict: 'mechanism_pass', signedDelta: 812.5, pValue: 0.004, nTreated: 9, nHoldout: 9 },
      output: { verdict: 'mechanism_pass', signedDelta: 140, pValue: 0.2, nTreated: 9, nHoldout: 9, cacheOk: true },
      total: { verdict: 'insufficient_data', signedDelta: null, pValue: null, nTreated: 0, nHoldout: 0 },
    },
  };
  const seen = [];
  const f = fakes({});
  const modules = { ...f.modules, analyzeS5: (...a) => { seen.push(a); return report; } };
  const r = await cli(['analyze', '--prereg', 'reg.json', '--rows', file], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(f.of('loadS5Prereg'), [['loadS5Prereg', resolve(ROOT, 'reg.json')]]);
  assert.equal(f.of('loadS5Config').length, 0);
  assert.deepEqual(seen[0][0], rows);
  assert.equal(seen[0][1].registered, true);
  const out = asJson(r);
  assert.deepEqual(out.excluded, excluded);
  assert.equal(out.verdict, 'uninformative');
  assert.deepEqual(out.mechanism.output, { signedDelta: 140, pValue: 0.2 });
  assert.deepEqual(out.mechanism.total, { signedDelta: null, pValue: null });
  assert.equal(out.mechanism.thinking.verdict, 'mechanism_pass', 'the registered test keeps its own verdict');
  assert.equal(JSON.stringify(out.mechanism.output).includes('verdict'), false);
  assert.match(r.stderr, /2 typed/);
  assert.match(r.stderr, /1 .*without/);
});

await ta('analyze: a loader refusal, an unreadable rows file and a damaged one are exit 1 with an empty stdout; a torn last line is ignored', async () => {
  const dir = freshDir('r');
  const good = join(dir, 'g.jsonl');
  writeFileSync(good, jsonl([row('a', 'A', 0, true)]));
  const f = fakes({});
  f.modules.loadS5Prereg = () => { throw new Error('prereg: not committed'); };
  const noReg = await cli(['analyze', '--prereg', 'p', '--rows', good], { modules: { ...f.modules, analyzeS5: () => ({}) } });
  assert.equal(noReg.code, 1);
  noStdout(noReg);
  const g = fakes({});
  const m = { ...g.modules, analyzeS5: () => ({ excluded: [], mechanism: {} }) };
  const missing = await cli(['analyze', '--prereg', 'p', '--rows', join(dir, 'nope')], { modules: m });
  assert.equal(missing.code, 1);
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, jsonl(['not json', row('a', 'A', 0, true)]));
  assert.equal((await cli(['analyze', '--prereg', 'p', '--rows', bad], { modules: m })).code, 1);
  const torn = join(dir, 'torn.jsonl');
  writeFileSync(torn, `${jsonl([row('a', 'A', 0, true)])}{"runId":"a.B.0",`);
  const ok = await cli(['analyze', '--prereg', 'p', '--rows', torn], { modules: m });
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stderr, /torn/i);
});

await ta('analyze: a row whose mode is not measure (a pilot row in the middle, a row with no mode) is refused with the line and the mode; a typed line of another mode is not a row (R142)', async () => {
  const dir = freshDir('r');
  const mk = (lines) => {
    const f = join(dir, `m${dirNo++}.jsonl`);
    writeFileSync(f, jsonl(lines));
    return f;
  };
  const f = fakes({});
  let called = 0;
  const modules = { ...f.modules, analyzeS5: () => { called += 1; return { excluded: [], mechanism: {} }; } };
  const mixed = await cli(['analyze', '--prereg', 'p', '--rows', mk([row('a', 'A', 0, true), { type: 'stopped', mode: 'pilot', reason: 'cost' }, row('a', 'B', 0, true, { mode: 'pilot' }), row('b', 'C', 0, false)])], { modules });
  assert.equal(mixed.code, 1);
  noStdout(mixed);
  assert.match(mixed.stderr, /line 3/);
  assert.match(mixed.stderr, /pilot/);
  const none = await cli(['analyze', '--prereg', 'p', '--rows', mk([row('a', 'A', 0, true), row('a', 'B', 0, true, { mode: undefined })])], { modules });
  assert.equal(none.code, 1);
  noStdout(none);
  assert.match(none.stderr, /line 2/);
  assert.match(none.stderr, /no mode/);
  assert.equal(called, 0, 'analyzeS5 is not reached');
  const ok = await cli(['analyze', '--prereg', 'p', '--rows', mk([{ type: 'stopped', mode: 'pilot', reason: 'cost' }, row('a', 'A', 0, true), row('a', 'B', 0, true)])], { modules });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(called, 1);
});

// ---- simulate ----

await ta('simulate runs the registered scenarios with the registered defaults and prints niRate and gateRate for each', async () => {
  const calls = [];
  const modules = { simulate: (o) => { calls.push(o); return o.deltaB === -0.15 ? { niRate: 0.048, gateRate: 0.053 } : { niRate: 0.722, gateRate: 0.995 }; } };
  const r = await cli(['simulate'], { modules });
  assert.equal(r.code, 0, r.stderr);
  const base = { nTasks: 32, runs: { A: 3, B: 3, C: 2 }, pA: [0.3, 0.95], trials: 1000, resamples: 1000, seed: 20261008, method: 'paired-t', margin: 0.15, alpha: 0.05 };
  assert.deepEqual(calls, [{ ...base, deltaB: -0.15, deltaC: 0 }, { ...base, deltaB: 0, deltaC: -0.3 }]);
  const out = asJson(r);
  assert.deepEqual(out.params, base);
  assert.deepEqual(out.scenarios, [
    { deltaB: -0.15, deltaC: 0, niRate: 0.048, gateRate: 0.053 },
    { deltaB: 0, deltaC: -0.3, niRate: 0.722, gateRate: 0.995 },
  ]);
});

await ta('simulate: every option reaches the module', async () => {
  const calls = [];
  const modules = { simulate: (o) => { calls.push(o); return { niRate: 0, gateRate: 0 }; } };
  const r = await cli(['simulate', '--n-tasks', '40', '--trials=200', '--resamples', '3000', '--seed', '7', '--method', 'percentile', '--margin', '0.1', '--alpha', '0.025', '--runs-a', '4', '--runs-b', '5', '--runs-c', '1', '--pa-lo', '0.2', '--pa-hi', '0.9'], { modules });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(calls[0], {
    nTasks: 40, runs: { A: 4, B: 5, C: 1 }, pA: [0.2, 0.9], trials: 200, resamples: 3000, seed: 7, method: 'percentile', margin: 0.1, alpha: 0.025, deltaB: -0.15, deltaC: 0,
  });
});

await ta('simulate with the real module (a tiny run) is deterministic for a seed and gives rates in [0, 1]', async () => {
  const args = ['simulate', '--n-tasks', '8', '--trials', '20', '--resamples', '0', '--seed', '5'];
  const a = await cli(args, { modules: { simulate: realSimulate } });
  const b = await cli(args, { modules: { simulate: realSimulate } });
  assert.equal(a.code, 0, a.stderr);
  assert.equal(a.stdout, b.stdout);
  for (const s of asJson(a).scenarios) for (const k of ['niRate', 'gateRate']) assert.ok(s[k] >= 0 && s[k] <= 1);
});

await ta('simulate: a module refusal (--n-tasks 1) is exit 1 with an empty stdout', async () => {
  const r = await cli(['simulate', '--n-tasks', '1'], { modules: { simulate: realSimulate } });
  assert.equal(r.code, 1);
  noStdout(r);
  assert.match(r.stderr, /nTasks/);
});

// ---- nothing left behind ----

t('the sentinel is on disk only in the token files these tests wrote on purpose', () => {
  assert.deepEqual(filesHolding(SENTINEL), []);
});

// ---- R153: the name of the token variable is defined once ----

t('R153: the token variable name is one exported constant, run.mjs\'s TOKEN_ENV, which s5.mjs imports: the literal is written once in the code of the two files', () => {
  assert.equal(RUN_TOKEN_ENV, 'CLAUDE_CODE_OAUTH_TOKEN');
  const code = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  const literal = /['"`]CLAUDE_CODE_OAUTH_TOKEN['"`]/g;
  assert.equal((code('./run.mjs').match(literal) ?? []).length, 1, 'run.mjs: the definition, nothing else');
  assert.equal((code('./s5.mjs').match(literal) ?? []).length, 0, 's5.mjs: none, it imports the constant');
  assert.match(code('./s5.mjs'), /import \{[^}]*\bTOKEN_ENV\b[^}]*\} from '\.\/run\.mjs'/);
  assert.match(code('./run.mjs'), /export const TOKEN_ENV = /);
});
