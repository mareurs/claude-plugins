// TUI parts (statusline, buddy, shared lib/tui.mjs) — unit tests.
// Run: node harnesses/opencode/tests/test-tui.mjs
//
// The host rendering (slots, @opentui/solid) only exists inside OpenCode and was verified
// live (README §Verified vs asserted). This pins everything that does not need the host:
// ANSI translation, the statusline layout, buddy's real statusline.py round trip, and the
// one structural rule a TUI entry file must keep (no static import leaving its directory).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ansiToParts, currentSessionID, dialogBodyHeight, markdownDialog, markdownStyles, rootOf, stripAnsi, textNode } from '../lib/tui.mjs';
import SL, { fmtDuration, fmtK, parseShortstat, readGit, segments } from '../tui/statusline/tui.js';
import BT, { FRESH_MS, REPORT, REPORT_COMMANDS, STATUSLINE, buddySidebar, inputsKey, renderBuddy, reportLayer, runReport, statuslineInput, toLines } from '../tui/buddy/tui.js';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import HE from '../tui/hint-echo/tui.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const ok = async (name, fn) => {
  try {
    await fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`  FAIL: ${name}\n        ${String(e?.message || e).split('\n').join('\n        ')}`);
  }
};

await ok('every TUI entry exports {id, setup} (the TUI loader shape, measured)', () => {
  for (const m of [SL, BT, HE]) {
    assert.equal(typeof m.id, 'string');
    assert.equal(typeof m.setup, 'function');
  }
  assert.equal(new Set([SL.id, BT.id, HE.id]).size, 3, 'ids must be distinct');
});

await ok('no tui.js has a static import that leaves its own directory', () => {
  // install.sh links tui/<p>/ as a directory symlink; one host load stage resolves static
  // imports against the SYMLINK path, where ../../lib does not exist (measured: "Cannot
  // find module" on every reconciliation). Dynamic imports through realpath are fine.
  const tuiDir = join(HERE, '..', 'tui');
  for (const p of readdirSync(tuiDir)) {
    const src = readFileSync(join(tuiDir, p, 'tui.js'), 'utf8');
    const bad = src.match(/^\s*import\s[^;]*?from\s+['"]\.\.?\//m);
    assert.equal(bad, null, `tui/${p}/tui.js: ${bad?.[0]}`);
  }
});

await ok('ansiToParts: basic, bright, 256 and truecolor foregrounds; reset', () => {
  assert.deepEqual(ansiToParts('\x1b[31mred\x1b[0m plain'), [{ text: 'red', fg: '#cd3131' }, { text: ' plain' }]);
  assert.deepEqual(ansiToParts('\x1b[92mok'), [{ text: 'ok', fg: '#23d18b' }]);
  assert.deepEqual(ansiToParts('\x1b[38;5;196mx'), [{ text: 'x', fg: '#ff0000' }]);
  assert.deepEqual(ansiToParts('\x1b[38;2;1;2;3mx'), [{ text: 'x', fg: '#010203' }]);
  assert.deepEqual(ansiToParts('\x1b[1;34mb\x1b[22mn'), [{ text: 'b', fg: '#2472c8', bold: true }, { text: 'n', fg: '#2472c8' }]);
});

await ok('ansiToParts drops non-SGR escapes and background colours instead of printing them', () => {
  assert.equal(stripAnsi('a\x1b[2Kb\x1b]0;title\x07c'), 'abc');
  assert.deepEqual(ansiToParts('\x1b[48;5;21;33mx'), [{ text: 'x', fg: '#e5e510' }]);
  assert.deepEqual(ansiToParts('\x1b[48;5;34mx'), [{ text: 'x' }], 'a 256-colour background index is not read as a foreground code');
  assert.deepEqual(ansiToParts('\x1b[48;2;1;31;1mx'), [{ text: 'x' }], 'truecolor background components are not read as codes');
});

await ok('ansiToParts drops private and intermediate CSI sequences whole, and ignores 256-colour codes above 255', () => {
  // Measured before the fix: '?25lhi0 q' (the parameters printed) and fg '#2b02b02b0'.
  assert.deepEqual(ansiToParts('\x1b[?25lhi\x1b[0 q'), [{ text: 'hi' }]);
  assert.deepEqual(ansiToParts('\x1b[38;5;300mx'), [{ text: 'x' }]);
  assert.deepEqual(ansiToParts('\x1b[31m\x1b[38;5;300mx'), [{ text: 'x', fg: '#cd3131' }], 'an invalid code keeps the colour in force');
  assert.deepEqual(ansiToParts('\x1b[38;5;255mx'), [{ text: 'x', fg: '#eeeeee' }], '255 is still a colour');
});

await ok('currentSessionID: slot prop, then the router, else none', () => {
  const api = { ui: { router: { current: () => ({ type: 'session', sessionID: 'routed' }) } } };
  assert.equal(currentSessionID(api, { sessionID: 'prop' }), 'prop');
  assert.equal(currentSessionID(api, {}), 'routed');
  assert.equal(currentSessionID({ ui: { router: { current: () => ({ type: 'home' }) } } }), undefined);
  assert.equal(rootOf({ data: { session: { root: () => 'r' } } }, 'child'), 'r');
  assert.equal(rootOf({}, 'solo'), 'solo');
});

await ok('statusline formatters', () => {
  assert.equal(fmtK(999), '999');
  assert.equal(fmtK(1500), '1.5k');
  assert.equal(fmtK(24000), '24k');
  assert.equal(fmtDuration(42_000), '42s');
  assert.equal(fmtDuration(5 * 60_000), '5m');
  assert.equal(fmtDuration(65 * 60_000), '1h05m');
  assert.deepEqual(parseShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)'), { add: 10, del: 2 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)'), { add: 1, del: 0 });
});

