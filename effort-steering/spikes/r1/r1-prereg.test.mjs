import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t } from '../../core/testkit.mjs';
import { loadS5Config } from '../s5/prereg.mjs';
import { makeR1Prereg, serializePrereg, stageConfig, verifyRegistered } from './r1-prereg.mjs';

const hex = (c) => c.repeat(64);
const base = {
  model: 'claude-sonnet-5-5',
  cli: { version: '2.1.296', sha256: `sha256:${hex('a')}` },
  mechanism: { alpha: 0.05, permutations: 9999, seed: 1, effectSizeThinkingTokens: 500 },
  limits: { timeoutMinutes: 60, cpus: 4, memoryGb: 8, concurrency: 1, infraRetries: 2 },
  images: { codescout: `sha256:${hex('b')}`, 'claude-plugins': `sha256:${hex('c')}`, proxy: `sha256:${hex('d')}` },
  proxyAllowlist: ['api.anthropic.com'],
};
const tasks = [
  { id: 'cs-p01', treeHash: hex('1'), hiddenHash: hex('2'), promptHash: hex('3') },
  { id: 'cs-p05', treeHash: hex('4'), hiddenHash: hex('5'), promptHash: hex('6') },
];
const make = () => makeR1Prereg({ base, tasks, orderSeed: 20261013, bound: { method: 'paired-t', resamples: 0, seed: 1 } });

const scratch = mkdtempSync(join(tmpdir(), 'r1-prereg-'));
t('makeR1Prereg holds the registered values of the spec', () => {
  const p = make();
  assert.equal(p.margin, 0.15);
  assert.equal(p.alpha, 0.05);
  assert.deepEqual(p.arms, {
    A: { effort: 'xhigh', steer: false, runs: 2 },
    B: { effort: 'xhigh', steer: true, runs: 0 },
    C: { effort: 'low', steer: false, runs: 2 },
  });
  assert.equal(p.orderSeed, 20261013);
  assert.equal(p.stopAtCostUsd, 60);
  assert.deepEqual(p.tasks, tasks);
  assert.equal(p.model, base.model);
  assert.deepEqual(p.images, base.images);
});

t('makeR1Prereg output loads through loadS5Config in calibrate mode and is canonical', () => {
  const file = join(scratch, 'prereg.json');
  writeFileSync(file, serializePrereg(make()));
  const loaded = loadS5Config(file, { mode: 'calibrate' });
  assert.equal(loaded.arms.B.runs, 0);
  assert.equal(loaded.arms.C.runs, 2);
  assert.equal(loaded.registered, false);
});

t('makeR1Prereg refuses a task list that does not carry the three hashes', () => {
  assert.throws(() => makeR1Prereg({ base, tasks: [{ ...tasks[0], promptHash: undefined }], orderSeed: 1, bound: { method: 'paired-t', resamples: 0, seed: 1 } }), /promptHash/);
});

t('stageConfig 1 zeroes arm A only, stage 2 zeroes arm C only, nothing else changes', () => {
  const p = make();
  const s1 = stageConfig(p, 1);
  const s2 = stageConfig(p, 2);
  assert.equal(s1.arms.A.runs, 0);
  assert.equal(s1.arms.C.runs, 2);
  assert.equal(s2.arms.C.runs, 0);
  assert.equal(s2.arms.A.runs, 2);
  assert.deepEqual({ ...s1, arms: null }, { ...p, arms: null });
  assert.deepEqual({ ...s2, arms: null }, { ...p, arms: null });
  assert.equal(p.arms.A.runs, 2, 'the input is not changed');
  assert.throws(() => stageConfig(p, 3), /stage/);
});

t('both stage configs load in calibrate mode', () => {
  for (const stage of [1, 2]) {
    const file = join(scratch, `stage${stage}.json`);
    writeFileSync(file, serializePrereg(stageConfig(make(), stage)));
    assert.doesNotThrow(() => loadS5Config(file, { mode: 'calibrate' }));
  }
});

t('verifyRegistered refuses a file that git does not track', () => {
  const file = join(scratch, 'untracked.json');
  writeFileSync(file, serializePrereg(make()));
  assert.throws(() => verifyRegistered(file), /not committed/);
});

rmSync(scratch, { recursive: true, force: true });
