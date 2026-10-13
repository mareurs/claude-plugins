import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureTrace, runStage0 } from './r1-stage0.mjs';

let failed = false;
async function t(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failed = true;
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
  }
}

const OUTPUT = '---- x::y stdout ----\nthread panicked at src/lib.rs:1:1:\nstack backtrace:\n   0: f\n             at ./src/lib.rs:34:9\n';
const manifest = (over = {}) => ({
  id: 'cs-x', repo: 'codescout',
  def: { testRunner: 'cargo', f2p: { command: ['cargo', 'test', '--lib'], names: ['x::y'] }, ...over },
});

// A fake gradeTree: it keeps a grade directory holding results/f2p.out, as S5_KEEP_GRADES=1 does.
function fakeGrade(scratch, seen) {
  return async (m, treeDir, options) => {
    seen.manifest = m;
    seen.treeDir = treeDir;
    seen.options = options;
    seen.keepEnv = process.env.S5_KEEP_GRADES;
    const kept = join(scratch, 'kept');
    mkdirSync(join(kept, 'results'), { recursive: true });
    writeFileSync(join(kept, 'results', 'f2p.out'), OUTPUT);
    return { kept };
  };
}

const scratch = mkdtempSync(join(tmpdir(), 'r1-stage0-'));
try {
  await t('captureTrace runs the f2p command under env RUST_BACKTRACE=1 on the task tree and returns f2p.out', async () => {
    const seen = {};
    const before = process.env.S5_KEEP_GRADES;
    const text = await captureTrace(manifest(), { workRoot: '/w', image: 'img', cpus: 4, memoryGb: 8, grade: fakeGrade(scratch, seen) });
    assert.equal(text, OUTPUT);
    assert.deepEqual(seen.manifest.def.f2p.command.slice(0, 3), ['env', 'RUST_BACKTRACE=1', 'cargo']);
    assert.equal(seen.treeDir, '/w/tasks/cs-x/tree');
    assert.equal(seen.options.runId, 'r1-cs-x');
    assert.equal(seen.options.workRoot, '/w');
    assert.equal(seen.options.image, 'img');
    assert.equal(seen.options.cpus, 4);
    assert.equal(seen.options.memoryGb, 8);
    assert.equal(seen.keepEnv, '1');
    assert.equal(process.env.S5_KEEP_GRADES, before, 'the variable is restored');
  });

  await t('captureTrace does not change the manifest it was given', async () => {
    const m = manifest();
    await captureTrace(m, { workRoot: '/w', image: 'img', grade: fakeGrade(scratch, {}) });
    assert.deepEqual(m.def.f2p.command, ['cargo', 'test', '--lib']);
  });

  await t('captureTrace removes the kept grade directory', async () => {
    await captureTrace(manifest(), { workRoot: '/w', image: 'img', grade: fakeGrade(scratch, {}) });
    assert.equal(existsSync(join(scratch, 'kept')), false);
  });

  await t('captureTrace restores S5_KEEP_GRADES when grade throws', async () => {
    const before = process.env.S5_KEEP_GRADES;
    await assert.rejects(captureTrace(manifest(), { workRoot: '/w', image: 'img', grade: async () => { throw new Error('boom'); } }), /boom/);
    assert.equal(process.env.S5_KEEP_GRADES, before);
  });

  await t('captureTrace refuses a task that is not cargo', async () => {
    await assert.rejects(captureTrace(manifest({ testRunner: 'node' }), { workRoot: '/w', image: 'img', grade: fakeGrade(scratch, {}) }), /cargo/);
  });

  await t('captureTrace throws when grade keeps nothing', async () => {
    await assert.rejects(captureTrace(manifest(), { workRoot: '/w', image: 'img', grade: async () => ({ kept: null }) }), /kept/);
  });

  await t('runStage0 writes the output, the prompt and the report, and counts the usable tasks', async () => {
    const work = join(scratch, 'work');
    const out = join(scratch, 'out');
    for (const id of ['cs-a', 'cs-b']) {
      mkdirSync(join(work, 'tasks', id), { recursive: true });
      writeFileSync(join(work, 'tasks', id, 'manifest.json'), JSON.stringify({ id, repo: 'codescout', def: { testRunner: 'cargo', f2p: { command: ['cargo', 'test'], names: ['x::y'] }, scrub: { terms: ['bad_term'] } } }));
    }
    // cs-a gets a clean trace; cs-b gets output that holds a scrub term.
    const capture = async (m) => (m.id === 'cs-a' ? OUTPUT : `${OUTPUT}bad_term\n`);
    const logs = [];
    const { report, usable } = await runStage0({ workRoot: work, outRoot: out, taskIds: ['cs-a', 'cs-b'], capture, log: (l) => logs.push(l) });
    assert.equal(usable, 1);
    assert.deepEqual(report.map((r) => [r.id, r.ok]), [['cs-a', true], ['cs-b', false]]);
    assert.deepEqual(report[1].reasons, ['leak:bad_term']);
    assert.equal(report[0].f2pNamesShown, true);
    assert.equal(readFileSync(join(out, 'stage0', 'cs-a.f2p.out'), 'utf8'), OUTPUT);
    const prompt = readFileSync(join(out, 'stage0', 'cs-a.prompt.txt'), 'utf8');
    assert.ok(prompt.endsWith('Please fix it.\n'));
    assert.equal(report[0].promptSha256, createHash('sha256').update(prompt).digest('hex'));
    assert.equal(report[0].chars, prompt.length);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'stage0', 'report.json'), 'utf8')), report);
    assert.equal(logs.length, 2);
  });

  await t('runStage0 reports a task with no failure block as not ok', async () => {
    const work = join(scratch, 'work2');
    mkdirSync(join(work, 'tasks', 'cs-c'), { recursive: true });
    writeFileSync(join(work, 'tasks', 'cs-c', 'manifest.json'), JSON.stringify({ id: 'cs-c', repo: 'codescout', def: { testRunner: 'cargo', f2p: { command: ['cargo', 'test'], names: [] } } }));
    const { report, usable } = await runStage0({ workRoot: work, outRoot: join(scratch, 'out2'), taskIds: ['cs-c'], capture: async () => 'running 0 tests\n', log: () => {} });
    assert.equal(usable, 0);
    assert.deepEqual(report[0].reasons, ['no_failure_block']);
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed) process.exitCode = 1;
