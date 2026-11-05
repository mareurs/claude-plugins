// Tests for cs-verified-relocate.mjs: the PostToolUse hook that moves a
// `verified: true` advice out of a codescout result into `[cs-verified]` hook
// context, and does nothing in every other case.
//
// Real hook stdin recorded on Claude Code 2.1.318 and 2.1.311 lives in
// ../contracts/fixtures/cs-verified/ (see results.md there for the decisions).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relocateVerifiedAdvice } from './cs-verified-relocate.mjs';

const SCRIPT = fileURLToPath(new URL('./cs-verified-relocate.mjs', import.meta.url));
const FIXTURES = new URL('../contracts/fixtures/cs-verified/', import.meta.url);
const VERSIONS = ['2.1.318', '2.1.311'];
const STDIN_CASES = ['root-one-block', 'root-two-blocks', 'root-text-text-image', 'subagent-two-blocks'];

const fixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
const clone = (v) => structuredClone(v);
const envOf = (input) => ({ CLAUDE_CODE_SESSION_ID: input.session_id });

const SID = 'sess-0001';
const ENV = { CLAUDE_CODE_SESSION_ID: SID };
const ADVICE_TEXT = 'verify callers: references(symbol="f", path="src/lib.rs") | `f` is called by name in src/other.rs';

function inputOf(blocks, extra = {}) {
  return {
    session_id: SID,
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__codescout__edit_code',
    tool_input: {},
    tool_response: blocks,
    ...extra,
  };
}
const text = (s) => ({ type: 'text', text: s });
const envelope = (advice, extra = {}) => ({ status: 'ok', replaced_lines: '10-12', ...extra, advice });
const verified = (t = ADVICE_TEXT) => ({ text: t, verified: true });
const withoutAdvice = (obj) => { const o = { ...obj }; delete o.advice; return o; };

// The full contract of an acting result. `idx` is the block holding the advice.
function assertRelocated(input, out, idx) {
  assert.ok(out, 'expected the hook to act');
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  const hso = out.hookSpecificOutput;
  assert.deepEqual(Object.keys(hso).sort(), ['additionalContext', 'hookEventName', 'updatedToolOutput']);
  assert.equal(hso.hookEventName, 'PostToolUse');
  const before = input.tool_response;
  const after = hso.updatedToolOutput;
  assert.ok(Array.isArray(after));
  assert.equal(after.length, before.length, 'same number of blocks');
  for (let i = 0; i < before.length; i++) {
    if (i === idx) continue;
    assert.equal(JSON.stringify(after[i]), JSON.stringify(before[i]), `block ${i} byte-identical`);
  }
  const orig = JSON.parse(before[idx].text);
  const edited = JSON.parse(after[idx].text);
  assert.deepEqual(withoutAdvice({ ...before[idx], text: null }), withoutAdvice({ ...after[idx], text: null }),
    'only the text of the edited block changes');
  assert.deepEqual(Object.keys(after[idx]), Object.keys(before[idx]), 'block key order kept');
  assert.equal(Object.hasOwn(edited, 'advice'), false, 'advice removed');
  assert.deepEqual(edited, withoutAdvice(orig), 'every other field deep-equal');
  assert.deepEqual(Object.keys(edited), Object.keys(withoutAdvice(orig)), 'field order kept');
  assert.equal(hso.additionalContext, '[cs-verified] ' + orig.advice.text);
  return { edited, after, hso };
}

