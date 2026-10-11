// plan-limit.guard.test.mjs — the structural guard for R-PL8 and amendment A4: every file under effort-steering/ that launches `claude` imports the plan-limit
// detector, or is listed in UNGUARDED on purpose. Without it a NEW harness that runs `claude -p` and grades what comes back would be wired to nothing, and a
// spent subscription's refusal (`You've hit your limit · resets 3pm`) would be graded as a model failure, which is the defect plan-limit.mjs exists to stop.
//
// WHAT THE SCANNER DOES. It walks effort-steering/ (a superset of A4's spikes/, adapter/ and bin/; core/ and the root are walked too), skipping directories
// named node_modules, tasks, fixtures and .git, and every *.test.mjs. It reads files by extension: .mjs .js .cjs .jsx .ts .tsx .mts .cts (kind js), .sh .bash
// .zsh (kind sh), .py (kind py), and extensionless files under a bin/ directory by their shebang (node/bun/deno/tsx: js, python: py, anything else: sh). A line whose first non-blank characters are a comment marker (// * /* for js; # for sh and py) is dropped before anything is matched, so
// prose about `claude -p` is never a launch. A file is a LAUNCHER when one of its kind's LAUNCH patterns matches (the patterns are below, each with samples
// that it matches and samples that it must not).
//
// WHAT THE REGEXES KEY ON (the decision A4 asked for, made with evidence from a real grep of effort-steering/). A js file launches claude when it passes the
// claude BINARY NAME to a child-process call (`spawn('claude', …)`, which s4-run.mjs does through its injected `spawn`), or a variable named like it, or
// writes the container command line `'/opt/claude/claude', '-p'` (s5/run.mjs does: it hands the array to `docker run`), or holds a command string that
// starts `claude -p`. s5/docker.mjs also spawns, but its first argument is `bin` / `dockerBin`: it launches DOCKER, never claude, so no pattern matches it
// (pinned below with the real file). M1 (final review): the call patterns miss a launcher that keeps the binary and the flag apart, so a js or py file is ALSO a
// launcher when it holds the binary as a string literal (exactly `claude`, a path ending /claude or /claude/versions/<v>, or @anthropic-ai/claude-code) and a
// literal with the print flag as a word (`-p`, `--print`, `${bin} -p`): an argv array indexed or destructured, a bin in a variable, an absolute path, execa,
// Bun.spawn, npx. The call patterns stay (they also see `spawn('claude', buildArgs())`, where the flag is nowhere in the file); the cost is the pinned false
// alarms below. A sh file launches claude when the command token (`claude`, a path ending /claude, either quoted, @anthropic-ai/claude-code, or a variable
// named like it: "$CLAUDE", ${CLAUDE_BIN:-claude}) stands in command position: at line start, after ; & | ( { ! or a backtick, after if/then/do/else/elif/while/until,
// or after a wrapper (exec nohup sudo time xargs stdbuf nice timeout env npx, and `command` unless it is `command -v`) with its option, number and VAR=x arguments.
// A py file launches it when an argv list starts with 'claude', a call's first argument is 'claude' (or a path to it), a string starts `claude -p`, or the
// literal rule above holds.
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
const KIND_OF = {
  '.mjs': 'js', '.js': 'js', '.cjs': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mts': 'js', '.cts': 'js', '.sh': 'sh', '.bash': 'sh', '.zsh': 'sh', '.py': 'py',
};
const COMMENT_PREFIXES = { js: ['//', '*', '/*'], sh: ['#'], py: ['#'] };

