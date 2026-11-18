import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const statuses = new Set(['measured', 'documented', 'unsupported', 'unverified']);
const nonempty = (v) => typeof v === 'string' && v.trim().length > 0;

/** Validate evidence metadata; a successful process is never delivery evidence. */
export function validateManifest(value) {
  if (value?.version !== 1 || !Array.isArray(value.rows)) throw new Error('unsupported manifest version or rows');
  for (const row of value.rows) {
    if (!['claude-code', 'codex'].includes(row.harness) || !nonempty(row.hostVersion)) throw new Error('host and host version are required');
    if (!nonempty(row.os) || !statuses.has(row.status) || !nonempty(row.reason)) throw new Error('invalid evidence status or reason');
    if (!Array.isArray(row.fixtures)) throw new Error('fixtures must be an array');
    if (row.status === 'measured' && !row.fixtures.some((f) => f.synthetic === false)) throw new Error('measured status requires real fixture evidence');
    for (const fixture of row.fixtures) {
      if (!nonempty(fixture.file) || !/^[a-f0-9]{64}$/.test(fixture.sha256) || typeof fixture.synthetic !== 'boolean') throw new Error('invalid fixture evidence');
    }
  }
  return value;
}

/** Capture metadata is supplied by the probe operator, never the model's tool input. */
export function assessHookCapture({ harness, profileRoot, capture }) {
  const reject = (reason, origin = 'unknown') => ({ supported: false, origin, reason });
  if (!capture || !nonempty(profileRoot) || resolve(capture.profileRoot || '.') !== resolve(profileRoot)) return reject('capture belongs to a different profile');
  if (!['claude-code', 'codex'].includes(harness) || !nonempty(capture.input?.session_id)) return reject('missing native conversation identity');
  const proof = capture.rootDiscriminator;
  if (!proof || proof.field !== 'agent_id' || proof.absentMeansRoot !== true || !nonempty(proof.evidenceRef) || proof.measuredVersion !== capture.hostVersion) return reject('root/subagent identity is not measured for this host version');
  const id = capture.input.agent_id;
  if (id !== undefined && id !== null && id !== '') return reject('subagent-owned jobs are not supported', 'subagent');
  return { supported: true, origin: 'root', reason: 'root identity matches versioned native capture evidence' };
}

/** Inspect explicitly supplied captures. This function never launches a host or guesses an endpoint. */
export async function probeCapabilities({ harness, profileRoot, endpointRef = null, outputDir = null, captureDir = null, platform = process.platform }) {
  if (!['claude-code', 'codex'].includes(harness) || !nonempty(profileRoot)) throw new Error('explicit harness and profileRoot are required');
  const row = { harness, hostVersion: 'unmeasured', os: platform, status: 'unverified', reason: 'No native captures were supplied; wake capability is not measured.', fixtures: [], ready: false, endpointConfigured: nonempty(endpointRef) };
  if (captureDir) {
    for (const file of (await readdir(captureDir)).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort()) {
      const bytes = await readFile(join(captureDir, file));
      if (bytes.length > 2 * 1024 * 1024) throw new Error('capture exceeds probe budget');
      const capture = JSON.parse(bytes);
      if (capture.captureKind !== 'native-hook' || capture.harness !== harness || capture.os !== platform) continue;
      if (!nonempty(capture.hostVersion) || capture.hostVersion === 'unmeasured') throw new Error('capture has no measured host version');
      if (resolve(capture.profileRoot || '.') !== resolve(profileRoot)) throw new Error('capture profile does not match explicit profile');
      if (row.hostVersion !== 'unmeasured' && row.hostVersion !== capture.hostVersion) throw new Error('mixed host versions require separate reports');
      row.hostVersion = capture.hostVersion;
      row.fixtures.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), synthetic: capture.synthetic !== false });
    }
    if (row.fixtures.some((f) => !f.synthetic)) {
      row.status = 'measured';
      row.reason = 'Native hook shape captured. Non-destructive attach, permission callback survival and complete delivery remain separate unverified release gates.';
    }
  }
  const report = validateManifest({ version: 1, rows: [row] });
  if (outputDir) {
    await mkdir(outputDir, { recursive: true, mode: 0o700 });
    await writeFile(join(outputDir, 'capabilities.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = {};
  const names = { '--harness': 'harness', '--profile-root': 'profileRoot', '--endpoint': 'endpointRef', '--capture-dir': 'captureDir', '--output-dir': 'outputDir' };
  try {
    for (let i = 0; i < args.length; i += 2) {
      if (!names[args[i]] || !args[i + 1]) throw new Error('usage: --harness NAME --profile-root PATH [--capture-dir PATH] [--output-dir PATH] [--endpoint ENDPOINT]');
      options[names[args[i]]] = args[i + 1];
    }
    process.stdout.write(`${JSON.stringify(await probeCapabilities(options), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
