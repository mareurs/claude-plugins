// mod.test.mjs — the effort-toggle mod (mod/hooks/register.ts) driven by fakes, never by the engine.
//
//   node --test effort-steering/spikes/toggle/mod.test.mjs
//
// The fakes: `on` records each hook by event and matcher; `$` is { plugin.root, an in-memory fs.read / fs.write, a spy
// tool.register }; `next` for turn.step is a streaming generator that records the event it was given and returns {}.
// A turn.step event is frozen, as the engine's is, so a hook that mutates it fails here. What the harness calls "sent" is
// the event that reached `next`, i.e. what the request would carry.
//
// Review Focus 1 (two set_effort calls answered in one message) and 2 (subagent steps) are tested below by name.
// Never calls a model, never starts the engine, never touches Docker.

import assert from 'node:assert/strict';
import { t } from '../../core/testkit.mjs';
import { ta } from '../s5/fixtures/testkit-async.mjs';
import { INPUT_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME, randomLevels, register, resultText } from './mod/hooks/register.ts';

const ROOT = '/opt/es/mod';
const FALLBACK_LOG = '/run/state/effort-toggle/log.jsonl';
const LOG = '/run/state/effort-toggle/log.jsonl';
const FULL_TOOL = 'mcp__effort-toggle__set_effort';
const DENY = 'set_effort needs level "low" or "xhigh" and a non-empty reason.';

// The harness. `config` is an object (JSON-encoded), a string (written as is) or undefined (no config.json at all).
async function boot({ config, failWrites = false } = {}) {
  const hooks = { 'session.start': [], 'tool.call': [], 'turn.step': [] };
  const on = (pattern, a, b) => {
    const [matcher, hook] = b === undefined ? [undefined, a] : [a, b];
    assert.ok(pattern in hooks, `unexpected event ${pattern}`);
    hooks[pattern].push({ matcher, hook });
  };
  const files = new Map();
  if (config !== undefined) files.set(`${ROOT}/config.json`, typeof config === 'string' ? config : JSON.stringify(config));
  const registered = [];
  const writtenPaths = new Set();
  const $ = {
    plugin: { name: 'effort-toggle', root: ROOT },
    fs: {
      read: async (p) => {
        if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
        return files.get(p);
      },
      write: async (p, text) => {
        if (failWrites) throw new Error('EDQUOT');
        writtenPaths.add(p);
        files.set(p, text);
      },
    },
    tool: {
      register: async (spec) => {
        registered.push(spec);
        return { tool: `mcp__effort-toggle__${spec.name}` };
      },
    },
  };
  register(on, {});

  const drain = async (gen) => {
    for (;;) {
      const r = await gen.next();
      if (r.done) return r.value;
    }
  };
  const h = {
    $,
    files,
    registered,
    writtenPaths,
    hooks,
    async start() {
      assert.equal(hooks['session.start'].length, 1);
      const e = Object.freeze({ cwd: '/work', surface: null, isInteractive: false });
      return hooks['session.start'][0].hook($, e, async (x) => ({ cwd: x.cwd }));
    },
    // One turn.step through the hook; returns the event that reached `next`.
    async step(ev) {
      assert.equal(hooks['turn.step'].length, 1);
      const e = Object.freeze({ model: 'claude-test', messageCount: 3, index: 0, ...ev });
      const seen = [];
      async function* next(x) {
        seen.push(x);
        return {};
      }
      await drain(hooks['turn.step'][0].hook($, e, next));
      assert.equal(seen.length, 1, 'a step reaches next exactly once');
      return seen[0];
    },
    // One tool.call through the hooks whose matcher fits; returns the first hook's answer, or what `next` answered.
    async call(input, id = 'toolu_1') {
      const e = Object.freeze({ tool: FULL_TOOL, tool_use_id: id, ...input });
      const next = async () => ({ result: 'PASSED ON' });
      const hit = hooks['tool.call'].find((x) => x.matcher === undefined || Object.entries(x.matcher).every(([k, v]) => e[k] === v));
      return hit ? hit.hook($, e, next) : next();
    },
    log(path = LOG) {
      const text = files.get(path);
      if (text === undefined) return [];
      assert.ok(text.endsWith('\n'), 'the log ends with a newline');
      return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
  };
  return h;
}

const cfg = (mode, extra = {}) => ({ mode, logPath: LOG, ...extra });
const RANDOM = { pUp: 0.4, pDown: 0.3, seed: 7 };

await ta('toggle: no rewrite before any call; after set_effort xhigh the next main step asks xhigh; after set_effort low it asks low', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  const e0 = { turnId: 'T1', index: 0, effort: 'medium' };
  const sent0 = await m.step(e0);
  assert.equal(sent0.effort, 'medium', 'no call yet: the request keeps the effort it came with');
  assert.equal((await m.step({ ...e0, index: 1 })).effort, 'medium');

  const r1 = await m.call({ level: 'xhigh', reason: 'review' });
  assert.deepEqual(r1, { result: 'Effort is now xhigh. It applies from your next step.' });
  assert.equal((await m.step({ ...e0, index: 2 })).effort, 'xhigh');
  assert.equal((await m.step({ ...e0, index: 3 })).effort, 'xhigh');

  const r2 = await m.call({ level: 'low', reason: 'back to routine work' });
  assert.deepEqual(r2, { result: 'Effort is now low. It applies from your next step.' });
  assert.equal((await m.step({ ...e0, index: 4 })).effort, 'low');
  // Everything else of the step is left as it was.
  const sent = await m.step({ ...e0, index: 5 });
  assert.deepEqual({ ...sent, effort: undefined }, { model: 'claude-test', messageCount: 3, turnId: 'T1', index: 5, effort: undefined });
});