await ok('statusline segments: the fields and their order (session record shape measured on 2.1.3)', () => {
  const now = 1_000_000;
  const session = {
    agent: 'build',
    model: { id: 'main', providerID: 'litellm', variant: 'high' },
    cost: 0.1234,
    tokens: { input: 23360, output: 3, reasoning: 13, cache: { read: 19000, write: 1200 } },
    time: { created: now - 34_000 },
  };
  const text = segments(session, { branch: 'main', worktree: '', add: 5, del: 1 }, now).map((p) => p.text).join('');
  assert.equal(text, 'main · high │ build │ main │ +5 -1 │ cache 1.2kw/19kr │ $0.12 │ 34s');
});

await ok('statusline segments: default variant, zero cost and no git are left out', () => {
  const s = { agent: 'plan', model: { id: 'm', variant: 'default' }, cost: 0, tokens: { cache: { read: 0, write: 0 } }, time: {} };
  assert.equal(segments(s, {}).map((p) => p.text).join(''), 'm │ plan');
  assert.deepEqual(segments(undefined), []);
  const wt = segments({ model: { id: 'm' } }, { branch: 'feat', worktree: 'wt1' }).map((p) => p.text).join('');
  assert.equal(wt, 'm │ wt1:feat');
});

const haveGit = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
if (haveGit) {
  await ok('statusline readGit: a linked worktree is named, a main checkout under a "worktrees" dir is not', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sl-git-'));
    try {
      const main = join(root, 'worktrees', 'proj');
      mkdirSync(join(main, 'src'), { recursive: true });
      const g = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, encoding: 'utf8' });
      g(main, 'init', '-q', '-b', 'main');
      writeFileSync(join(main, 'src', 'a.txt'), 'a\n');
      g(main, 'add', '.');
      g(main, 'commit', '-q', '-m', 'init');
      const inMain = await readGit(join(main, 'src'));
      assert.equal(inMain.branch, 'main');
      assert.equal(inMain.worktree, '', 'a main checkout whose path contains /worktrees/ is not a linked worktree');
      const linked = join(root, 'wt1');
      g(main, 'worktree', 'add', '-q', '-b', 'feat', linked);
      const inLinked = await readGit(linked);
      assert.equal(inLinked.branch, 'feat');
      assert.equal(inLinked.worktree, 'wt1');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
} else {
  console.log('  SKIP: no git — statusline worktree detection NOT run');
}

