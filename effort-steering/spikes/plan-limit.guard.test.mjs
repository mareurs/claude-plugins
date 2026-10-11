// plan-limit.guard.test.mjs — the structural guard for R-PL8 and amendment A4: every file under effort-steering/ that launches `claude` imports the plan-limit
// detector, or is listed in UNGUARDED on purpose. Without it a NEW harness that runs `claude -p` and grades what comes back would be wired to nothing, and a
// spent subscription's refusal (`You've hit your limit · resets 3pm`) would be graded as a model failure, which is the defect plan-limit.mjs exists to stop.
//
// WHAT THE SCANNER DOES. It walks effort-steering/ (a superset of A4's spikes/, adapter/ and bin/; core/ and the root are walked too), skipping directories
// named node_modules, tasks, fixtures and .git, and every *.test.mjs. It reads files by extension: .mjs .js .cjs .ts .mts (kind js), .sh .bash (kind sh),
// .py (kind py). A line whose first non-blank characters are a comment marker (// * /* for js; # for sh and py) is dropped before anything is matched, so
// prose about `claude -p` is never a launch. A file is a LAUNCHER when one of its kind's LAUNCH patterns matches (the patterns are below, each with samples
// that it matches and samples that it must not).
//
// WHAT THE REGEXES KEY ON (the decision A4 asked for, made with evidence from a real grep of effort-steering/). A js file launches claude when it passes the
// claude BINARY NAME to a child-process call (`spawn('claude', …)`, which s4-run.mjs does through its injected `spawn`), or a variable named like it, or
// writes the container command line `'/opt/claude/claude', '-p'` (s5/run.mjs does: it hands the array to `docker run`), or holds a command string that
// starts `claude -p`. s5/docker.mjs also spawns, but its first argument is `bin` / `dockerBin`: it launches DOCKER, never claude, so no pattern matches it
// (pinned below with the real file). A sh file launches claude when `claude` stands in command position (line start, after ; & | ( (so $( too) or a backtick, or after
// timeout N / exec / env VAR=x / nohup / sudo / time / xargs). A py file launches it when an argv list starts with 'claude', a call's first argument is
// 'claude', or a string starts `claude -p`.
//
// WHAT A GUARDED LAUNCHER IS (js kinds only; a shell or python file cannot import the module). It has a static `import … from '<…/>plan-limit.mjs'` at the
// start of a line (the basename is exactly plan-limit.mjs, not my-plan-limit.mjs), the import brings in detectPlanLimit or assertNoPlanLimit, and the file
// CALLS what it imported. An import that is never called guards nothing. An aliased import (`detectPlanLimit as d`) fails this check: it is a false alarm
// and the fix is to not alias.
//
// THE RULE, per launcher: guarded XOR listed. Not guarded and not listed fails (a new unguarded launcher). Listed and guarded fails (a stale entry: the
// file got wired, so the exemption must go). An UNGUARDED key that is not a scanned file, or whose file no longer launches claude, fails too (a stale entry
// would hide the next unguarded launcher that takes its place), and so does an entry without a reason.
//
// UNGUARDED (R-PL8): the Python and shell harnesses are not wired in this build. The map was built from a real grep of effort-steering/ on 2026-10-11:
//   grep -rEn "claude -p|'claude'|\"claude\"|/opt/claude/claude" effort-steering, then each hit read in its file. The launcher lines are
//     spikes/probes/run-probe1.sh:20, run-probe2.sh:31, run-probe3.sh:48, run-i1.sh:21, run-i1b.sh:26, run-i2.sh:27, run-boundary.sh:25 (all `timeout N claude -p …`)
//     spikes/dose/run-calibration.py:111 (`cmd = ['claude', '-p', …`)
//   The other hits are prose (comments, READMEs, Dockerfile comments), model names (`claude-sonnet-5-5`), the config dir, or the S5 container command
//   (s5/run.mjs, guarded). Keys are relative to effort-steering/.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from '../core/testkit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ES = path.resolve(HERE, '..');