await ta('toggle: a step whose effort already equals the level is passed on untouched; a step with no effort gets the level', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  await m.call({ level: 'xhigh', reason: 'r' });
  const same = Object.freeze({ model: 'claude-test', messageCount: 3, index: 1, turnId: 'T1', effort: 'xhigh' });
  const seen = [];
  const hook = m.hooks['turn.step'][0].hook;
  async function* next(x) {
    seen.push(x);
    return {};
  }
  for await (const _ of hook(m.$, same, next)); // eslint-disable-line no-unused-vars
  assert.equal(seen[0], same, 'not rewritten: the very same event object reaches next');
  const none = await m.step({ turnId: 'T1', index: 2 });
  assert.equal(none.effort, 'xhigh');
  const steps = m.log().filter((l) => l.type === 'step');
  // P2: before = what the step carried, after = what the request carries.
  assert.deepEqual(steps.map((l) => [l.request, l.before, l.after]), [[0, 'medium', 'medium'], [1, 'xhigh', 'xhigh'], [2, null, 'xhigh']]);
});

await ta('toggle: the tool is registered at session.start with the exact spec, and session.start is passed on', async () => {
  const m = await boot({ config: cfg('toggle') });
  const r = await m.start();
  assert.deepEqual(r, { cwd: '/work' });
  assert.equal(m.registered.length, 1);
  assert.deepEqual(m.registered[0], { name: 'set_effort', description: TOOL_DESCRIPTION, inputSchema: INPUT_SCHEMA });
  assert.equal(TOOL_NAME, 'set_effort');
  assert.equal(
    TOOL_DESCRIPTION,
    'You start at low reasoning effort. Call this tool to change your effort for your next steps. Reviewing and verifying your work need higher effort: switch to xhigh before you review a change or run your final checks. When you judge that low effort is enough for what comes next, switch back to low.',
  );
  assert.deepEqual(INPUT_SCHEMA, {
    type: 'object',
    properties: { level: { type: 'string', enum: ['low', 'xhigh'] }, reason: { type: 'string' } },
    required: ['level', 'reason'],
  });
  assert.equal(resultText('low'), 'Effort is now low. It applies from your next step.');
  assert.equal(resultText('xhigh'), 'Effort is now xhigh. It applies from your next step.');
  // The hook for the tool is keyed on the plugin-qualified name; other tools pass through.
  assert.deepEqual(m.hooks['tool.call'].map((x) => x.matcher), [{ tool: FULL_TOOL }]);
  assert.deepEqual(await m.call({ tool: 'Read', file_path: 'a' }), { result: 'PASSED ON' });
});

