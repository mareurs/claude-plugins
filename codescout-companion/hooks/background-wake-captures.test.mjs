import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCapabilities, assessHookCapture } from '../../tools/probe-background-wake.mjs';

const fixtureDir = new URL('../contracts/fixtures/background-wake/', import.meta.url);
test('nativeCapturedShapesAreNormalizedWithoutBorrowingAnotherProfile', async () => {
  for (const [prefix, harness, shape] of [['claude', 'claude-code', 'array'], ['codex', 'codex', 'object']]) {
    const capture = JSON.parse(await readFile(new URL(`${prefix}-root-spawn.json`, fixtureDir), 'utf8'));
    assert.equal(Array.isArray(capture.input.tool_response) ? 'array' : typeof capture.input.tool_response, shape);
    assert.equal(assessHookCapture({ harness, profileRoot: capture.profileRoot, capture }).supported, true);
    const child = JSON.parse(await readFile(new URL(`${prefix}-subagent.json`, fixtureDir), 'utf8'));
    assert.equal(assessHookCapture({ harness, profileRoot: capture.profileRoot, capture: child }).origin, 'subagent');
    const measured = await probeCapabilities({ harness, profileRoot: capture.profileRoot, captureDir: fileURLToPath(fixtureDir) });
    assert.equal(measured.rows[0].status, 'measured');
    assert.equal(measured.rows[0].ready, false);
    assert.equal(measured.rows[0].fixtures.length, 3);
  }
});
test('mixedNativeVersionsAreRejected', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wake-captures-'));
  try {
    const a = JSON.parse(await readFile(new URL('claude-root-spawn.json', fixtureDir), 'utf8'));
    await writeFile(join(dir, 'a.json'), JSON.stringify(a));
    await writeFile(join(dir, 'b.json'), JSON.stringify({ ...a, hostVersion: '999.0' }));
    await assert.rejects(probeCapabilities({ harness: 'claude-code', profileRoot: a.profileRoot, captureDir: dir }), /mixed host versions/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
