// r1-workroot.mjs — the second work root of the R1 experiment: each usable task is a reflink copy of its S5 built task with
// prompt.txt replaced by the trace prompt and manifest.promptHash updated. The S5 work root stays intact; the S5 runner runs on
// the new root unchanged (it reads <root>/tasks/<id>/prompt.txt and checks its sha256 against manifest.promptHash).
//
//   buildR1Root({ srcRoot, dstRoot, tasks: [{ id, promptFile }], copy = reflinkCopy })
//     -> { tasks: [{ id, treeHash, hiddenHash, promptHash }] }
//
// tree/ and hidden/ are not touched, so treeHash, hiddenHash and gate.json stay valid: the source manifest's values are
// re-checked against the bytes (hashBuiltTask) before the copy is trusted. The agent's tree, TASK.md and CLAUDE.md are unchanged.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { hashBuiltTask, reflinkCopy } from '../s5/build-task.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readPrompt(file) {
  const bytes = readFileSync(file);
  if (bytes.includes(0)) throw new Error(`buildR1Root: ${file} holds a NUL byte; the prompt reaches the CLI as one process argument`);
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw new Error(`buildR1Root: ${file} is not valid UTF-8`);
  return bytes;
}

export function buildR1Root({ srcRoot, dstRoot, tasks, copy = reflinkCopy }) {
  const src = resolve(srcRoot);
  const dst = resolve(dstRoot);
  // Every input is checked before the first copy, so a refusal leaves no half-built root.
  const planned = tasks.map(({ id, promptFile }) => {
    const manifestFile = join(src, 'tasks', id, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const actual = hashBuiltTask(join(src, 'tasks', id));
    for (const key of ['treeHash', 'hiddenHash']) {
      if (manifest[key] !== actual[key]) throw new Error(`buildR1Root: ${id}: ${key} of the source manifest is not what the bytes hash to`);
    }
    return { id, manifest, bytes: readPrompt(promptFile) };
  });

  mkdirSync(join(dst, 'tasks'), { recursive: true });
  if (existsSync(join(src, 'cargo-home')) && !existsSync(join(dst, 'cargo-home'))) copy(join(src, 'cargo-home'), join(dst, 'cargo-home'));
  const built = [];
  for (const { id, manifest, bytes } of planned) {
    const dir = join(dst, 'tasks', id);
    copy(join(src, 'tasks', id), dir);
    writeFileSync(join(dir, 'prompt.txt'), bytes);
    const promptHash = sha256(bytes);
    writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify({ ...manifest, promptHash }, null, 2)}\n`);
    const check = hashBuiltTask(dir);
    if (check.treeHash !== manifest.treeHash || check.hiddenHash !== manifest.hiddenHash || check.promptHash !== promptHash) {
      throw new Error(`buildR1Root: ${id}: the copy does not hash to its manifest`);
    }
    built.push({ id, treeHash: manifest.treeHash, hiddenHash: manifest.hiddenHash, promptHash });
  }
  return { tasks: built };
}