await ta('toggle: a valid call is logged with the request number of the main request that made it', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  await m.step({ turnId: 'T1', effort: 'medium', index: 1 });
  await m.call({ level: 'xhigh', reason: 'check the diff' });
  await m.step({ turnId: 'T1', effort: 'medium', index: 2 });
  await m.call({ level: 'low', reason: 'routine again' });
  const calls = m.log().filter((l) => l.type === 'call');
  assert.deepEqual(calls, [
    { type: 'call', request: 1, agentId: null, level: 'xhigh', reason: 'check the diff', text: 'Effort is now xhigh. It applies from your next step.' },
    { type: 'call', request: 2, agentId: null, level: 'low', reason: 'routine again', text: 'Effort is now low. It applies from your next step.' },
  ]);
});

await ta('placebo: registers the same tool spec as toggle, answers the same text, and rewrites no step', async () => {
  const t0 = await boot({ config: cfg('toggle') });
  const p = await boot({ config: cfg('placebo') });
  await t0.start();
  await p.start();
  assert.deepEqual(p.registered, t0.registered);
  await p.step({ turnId: 'T1', effort: 'medium' });
  const r = await p.call({ level: 'xhigh', reason: 'review' });
  assert.deepEqual(r, { result: resultText('xhigh') });
  const r2 = await p.call({ level: 'low', reason: 'r' });
  assert.deepEqual(r2, { result: resultText('low') });
  for (let i = 1; i < 5; i += 1) {
    const sent = await p.step({ turnId: 'T1', index: i, effort: 'medium' });
    assert.equal(sent.effort, 'medium');
  }
  const log = p.log();
  assert.equal(log.filter((l) => l.type === 'call').length, 2, 'the calls are still logged');
  assert.ok(log.filter((l) => l.type === 'step').every((l) => l.before === l.after), 'no step was rewritten');
  // An invalid call is refused in placebo too.
  assert.deepEqual(await p.call({ level: 'high', reason: 'r' }), { deny: DENY });
});

await ta('random: registers the same tool spec; the main steps levels equal randomLevels(pUp, pDown, seed, firstTurnId, n); calls change nothing', async () => {
  const t0 = await boot({ config: cfg('toggle') });
  await t0.start();
  const m = await boot({ config: cfg('random', { random: RANDOM }) });
  await m.start();
  assert.deepEqual(m.registered, t0.registered);
  const n = 40;
  const expected = randomLevels(RANDOM.pUp, RANDOM.pDown, RANDOM.seed, 'T1', n);
  assert.equal(expected[0], 'low', 'request 0 is low');
  assert.ok(expected.includes('xhigh') && expected.includes('low'), 'the sequence exercises both levels');
  const got = [];
  for (let i = 0; i < n; i += 1) {
    // A later turn continues the chain: it does not reseed (ruling P6).
    const turnId = i < 15 ? 'T1' : i < 30 ? 'T2' : 'T3';
    const sent = await m.step({ turnId, index: i % 15, effort: 'medium' });
    got.push(sent.effort);
    // The model's own set_effort calls are answered but change nothing.
    if (i % 4 === 1) assert.deepEqual(await m.call({ level: i % 8 === 1 ? 'xhigh' : 'low', reason: 'r' }), { result: resultText(i % 8 === 1 ? 'xhigh' : 'low') });
  }
  assert.deepEqual(got, expected);
  const steps = m.log().filter((l) => l.type === 'step');
  assert.deepEqual(steps.map((l) => l.after), expected);
  assert.deepEqual(steps.map((l) => l.request), Array.from({ length: n }, (_, i) => i));
});