// R-PL8: launchers that are NOT wired to the detector in this build, each with the reason. Adding a launcher here is a decision, not a fix.
const R_PL8 = 'R-PL8: a shell/python harness is not wired to the detector in this build; a plan-limit refusal in its output would read as a model failure';
const UNGUARDED = {
  'spikes/probes/run-probe1.sh': `${R_PL8} (probe 1, run by hand)`,
  'spikes/probes/run-probe2.sh': `${R_PL8} (probe 2, run by hand)`,
  'spikes/probes/run-probe3.sh': `${R_PL8} (probe 3, run by hand)`,
  'spikes/probes/run-i1.sh': `${R_PL8} (probe i1, run by hand)`,
  'spikes/probes/run-i1b.sh': `${R_PL8} (probe i1b, run by hand)`,
  'spikes/probes/run-i2.sh': `${R_PL8} (probe i2, run by hand)`,
  'spikes/probes/run-boundary.sh': `${R_PL8} (boundary probe, run by hand)`,
  'spikes/dose/run-calibration.py': `${R_PL8} (dose calibration, run by hand; the Python harness)`,
};

// ---- the scanner ---------------------------------------------------------------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'tasks', 'fixtures', '.git']);
const KIND_OF = { '.mjs': 'js', '.js': 'js', '.cjs': 'js', '.ts': 'js', '.mts': 'js', '.sh': 'sh', '.bash': 'sh', '.py': 'py' };
const COMMENT_PREFIXES = { js: ['//', '*', '/*'], sh: ['#'], py: ['#'] };

// rel: a posix path relative to effort-steering/.
const kindOf = (rel) => KIND_OF[path.posix.extname(rel)] ?? null;
const isScanned = (rel) => {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((dir) => SKIP_DIRS.has(dir))) return false;
  if (parts.at(-1).endsWith('.test.mjs')) return false;
  return kindOf(rel) !== null;
};

function walk(dir, rel = '') {
  const found = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...walk(path.join(dir, entry.name), entryRel));
    } else if (entry.isFile() && isScanned(entryRel)) {
      found.push(entryRel);
    }
  }
  return found;
}

const readAll = (root = ES) => new Map(walk(root).map((rel) => [rel, readFileSync(path.join(root, rel), 'utf8')]));

const stripComments = (source, kind) => {
  const prefixes = COMMENT_PREFIXES[kind];
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !prefixes.some((prefix) => trimmed.startsWith(prefix));
    })
    .join('\n');
};

