// batch-world.mjs — a directory that looks like what buildTask and gateTask leave under a work root, built by hand and cheaply, for the
// runBatch tests that inject their own runOne (no git repository, no Docker, no reflink filesystem).
//
//   makeWorld(dir, specs) -> { workRoot, tasks, tamper }
//
//   spec   { id, repo = 'claude-plugins', testRunner = 'node', gate = 'ok' | 'missing' | 'not-ok', cargoHome? }
//   tasks  [{ id, repo, testRunner, dir, treeHash, hiddenHash, promptHash }]    the hashes are hashBuiltTask's, which is the one definition
//
// <workRoot>/tasks/<id>/{tree/, hidden/, prompt.txt, manifest.json, gate.json} are written the way build-task.mjs and gate-task.mjs
// write them (the manifest has the keys buildTask writes, gate.json the keys of R35). A cargo-home directory is made under the work
// root when any spec has `cargoHome: true`. `tamper(id, 'tree' | 'hidden' | 'prompt')` changes one part AFTER the hashes were taken,
// so that exactly one of the three hashes no longer matches the manifest.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashBuiltTask } from '../build-task.mjs';

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function makeWorld(dir, specs) {
  const workRoot = path.join(dir, 'work');
  mkdirSync(path.join(workRoot, 'tasks'), { recursive: true });
  const tasks = [];
  for (const spec of specs) {
    const { id, repo = 'claude-plugins', testRunner = 'node', gate = 'ok' } = spec;
    const taskDir = path.join(workRoot, 'tasks', id);
    write(path.join(taskDir, 'tree', 'lib.mjs'), `export const id = ${JSON.stringify(id)};\n`);
    write(path.join(taskDir, 'tree', 'src', 'more.mjs'), 'export const more = 1;\n');
    write(path.join(taskDir, 'hidden', 'tests', 'hidden.test.mjs'), `// hidden test of ${id}\n`);
    write(path.join(taskDir, 'prompt.txt'), `Fix the bug in ${id}.\n`);
    const { treeHash, hiddenHash, promptHash } = hashBuiltTask(taskDir);
    write(path.join(taskDir, 'manifest.json'), `${JSON.stringify({
      id, repo, fix: 'f'.repeat(40), parent: 'a'.repeat(40), baseCommit: 'b'.repeat(40), treeHash, hiddenHash, promptHash, taskMdHash: 'c'.repeat(64),
      def: { id, repo, testRunner, testPatterns: ['node tests/'] },
    }, null, 2)}\n`);
    if (gate !== 'missing') {
      write(path.join(taskDir, 'gate.json'), `${JSON.stringify({
        ok: gate === 'ok', reasons: gate === 'ok' ? [] : ['fails_at_fix'], atParent: null, atFix: [], treeHash, hiddenHash, gatedAt: '2026-10-09T00:00:00.000Z', leftover: null,
      }, null, 2)}\n`);
    }
    tasks.push({ id, repo, testRunner, dir: taskDir, treeHash, hiddenHash, promptHash });
  }
  if (specs.some((s) => s.cargoHome === true)) mkdirSync(path.join(workRoot, 'cargo-home'), { recursive: true });

  // One part of a built task is changed after the manifest and gate.json were written.
  function tamper(id, part) {
    const taskDir = path.join(workRoot, 'tasks', id);
    const file = { tree: path.join(taskDir, 'tree', 'lib.mjs'), hidden: path.join(taskDir, 'hidden', 'tests', 'hidden.test.mjs'), prompt: path.join(taskDir, 'prompt.txt') }[part];
    if (file === undefined) throw new Error(`tamper: unknown part ${part}`);
    writeFileSync(file, `tampered ${part}\n`);
  }
  return { workRoot, tasks, tamper };
}
