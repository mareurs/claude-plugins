// runtime-floor.test.mjs — the wake engine's runtime floor: Node 22 and Python 3.12.
//
// WHY THIS EXISTS (issue #18, item 1). The engine refused anything below Node 24 and Python 3.13
// through two inline `if` checks that nothing tested. Measured 2026-11-17: all 34 background-wake
// suites pass on Node 22.23.5 and Python 3.12.12 once those two checks are removed, so the floor
// is a support decision and not a technical limit. The floor is now Node 22 and Python 3.12, and
// each check is a function a test can call with any version.
//
// The tests do not depend on the host's own runtimes: they pass versions in. Only the last test
// of each group reads the host, and it checks that the host meets the floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const api = await import(new URL('./platform-node.mjs', import.meta.url));

// ---- Node ----------------------------------------------------------------------------------

test('nodeFloorIsExportedAndIs22', () => {
  assert.equal(api.MIN_NODE_MAJOR, 22);
});

test('nodeVersionsAtOrAboveTheFloorAreSupported', () => {
  assert.equal(typeof api.nodeVersionSupported, 'function', 'platform-node.mjs must export nodeVersionSupported');
  // 22.0.0 is the floor itself, 24.x is the version the engine was first built on, and 26 is newer than both.
  for (const v of ['22.0.0', '22.23.5', '23.11.0', '24.0.0', '24.22.3', '26.13.1']) {
    assert.equal(api.nodeVersionSupported(v), true, v);
  }
});

test('nodeVersionsBelowTheFloorAreNotSupported', () => {
  assert.equal(typeof api.nodeVersionSupported, 'function', 'platform-node.mjs must export nodeVersionSupported');
  for (const v of ['21.7.3', '20.19.0', '18.20.4', '8.0.0']) {
    assert.equal(api.nodeVersionSupported(v), false, v);
  }
});

test('anUnreadableNodeVersionIsNotSupported', () => {
  // `Number('')` and `Number('x')` are NaN, and `NaN < 22` is false: a comparison written the
  // obvious way lets an unreadable version through. Refuse it instead.
  assert.equal(typeof api.nodeVersionSupported, 'function', 'platform-node.mjs must export nodeVersionSupported');
  for (const v of ['', 'garbage', '.', undefined, null]) {
    assert.equal(api.nodeVersionSupported(v), false, String(v));
  }
});

test('theNodeGateNamesTheFloorInItsMessage', () => {
  assert.equal(typeof api.assertSupportedNode, 'function', 'platform-node.mjs must export assertSupportedNode');
  assert.throws(() => api.assertSupportedNode('21.7.3'), /Node 22 or newer is required/);
  assert.doesNotThrow(() => api.assertSupportedNode('22.0.0'));
  assert.doesNotThrow(() => api.assertSupportedNode('24.0.0'));
});

test('theRunningNodeMeetsTheFloor', () => {
  assert.equal(typeof api.assertSupportedNode, 'function', 'platform-node.mjs must export assertSupportedNode');
  assert.doesNotThrow(() => api.assertSupportedNode());
});

// ---- Python (receipt_txn.py) ----------------------------------------------------------------
// The helper is a Python module, so it is asked in Python. `-I` isolates the interpreter from
// the caller's environment; the module's own directory is added to sys.path by hand.

const python = process.platform === 'win32' ? 'python' : 'python3';
const ask = (body) => JSON.parse(execFileSync(python, ['-I', '-c',
  `import sys, json\nsys.path.insert(0, ${JSON.stringify(here)})\nimport receipt_txn as r\n${body}`], {encoding: 'utf8'}));
const ver = (major, minor, micro) => `(${major}, ${minor}, ${micro}, 'final', 0)`;

test('pythonFloorIsExportedAndIs312', () => {
  assert.deepEqual(ask('print(json.dumps(list(r.MIN_PYTHON)))'), [3, 12]);
});

test('pythonVersionsAtOrAboveTheFloorAreSupported', () => {
  const got = ask(`print(json.dumps([r.runtime_supported(v) for v in [${ver(3, 12, 0)}, ${ver(3, 12, 12)}, ${ver(3, 13, 0)}, ${ver(3, 14, 10)}, ${ver(4, 0, 0)}]]))`);
  assert.deepEqual(got, [true, true, true, true, true]);
});

test('pythonVersionsBelowTheFloorAreNotSupported', () => {
  const got = ask(`print(json.dumps([r.runtime_supported(v) for v in [${ver(3, 11, 9)}, ${ver(3, 9, 18)}, ${ver(2, 7, 18)}]]))`);
  assert.deepEqual(got, [false, false, false]);
});

test('theMinorVersionIsComparedAsANumber', () => {
  // As text '9' > '12', so 3.9 would pass a string comparison against 3.12.
  const got = ask(`print(json.dumps([r.runtime_supported(${ver(3, 9, 0)}), r.runtime_supported(${ver(3, 10, 0)}), r.runtime_supported(${ver(3, 11, 0)})]))`);
  assert.deepEqual(got, [false, false, false]);
});

test('thePythonGateNamesTheFloorInItsMessage', () => {
  const got = ask(`
def outcome(v):
    try:
        r.check_runtime(v)
        return 'ok'
    except RuntimeError as e:
        return str(e)
print(json.dumps([outcome(${ver(3, 11, 9)}), outcome(${ver(3, 12, 0)}), outcome(${ver(3, 13, 0)})]))`);
  assert.deepEqual(got, ['Python 3.12 or newer is required', 'ok', 'ok']);
});

test('theRunningPythonMeetsTheFloor', () => {
  assert.deepEqual(ask('print(json.dumps([r.runtime_supported(), r.check_runtime()]))'), [true, null]);
});
