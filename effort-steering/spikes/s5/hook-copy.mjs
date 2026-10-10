// hook-copy.mjs — the effort-steering hook as the S5 containers run it.
//
//   writeHookCopy(root, esRoot) -> { copyDir, settingsFile }
//
// Copies bin/, core/ and adapter/ of `esRoot` (the effort-steering/ directory) into <root>/es, without any *.test.mjs, gives the
// copy a one-rule core/rules.json, and writes <root>/es/settings.json, which registers the copy's hook for UserPromptSubmit. The
// formats are s4-run.mjs's writeScratch (ruling R83), with two differences: the rule is the fixed shallow one, and the hook's
// path is the CONTAINER's, not the copy's on the host.
//
// A container mounts `copyDir` read-only at /opt/es and runs the container's node on it. The settings file is INSIDE the copy
// (ruling R93), so that one mount carries the hook and its settings, and the invocation passes `--settings /opt/es/settings.json`.
// The copy's top level is therefore bin/, core/, adapter/ and settings.json, and nothing else. All three arms run this one copy.
// Which arm a run is in comes from the environment, not from the copy: EFFORT_STEERING_HOLDOUT_RATE '0' steers every prompt (B),
// '1' holds every prompt out (A and C), and in both the hook leaves one decision-log line per prompt.
//
// The copy is rebuilt from nothing on every call (`copyDir` is removed first, and only `copyDir`: whatever else `root` holds, a
// rows file or run directories, is not touched), so a file a former call left there is gone, and the source tree is only read.
// Every argument and source directory is checked before anything is removed or written.
// Never runs the hook, never calls a model, never touches Docker.

import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The directories of effort-steering/ the hook needs: the CLI (bin/), the policy and its rules and table (core/), the adapter.
const HOOK_DIRS = ['bin', 'core', 'adapter'];
// Where a container sees the copy.
const CONTAINER_ROOT = '/opt/es';
const HOOK_COMMAND = `node ${CONTAINER_ROOT}/adapter/claude-code/user-prompt-submit.mjs`;
// One rule that matches every prompt: the steer is a function of the arm alone, never of the prompt. (One exception that is not the
// rule's: an explicit "ultrathink" in a prompt wins over every rule, core/decide.mjs, and buildTask refuses such a prompt, R147.)
const RULE = { id: 's5-all', level: 'shallow', confidence: 'high', reason: 's5', when: { minChars: 0 } };
// The rules file the copy holds, and what buildTask asks decide() about a prompt.
export const HOOK_RULES = Object.freeze({ version: 1, rules: Object.freeze([Object.freeze(RULE)]) });
const SETTINGS = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } };

const isDirectory = (dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;

export function writeHookCopy(root, esRoot) {
  for (const [name, value] of [['root', root], ['esRoot', esRoot]]) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new TypeError(`writeHookCopy: ${name} must be a non-blank string, got ${JSON.stringify(value) ?? String(value)}`);
    }
  }
  const source = path.resolve(esRoot);
  for (const dir of HOOK_DIRS) {
    if (!isDirectory(path.join(source, dir))) {
      throw new Error(`writeHookCopy: ${path.join(source, dir)} is not a directory (esRoot must be the effort-steering/ directory, holding ${HOOK_DIRS.join('/, ')}/)`);
    }
  }

  const base = path.resolve(root);
  const copyDir = path.join(base, 'es');
  const settingsFile = path.join(copyDir, 'settings.json');
  mkdirSync(base, { recursive: true });
  rmSync(copyDir, { recursive: true, force: true });
  for (const dir of HOOK_DIRS) {
    cpSync(path.join(source, dir), path.join(copyDir, dir), { recursive: true, filter: (src) => !src.endsWith('.test.mjs') });
  }
  writeFileSync(path.join(copyDir, 'core', 'rules.json'), `${JSON.stringify(HOOK_RULES)}\n`);
  writeFileSync(settingsFile, `${JSON.stringify(SETTINGS, null, 2)}\n`);
  return { copyDir, settingsFile };
}
