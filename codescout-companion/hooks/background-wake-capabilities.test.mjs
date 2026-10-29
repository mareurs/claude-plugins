import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const probeUrl = new URL('../../tools/probe-background-wake.mjs', import.meta.url);
let api;
try { api = await import(probeUrl.href); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || error.url !== probeUrl.href) throw error; }
const requireApi = () => { assert.ok(api, 'background wake capability probe is not implemented'); return api; };
const row = (overrides = {}) => ({ harness: 'codex', hostVersion: '0.165.0', os: 'linux', status: 'unverified', reason: 'not captured', fixtures: [], ...overrides });
const report = (rows) => ({ version: 1, rows });

test('manifestRejectsMissingVersion', () => {
  const { validateManifest } = requireApi();
  assert.throws(() => validateManifest(report([row({ hostVersion: undefined })])), /version/i);
});
test('probeDoesNotClaimSkippedWindows', async () => {
  const { probeCapabilities } = requireApi();
  const result = await probeCapabilities({ harness: 'codex', profileRoot: '/not-probed', endpointRef: null, platform: 'win32' });
  assert.equal(result.rows[0].status, 'unverified');
  assert.match(result.rows[0].reason, /capture|measure/i);
});
test('unsupportedDoesNotBecomeMeasuredFromExitZero', () => {
  const { validateManifest } = requireApi();
  assert.throws(() => validateManifest(report([row({ status: 'measured', reason: 'No real fixture evidence', fixtures: [] })])), /evidence|fixture/i);
});
test('wrongProfileIsRejected', () => {
  const { assessHookCapture } = requireApi();
  const result = assessHookCapture({ harness: 'claude-code', profileRoot: '/profile-a', capture: { profileRoot: '/profile-b', input: { session_id: 'root', cwd: '/work' } } });
  assert.equal(result.supported, false);
  assert.match(result.reason, /profile/i);
});
test('ambiguousRootProofDisablesAdapter', () => {
  const { assessHookCapture } = requireApi();
  const result = assessHookCapture({ harness: 'codex', profileRoot: '/profile', capture: { profileRoot: '/profile', input: { session_id: 'parent', cwd: '/work' }, rootDiscriminator: null } });
  assert.equal(result.supported, false);
  assert.match(result.reason, /root|subagent/i);
});
test('rootAndSubagentAreDistinguishable', () => {
  const { assessHookCapture } = requireApi();
  const base = { harness: 'claude-code', profileRoot: '/profile' };
  const input = { session_id: 'same-parent', cwd: '/work' };
  const evidence = { field: 'agent_id', absentMeansRoot: true, measuredVersion: '2.1.312', evidenceRef: 'claude-shape' };
  const root = assessHookCapture({ ...base, capture: { profileRoot: '/profile', hostVersion: '2.1.312', input, rootDiscriminator: evidence } });
  const child = assessHookCapture({ ...base, capture: { profileRoot: '/profile', hostVersion: '2.1.312', input: { ...input, agent_id: 'child' }, rootDiscriminator: evidence } });
  assert.equal(root.supported, true);
  assert.equal(root.origin, 'root');
  assert.equal(child.supported, false);
  assert.equal(child.origin, 'subagent');
});
test('rootEvidenceCannotBeBorrowedAcrossVersions', () => {
  const { assessHookCapture } = requireApi();
  const result = assessHookCapture({ harness: 'claude-code', profileRoot: '/profile', capture: { profileRoot: '/profile', hostVersion: '9.9', input: { session_id: 'root', cwd: '/work' }, rootDiscriminator: { field: 'agent_id', absentMeansRoot: true, measuredVersion: '2.1.312', evidenceRef: 'old' } } });
  assert.equal(result.supported, false);
});
test('committedManifestHasVersionedHonestEvidence', async () => {
  const { validateManifest } = requireApi();
  const url = new URL('../contracts/fixtures/background-wake/manifest.json', import.meta.url);
  const manifest = validateManifest(JSON.parse(await readFile(url, 'utf8')));
  assert.ok(manifest.rows.some((r) => r.os === 'win32' && r.status === 'unverified'));
  assert.ok(manifest.rows.every((r) => r.hostVersion && r.reason));
});