await ta('schedule: registers no tool; level = schedule[min(request, length - 1)]; a second turn continues the request number', async () => {
  const m = await boot({ config: cfg('schedule', { schedule: ['low', 'xhigh', 'xhigh', 'low'] }) });
  await m.start();
  assert.equal(m.registered.length, 0);
  const want = ['low', 'xhigh', 'xhigh', 'low', 'low', 'low'];
  const got = [];
  for (let i = 0; i < 3; i += 1) got.push((await m.step({ turnId: 'T1', index: i, effort: 'medium' })).effort);
  // Turn 2: the engine's per-turn index restarts at 0; the request count must not.
  for (let i = 0; i < 3; i += 1) got.push((await m.step({ turnId: 'T2', index: i, effort: 'medium' })).effort);
  assert.deepEqual(got, want);
  assert.deepEqual(m.log().filter((l) => l.type === 'step').map((l) => l.request), [0, 1, 2, 3, 4, 5]);
  assert.equal(m.log().filter((l) => l.type === 'step')[3].turnId, 'T2');
});

await ta('schedule: a one-level schedule holds that level for every request (the fixed arms)', async () => {
  const m = await boot({ config: cfg('schedule', { schedule: ['xhigh'] }) });
  await m.start();
  for (let i = 0; i < 4; i += 1) assert.equal((await m.step({ turnId: 'T1', index: i, effort: 'medium' })).effort, 'xhigh');
});

await ta('subagent steps (agentId set) do not advance the request number, are logged with request null, and get the current main level', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  // A subagent step can come before any main step: no level yet, no rewrite.
  const first = await m.step({ turnId: 'T1', index: 0, agentId: 'agent-1', effort: 'medium' });
  assert.equal(first.effort, 'medium');
  await m.step({ turnId: 'T1', index: 0, effort: 'medium' }); // main request 0
  await m.step({ turnId: 'T1', index: 0, agentId: 'agent-1', effort: 'medium' });
  await m.step({ turnId: 'T1', index: 1, agentId: 'agent-1', effort: 'medium' });
  await m.call({ level: 'xhigh', reason: 'review' });
  const sub = await m.step({ turnId: 'T1', index: 2, agentId: 'agent-2', effort: 'medium' });
  assert.equal(sub.effort, 'xhigh', 'a subagent step gets the current main level');
  const main = await m.step({ turnId: 'T1', index: 1, effort: 'medium' }); // main request 1, not 4
  assert.equal(main.effort, 'xhigh');
  const steps = m.log().filter((l) => l.type === 'step');
  assert.deepEqual(
    steps.map((l) => [l.request, l.agentId]),
    [[null, 'agent-1'], [0, null], [null, 'agent-1'], [null, 'agent-1'], [null, 'agent-2'], [1, null]],
  );
  assert.deepEqual(steps[4], { type: 'step', request: null, index: 2, agentId: 'agent-2', turnId: 'T1', before: 'medium', after: 'xhigh' });
});