// The LAUNCH patterns, per kind. `name` is what a failure message and the real-file pins use.
const LAUNCH = {
  js: [
    // spawn('claude', …), execFileSync("claude", …), exec(`claude`) …: the binary name is the call's first argument.
    { name: 'spawn-claude', re: /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(\s*(['"`])claude\1/ },
    // spawn(claudeBin, …), spawnSync(opts.claudeCmd, …): a variable named like the binary is the first argument.
    { name: 'spawn-claude-variable', re: /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*[\w$.]*claude[\w$.]*\s*[,)]/i },
    // ['/opt/claude/claude', '-p', …]: the command line S5 hands to `docker run`.
    { name: 'container-claude-p', re: /(['"`])\/opt\/claude\/claude\1\s*,\s*(['"`])-p\2/ },
    // 'claude -p …': a command string (exec, sh -c).
    { name: 'claude-p-command-string', re: /(['"`])claude\s+(?:-p|--print)\b/ },
  ],
  sh: [
    {
      name: 'claude-in-command-position',
      re: /(?:^[ \t]*|[;&|(][ \t]*|`[ \t]*|\b(?:exec|command|nohup|sudo|time|xargs)[ \t]+|\btimeout(?:[ \t]+\S+){1,4}[ \t]+|\benv(?:[ \t]+\S+=\S*)*[ \t]+)claude(?=[ \t]|$)/m,
    },
    { name: 'claude-p-command-string', re: /(['"])claude[ \t]+(?:-p|--print)\b/ },
  ],
  py: [
    { name: 'argv-list-starts-claude', re: /\[\s*(['"])claude\1\s*[,\]]/ },
    { name: 'call-first-argument-claude', re: /\(\s*f?(['"])claude\1/ },
    { name: 'claude-p-command-string', re: /(['"])claude\s+(?:-p|--print)\b/ },
  ],
};

// -> the names of the LAUNCH patterns that match the file (empty: not a launcher).
function launchKinds(rel, source) {
  const kind = kindOf(rel);
  if (kind === null) return [];
  const code = stripComments(source, kind);
  return LAUNCH[kind].filter(({ re }) => re.test(code)).map(({ name }) => name);
}

const DETECTOR_NAMES = ['detectPlanLimit', 'assertNoPlanLimit'];
// A static import at the start of a line from a path whose basename is plan-limit.mjs, bringing in a detector function that the file then calls.
const IMPORT_RE = /^[ \t]*import\b([^;'"]*?)\bfrom\s*(['"])(?:[^'"\n]*\/)?plan-limit\.mjs\2/gm;
function importsDetector(rel, source) {
  if (kindOf(rel) !== 'js') return false;
  const code = stripComments(source, 'js');
  const imported = [];
  for (const match of code.matchAll(IMPORT_RE)) {
    for (const name of DETECTOR_NAMES) if (new RegExp(`\\b${name}\\b`).test(match[1])) imported.push(name);
  }
  return imported.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(code));
}

// The rule. files: Map<rel, source>; unguarded: { rel: reason }. -> a list of problems (empty: the guard holds).
function check(files, unguarded) {
  const problems = [];
  for (const [rel, source] of files) {
    const kinds = launchKinds(rel, source);
    if (kinds.length === 0) continue;
    const listed = Object.hasOwn(unguarded, rel);
    const guarded = importsDetector(rel, source);
    if (guarded && listed) {
      problems.push(`${rel}: listed in UNGUARDED although it imports and calls the plan-limit detector: remove the entry`);
    } else if (!guarded && !listed) {
      problems.push(`${rel}: launches claude (${kinds.join(', ')}) but does not import and call the plan-limit detector from plan-limit.mjs, and is not listed in UNGUARDED`);
    }
  }
  for (const [rel, reason] of Object.entries(unguarded)) {
    if (typeof reason !== 'string' || reason.trim() === '') problems.push(`UNGUARDED[${rel}]: an entry needs a reason`);
    if (!files.has(rel)) {
      problems.push(`UNGUARDED[${rel}]: stale entry, not a scanned file (missing, renamed, or in a skipped place)`);
    } else if (launchKinds(rel, files.get(rel)).length === 0) {
      problems.push(`UNGUARDED[${rel}]: stale entry, the file no longer launches claude: remove it`);
    }
  }
  return problems;
}

// ---- the guard on the real tree ------------------------------------------------------------------------------------------------------------------

const REAL = readAll();

t('R-PL8 guard: every file under effort-steering/ that launches claude imports and calls the plan-limit detector or is listed in UNGUARDED', () => {
  assert.deepEqual(check(REAL, UNGUARDED), []);
});

t('R-PL8 guard: the scan reaches the files it is meant to guard, and none of the skipped places', () => {
  for (const rel of ['spikes/s4-run.mjs', 'spikes/s5/run.mjs', 'spikes/probes/run-probe1.sh', 'spikes/dose/run-calibration.py', 'adapter/claude-code/user-prompt-submit.mjs', 'bin/effort-policy.mjs']) {
    assert.ok(REAL.has(rel), `${rel} is scanned`);
  }
  assert.ok(REAL.size > 40, `a real scan reads many files, read ${REAL.size}`);
  for (const rel of REAL.keys()) {
    assert.ok(!rel.endsWith('.test.mjs'), `${rel}: a test file is not scanned`);
    assert.ok(!rel.split('/').some((part) => SKIP_DIRS.has(part)), `${rel}: lies in a skipped directory`);
    assert.ok(kindOf(rel) !== null, `${rel}: has a scanned extension`);
  }
  // the skipped places exist on disk, so the absence above is the rule's doing and not an empty directory
  assert.ok(readdirSync(path.join(ES, 'spikes', 's5')).includes('fixtures'), 'spikes/s5/fixtures exists');
  assert.ok(readdirSync(path.join(ES, 'spikes', 's5', 'fixtures')).includes('fake-claude.mjs'), 'and holds the fake claude');
  assert.ok(!REAL.has('spikes/s5/fixtures/fake-claude.mjs'));
});

t('R-PL8 guard: the two real launchers are launchers, each by the pattern that fits it, and both are guarded', () => {
  assert.deepEqual(launchKinds('spikes/s4-run.mjs', REAL.get('spikes/s4-run.mjs')), ['spawn-claude']);
  assert.deepEqual(launchKinds('spikes/s5/run.mjs', REAL.get('spikes/s5/run.mjs')), ['container-claude-p']);
  assert.equal(importsDetector('spikes/s4-run.mjs', REAL.get('spikes/s4-run.mjs')), true);
  assert.equal(importsDetector('spikes/s5/run.mjs', REAL.get('spikes/s5/run.mjs')), true);
  // and neither is exempted
  assert.ok(!Object.hasOwn(UNGUARDED, 'spikes/s4-run.mjs') && !Object.hasOwn(UNGUARDED, 'spikes/s5/run.mjs'));
});

t('R-PL8 guard: files that only MENTION claude, or spawn something else, are not launchers (s5/docker.mjs spawns docker; the others carry claude in prose or as a path)', () => {
  const readPath = (rel) => readFileSync(path.join(ES, rel), 'utf8');
  for (const rel of [
    'spikes/s5/docker.mjs', // spawn(bin, …) / spawn(dockerBin, …): the first argument is docker
    'spikes/s4-prereg.mjs', // `claude -p` in comments only
    'spikes/plan-limit.mjs', // `claude -p` in the header
    'spikes/s5/proxy.mjs',
    'spikes/s5/grade.mjs',
    'spikes/s5/usage.mjs',
    'spikes/s5/fixtures/fake-claude.mjs', // the stand-in for claude: it is run BY the harness, it launches nothing
    'spikes/probes/lib.sh', // CLAUDE_CONFIG_DIR, .claude-plugin
    'spikes/probes/analyze-boundary.py', // CLAUDE_CONFIG_DIR
    'spikes/probes/wire_recorder.py', // x-claude-code-session-id
    'spikes/probes/mods/effort-rewriter/register.ts', // `claude -p` in a comment
    'spikes/s5/images/build.sh', // docker build
  ]) {
    assert.deepEqual(launchKinds(rel, readPath(rel)), [], rel);
  }
  assert.deepEqual(check(new Map([['spikes/s5/docker.mjs', readPath('spikes/s5/docker.mjs')]]), {}), []);
});

t('R-PL8 guard: the 8 shell/python launchers in UNGUARDED are launchers, from a real grep (each file, with the pattern that fires)', () => {
  const expected = {
    'spikes/probes/run-probe1.sh': 'claude-in-command-position',
    'spikes/probes/run-probe2.sh': 'claude-in-command-position',
    'spikes/probes/run-probe3.sh': 'claude-in-command-position',
    'spikes/probes/run-i1.sh': 'claude-in-command-position',
    'spikes/probes/run-i1b.sh': 'claude-in-command-position',
    'spikes/probes/run-i2.sh': 'claude-in-command-position',
    'spikes/probes/run-boundary.sh': 'claude-in-command-position',
    'spikes/dose/run-calibration.py': 'argv-list-starts-claude',
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(UNGUARDED).sort(), 'the table and UNGUARDED name the same files');
  for (const [rel, name] of Object.entries(expected)) assert.deepEqual(launchKinds(rel, REAL.get(rel)), [name], rel);
  for (const [rel, reason] of Object.entries(UNGUARDED)) {
    assert.ok(!rel.startsWith('/') && !rel.includes('\\') && !rel.startsWith('effort-steering/'), `${rel}: a posix path relative to effort-steering/`);
    assert.ok(reason.includes('R-PL8') && reason.length > 40, `${rel}: carries the ruling and a reason`);
  }
});

// ---- the patterns: what each must and must not match ---------------------------------------------------------------------------------------------

t('R-PL8 guard, js: spawn-like calls with claude as the first argument, a variable named like it, a container command line and a command string are launches', () => {
  const launches = [
    ["spawn('claude', args, { cwd })", 'spawn-claude'],
    ['spawnSync("claude", ["-p", prompt])', 'spawn-claude'],
    ['execFile(`claude`, argv, cb)', 'spawn-claude'],
    ["execFileSync( 'claude' , ['-p'])", 'spawn-claude'],
    ["const out = execSync('claude')", 'spawn-claude'],
    ["child_process.spawn(\n  'claude',\n  args)", 'spawn-claude'],
    ['spawn(claudeBin, args)', 'spawn-claude-variable'],
    ['spawnSync(opts.claudeCmd, args)', 'spawn-claude-variable'],
    ['execFile(CLAUDE_BIN)', 'spawn-claude-variable'],
    ["const argv = ['/opt/claude/claude', '-p', '--model', model];", 'container-claude-p'],
    ["const argv = [\"/opt/claude/claude\",\n '-p']", 'container-claude-p'],
    ["exec('claude -p hello')", 'claude-p-command-string'],
    ["spawn('sh', ['-c', 'claude --print hi'])", 'claude-p-command-string'],
  ];
  for (const [code, name] of launches) assert.ok(launchKinds('x.mjs', code).includes(name), `${name}: ${code}`);
  // the same text in every js extension
  for (const ext of ['.mjs', '.js', '.cjs', '.ts', '.mts']) assert.deepEqual(launchKinds(`x${ext}`, "spawn('claude', [])"), ['spawn-claude'], ext);
});

t('R-PL8 guard, js: calls that launch something else, mounts, names and prose are NOT launches', () => {
  const notLaunches = [
    "spawn('docker', ['run', '--mount', 'target=/opt/claude/claude', img])",
    "spawn(bin, args, { env })",
    "spawn(dockerBin, argv, { detached: true })",
    "{ host: o.claudeBin, container: '/opt/claude/claude', readOnly: true },",
    "const name = 'claude';",
    "if (cmd !== 'claude') return;",
    "spawn('claude-code-docs', [])",
    "spawn('claudex', [])",
    "execFile('docker', ['exec', 'claude'])",
    "const MODEL = 'claude-sonnet-5-5';",
    "const s = `the claude -p run`;",
    "console.log('claude is slow')",
    "import { spawn } from 'node:child_process';",
    "const claudeBin = path.join(os.homedir(), '.local', 'share', 'claude', 'versions', v);",
    "respawn('claude', [])",
  ];
  for (const code of notLaunches) assert.deepEqual(launchKinds('x.mjs', code), [], code);
});

t('R-PL8 guard, js: a comment line is never a launch (// , a block comment line, a line starting with *), but code after a comment line still is', () => {
  for (const line of ["// spawn('claude', args)", "   // spawn('claude', args)", "/* spawn('claude', args) */", " * spawn('claude', args)", "// ['/opt/claude/claude', '-p']"]) {
    assert.deepEqual(launchKinds('x.mjs', line), [], line);
  }
  assert.deepEqual(launchKinds('x.mjs', "// not a launch\nspawn('claude', args)"), ['spawn-claude']);
  assert.deepEqual(launchKinds('x.mjs', "const a = 1; // spawn('claude', args)"), ['spawn-claude'], 'a trailing comment is not stripped: a false alarm there is visible and fixed in the file');
});

t('R-PL8 guard, sh: claude in command position is a launch, however it is wrapped', () => {
  const launches = [
    'claude -p "$prompt"',
    '  claude --print foo',
    'timeout 600 claude -p --model m "$x"',
    'timeout -k 5 900 claude -p x',
    'cd "$d" && claude -p x',
    'cd "$d"; claude -p x',
    'echo hi | claude -p',
    'out=$(claude -p x)', // `(` after the `$` is a separator
    'set -e\nclaude -p x', // line start, not string start (the m flag)
    '#!/bin/sh\n# a note\n  timeout 9 claude -p x',
    'out=`claude -p x`',
    'exec claude -p x',
    'nohup claude -p x &',
    'env FOO=1 BAR=2 claude -p x',
    'sudo claude -p x',
    'time claude -p x',
    'xargs claude',
    'bash -c "claude -p x"',
    'claude',
    '(claude -p x)',
  ];
  for (const line of launches) assert.ok(launchKinds('x.sh', line).length > 0, line);
  assert.deepEqual(launchKinds('x.bash', 'claude -p x'), ['claude-in-command-position']);
});

t('R-PL8 guard, sh: comments, model names, the config dir, plugin dirs and arguments are NOT launches', () => {
  const notLaunches = [
    '# claude -p "$prompt"',
    '   # timeout 600 claude -p x',
    'echo claude -p is slow',
    'echo claude',
    'CLAUDE_CONFIG_DIR=x',
    'CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"',
    'mkdir -p "$d/.claude-plugin" "$d/hooks"',
    'cp "$HERE/mods/$name/plugin.json" "$d/.claude-plugin/plugin.json"',
    "printf '2:claude-haiku-4-5-20251001\\n' > \"$dir/.model-probe\"",
    'timeout 900 claude-code -p x',
    'ls ~/.claude/projects',
    'docker build -t s5/plugins -f plugins.Dockerfile .',
    'claudex -p x',
    'my-claude -p x',
  ];
  for (const line of notLaunches) assert.deepEqual(launchKinds('x.sh', line), [], line);
  // KNOWN false alarm, pinned: a quoted string that STARTS `claude -p` is read as a command string (bash -c "claude -p x" is a real launch), so an echo of
  // exactly that needs an UNGUARDED entry or a rewording. A false alarm is visible and cheap; a missed launcher is not.
  assert.deepEqual(launchKinds('x.sh', 'echo "claude -p is slow"'), ['claude-p-command-string']);
});

t('R-PL8 guard, py: an argv list starting with claude, a call whose first argument is claude and a command string are launches', () => {
  const launches = [
    ["cmd = ['claude', '-p', '--model', MODEL]", 'argv-list-starts-claude'],
    ['subprocess.run(["claude", "-p"], check=True)', 'argv-list-starts-claude'],
    ["subprocess.run(['claude'], check=True)", 'argv-list-starts-claude'],
    ["subprocess.run('claude', shell=True)", 'call-first-argument-claude'],
    ['os.execvp("claude", argv)', 'call-first-argument-claude'],
    ["os.system('claude -p x')", 'claude-p-command-string'],
    ["subprocess.run('claude --print x', shell=True)", 'claude-p-command-string'],
  ];
  for (const [code, name] of launches) assert.ok(launchKinds('x.py', code).includes(name), `${name}: ${code}`);
});

t('R-PL8 guard, py: model names, the config dir, headers, prose and comments are NOT launches', () => {
  const notLaunches = [
    "MODEL = 'claude-sonnet-5-5'",
    "cfg = os.environ.get('CLAUDE_CONFIG_DIR', os.path.expanduser('~/.claude'))",
    'sid = headers.get("x-claude-code-session-id")',
    'Needs `claude` on PATH. Each call is capped at 1 USD."""',
    "# cmd = ['claude', '-p']",
    "    # subprocess.run('claude', shell=True)",
    "subprocess.run(['git', 'log'])",
    "x = ['claudex', '-p']",
    "name = 'claude'",
  ];
  for (const code of notLaunches) assert.deepEqual(launchKinds('x.py', code), [], code);
});

t('R-PL8 guard: only the scanned extensions are read, test files and skipped directories are not (isScanned)', () => {
  for (const rel of ['spikes/s4-run.mjs', 'a/b.js', 'a/b.cjs', 'a/b.ts', 'a/b.mts', 'a/b.sh', 'a/b.bash', 'a/b.py', 'bin/effort-policy.mjs', 'spikes/probes/mods/x/register.ts']) {
    assert.equal(isScanned(rel), true, rel);
  }
  for (const rel of [
    'spikes/s4-run.test.mjs',
    'spikes/plan-limit.guard.test.mjs',
    'spikes/s5/tasks/t1/run.sh',
    'spikes/tasks/x.mjs',
    'adapter/claude-code/fixtures/x.mjs',
    'spikes/s5/fixtures/fake-claude.mjs',
    'a/node_modules/pkg/index.js',
    '.git/hooks/pre-commit.sh',
    'README.md',
    'spikes/s4-prereg.json',
    'spikes/s5/images/plugins.Dockerfile',
    'spikes/s5/task-claude.md.tmpl',
  ]) {
    assert.equal(isScanned(rel), false, rel);
  }
  // only the *.test.mjs rule excuses a test: a helper that merely lives next to tests is scanned
  assert.equal(isScanned('spikes/s5/helper.mjs'), true);
  assert.equal(isScanned('spikes/s5/test-helper.mjs'), true);
  // a directory is skipped by its exact name, not by a substring
  assert.equal(isScanned('spikes/my-tasks/x.mjs'), true);
  assert.equal(isScanned('spikes/fixtures-extra/x.mjs'), true);
});

// ---- the import check ----------------------------------------------------------------------------------------------------------------------------

const LAUNCH_JS = "spawn('claude', args);\n";

t('R-PL8 guard: a launcher is guarded when it imports detectPlanLimit or assertNoPlanLimit from a plan-limit.mjs path and calls it', () => {
  const guarded = [
    `import { detectPlanLimit } from './plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit({ stdout });`,
    `import { detectPlanLimit } from "../plan-limit.mjs";\n${LAUNCH_JS}const hit = detectPlanLimit({ stdout });`,
    `import { assertNoPlanLimit } from '../../plan-limit.mjs';\n${LAUNCH_JS}assertNoPlanLimit({ stdout });`,
    `import {\n  VERIFIED_CLI_VERSIONS,\n  detectPlanLimit,\n} from '../plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit ({ stdout });`,
    `import { assertNoPlanLimit, detectPlanLimit } from './plan-limit.mjs'\n${LAUNCH_JS}detectPlanLimit({ stdout });`,
    `import {detectPlanLimit} from 'effort-steering/spikes/plan-limit.mjs';\n${LAUNCH_JS}x = detectPlanLimit({});`,
  ];
  for (const source of guarded) {
    assert.equal(importsDetector('x.mjs', source), true, source);
    assert.deepEqual(check(new Map([['x.mjs', source]]), {}), [], source);
  }
});

t('R-PL8 guard: an import that does not make a launcher guarded (wrong module, wrong names, never called, in a comment or a string, other kinds)', () => {
  const unguarded = [
    ['no import at all', LAUNCH_JS],
    ['another module', `import { detectPlanLimit } from './plan-limit-extra.mjs';\n${LAUNCH_JS}detectPlanLimit({});`],
    ['a module whose name only ends with plan-limit.mjs', `import { detectPlanLimit } from './my-plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit({});`],
    ['a prefix of the path', `import { detectPlanLimit } from './plan-limit.mjs.bak';\n${LAUNCH_JS}detectPlanLimit({});`],
    ['only the version list', `import { VERIFIED_CLI_VERSIONS } from './plan-limit.mjs';\n${LAUNCH_JS}VERIFIED_CLI_VERSIONS.includes(v);`],
    ['a side-effect import', `import './plan-limit.mjs';\n${LAUNCH_JS}`],
    ['imported but never called', `import { detectPlanLimit } from './plan-limit.mjs';\n${LAUNCH_JS}`],
    ['named in a call but not imported by that import', `import { PlanLimitError } from './plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit({});`],
    ['import in a comment', `// import { detectPlanLimit } from './plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit({});`],
    ['import in a block comment line', `/*\n * import { detectPlanLimit } from './plan-limit.mjs';\n */\n${LAUNCH_JS}detectPlanLimit({});`],
    ['imported, but the only call is in a comment', `import { detectPlanLimit } from './plan-limit.mjs';\n${LAUNCH_JS}// detectPlanLimit({ stdout });\n * detectPlanLimit(x)\n`],
    ['import text inside a string', `const s = "import { detectPlanLimit } from './plan-limit.mjs'";\n${LAUNCH_JS}detectPlanLimit({});`],
    ['a dynamic import', `const m = await import('./plan-limit.mjs');\n${LAUNCH_JS}m.detectPlanLimit({});`],
    ['an aliased import (the call is by the alias)', `import { detectPlanLimit as d } from './plan-limit.mjs';\n${LAUNCH_JS}d({});`],
  ];
  for (const [what, source] of unguarded) {
    assert.equal(importsDetector('x.mjs', source), false, what);
    const problems = check(new Map([['x.mjs', source]]), {});
    assert.equal(problems.length, 1, what);
    assert.match(problems[0], /^x\.mjs: launches claude/, what);
  }
  // a shell or python file can never be guarded, whatever it says
  assert.equal(importsDetector('x.sh', "import { detectPlanLimit } from './plan-limit.mjs'\ndetectPlanLimit(x)"), false);
  assert.equal(importsDetector('x.py', "from plan_limit import detectPlanLimit\ndetectPlanLimit(x)"), false);
});

// ---- the rule: guarded XOR listed ---------------------------------------------------------------------------------------------------------------

const GUARDED_JS = `import { detectPlanLimit } from './plan-limit.mjs';\n${LAUNCH_JS}detectPlanLimit({ stdout });\n`;

t('R-PL8 guard SELF-TEST: a synthetic launcher that is neither guarded nor listed FAILS the check, naming the file and what it launches, for every kind', () => {
  const synthetic = {
    'spikes/new-harness.mjs': "import { spawnSync } from 'node:child_process';\nspawnSync('claude', ['-p', prompt]);\n",
    'spikes/new-harness.ts': "spawn('claude', [])",
    'spikes/probes/run-new.sh': '#!/bin/sh\ntimeout 600 claude -p "$1"\n',
    'spikes/dose/new.py': "import subprocess\nsubprocess.run(['claude', '-p', 'x'])\n",
    'adapter/new.mjs': "spawn(claudeBin, ['-p'])",
    'bin/new.mjs': "const argv = ['/opt/claude/claude', '-p'];",
  };
  for (const [rel, source] of Object.entries(synthetic)) {
    const problems = check(new Map([[rel, source]]), {});
    assert.equal(problems.length, 1, rel);
    assert.ok(problems[0].startsWith(`${rel}: launches claude (`), problems[0]);
    assert.match(problems[0], /not listed in UNGUARDED/);
  }
  // all of them at once: one problem per file
  assert.equal(check(new Map(Object.entries(synthetic)), {}).length, Object.keys(synthetic).length);
  // and the same files are accepted once listed (the .mjs/.ts ones could be guarded instead)
  assert.deepEqual(check(new Map(Object.entries(synthetic)), Object.fromEntries(Object.keys(synthetic).map((rel) => [rel, 'a reason']))), []);
  // the REAL tree plus one unguarded launcher fails: the guard on the real files would catch a new harness
  const withNew = new Map(REAL);
  withNew.set('spikes/brand-new-harness.mjs', "spawn('claude', [])");
  const problems = check(withNew, UNGUARDED);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^spikes\/brand-new-harness\.mjs: launches claude/);
});

t('R-PL8 guard: a guarded launcher passes, listed or not-a-launcher files are not asked for anything, and a listed unguarded launcher passes', () => {
  assert.deepEqual(check(new Map([['spikes/a.mjs', GUARDED_JS]]), {}), []);
  assert.deepEqual(check(new Map([['spikes/a.mjs', 'export const x = 1;\n']]), {}), []);
  assert.deepEqual(check(new Map([['spikes/a.sh', 'echo hello\n']]), {}), []);
  assert.deepEqual(check(new Map([['spikes/a.sh', 'timeout 9 claude -p x\n']]), { 'spikes/a.sh': 'R-PL8 reason' }), []);
  assert.deepEqual(check(new Map(), {}), []);
});

t('R-PL8 guard: a stale UNGUARDED entry fails: file missing, file no longer a launcher, file now guarded, file in a skipped place, or no reason', () => {
  // missing (renamed or deleted): the entry would hide whatever takes its place
  let problems = check(new Map(), { 'spikes/gone.sh': 'a reason' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^UNGUARDED\[spikes\/gone\.sh\]: stale entry, not a scanned file/);
  // exists, but no longer launches claude
  problems = check(new Map([['spikes/a.sh', 'echo hello\n']]), { 'spikes/a.sh': 'a reason' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^UNGUARDED\[spikes\/a\.sh\]: stale entry, the file no longer launches claude/);
  // the launcher got wired: the exemption must go
  problems = check(new Map([['spikes/a.mjs', GUARDED_JS]]), { 'spikes/a.mjs': 'a reason' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^spikes\/a\.mjs: listed in UNGUARDED although it imports and calls/);
  // listed, but the path is one the scanner skips (a test file, a fixture): it cannot vouch for it
  problems = check(new Map(), { 'spikes/x.test.mjs': 'a reason', 'spikes/s5/fixtures/f.sh': 'a reason' });
  assert.equal(problems.length, 2);
  // an entry needs a reason: a blank, a missing one, a non-string
  for (const reason of ['', '   ', undefined, null, 5, {}]) {
    problems = check(new Map([['spikes/a.sh', 'timeout 9 claude -p x\n']]), { 'spikes/a.sh': reason });
    assert.equal(problems.length, 1, JSON.stringify(reason));
    assert.match(problems[0], /^UNGUARDED\[spikes\/a\.sh\]: an entry needs a reason/);
  }
});

t('R-PL8 guard: removing any one UNGUARDED entry, or emptying the map, makes the real-tree check fail naming that file', () => {
  for (const rel of Object.keys(UNGUARDED)) {
    const { [rel]: removed, ...rest } = UNGUARDED;
    assert.ok(typeof removed === 'string');
    const problems = check(REAL, rest);
    assert.equal(problems.length, 1, rel);
    assert.ok(problems[0].startsWith(`${rel}: launches claude`), problems[0]);
  }
  assert.equal(check(REAL, {}).length, Object.keys(UNGUARDED).length);
  // and an extra, invented entry fails as stale
  const problems = check(REAL, { ...UNGUARDED, 'spikes/probes/run-invented.sh': 'a reason' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^UNGUARDED\[spikes\/probes\/run-invented\.sh\]: stale entry/);
});