await ok('buddy TUI: the statusline.py it runs exists, and the input names the session', () => {
  assert.match(STATUSLINE, /[\\/]buddy[\\/]scripts[\\/]statusline\.py$/);
  assert.ok(readFileSync(STATUSLINE, 'utf8').includes('def main'));
  assert.deepEqual(statuslineInput('ses_1', '/p'), { session_id: 'ses_1', cwd: '/p', workspace: { current_dir: '/p' } });
});

await ok('buddy TUI: toLines translates each output row', async () => {
  const lines = await toLines('\x1b[32mA\x1b[0m\nB\n\n');
  assert.deepEqual(lines, [[{ text: 'A', fg: '#0dbc79' }], [{ text: 'B' }]]);
  assert.deepEqual(await toLines(''), []);
});

await ok('buddy TUI: falls through to the next interpreter, and uses the first that answers', async () => {
  const seen = [];
  const run = async (cmd) => {
    seen.push(cmd);
    return cmd === 'python3' ? null : { code: 0, stdout: 'ART\n', stderr: '' };
  };
  const lines = await renderBuddy('s', '/tmp', { run });
  assert.deepEqual(seen, ['python3', 'python']);
  assert.deepEqual(lines, [[{ text: 'ART' }]]);
});

await ok('buddy TUI: a candidate that starts but exits non-zero (the Windows python3 stub, 9009) passes to the next', async () => {
  const seen = [];
  const run = async (cmd) => {
    seen.push(cmd);
    return cmd === 'python3' ? { code: 9009, stdout: '', stderr: '' } : { code: 0, stdout: 'ART\n', stderr: '' };
  };
  assert.deepEqual(await renderBuddy('s', '/tmp', { run }), [[{ text: 'ART' }]]);
  assert.deepEqual(seen, ['python3', 'python']);
});

await ok('buddy TUI: a timeout is not re-run under the next interpreter, and draws nothing (null)', async () => {
  const seen = [];
  const run = async (cmd, _args, opts) => {
    seen.push(cmd);
    opts.onFail?.('timeout');
    return null;
  };
  assert.equal(await renderBuddy('s', '/tmp', { run }), null);
  assert.deepEqual(seen, ['python3']);
  const none = [];
  assert.equal(await renderBuddy('s', '/tmp', { run: async (cmd) => (none.push(cmd), null) }), null, 'no interpreter → null, not []');
  assert.deepEqual(none, ['python3', 'python', 'py']);
});

await ok('buddy TUI: an empty answer draws nothing (null), because statusline.py exits 0 when it fails', async () => {
  // statusline.py's main() catches every exception and returns 0 with nothing printed. [] here
  // blanked the sidebar until a later run worked.
  assert.equal(await renderBuddy('s', '/tmp', { run: async () => ({ code: 0, stdout: '\n', stderr: '' }) }), null);
});

await ok("buddy sidebar: draws the family ROOT's animal, and a run that drew nothing keeps the frame", async () => {
  const drawn = [];
  const rendered = [];
  let answer = [[{ text: 'ART' }]];
  let onScreen = 'child';
  const api = { data: { session: { root: (sid) => (sid === 'child' ? 'root' : sid) } } };
  const sb = buddySidebar(api, {
    currentSessionID: () => onScreen,
    rootOf,
    setLines: (l) => drawn.push(l),
    dirOf: () => '/p',
    render: async (sid) => {
      rendered.push(sid);
      return answer;
    },
  });
  await sb.refresh();
  assert.deepEqual(rendered, ['root'], "a subagent's view reads the root session's state");
  assert.equal(sb.sid(), 'root', '/buddy-status reports the root session too');
  answer = null; // a timeout or a non-zero exit
  await sb.refresh();
  assert.equal(drawn.length, 1, 'a run that drew nothing must not blank the sidebar');
  onScreen = undefined; // home screen
  answer = [[{ text: 'B' }]];
  await sb.refresh();
  assert.equal(rendered.at(-1), 'root', 'no session on screen → the last one');
  assert.equal(drawn.length, 2);
});