test('relocates_a_verified_advice_and_keeps_every_other_block', () => {
  // Real recorded stdin, both CLI versions, every block shape recorded.
  for (const v of VERSIONS) {
    for (const c of STDIN_CASES) {
      const input = fixture(`claude-${v}-${c}.json`);
      const snapshot = clone(input);
      const out = relocateVerifiedAdvice(input, envOf(input));
      const { after } = assertRelocated(snapshot, out, 0);
      assert.equal(after[0].text.includes('\n'), false, `${v} ${c}: single-line block stays single-line`);
      assert.deepEqual(input, snapshot, `${v} ${c}: input not mutated`);
    }
  }
  // The text-text-image case: 4 blocks (the CLI adds `[Image: ...]`), kept in order.
  const mixed = fixture('claude-2.1.318-root-text-text-image.json');
  const out = relocateVerifiedAdvice(mixed, envOf(mixed));
  assert.deepEqual(out.hookSpecificOutput.updatedToolOutput.map((b) => b.type), ['text', 'text', 'image', 'text']);
  assert.match(out.hookSpecificOutput.updatedToolOutput[3].text, /^\[Image: source: /);
  // Hand-built two text blocks, advice in the SECOND block.
  const built = inputOf([text('first block, plain prose'), text(JSON.stringify(envelope(verified())))]);
  assertRelocated(clone(built), relocateVerifiedAdvice(built, ENV), 1);
});

test('keeps_a_pretty_printed_block_pretty', () => {
  const input = fixture('claude-2.1.318-root-two-blocks.json');
  const obj = JSON.parse(input.tool_response[0].text);
  input.tool_response[0].text = JSON.stringify(obj, null, 2);
  const out = relocateVerifiedAdvice(input, envOf(input));
  const { after } = assertRelocated(clone(input), out, 0);
  assert.equal(after[0].text, JSON.stringify(withoutAdvice(obj), null, 2));
});

test('a_single_line_or_other_layout_becomes_compact', () => {
  const obj = envelope(verified(), { hint: 'h' });
  const layouts = [
    JSON.stringify(obj),
    JSON.stringify(obj).replaceAll('":', '": ').replaceAll(',"', ', "'), // python json.dumps style
    JSON.stringify(obj, null, 4),
    JSON.stringify(obj, null, '\t'),
  ];
  for (const layout of layouts) {
    const input = inputOf([text(layout)]);
    const out = relocateVerifiedAdvice(input, ENV);
    assertRelocated(clone(input), out, 0);
    assert.equal(out.hookSpecificOutput.updatedToolOutput[0].text, JSON.stringify(withoutAdvice(obj)));
  }
});

test('relocates_with_extra_trailing_blocks', () => {
  for (const pretty of [false, true]) {
    const input = fixture('claude-2.1.311-root-two-blocks.json');
    if (pretty) input.tool_response[0].text = JSON.stringify(JSON.parse(input.tool_response[0].text), null, 2);
    input.tool_response.push(
      text('<!-- auto-injected get_guide(\'x\') -->\n\n# Guide\n\nMentions "advice": {"verified": true} in prose.\n'),
      text('{"guide": "progressive-disclosure", "n": 1, "rows": [1, 2]}'), // JSON, no advice, python spacing
      { type: 'resource', resource: { uri: 'file:///x', text: '{"advice": {"text": "t", "verified": true}}' } },
      text(''),
    );
    const snapshot = clone(input);
    const out = relocateVerifiedAdvice(input, envOf(input));
    const { after } = assertRelocated(snapshot, out, 0);
    assert.equal(after.length, 6);
    assert.equal(after[0].text.includes('\n'), pretty);
  }
});

test('leaves_hint_and_every_other_field_untouched', () => {
  const obj = {
    status: 'ok',
    hint: 'WARNING: the edited file has uncommitted changes from another session; review before committing',
    advice: verified(),
    replaced_lines: '10-12',
    nested: { a: { b: [1, 2, { c: 'üñí € 😀 中文 \u00A0' }] }, empty: {}, list: [] },
    _private: { _x: true },
    numbers: [0, -5, 3.25, 1.5e10, 9007199254740991, -9007199254740991, 1.5e-7, 1e-300],
    flags: [true, false, null],
    escapes: 'quote " backslash \\ slash / tab \t nl \n',
  };
  const input = inputOf([text(JSON.stringify(obj))]);
  const { edited } = assertRelocated(clone(input), relocateVerifiedAdvice(input, ENV), 0);
  assert.equal(edited.hint, obj.hint);
  assert.deepEqual(Object.keys(edited), ['status', 'hint', 'replaced_lines', 'nested', '_private', 'numbers', 'flags', 'escapes']);
  // A protocol hint with no advice: nothing to do.
  const hintOnly = inputOf([text(JSON.stringify({ status: 'ok', hint: 'job started: @bg_1' }))]);
  assert.equal(relocateVerifiedAdvice(hintOnly, ENV), null);
});

test('acts_only_on_verified_true', () => {
  const adviceValues = [
    { text: ADVICE_TEXT, verified: false },
    { text: ADVICE_TEXT },
    { text: ADVICE_TEXT, verified: 'true' },
    { text: ADVICE_TEXT, verified: 1 },
    { text: ADVICE_TEXT, verified: null },
    { text: ADVICE_TEXT, verified: [true] },
    { verified: true },
    { text: 42, verified: true },
    { text: null, verified: true },
    ADVICE_TEXT,
    [verified()],
    null,
    true,
  ];
  for (const advice of adviceValues) {
    const input = inputOf([text(JSON.stringify(envelope(advice)))]);
    assert.equal(relocateVerifiedAdvice(input, ENV), null, `advice=${JSON.stringify(advice)}`);
  }
  // The positive control for this table.
  assert.ok(relocateVerifiedAdvice(inputOf([text(JSON.stringify(envelope(verified())))]), ENV));
});

test('acts_only_on_a_top_level_advice', () => {
  const nested = { status: 'ok', result: { advice: verified() } };
  assert.equal(relocateVerifiedAdvice(inputOf([text(JSON.stringify(nested))]), ENV), null);
  const inList = { status: 'ok', items: [{ advice: verified() }] };
  assert.equal(relocateVerifiedAdvice(inputOf([text(JSON.stringify(inList))]), ENV), null);
});

test('does_nothing_on_two_verified_advices', () => {
  const block = text(JSON.stringify(envelope(verified())));
  assert.equal(relocateVerifiedAdvice(inputOf([block, clone(block)]), ENV), null);
  assert.equal(relocateVerifiedAdvice(inputOf([block, text('x'), clone(block)]), ENV), null);
});

test('does_nothing_when_another_block_also_carries_advice', () => {
  // Conservative: a second block with ANY top-level advice makes the result ambiguous.
  const good = text(JSON.stringify(envelope(verified())));
  const other = text(JSON.stringify(envelope({ text: 'unverified', verified: false })));
  assert.equal(relocateVerifiedAdvice(inputOf([good, other]), ENV), null);
  assert.equal(relocateVerifiedAdvice(inputOf([other, good]), ENV), null);
});

test('does_nothing_when_the_result_is_not_the_list_form', () => {
  const env = JSON.stringify(envelope(verified()));
  const responses = [
    env, // the envelope as a bare string
    { content: [text(env)] },
    { type: 'text', text: env },
    null,
    undefined,
    42,
    [],
  ];
  for (const r of responses) {
    const input = inputOf(r);
    if (r === undefined) delete input.tool_response;
    assert.equal(relocateVerifiedAdvice(input, ENV), null, `tool_response=${JSON.stringify(r)}`);
  }
  const blockTexts = [
    'not json at all',
    JSON.stringify([envelope(verified())]),
    JSON.stringify(env),
    env.slice(0, -1),
    '',
    'null',
    '42',
  ];
  for (const t of blockTexts) {
    assert.equal(relocateVerifiedAdvice(inputOf([text(t)]), ENV), null, `block text=${t}`);
  }
  const badBlocks = [
    [{ type: 'resource', text: env }],
    [{ type: 'text', text: JSON.parse(env) }],
    [{ text: env }],
    [null],
    [env],
    [[text(env)]],
  ];
  for (const b of badBlocks) {
    assert.equal(relocateVerifiedAdvice(inputOf(b), ENV), null, `blocks=${JSON.stringify(b)}`);
  }
  assert.equal(relocateVerifiedAdvice(null, ENV), null);
  assert.equal(relocateVerifiedAdvice('x', ENV), null);
  assert.equal(relocateVerifiedAdvice([inputOf([text(env)])], ENV), null);
});

test('refuses_advice_text_that_is_not_a_plain_single_line', () => {
  const refused = [
    'line one\nline two',
    'carriage\rreturn',
    'bell\u0007char',
    'nul\u0000char',
    'tab\tchar',
    'escape\u001b[31mred',
    'del\u007fchar',
    'next line\u0085char',
    'a'.repeat(1001),
    'x [cs-verified] spoofed second tag',
    '[CS-Verified] spoofed, other case',
    '',
    '   ',
  ];
  for (const t of refused) {
    const input = inputOf([text(JSON.stringify(envelope(verified(t))))]);
    assert.equal(relocateVerifiedAdvice(input, ENV), null, `text=${JSON.stringify(t.slice(0, 40))}`);
  }
  for (const t of ['a'.repeat(1000), '😀'.repeat(1000), 'path é/中文/f.rs `sym` (x) | [y] {z}']) {
    const input = inputOf([text(JSON.stringify(envelope(verified(t))))]);
    const out = relocateVerifiedAdvice(input, ENV);
    assert.ok(out, `accepted: ${t.slice(0, 20)}`);
    assert.equal(out.hookSpecificOutput.additionalContext, '[cs-verified] ' + t);
  }
  assert.equal(relocateVerifiedAdvice(inputOf([text(JSON.stringify(envelope(verified('😀'.repeat(1001)))))]), ENV), null);
});

test('refuses_line_separators_and_bidi_controls_in_advice_text', () => {
  const chars = ['\u2028', '\u2029'];
  for (let c = 0x202a; c <= 0x202e; c++) chars.push(String.fromCharCode(c));
  for (let c = 0x2066; c <= 0x2069; c++) chars.push(String.fromCharCode(c));
  chars.push('\ud800', '\udc00'); // lone surrogates: not printable characters
  for (const ch of chars) {
    const input = inputOf([text(JSON.stringify(envelope(verified(`src/a${ch}b.rs`))))]);
    assert.equal(relocateVerifiedAdvice(input, ENV), null, `U+${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  }
});

test('refuses_a_block_a_json_round_trip_would_change', () => {
  const adv = JSON.stringify(verified());
  const texts = [
    `{"1": "integer-like key", "advice": ${adv}}`,
    `{"status": "ok", "nested": {"0": 1}, "advice": ${adv}}`,
    `{"status": "ok", "list": [{"42": true}], "advice": ${adv}}`,
    `{"status": "ok", "n": 9007199254740993, "advice": ${adv}}`,
    `{"status": "ok", "n": -9007199254740993, "advice": ${adv}}`,
    `{"status": "ok", "n": 1e400, "advice": ${adv}}`,
    `{"status": "ok", "n": [12345678901234567890], "advice": ${adv}}`,
    `{"status": "ok", "n": -0, "advice": ${adv}}`,
  ];
  for (const t of texts) {
    assert.equal(relocateVerifiedAdvice(inputOf([text(t)]), ENV), null, t);
  }
  // A round-trip-unsafe value in ANOTHER block's structure (the hook re-serialises every block).
  const env = JSON.stringify(envelope(verified()));
  assert.equal(relocateVerifiedAdvice(inputOf([text(env), { type: 'x', meta: { 7: 'k' } }]), ENV), null);
  assert.equal(relocateVerifiedAdvice(inputOf([text(env), { type: 'x', n: 2 ** 60 }]), ENV), null);
  // Controls: a non-index key that looks numeric-ish and the largest safe integer are fine.
  assert.ok(relocateVerifiedAdvice(inputOf([text(`{"01": 1, "-1": 2, "n": 9007199254740991, "advice": ${adv}}`)]), ENV));
});

test('does_nothing_on_a_huge_tool_response', () => {
  const input = fixture('claude-2.1.318-root-two-blocks.json');
  input.tool_response[1].text = 'x'.repeat(300 * 1024);
  assert.equal(relocateVerifiedAdvice(input, envOf(input)), null);
});

test('ignores_extra_stdin_keys', () => {
  const input = fixture('claude-2.1.318-root-two-blocks.json');
  input.scratchpad_dir = '/tmp/scratch';
  input.some_future_key = { a: 1 };
  assertRelocated(clone(input), relocateVerifiedAdvice(input, envOf(input)), 0);
});

test('the_host_gate', () => {
  const base = fixture('claude-2.1.318-root-two-blocks.json');
  assert.ok(relocateVerifiedAdvice(clone(base), envOf(base)), 'positive');
  const negatives = [
    ['hook_event_name PreToolUse', { ...clone(base), hook_event_name: 'PreToolUse' }, envOf(base)],
    ['hook_event_name missing', (() => { const i = clone(base); delete i.hook_event_name; return i; })(), envOf(base)],
    ['session_id not a string', { ...clone(base), session_id: 123 }, { CLAUDE_CODE_SESSION_ID: '123' }],
    ['session_id empty', { ...clone(base), session_id: '' }, { CLAUDE_CODE_SESSION_ID: '' }],
    ['session_id missing', (() => { const i = clone(base); delete i.session_id; return i; })(), {}],
    ['env session id differs', clone(base), { CLAUDE_CODE_SESSION_ID: base.session_id + 'x' }],
    ['env session id missing', clone(base), {}],
    ['env session id polluted', clone(base), { CLAUDE_CODE_SESSION_ID: 'polluted' }],
  ];
  for (const [name, input, env] of negatives) {
    assert.equal(relocateVerifiedAdvice(input, env), null, name);
  }
  // Signals that must NOT open the gate on their own.
  const decoys = { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', AI_AGENT: 'claude-code_2-1-318_harness', CLAUDE_PLUGIN_ROOT: '/p' };
  assert.equal(relocateVerifiedAdvice(clone(base), decoys), null, 'decoy variables alone');
  // The real recorded hook environments: the CLI-set session id matches stdin.
  for (const v of VERSIONS) {
    for (const kind of ['clean', 'polluted', 'plugin', 'subagent']) {
      const rec = fixture(`claude-${v}-hook-env-${kind}.json`);
      const input = { ...clone(base), session_id: rec.stdinSessionId };
      assert.ok(relocateVerifiedAdvice(input, rec.hookEnv), `${v} ${kind}`);
    }
  }
  // Default env parameter is process.env.
  const saved = process.env.CLAUDE_CODE_SESSION_ID;
  try {
    process.env.CLAUDE_CODE_SESSION_ID = base.session_id;
    assert.ok(relocateVerifiedAdvice(clone(base)));
    process.env.CLAUDE_CODE_SESSION_ID = 'other';
    assert.equal(relocateVerifiedAdvice(clone(base)), null);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = saved;
  }
});

test('a_second_run_on_a_relocated_result_does_nothing', () => {
  for (const v of VERSIONS) {
    for (const c of STDIN_CASES) {
      const input = fixture(`claude-${v}-${c}.json`);
      const out = relocateVerifiedAdvice(input, envOf(input));
      const again = { ...input, tool_response: out.hookSpecificOutput.updatedToolOutput };
      assert.equal(relocateVerifiedAdvice(again, envOf(input)), null, `${v} ${c}`);
    }
  }
});

// --- process level ---------------------------------------------------------

function run(stdin, env = {}) {
  const r = spawnSync(process.execPath, [SCRIPT], { input: stdin, env, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
function assertSilent(r, what) {
  assert.equal(r.signal, null, `${what}: not killed`);
  assert.equal(r.status, 0, `${what}: exit 0`);
  assert.equal(r.stdout, '', `${what}: empty stdout`);
  assert.equal(r.stderr, '', `${what}: empty stderr`);
}

// Block text nested deeper than the decision code's stack: the decision code throws.
function throwingInput() {
  const depth = 20000;
  const deep = `{"advice": ${JSON.stringify(verified())}, "deep": ${'['.repeat(depth)}${']'.repeat(depth)}}`;
  return inputOf([text(deep)]);
}

test('process_exits_0_and_prints_nothing_when_not_acting', () => {
  const base = fixture('claude-2.1.318-root-two-blocks.json');
  assertSilent(run('', envOf(base)), 'empty stdin');
  assertSilent(run('not json', envOf(base)), 'not json');
  assertSilent(run('null', envOf(base)), 'json null');
  const huge = clone(base);
  huge.tool_response.push(text('y'.repeat(4 * 1024 * 1024)));
  assertSilent(run(JSON.stringify(huge), envOf(base)), 'huge tool_response');
  assertSilent(run(JSON.stringify(base), {}), 'host gate closed');
  // The decision code really throws on this input (witness), and the process stays silent.
  const thrower = throwingInput();
  assert.throws(() => relocateVerifiedAdvice(thrower, ENV), RangeError);
  assertSilent(run(JSON.stringify(thrower), ENV), 'thrown error inside');
});

test('process_acts_when_started_through_a_symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-verified-'));
  try {
    const link = join(dir, 'hook.mjs');
    symlinkSync(SCRIPT, link);
    const raw = readFileSync(new URL('claude-2.1.318-root-two-blocks.json', FIXTURES), 'utf8');
    const input = JSON.parse(raw);
    const r = spawnSync(process.execPath, [link], { input: raw, env: envOf(input), encoding: 'utf8', timeout: 20000 });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout, JSON.stringify(relocateVerifiedAdvice(input, envOf(input))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('process_prints_exactly_the_pure_result_when_acting', () => {
  for (const v of VERSIONS) {
    for (const c of STDIN_CASES) {
      const name = `claude-${v}-${c}.json`;
      const raw = readFileSync(new URL(name, FIXTURES), 'utf8');
      const input = JSON.parse(raw);
      const r = run(raw, envOf(input));
      assert.equal(r.status, 0, name);
      assert.equal(r.stderr, '', name);
      assert.equal(r.stdout, JSON.stringify(relocateVerifiedAdvice(input, envOf(input))), name);
    }
  }
});
