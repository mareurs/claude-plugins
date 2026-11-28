import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parentOf, ownAncestry } from './lib.mjs';

test('parentOf answers a parent pid for the running process on Linux and macOS', { skip: process.platform === 'win32' }, () => {
  const ppid = parentOf(process.pid);
  assert.equal(typeof ppid, 'number');
  assert.ok(ppid > 0);
});

// On Windows the only reachable `ps` rejects `-o`, so the answer is null; the hook must say so
// without starting a process (about 0.2 s each under endpoint protection).
test('parentOf answers null on Windows without starting a process', { skip: process.platform !== 'win32' }, () => {
  const t0 = process.hrtime.bigint();
  assert.equal(parentOf(process.pid), null);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 50, `parentOf took ${ms.toFixed(0)} ms: it started a process`);
});

test('ownAncestry always contains the running process', () => {
  assert.ok(ownAncestry().has(process.pid));
});