await ok('buddy sidebar: the 3 s tick starts statusline.py only when its inputs changed', async () => {
  let k = 'a';
  let runs = 0;
  const sb = buddySidebar({}, {
    currentSessionID: () => 's',
    rootOf: (_api, s) => s,
    setLines: () => {},
    dirOf: () => '/p',
    render: async () => (runs++, [[{ text: 'A' }]]),
    key: () => k,
  });
  await sb.refresh();
  await sb.tick();
  await sb.tick();
  assert.equal(runs, 1, 'nothing changed: no new run');
  k = 'b';
  await sb.tick();
  assert.equal(runs, 2, 'a changed input: one run');
  await sb.tick();
  assert.equal(runs, 2);
});

await ok('buddy sidebar inputsKey: a changed session file, a new minute, and 3 s steps while a file is fresh', () => {
  const proj = mkdtempSync(join(tmpdir(), 'buddy-key-'));
  const home = mkdtempSync(join(tmpdir(), 'buddy-home-'));
  try {
    const env = { BUDDY_HOME: home };
    const base = 1_800_000_000_000; // a whole minute
    mkdirSync(join(proj, '.buddy', 's'), { recursive: true });
    const f = join(proj, '.buddy', 's', 'state.json');
    writeFileSync(f, '{}');
    const old = (base - 3_600_000) / 1000;
    utimesSync(f, old, old);
    const a = inputsKey('s', proj, { now: base + 1000, env });
    assert.equal(inputsKey('s', proj, { now: base + 30_000, env }), a, 'same minute, nothing changed: same key');
    assert.notEqual(inputsKey('s', proj, { now: base + 61_000, env }), a, 'a new minute (mood decay)');
    writeFileSync(f, '{"x":1}');
    utimesSync(f, old, old);
    const changed = inputsKey('s', proj, { now: base + 1000, env });
    assert.notEqual(changed, a, 'a changed state.json');
    writeFileSync(join(home, 'identity.json'), '{}');
    assert.notEqual(inputsKey('s', proj, { now: base + 1000, env }), changed, 'the identity file counts');
    utimesSync(f, base / 1000, base / 1000); // a file written at `base`
    assert.notEqual(inputsKey('s', proj, { now: base + 1000, env }), inputsKey('s', proj, { now: base + 4000, env }), 'fresh: a new key every 3 s (verdict bubbles expire in seconds)');
    const later = base + FRESH_MS + 1000;
    assert.equal(inputsKey('s', proj, { now: later, env }), inputsKey('s', proj, { now: later + 3000, env }), 'no longer fresh: back to the minute');
  } finally {
    rmSync(proj, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

const havePython = spawnSync('python3', ['-c', ''], { stdio: 'ignore' }).status === 0;
if (havePython) {
  await ok('buddy TUI: the REAL statusline.py renders rows for an unknown session', async () => {
    const lines = await renderBuddy('ses_none', '/tmp');
    assert.ok(lines.length >= 2, `expected the spirit animal, got ${JSON.stringify(lines)}`);
  });
} else {
  console.log('  SKIP: no python3 — real statusline.py NOT run');
}

// ── /buddy-status and /buddy-legend as TUI commands (no model, no interruption) ─────────────────────
// A fake @opentui/solid: records every element and prop, so the host contract can be pinned.
const fakeSolid = () => {
  const els = [];
  return {
    els,
    createElement: (type) => {
      const el = { type, props: {}, kids: [], focused: false, focus() { this.focused = true; } };
      els.push(el);
      return el;
    },
    setProp: (el, k, v) => { el.props[k] = v; },
    insert: (el, v) => { el.kids.push(v); },
  };
};

await ok('textNode nowrap: one row, cut at the edge (statusline must not wrap)', () => {
  const solid = fakeSolid();
  const t = textNode(solid, [{ text: 'a' }], { nowrap: true });
  assert.equal(t.props.wrapMode, 'none');
  assert.equal(t.props.truncate, true);
  assert.equal(textNode(solid, [{ text: 'b' }]).props.wrapMode, undefined, 'wrapping stays the default elsewhere');
});

await ok('dialogBodyHeight leaves room for the dialog chrome and never collapses', () => {
  assert.equal(dialogBodyHeight(40), 24);
  assert.equal(dialogBodyHeight(10), 5);
  assert.equal(dialogBodyHeight(undefined), 8);
});

await ok('markdownStyles: theme colours mapped onto the markdown scopes, headings bold', () => {
  const theme = { markdown: { text: 'T', heading: 'H', code: 'C', link: 'L' } };
  const st = markdownStyles(theme);
  assert.deepEqual(st.default, { fg: 'T' });
  assert.deepEqual(st['markup.heading'], { fg: 'H', bold: true });
  assert.deepEqual(st['markup.raw'], { fg: 'C' });
  assert.deepEqual(st['markup.link'], { fg: 'L', underline: true });
  assert.deepEqual(markdownStyles(undefined)['markup.strong'], { bold: true });
});

await ok('markdownDialog: owned SyntaxStyle, capped scrollbox, concealed markdown, focused', async () => {
  const solid = fakeSolid();
  const calls = [];
  const core = { SyntaxStyle: { fromStyles: (styles, owner) => { calls.push(owner); return { destroy() { calls.push('destroyed'); } }; } } };
  let render;
  let onClose;
  const api = {
    theme: { markdown: { text: 'T' } },
    renderer: { height: 40, nativeScene: 'SCENE', idle: async () => {} },
    ui: { dialog: { set: (o) => calls.push(o.size), show: (r, c) => { render = r; onClose = c; }, clear() {} } },
  };
  markdownDialog(api, { solid, core }, { title: 'T', markdown: '## Hi' });
  assert.deepEqual(calls.slice(0, 2), ['SCENE', 'large'], 'fromStyles needs renderer.nativeScene as owner (measured)');
  render();
  const sb = solid.els.find((e) => e.type === 'scrollbox');
  const md = solid.els.find((e) => e.type === 'markdown');
  assert.equal(sb.props.maxHeight, 24, 'the scroll area must be capped to the screen');
  assert.equal(md.props.conceal, true);
  assert.equal(md.props.content, '## Hi');
  assert.ok(md.props.syntaxStyle, 'without a style the raw markers show (measured)');
  assert.deepEqual(md.props.tableOptions, { style: 'grid', cellPaddingX: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(sb.focused, true, 'only a focused scrollbox scrolls with the keys (measured)');
  onClose();
  await new Promise((r) => setTimeout(r, 5));
  assert.ok(calls.includes('destroyed'), 'the plugin-owned style is destroyed on close');
  // No owner available → no style, but the dialog still opens.
  const solid2 = fakeSolid();
  let r2;
  markdownDialog({ ...api, renderer: { height: 40 }, ui: { dialog: { show: (r) => { r2 = r; } } } }, { solid: solid2, core }, { title: 'T', markdown: 'x' });
  r2();
  assert.equal(solid2.els.find((e) => e.type === 'markdown').props.syntaxStyle, undefined);
});

await ok('reportLayer: two global palette + slash commands, named as install.sh expects', () => {
  const shown = [];
  const layer = reportLayer((c) => shown.push(c.kind));
  assert.equal(layer.mode, 'global');
  assert.deepEqual(layer.commands.map((c) => c.slash.name), ['buddy-status', 'buddy-legend']);
  for (const c of layer.commands) {
    assert.equal(c.palette, true);
    assert.equal(c.group, 'Buddy');
    assert.match(c.id, /^buddy\./);
  }
  layer.commands.forEach((c) => c.run());
  assert.deepEqual(shown, ['status', 'legend']);
  const inst = readFileSync(join(HERE, '..', 'install.sh'), 'utf8');
  for (const c of REPORT_COMMANDS) {
    assert.ok(inst.includes(`|${c.kind}`) || inst.includes(`${c.kind}|`), `install.sh must skip the ${c.kind} model command`);
  }
});

await ok('runReport without a working interpreter says so instead of throwing', async () => {
  const text = await runReport('status', 's', '/tmp', { run: async () => null });
  assert.match(text, /no python3\/python could run/);
  assert.match(REPORT, /report\.py$/);
});

if (havePython) {
  await ok('real report.py: wrong arguments print its usage line', () => {
    const r = spawnSync('python3', [REPORT], { encoding: 'utf8' });
    assert.match(r.stdout.trim(), /^usage: report\.py status\|legend /);
  });
}

if (havePython) {
  const proj = mkdtempSync(join(tmpdir(), 'buddy-report-'));
  try {
    const sid = 'ses_report_test';
    mkdirSync(join(proj, '.buddy', sid), { recursive: true });
    // Built from buddy's own default_state(): load_state() discards a file whose `version`
    // is not STATE_VERSION, so a hand-written fixture would silently read as defaults.
    const made = spawnSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(join(HERE, '..', '..', '..', 'buddy'))})`,
      'from scripts.state import default_state',
      's = default_state()',
      "s['signals']['tool_call_count'] = 7",
      "s['signals']['recent_errors'] = [{'ts': 1, 'tool': 'Bash', 'error': 'x'}] * 2",
      "s['active_specialists'] = ['debugging-yeti']",
      'print(json.dumps(s))',
    ].join('\n')], { encoding: 'utf8' });
    writeFileSync(join(proj, '.buddy', sid, 'state.json'), made.stdout);
    await ok('real report.py status: mood, signals, specialists and hook health of THIS session', async () => {
      const text = await runReport('status', sid, proj);
      assert.match(text, new RegExp(`session: ${sid}`));
      assert.match(text, /derived_mood: \w/);
      assert.match(text, /tool_call_count: 7/);
      assert.match(text, /recent_errors: 2/);
      assert.match(text, /active_specialists: debugging-yeti/);
      assert.match(text, /hooks are firing/);
      assert.match(text, /^### Mood$/m, 'sections are markdown headings (rendered in the dialog)');
      assert.match(text, /^- tool_call_count: 7$/m, 'rows are list items');
    });
    await ok('real report.py legend: active label substituted, tables from legend.md, dashed commands', async () => {
      const text = await runReport('legend', sid, proj);
      assert.match(text, /Currently Active/);
      assert.match(text, /\(debugging-yeti\)/);
      assert.doesNotMatch(text, /<output of Step 1/);
      assert.match(text, /`\/buddy-summon yeti`/);
      assert.doesNotMatch(text, /\/buddy:/);
    });
    await ok('real report.py legend reads state through load_state, as status does (another STATE_VERSION reads as none)', async () => {
      const oldSid = 'ses_old_version';
      mkdirSync(join(proj, '.buddy', oldSid), { recursive: true });
      writeFileSync(join(proj, '.buddy', oldSid, 'state.json'), JSON.stringify({ version: -1, active_specialists: ['debugging-yeti'] }));
      assert.match(await runReport('status', oldSid, proj), /active_specialists: \(none\)/);
      const legend = await runReport('legend', oldSid, proj);
      assert.doesNotMatch(legend, /^- .*\(debugging-yeti\)$/m, 'legend listed the old file\'s specialists while status said none');
      assert.match(legend, /\(none\)/);
    });
    await ok('real report.py: no session id → a plain message, not a crash', async () => {
      assert.match(await runReport('status', '', proj), /no active buddy session/);
      assert.match(await runReport('legend', '', proj), /no active session/);
    });
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed`);