// rel: a posix path relative to effort-steering/.
const extKind = (rel) => KIND_OF[path.posix.extname(rel)] ?? null;
// An extensionless file is a script (bin/run-claude): scanned when it lies under a bin/ directory, and read by its shebang (node/bun/deno/tsx: js; python: py;
// anything else, or none: sh).
const isExtensionlessScript = (rel) => {
  const parts = rel.split('/');
  return !parts.at(-1).includes('.') && parts.slice(0, -1).includes('bin');
};
const kindOf = (rel, source = '') => {
  const byExt = extKind(rel);
  if (byExt !== null) return byExt;
  if (!isExtensionlessScript(rel)) return null;
  const shebang = source.split('\n', 1)[0];
  if (/^#!.*\b(?:node|bun|deno|tsx)\b/.test(shebang)) return 'js';
  if (/^#!.*\bpython/.test(shebang)) return 'py';
  return 'sh';
};
const isScanned = (rel) => {
  const parts = rel.split('/');
  if (parts.slice(0, -1).some((dir) => SKIP_DIRS.has(dir))) return false;
  if (parts.at(-1).endsWith('.test.mjs')) return false;
  return extKind(rel) !== null || isExtensionlessScript(rel);
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

// M1 (review 3). js and py: a file holds the claude binary as a string literal (exactly `claude`, a path ending /claude or /claude/versions/<v>, or the npx
// package @anthropic-ai/claude-code) AND the print flag as a word of a string literal (`-p`, `--print`, or inside `${bin} -p`). Comments are dropped first; a
// literal is read on one line. Evidence from the real tree: this alone flags exactly s4-run.mjs, s5/run.mjs and dose/run-calibration.py.
const STRING_LITERAL = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
const CLAUDE_LITERAL = /^(?:\S*\/)?claude$|^@anthropic-ai\/claude-code$|\/claude\/versions\/[\w.-]+$/;
const PRINT_FLAG_LITERAL = /(?:^|\s)(?:-p|--print)(?:\s|$)/;
const hasClaudeAndPrintFlagLiterals = (code) => {
  const values = [...code.matchAll(STRING_LITERAL)].map((match) => match[2]);
  return values.some((value) => CLAUDE_LITERAL.test(value)) && values.some((value) => PRINT_FLAG_LITERAL.test(value));
};

// sh: claude in command position. The command token is `claude`, a path ending /claude, either quoted, the npx package, or a variable named like it
// ("$CLAUDE", ${CLAUDE_BIN:-claude}). It is in command position at line start, after ; & | ( { ! or a backtick, after if/then/do/else/elif/while/until, or after
// a wrapper (exec nohup sudo time xargs stdbuf nice timeout env npx; `command` unless `command -v`) with its option, number and VAR=x arguments.
const SH_CLAUDE = String.raw`(?:["']?(?:[^\s"'\x60;&|()]*\/)?claude["']?|["']?@anthropic-ai\/claude-code["']?|["']?\$\{?(?:CLAUDE|claude)(?:_(?:BIN|CMD|CLI|PATH|EXE|bin|cmd|cli|path|exe))?(?::?-[^}"'\s]*)?\}?["']?)`;
const SH_WRAPPER_ARGS = String.raw`(?:[ \t]+(?:-\S+|\d+\S*|[A-Za-z_]\w*=\S*)){0,6}`;
const SH_PREFIX = String.raw`(?:^[ \t]*|[;&|({!][ \t]*|\x60[ \t]*|\b(?:if|then|do|else|elif|while|until)[ \t]+|\b(?:exec|nohup|sudo|time|xargs|stdbuf|nice|timeout|env|npx)${SH_WRAPPER_ARGS}[ \t]+|\bcommand(?![ \t]+-[vV])${SH_WRAPPER_ARGS}[ \t]+)`;
const SH_COMMAND_POSITION = new RegExp(`${SH_PREFIX}${SH_CLAUDE}(?=[ \\t;&|)]|$)`, 'm');


// The LAUNCH patterns, per kind. `name` is what a failure message and the real-file pins use.
const LAUNCH = {
  js: [
    // spawn('claude', …), execFileSync("claude", …), exec(`claude`), spawn('/home/u/.local/bin/claude', …) …: the binary is the call's first argument.
    { name: 'spawn-claude', re: /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork)\s*\(\s*(['"`])(?:[^'"`]*\/)?claude\1/ },
    // spawn(claudeBin, …), spawnSync(opts.claudeCmd, …): a variable named like the binary is the first argument.
    { name: 'spawn-claude-variable', re: /\b(?:spawn|spawnSync|execFile|execFileSync|fork)\s*\(\s*[\w$.]*claude[\w$.]*\s*[,)]/i },
    // ['/opt/claude/claude', '-p', …]: the command line S5 hands to `docker run`.
    { name: 'container-claude-p', re: /(['"`])\/opt\/claude\/claude\1\s*,\s*(['"`])-p\2/ },
    // 'claude -p …', '/opt/claude/claude --print …': a command string (exec, sh -c).
    { name: 'claude-p-command-string', re: /(['"`])(?:[^'"`\s]*\/)?claude\s+(?:-p|--print)\b/ },
    // M1 (review 3): the binary and the print flag as separate string literals, however the call is spelled (a bin in a variable, an argv array indexed or
    // destructured, execa, Bun.spawn, npx, an absolute path).
    { name: 'claude-literal-with-print-flag', test: hasClaudeAndPrintFlagLiterals },
  ],
  sh: [
    { name: 'claude-in-command-position', re: SH_COMMAND_POSITION },
    { name: 'claude-p-command-string', re: /(['"])(?:[^'"\s]*\/)?claude[ \t]+(?:-p|--print)\b/ },
  ],
  py: [
    { name: 'argv-list-starts-claude', re: /\[\s*(['"])claude\1\s*[,\]]/ },
    { name: 'call-first-argument-claude', re: /\(\s*f?(['"])(?:[^'"]*\/)?claude\1/ },
    { name: 'claude-p-command-string', re: /(['"])(?:[^'"\s]*\/)?claude\s+(?:-p|--print)\b/ },
    { name: 'claude-literal-with-print-flag', test: hasClaudeAndPrintFlagLiterals },
  ],
};

// -> the names of the LAUNCH patterns that match the file (empty: not a launcher).
function launchKinds(rel, source) {
  const kind = kindOf(rel, source);
  if (kind === null) return [];
  const code = stripComments(source, kind);
  return LAUNCH[kind].filter((pattern) => (pattern.re ? pattern.re.test(code) : pattern.test(code))).map(({ name }) => name);
}

const DETECTOR_NAMES = ['detectPlanLimit', 'assertNoPlanLimit'];
// A static import at the start of a line from a path whose basename is plan-limit.mjs, bringing in a detector function that the file then calls.
const IMPORT_RE = /^[ \t]*import\b([^;'"]*?)\bfrom\s*(['"])(?:[^'"\n]*\/)?plan-limit\.mjs\2/gm;
function importsDetector(rel, source) {
  if (kindOf(rel, source) !== 'js') return false;
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
    assert.ok(isScanned(rel), `${rel}: is a scanned file`);
  }
  // the skipped places exist on disk, so the absence above is the rule's doing and not an empty directory
  assert.ok(readdirSync(path.join(ES, 'spikes', 's5')).includes('fixtures'), 'spikes/s5/fixtures exists');
  assert.ok(readdirSync(path.join(ES, 'spikes', 's5', 'fixtures')).includes('fake-claude.mjs'), 'and holds the fake claude');
  assert.ok(!REAL.has('spikes/s5/fixtures/fake-claude.mjs'));
});

t('R-PL8 guard: the two real launchers are launchers, each by the pattern that fits it, and both are guarded', () => {
  assert.deepEqual(launchKinds('spikes/s4-run.mjs', REAL.get('spikes/s4-run.mjs')), ['spawn-claude', 'claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('spikes/s5/run.mjs', REAL.get('spikes/s5/run.mjs')).sort(), ['claude-literal-with-print-flag', 'container-claude-p']);
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
    'spikes/probes/run-probe1.sh': ['claude-in-command-position'],
    'spikes/probes/run-probe2.sh': ['claude-in-command-position'],
    'spikes/probes/run-probe3.sh': ['claude-in-command-position'],
    'spikes/probes/run-i1.sh': ['claude-in-command-position'],
    'spikes/probes/run-i1b.sh': ['claude-in-command-position'],
    'spikes/probes/run-i2.sh': ['claude-in-command-position'],
    'spikes/probes/run-boundary.sh': ['claude-in-command-position'],
    'spikes/dose/run-calibration.py': ['argv-list-starts-claude', 'claude-literal-with-print-flag'],
  };
  assert.deepEqual(Object.keys(expected).sort(), Object.keys(UNGUARDED).sort(), 'the table and UNGUARDED name the same files');
  for (const [rel, names] of Object.entries(expected)) assert.deepEqual(launchKinds(rel, REAL.get(rel)), names, rel);
  for (const [rel, reason] of Object.entries(UNGUARDED)) {
    assert.ok(!rel.startsWith('/') && !rel.includes('\\') && !rel.startsWith('effort-steering/'), `${rel}: a posix path relative to effort-steering/`);
    assert.ok(reason.includes('R-PL8') && reason.length > 40, `${rel}: carries the ruling and a reason`);
  }
});

t('R-PL8 guard: on the real tree the launchers are exactly these 10 files: no other file is flagged (M1: the token rule has no false positive here)', () => {
  const found = [...REAL].filter(([rel, source]) => launchKinds(rel, source).length > 0).map(([rel]) => rel).sort();
  assert.deepEqual(found, [
    'spikes/dose/run-calibration.py',
    'spikes/probes/run-boundary.sh',
    'spikes/probes/run-i1.sh',
    'spikes/probes/run-i1b.sh',
    'spikes/probes/run-i2.sh',
    'spikes/probes/run-probe1.sh',
    'spikes/probes/run-probe2.sh',
    'spikes/probes/run-probe3.sh',
    'spikes/s4-run.mjs',
    'spikes/s5/run.mjs',
  ]);
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
    "exec('claude --printer x')", // the flag must end at a boundary (-p, --print), not be a prefix of a longer word
    "exec('claude -pfoo x')",
    "execFileSync('mkdir', ['--parents', path.join(dir, 'claude')])", // a claude path literal but no print flag
    "const bin = 'claude'; spawn(bin, ['--version']);",
    "execSync('which claude')",
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
  for (const rel of ['spikes/s4-run.mjs', 'a/b.js', 'a/b.cjs', 'a/b.jsx', 'a/b.ts', 'a/b.tsx', 'a/b.mts', 'a/b.cts', 'a/b.sh', 'a/b.bash', 'a/b.zsh', 'a/b.py', 'bin/effort-policy.mjs', 'spikes/probes/mods/x/register.ts']) {
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
  // M1: an extensionless file is a script when it lies under a bin/ directory (at any depth); elsewhere it is not read, and a dotted name is not extensionless
  for (const rel of ['bin/run-claude', 'spikes/bin/run-claude', 'bin/sub/launch']) assert.equal(isScanned(rel), true, rel);
  for (const rel of ['spikes/probes/run-claude', 'run-claude', 'bin/.hidden', 'bin/notes.txt', 'bin/data.json', 'tasks/bin/run-claude', 'bin/fixtures/run-claude']) assert.equal(isScanned(rel), false, rel);
});

t('R-PL8 guard (M1): an extensionless script is read by its shebang: node/bun/deno/tsx as js, python as py, anything else or none as sh', () => {
  assert.equal(kindOf('bin/x', '#!/usr/bin/env node\nspawn(1)'), 'js');
  assert.equal(kindOf('bin/x', '#!/usr/bin/env bun\n'), 'js');
  assert.equal(kindOf('bin/x', '#!/usr/bin/env -S deno run\n'), 'js');
  assert.equal(kindOf('bin/x', '#!/usr/bin/env tsx\n'), 'js');
  assert.equal(kindOf('bin/x', '#!/usr/bin/env python3\n'), 'py');
  assert.equal(kindOf('bin/x', '#!/bin/sh\n'), 'sh');
  assert.equal(kindOf('bin/x', '#!/bin/bash\n'), 'sh');
  assert.equal(kindOf('bin/x', 'claude -p x\n'), 'sh');
  assert.equal(kindOf('bin/x'), 'sh');
  // an extension wins over the shebang, and a file outside bin/ with no extension has no kind
  assert.equal(kindOf('bin/x.py', '#!/bin/sh\n'), 'py');
  assert.equal(kindOf('spikes/x', '#!/bin/sh\n'), null);
  for (const [ext, kind] of [['.jsx', 'js'], ['.tsx', 'js'], ['.cts', 'js'], ['.zsh', 'sh']]) assert.equal(kindOf(`a/b${ext}`), kind, ext);
});

// ---- M1 (review 3): realistic launcher forms the first version of the guard stayed green on -------------------------------------------------------

// Each form is [path, source]: a launcher the guard MUST see. The js ones also carry a guarded twin below. Forms 1-14 and the shell forms come from the
// review's guard-defeat table (each was run through the first guard and passed it).
const DEFEAT_JS = [
  ['spikes/s6/run.mjs', "const cmd = ['claude', '-p', '--output-format', 'json'];\nspawnSync(cmd[0], cmd.slice(1));"],
  ['spikes/s6/destructured.mjs', "const [bin, ...args] = ['claude', '-p'];\nspawn(bin, args);"],
  ['spikes/s6/neutral-var.mjs', "const bin = 'claude';\nspawn(bin, ['-p', prompt]);"],
  ['spikes/s6/cfg.mjs', "const cfg = { cli: 'claude' };\nspawn(cfg.cli, ['-p', prompt]);"],
  ['spikes/s6/template.mjs', "const bin = 'claude';\nexecSync(`${bin} -p ${q}`);"],
  ['spikes/s6/env-fallback.mjs', "spawn(process.env.CLAUDE_BIN ?? 'claude', ['-p', x]);"],
  ['spikes/s6/abs-path.mjs', "spawn('/home/u/.local/bin/claude', ['-p', x]);"],
  ['spikes/s6/versions-path.mjs', "spawn(path.join(os.homedir(), '.local/share/claude/versions/2.1.292'), ['-p']);"],
  ['spikes/s6/container-print.mjs', "const argv = ['/opt/claude/claude', '--print', '--model', m];"],
  ['spikes/s6/container-flag-first.mjs', "const argv = ['/opt/claude/claude', '--model', m, '-p'];"],
  ['spikes/s6/sh-c.mjs', "spawn('sh', ['-c', '/opt/claude/claude -p x']);"],
  ['spikes/s6/npx.mjs', "spawn('npx', ['@anthropic-ai/claude-code', '-p', x]);"],
  ['spikes/s6/execa.mjs', "await execa('claude', ['-p', x]);"],
  ['spikes/s6/bun.mjs', "Bun.spawn(['claude', '-p', x]);"],
  ['spikes/s6/abs-no-flag.mjs', "spawn('/usr/local/bin/claude', args);"],
  ['spikes/s6/a.jsx', "spawn('claude', ['-p']);"],
  ['spikes/s6/a.tsx', "spawn(bin, ['-p']); const bin = 'claude';"],
  ['spikes/s6/a.cts', "spawn('claude', ['-p']);"],
  ['bin/run-claude', "#!/usr/bin/env node\nspawn('claude', ['-p', x]);"],
  ['adapter/new-launch.mjs', "const bin = 'claude'; spawnSync(bin, ['--print', x]);"],
];
const DEFEAT_SH = [
  ['spikes/probes/else.sh', 'if x; then echo a; else claude -p x; fi'],
  ['spikes/probes/elif.sh', 'if a; then b; elif claude -p x; then c; fi'],
  ['spikes/probes/until.sh', 'until claude -p x; do sleep 1; done'],
  ['spikes/probes/bare-semicolon.sh', 'claude; echo done'],
  ['spikes/probes/bare-brace.sh', '{ claude; }'],
  ['spikes/probes/bare-paren.sh', 'x=$(claude)'],
  ['spikes/probes/bare-amp.sh', 'claude&'],
  ['spikes/probes/bare-pipe.sh', 'claude|tee out'],
  ['spikes/probes/sh-c-abs.sh', 'sh -c "/usr/local/bin/claude -p x"'],
  ['spikes/probes/if.sh', 'if claude -p "$x"; then echo ok; fi'],
  ['spikes/probes/then.sh', 'if true\nthen claude -p "$x"\nfi'],
  ['spikes/probes/for-do.sh', 'for p in a b; do claude -p "$p"; done'],
  ['spikes/probes/while.sh', 'while claude -p x; do :; done'],
  ['spikes/probes/bang.sh', '! claude -p x'],
  ['spikes/probes/brace.sh', '{ claude -p x; }'],
  ['spikes/probes/abs-path.sh', '/usr/local/bin/claude -p x'],
  ['spikes/probes/home-path.sh', '"$HOME/.local/bin/claude" -p x'],
  ['spikes/probes/var.sh', '"$CLAUDE" -p x'],
  ['spikes/probes/var-default.sh', '${CLAUDE_BIN:-claude} -p x'],
  ['spikes/probes/var-bare.sh', '$CLAUDE_BIN --print x'],
  ['spikes/probes/quoted.sh', '"claude" -p x'],
  ['spikes/probes/stdbuf.sh', 'stdbuf -oL claude -p x'],
  ['spikes/probes/nice.sh', 'nice -n 5 claude -p x'],
  ['spikes/probes/npx.sh', 'npx -y @anthropic-ai/claude-code -p x'],
  ['spikes/probes/print.sh', 'timeout 900 claude --print x'],
  ['spikes/probes/command.sh', 'command claude -p x'],
  ['spikes/probes/env.sh', 'env A=1 "$CLAUDE" -p x'],
  ['spikes/probes/a.zsh', 'claude -p x'],
  ['bin/run-claude', '#!/bin/sh\nclaude -p "$1"'],
  ['bin/run-claude-nobang', 'exec claude -p "$1"'],
  ['bin/new.sh', 'cd /x && claude -p y'],
];
const DEFEAT_PY = [
  ['spikes/dose/var.py', "CLAUDE = 'claude'\nsubprocess.run([CLAUDE, '-p', x])"],
  ['spikes/dose/abs.py', "subprocess.run(['/usr/local/bin/claude', '-p', x])"],
  ['spikes/dose/print.py', "cmd = ['claude', '--print', x]"],
  ['spikes/dose/os-system-abs.py', "os.system('/usr/local/bin/claude -p x')"],
  ['spikes/dose/run-abs.py', "subprocess.run('/usr/local/bin/claude', shell=True)"],
  ['bin/run-claude', "#!/usr/bin/env python3\nimport subprocess\nsubprocess.run(['claude', '-p'])"],
];
const GUARD_PREFIX = "import { detectPlanLimit } from './plan-limit.mjs';\n";
const GUARD_SUFFIX = '\ndetectPlanLimit({ stdout });\n';

t('R-PL8 guard SELF-TEST (M1): every realistic launcher form from the review is seen as a launcher and FAILS the check unless guarded or listed', () => {
  for (const [rel, source] of [...DEFEAT_JS, ...DEFEAT_SH, ...DEFEAT_PY]) {
    assert.ok(launchKinds(rel, source).length > 0, `${rel}: seen as a launcher: ${source}`);
    const problems = check(new Map([[rel, source]]), {});
    assert.equal(problems.length, 1, `${rel}: ${source}`);
    assert.ok(problems[0].startsWith(`${rel}: launches claude (`), problems[0]);
    assert.deepEqual(check(new Map([[rel, source]]), { [rel]: 'a reason' }), [], `${rel}: accepted once listed`);
  }
  // a js form is accepted once it imports and calls the detector (an extensionless node script included); a form in another kind never is
  for (const [rel, source] of DEFEAT_JS) {
    const guarded = rel === 'bin/run-claude' ? source.replace('\n', `\n${GUARD_PREFIX}`) + GUARD_SUFFIX : GUARD_PREFIX + source + GUARD_SUFFIX;
    assert.deepEqual(check(new Map([[rel, guarded]]), {}), [], `${rel}: guarded`);
  }
  // the same, all at once on top of the real tree: one problem per new file (the real tree stays clean)
  const many = new Map(REAL);
  const forms = new Map([...DEFEAT_JS, ...DEFEAT_SH, ...DEFEAT_PY].filter(([rel]) => !REAL.has(rel)));
  for (const [rel, source] of forms) many.set(rel, source);
  assert.equal(check(many, UNGUARDED).length, forms.size);
});

t('R-PL8 guard (M1): each defeat form is found by the rule meant for it (not by a lucky other one)', () => {
  const has = (rel, source, name) => assert.ok(launchKinds(rel, source).includes(name), `${name}: ${source}`);
  has('x.mjs', "const cmd = ['claude', '-p']; spawnSync(cmd[0], cmd.slice(1));", 'claude-literal-with-print-flag');
  assert.deepEqual(launchKinds('x.mjs', "const cmd = ['claude', '-p']; spawnSync(cmd[0], cmd.slice(1));"), ['claude-literal-with-print-flag'], 'the call patterns do not see this one');
  assert.deepEqual(launchKinds('x.mjs', "execSync(`${bin} -p ${q}`); const bin = 'claude';"), ['claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('x.mjs', "spawn('sh', ['-c', '/opt/claude/claude -p x']);"), ['claude-p-command-string']);
  assert.deepEqual(launchKinds('x.py', "CLAUDE = 'claude'\nsubprocess.run([CLAUDE, '-p', x])"), ['claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('x.sh', '"$CLAUDE" -p x'), ['claude-in-command-position']);
});

t('R-PL8 guard (M1): the literal rule needs BOTH halves: the binary alone, or a print flag alone, is no launch', () => {
  const only = [
    "const bin = 'claude'; log(bin);",
    "const p = ['-p', x]; run(p);",
    "const p = ['--print', x]; run(p);",
    "const name = '/usr/local/bin/claude'; const flags = ['--model', m];",
    "const a = 'claude-code'; const b = ['-p'];", // the package name needs its scope
    "const a = 'claude.md'; const b = ['-p'];",
    "const a = 'myclaude'; const b = ['-p'];",
    "const a = 'claude'; const b = ['-pp', '-print', 'p'];",
    "const a = 'claude'; const b = ['--model-p', 'x'];", // the flag is a word of its own, not the end of another one
    'const a = `claude`; const b = `--model`;',
  ];
  for (const code of only) assert.deepEqual(launchKinds('x.mjs', code), [], code);
  // both halves in a comment are no launch, and the print flag can be a word inside a longer literal
  assert.deepEqual(launchKinds('x.mjs', "// const bin = 'claude'; const f = '-p';"), []);
  assert.deepEqual(launchKinds('x.mjs', "const bin = 'claude'; const f = 'x -p y';"), ['claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('x.mjs', 'const bin = "claude"; const f = "--print";'), ['claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('x.mjs', 'const bin = `claude`; const f = `-p`;'), ['claude-literal-with-print-flag']);
  assert.deepEqual(launchKinds('x.py', "b = 'claude'\nf = '-p'"), ['claude-literal-with-print-flag']);
});

t('R-PL8 guard (M1): shell innocents stay innocent under the widened wrapper list', () => {
  const notLaunches = [
    'command -v claude',
    'command -V claude >/dev/null',
    'which claude',
    'type claude',
    'claude_call() {',
    'echo "$CLAUDE_CONFIG_DIR"',
    '"$CLAUDE_CONFIG_DIR/projects" ',
    'cp x /opt/claude/claude.bak',
    'sudo cp a /opt/claude/claude',
    'ln -s a /usr/local/bin/claude',
    'cd ~/work/claude',
    'todo claude -p x',
    'doc claude -p x',
    'exec_claude -p x',
    'git log --grep claude',
    'timeout 900 claude-code -p x',
    'npx some-other-tool -p x',
    'nice -n 5 make',
    '"$CLAUDE_CONFIG_DIR" x',
    'bash -c "claude --printer x"',
    'bash -c "claude -pfoo x"',
    'if a; then b; else c; fi',
    'until true; do :; done',
  ];
  for (const line of notLaunches) assert.deepEqual(launchKinds('x.sh', line), [], line);
});

t('R-PL8 guard: KNOWN false alarms, pinned (visible and cheap: an UNGUARDED entry or a rewording fixes each; a missed launcher is neither)', () => {
  // the call patterns do not require the print flag, so a probe of the binary is a launch
  assert.deepEqual(launchKinds('x.mjs', "execFileSync('claude', ['--version'])"), ['spawn-claude']);
  assert.deepEqual(launchKinds('x.sh', 'claude --version'), ['claude-in-command-position']);
  assert.deepEqual(launchKinds('x.py', "shutil.which('claude')"), ['call-first-argument-claude']);
  // a quoted string that starts `claude -p` is a command string (bash -c "claude -p x" is real), so an echo of it matches
  assert.deepEqual(launchKinds('x.sh', 'echo "claude -p is slow"'), ['claude-p-command-string']);
  // the literal rule cannot tell mkdir -p from claude -p when the file also names a claude path
  assert.deepEqual(launchKinds('x.mjs', "execFileSync('mkdir', ['-p', path.join(dir, 'claude')])"), ['claude-literal-with-print-flag']);
  // a block-comment line that does not start with * is code to the scanner
  assert.deepEqual(launchKinds('x.mjs', "/* \n   spawn('claude', args)\n*/"), ['spawn-claude']);
  // a docstring line that looks like an argv list
  assert.deepEqual(launchKinds('x.py', "\"\"\"\n['claude', '-p']\n\"\"\""), ['argv-list-starts-claude', 'claude-literal-with-print-flag']);
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
