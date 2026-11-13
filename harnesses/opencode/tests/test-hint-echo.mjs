// hint-echo channel — unit tests. Run: node harnesses/opencode/tests/test-hint-echo.mjs
//
// The channel has a writer (lib/host.mjs echoHint, called by the bridges) and a reader
// (tui/hint-echo/tui.js readNew). They run in different processes, so the only contract is
// the file: this suite writes with one and reads with the other.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { echoHint, hintEchoDir, hintEchoFile, HINT_ECHO_MAX_BYTES, runProcess } from '../lib/host.mjs';
import { hintMessage, readNew, relevant, MAX_CHARS } from '../tui/hint-echo/tui.js';
import { buildSddBridge } from '../plugins/sdd.js';

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

const root = mkdtempSync(join(tmpdir(), 'hint-echo-'));
const env = { OPENCODE_HINT_ECHO_DIR: join(root, 'chan') };

try {
  await ok('the channel dir follows OPENCODE_HINT_ECHO_DIR, else XDG_STATE_HOME', () => {
    assert.equal(hintEchoDir(env), join(root, 'chan'));
    assert.equal(hintEchoDir({ XDG_STATE_HOME: '/s' }), join('/s', 'opencode-hint-echo'));
  });

  await ok('echoHint writes nothing while the channel dir does not exist (hint-echo not installed)', () => {
    assert.equal(echoHint({ text: 'x' }, env), false);
    assert.equal(existsSync(hintEchoFile(env)), false);
  });

  await ok('writer → reader round trip; no replay before the reader\'s offset', () => {
    mkdirSync(hintEchoDir(env), { recursive: true });
    assert.equal(echoHint({ sessionID: 's1', tool: 'shell', source: 'buddy', text: 'old' }, env), true);
    const start = statSync(hintEchoFile(env)).size; // the TUI starts here
    echoHint({ sessionID: 's1', tool: 'shell', source: 'buddy', text: '[cs-hint] one' }, env);
    echoHint({ sessionID: 's2', tool: 'edit', source: 'sdd', text: 'two' }, env);
    const r = readNew(hintEchoFile(env), start);
    assert.deepEqual(r.records.map((x) => x.text), ['[cs-hint] one', 'two']);
    assert.equal(r.records[0].tool, 'shell');
    assert.equal(r.records[1].source, 'sdd');
    assert.deepEqual(readNew(hintEchoFile(env), r.offset).records, [], 'nothing new → nothing read');
  });

  await ok('a half-written line waits; a rotated (shrunk) file is read from the start', () => {
    const f = join(root, 'partial.jsonl');
    writeFileSync(f, `${JSON.stringify({ text: 'a' })}\n{"text":"b`);
    const r1 = readNew(f, 0);
    assert.deepEqual(r1.records.map((x) => x.text), ['a']);
    appendFileSync(f, '"}\n');
    const r2 = readNew(f, r1.offset);
    assert.deepEqual(r2.records.map((x) => x.text), ['b']);
    writeFileSync(f, `${JSON.stringify({ text: 'c' })}\n`); // rotated: smaller than offset
    assert.deepEqual(readNew(f, r2.offset).records.map((x) => x.text), ['c']);
  });

  await ok('echoHint rotates the file past its size cap', () => {
    const f = hintEchoFile(env);
    writeFileSync(f, 'x'.repeat(HINT_ECHO_MAX_BYTES + 1));
    echoHint({ text: 'after rotation' }, env);
    assert.ok(existsSync(`${f}.1`), 'old generation kept as .1');
    assert.ok(statSync(f).size < 1000, 'live file restarted');
  });

  await ok('hintMessage mirrors Claude Code hint-echo: prefix and a 400-character cut', () => {
    assert.equal(hintMessage({ tool: 'shell', text: 'use  read_file\n now' }), 'hook told the model after shell: use read_file now');
    const long = hintMessage({ tool: 't', text: 'y'.repeat(1000) });
    assert.ok(long.endsWith('…'));
    assert.equal(long.length, 'hook told the model after t: '.length + MAX_CHARS);
  });

  await ok('relevant: same session family only, everything when no session is on screen', () => {
    const rootOf = (s) => ({ child: 'p', p: 'p', other: 'other' })[s] ?? s;
    assert.equal(relevant({ sessionID: 'child' }, 'p', rootOf), true);
    assert.equal(relevant({ sessionID: 'other' }, 'p', rootOf), false);
    assert.equal(relevant({ sessionID: 'other' }, undefined, rootOf), true);
  });

  await ok('the sdd bridge echoes the advisory it appends to a tool result', async () => {
    const proj = join(root, 'sddproj');
    mkdirSync(join(proj, '.sdd'), { recursive: true });
    writeFileSync(join(proj, '.sdd', 'config.json'), '{}');
    const echoed = [];
    const run = async () => ({ hookSpecificOutput: { additionalContext: 'sdd says hi' } });
    const b = buildSddBridge(proj, { run, echo: (r) => echoed.push(r) });
    await b.onToolBefore({ id: 'c1', sessionID: 's1', tool: 'edit', input: { filePath: join(proj, 'a.txt') } });
    const ev = { id: 'c1', sessionID: 's1', tool: 'edit', result: { content: [] } };
    await b.onToolAfter(ev);
    assert.equal(ev.result.content[0]?.text, 'sdd says hi');
    assert.deepEqual(echoed.map((r) => [r.tool, r.source, r.text]), [['edit', 'sdd', 'sdd says hi']]);
  });

  await ok('runProcess returns exit code, stdout and stderr (buddy\'s exit-2 block needs all three)', async () => {
    const r = await runProcess(process.execPath, ['-e', 'process.stdout.write("o");process.stderr.write("e");process.exit(2)'], { timeoutMs: 5000 });
    assert.deepEqual(r, { code: 2, stdout: 'o', stderr: 'e' });
    const echo = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'in', timeoutMs: 5000 });
    assert.equal(echo.stdout, 'in');
    assert.equal(await runProcess('definitely-not-a-binary-xyz', [], { timeoutMs: 2000, label: 'test' }), null);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${pass} passed`);