await ta('subagent steps in schedule and random mode get the level of the latest main request and do not consume the schedule', async () => {
  const s = await boot({ config: cfg('schedule', { schedule: ['low', 'xhigh', 'low'] }) });
  await s.start();
  assert.equal((await s.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'medium', 'before any main step: no level');
  assert.equal((await s.step({ turnId: 'T1', effort: 'medium' })).effort, 'low'); // request 0
  assert.equal((await s.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'low');
  assert.equal((await s.step({ turnId: 'T1', effort: 'medium' })).effort, 'xhigh'); // request 1
  assert.equal((await s.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'xhigh');
  assert.equal((await s.step({ turnId: 'T1', agentId: 'b', effort: 'medium' })).effort, 'xhigh');
  assert.equal((await s.step({ turnId: 'T1', effort: 'medium' })).effort, 'low'); // request 2

  const r = await boot({ config: cfg('random', { random: { pUp: 1, pDown: 1, seed: 1 } }) });
  await r.start();
  assert.equal((await r.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'medium');
  assert.equal((await r.step({ turnId: 'T1', effort: 'medium' })).effort, 'low'); // request 0
  assert.equal((await r.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'low');
  assert.equal((await r.step({ turnId: 'T1', effort: 'medium' })).effort, 'xhigh'); // request 1
  assert.equal((await r.step({ turnId: 'T1', agentId: 'a', effort: 'medium' })).effort, 'xhigh');
  assert.equal((await r.step({ turnId: 'T1', effort: 'medium' })).effort, 'low'); // request 2
});

await ta('two set_effort calls answered in one message: both logged, the last level applies', async () => {
  for (const [first, second] of [['xhigh', 'low'], ['low', 'xhigh']]) {
    // One after the other.
    const m = await boot({ config: cfg('toggle') });
    await m.start();
    await m.step({ turnId: 'T1', effort: 'medium' });
    await m.call({ level: first, reason: 'a' }, 'toolu_a');
    await m.call({ level: second, reason: 'b' }, 'toolu_b');
    assert.equal((await m.step({ turnId: 'T1', index: 1, effort: 'medium' })).effort, second);
    assert.deepEqual(
      m.log().filter((l) => l.type === 'call').map((l) => [l.request, l.level, l.reason]),
      [[0, first, 'a'], [0, second, 'b']],
    );

    // Started together (parallel tool use): the handler order decides, and no log line is lost.
    const p = await boot({ config: cfg('toggle') });
    await p.start();
    await p.step({ turnId: 'T1', effort: 'medium' });
    await Promise.all([p.call({ level: first, reason: 'a' }, 'toolu_a'), p.call({ level: second, reason: 'b' }, 'toolu_b')]);
    assert.equal((await p.step({ turnId: 'T1', index: 1, effort: 'medium' })).effort, second);
    assert.deepEqual(
      p.log().filter((l) => l.type === 'call').map((l) => [l.level, l.reason]),
      [[first, 'a'], [second, 'b']],
    );
  }
});

await ta('invalid input (level "high", missing reason, empty reason): deny result, level unchanged, one invalid line', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  await m.call({ level: 'xhigh', reason: 'review' });
  const bad = [
    { level: 'high', reason: 'because' },
    { level: 'low' },
    { level: 'low', reason: '' },
    { level: 'xhigh', reason: '   ' },
    { level: 5, reason: 'r' },
    { reason: 'r' },
  ];
  for (const input of bad) assert.deepEqual(await m.call(input), { deny: DENY }, JSON.stringify(input));
  assert.equal((await m.step({ turnId: 'T1', index: 1, effort: 'medium' })).effort, 'xhigh', 'the level is still the last valid one');
  const log = m.log();
  const invalid = log.filter((l) => l.type === 'invalid');
  assert.equal(invalid.length, bad.length, 'one invalid line per refused call');
  assert.deepEqual(invalid[0], { type: 'invalid', request: 0, agentId: null, input: { level: 'high', reason: 'because' } });
  assert.deepEqual(invalid[1].input, { level: 'low' });
  assert.equal(log.filter((l) => l.type === 'call').length, 1, 'only the valid call is a call line');
});

await ta('invalid input with no level chosen yet: the next step is still not rewritten', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  assert.deepEqual(await m.call({ level: 'high', reason: 'r' }), { deny: DENY });
  assert.equal((await m.step({ turnId: 'T1', effort: 'medium' })).effort, 'medium');
});

await ta('missing or malformed config.json: no tool registered, no step rewritten, one error line at the fallback log path', async () => {
  const cases = {
    'no file': undefined,
    'not json': '{ mode: toggle',
    'not an object': '[]',
    'unknown mode': cfg('sometimes'),
    'no logPath': { mode: 'toggle' },
    'empty logPath': { mode: 'toggle', logPath: '' },
    'schedule mode without a schedule': cfg('schedule'),
    'empty schedule': cfg('schedule', { schedule: [] }),
    'schedule with a level that is not allowed': cfg('schedule', { schedule: ['low', 'medium'] }),
    'random mode without random': cfg('random'),
    'random with pUp above 1': cfg('random', { random: { pUp: 1.5, pDown: 0.5, seed: 1 } }),
    'random with a non-number seed': cfg('random', { random: { pUp: 0.5, pDown: 0.5, seed: 'x' } }),
  };
  for (const [label, config] of Object.entries(cases)) {
    const m = await boot({ config });
    const r = await m.start();
    assert.deepEqual(r, { cwd: '/work' }, `${label}: session.start is passed on`);
    assert.equal(m.registered.length, 0, `${label}: no tool`);
    const s0 = await m.step({ turnId: 'T1', effort: 'medium' });
    const s1 = await m.step({ turnId: 'T1', index: 1, agentId: 'a', effort: 'medium' });
    assert.equal(s0.effort, 'medium', label);
    assert.equal(s1.effort, 'medium', label);
    assert.deepEqual([...m.writtenPaths], [FALLBACK_LOG], `${label}: only the fallback log is written`);
    const log = m.log(FALLBACK_LOG);
    assert.equal(log.length, 1, `${label}: one line`);
    assert.equal(log[0].type, 'error', label);
    assert.equal(typeof log[0].message, 'string', label);
    assert.ok(log[0].message.length > 0, label);
    assert.deepEqual(await m.call({ level: 'xhigh', reason: 'r' }), { result: 'PASSED ON' }, `${label}: the tool call is passed on`);
  }
});

await ta('a custom logPath is honoured and the fallback is then not written', async () => {
  const m = await boot({ config: { mode: 'toggle', logPath: '/somewhere/else.jsonl' } });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  assert.deepEqual([...m.writtenPaths], ['/somewhere/else.jsonl']);
  assert.equal(m.log('/somewhere/else.jsonl').length, 1);
});

await ta('the tool spec passed to $.tool.register is deepEqual across toggle, placebo and random', async () => {
  const specs = [];
  for (const config of [cfg('toggle'), cfg('placebo'), cfg('random', { random: RANDOM })]) {
    const m = await boot({ config });
    await m.start();
    assert.equal(m.registered.length, 1);
    specs.push(m.registered[0]);
  }
  assert.deepEqual(specs[1], specs[0]);
  assert.deepEqual(specs[2], specs[0]);
});

await ta('a log write that fails never breaks a request or a tool answer', async () => {
  const m = await boot({ config: cfg('toggle'), failWrites: true });
  await m.start();
  assert.equal((await m.step({ turnId: 'T1', effort: 'medium' })).effort, 'medium');
  assert.deepEqual(await m.call({ level: 'xhigh', reason: 'r' }), { result: resultText('xhigh') });
  assert.equal((await m.step({ turnId: 'T1', index: 1, effort: 'medium' })).effort, 'xhigh');
  assert.deepEqual(await m.call({ level: 'high', reason: 'r' }), { deny: DENY });
});

t('randomLevels: pUp 0 gives all low', () => {
  assert.deepEqual(randomLevels(0, 0.5, 123, 'T1', 6), Array(6).fill('low'));
  assert.deepEqual(randomLevels(0, 1, 9, 'T9', 50), Array(50).fill('low'));
});

t('randomLevels: pUp 1 and pDown 1 alternate low, xhigh, low, ...', () => {
  assert.deepEqual(randomLevels(1, 1, 5, 'T1', 6), ['low', 'xhigh', 'low', 'xhigh', 'low', 'xhigh']);
  assert.deepEqual(randomLevels(1, 1, 5, 'T1', 1), ['low']);
});

t('randomLevels: pUp 1 and pDown 0 climb to xhigh and stay', () => {
  assert.deepEqual(randomLevels(1, 0, 5, 'T1', 4), ['low', 'xhigh', 'xhigh', 'xhigh']);
});

t('randomLevels: n 0 gives an empty list, and a prefix of a longer run is the shorter run', () => {
  assert.deepEqual(randomLevels(0.5, 0.5, 1, 'T1', 0), []);
  const long = randomLevels(0.4, 0.3, 7, 'T1', 40);
  assert.deepEqual(randomLevels(0.4, 0.3, 7, 'T1', 17), long.slice(0, 17));
});

t('randomLevels: equal inputs give equal outputs; two turnIds give different sequences for pUp = pDown = 0.5, n = 32', () => {
  const a = randomLevels(0.5, 0.5, 11, 'turn-a', 32);
  assert.deepEqual(randomLevels(0.5, 0.5, 11, 'turn-a', 32), a);
  const b = randomLevels(0.5, 0.5, 11, 'turn-b', 32);
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(randomLevels(0.5, 0.5, 12, 'turn-a', 32), a, 'the seed matters too');
  assert.equal(a.length, 32);
  assert.ok(a.every((x) => x === 'low' || x === 'xhigh'));
});

t('randomLevels: the sequence is pinned, so a registered seed reproduces the same arm on any machine', () => {
  // The literals were computed by an independent implementation (a Python port of mulberry32 seeded with
  // seed ^ fnv1a32(turnId)), not recorded from register.ts. Changing either function after a seed is registered
  // would silently change the registered arm.
  const L = 'low';
  const X = 'xhigh';
  assert.deepEqual(randomLevels(0.5, 0.5, 42, 'T1', 16), [L, L, X, L, L, L, L, X, X, X, X, L, X, X, X, X]);
  assert.deepEqual(randomLevels(0.4, 0.3, 7, 'T1', 20), [L, L, X, X, L, X, L, X, X, L, L, X, L, X, L, L, X, L, X, X]);
});

// P26: the log fields the arm check (evidence.mjs) and the reader need.
await ta('P26: a subagent call line and an invalid line carry the agentId; a main-loop call carries null; the call line carries the answered text', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  assert.deepEqual(await m.call({ level: 'xhigh', reason: 'r', agentId: 'agent-7' }), { result: resultText('xhigh') });
  assert.deepEqual(await m.call({ level: 'low', reason: 'r2' }), { result: resultText('low') });
  assert.deepEqual(await m.call({ level: 'high', reason: 'r3', agentId: 'agent-8' }), { deny: DENY });
  assert.deepEqual(await m.call({ level: 'high', reason: 'r4' }), { deny: DENY });
  const log = m.log();
  const calls = log.filter((l) => l.type === 'call');
  assert.deepEqual(calls.map((l) => [l.agentId, l.level, l.text]), [
    ['agent-7', 'xhigh', 'Effort is now xhigh. It applies from your next step.'],
    [null, 'low', 'Effort is now low. It applies from your next step.'],
  ]);
  assert.deepEqual(log.filter((l) => l.type === 'invalid').map((l) => l.agentId), ['agent-8', null]);
  // The logged text is exactly what the tool answered, in every mode that answers.
  for (const config of [cfg('placebo'), cfg('random', { random: RANDOM })]) {
    const p = await boot({ config });
    await p.start();
    await p.step({ turnId: 'T1', effort: 'medium' });
    const r = await p.call({ level: 'xhigh', reason: 'r' });
    assert.equal(p.log().find((l) => l.type === 'call').text, r.result);
  }
});

await ta('P26: the step line carries the engine index, which restarts every turn while request does not', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  for (const [turnId, index] of [['T1', 0], ['T1', 1], ['T1', 2], ['T2', 0], ['T2', 1]]) await m.step({ turnId, index, effort: 'medium' });
  await m.step({ turnId: 'T2', index: 5, agentId: 'agent-1', effort: 'medium' });
  const steps = m.log().filter((l) => l.type === 'step');
  assert.deepEqual(steps.map((l) => l.index), [0, 1, 2, 0, 1, 5]);
  assert.deepEqual(steps.map((l) => l.request), [0, 1, 2, 3, 4, null]);
});

await ta('P26: the reserved key consent (and tool, tool_use_id, agentId) is not logged in an invalid input', async () => {
  const m = await boot({ config: cfg('toggle') });
  await m.start();
  await m.step({ turnId: 'T1', effort: 'medium' });
  await m.call({ level: 'high', reason: 'because', consent: 'The user pressed "1: Yes" on ...', agentId: 'agent-1' });
  const invalid = m.log().filter((l) => l.type === 'invalid');
  assert.equal(invalid.length, 1);
  assert.deepEqual(invalid[0], { type: 'invalid', request: 0, agentId: 'agent-1', input: { level: 'high', reason: 'because' } });
  assert.ok(!m.files.get(LOG).includes('pressed'), 'the consent text is nowhere in the log');
  // A valid call carrying consent is logged without it too, and is still answered.
  assert.deepEqual(await m.call({ level: 'low', reason: 'r', consent: 'x' }), { result: resultText('low') });
  assert.ok(!m.files.get(LOG).includes('"consent"'));
});
