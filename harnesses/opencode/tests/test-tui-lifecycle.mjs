// Exercise actual setup/cleanup; only the unavailable OpenTUI/Solid runtime is stubbed.
// This runs in its own process (the adapter runner discovers test-*.mjs).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const stub = 'data:text/javascript,' + encodeURIComponent(`
export const createSignal = (initial) => {
  let value = initial;
  return [() => value, (next) => value = typeof next === 'function' ? next(value) : next];
};
`);
const loader = `
export async function resolve(specifier, context, next) {
  if (['@opentui/solid', 'solid-js', '@opentui/core'].includes(specifier)) {
    return { url: ${JSON.stringify(stub)}, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loader), import.meta.url);

const root = mkdtempSync(join(tmpdir(), 'oc-tui-lifecycle-'));
const savedEnv = { BUDDY_HOME: process.env.BUDDY_HOME, OPENCODE_HINT_ECHO_DIR: process.env.OPENCODE_HINT_ECHO_DIR };
process.env.BUDDY_HOME = join(root, 'buddy-home');
process.env.OPENCODE_HINT_ECHO_DIR = join(root, 'hints');
let pass = 0;
try {
  for (const [name, periods, listens] of [
    ['buddy', [3000], true],
    ['statusline', [1000, 5000], true],
    ['hint-echo', [750], false],
  ]) {
    const original = { setInterval, clearInterval, setTimeout, clearTimeout };
    const intervals = [];
    const cleared = [];
    const timeouts = [];
    const clearedTimeouts = [];
    let listener;
    let unlistened = 0;
    try {
      globalThis.setInterval = (fn, ms) => {
        const handle = { fn, ms };
        intervals.push(handle);
        return handle;
      };
      globalThis.clearInterval = (handle) => cleared.push(handle);
      globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms !== 300) return original.setTimeout(fn, ms, ...args);
        const handle = { fn, ms };
        timeouts.push(handle);
        return handle;
      };
      globalThis.clearTimeout = (handle) => {
        if (timeouts.includes(handle)) clearedTimeouts.push(handle);
        else original.clearTimeout(handle);
      };
      const { default: plugin } = await import(`../tui/${name}/tui.js`);
      const api = {
        location: { directory: root },
        data: {
          session: { get: () => undefined },
          listen: (fn) => { listener = fn; return () => { unlistened++; }; },
        },
        ui: { slot: () => {} },
      };
      const cleanup = await plugin.setup(api);
      assert.equal(typeof cleanup, 'function', name + ' must finish setup');
      assert.deepEqual(intervals.map((t) => t.ms), periods);
      assert.deepEqual(cleared, []);
      if (listens) {
        assert.equal(typeof listener, 'function');
        listener({ details: { type: 'session.created' } });
      }
      if (name === 'buddy') assert.equal(timeouts.length, 1, 'exercise the pending debounce');
      cleanup();
      assert.deepEqual(cleared, intervals, 'every polling timer must be cleared');
      assert.equal(unlistened, listens ? 1 : 0, 'event subscriptions must be released');
      if (name === 'buddy') assert.deepEqual(clearedTimeouts, timeouts, 'pending debounce must be cleared');
      pass++;
      console.log(`  PASS: ${name} setup releases timers and event listeners on unload`);
    } catch (e) {
      process.exitCode = 1;
      console.log(`  FAIL: ${name} setup lifecycle\n        ${e.message}`);
    } finally {
      Object.assign(globalThis, original);
    }
  }
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
}
console.log(`\nResults: ${pass} passed, ${process.exitCode ? 'FAILURES above' : '0 failed'}`);
