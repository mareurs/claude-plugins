// hook-copy.mjs — the effort-steering hook as the S5 containers run it.
//
//   writeHookCopy(root, esRoot, mod = null, opts = {}) -> { copyDir, settingsFile, modDir }
//   MOD_CONTAINER_DIR, MOD_LOG_PATH   where a container sees the effort-toggle mod, and where the mod writes its log
//
// Copies bin/, core/ and adapter/ of `esRoot` (the effort-steering/ directory) into <root>/es, without any *.test.mjs, gives the
// copy a one-rule core/rules.json, and writes <root>/es/settings.json, which registers the copy's hook for UserPromptSubmit. The
// formats are s4-run.mjs's writeScratch (ruling R83), with two differences: the rule is the fixed shallow one, and the hook's
// path is the CONTAINER's, not the copy's on the host.
//
// A container mounts `copyDir` read-only at /opt/es and runs the container's node on it. The settings file is INSIDE the copy
// (ruling R93), so that one mount carries the hook and its settings, and the invocation passes `--settings /opt/es/settings.json`.
// The copy's top level is therefore bin/, core/, adapter/ and settings.json, and mod/ when the config names a mod, and nothing else.
// All arms of one batch run this one copy.
//
// With a `mod` (the validated config's {mode, schedule?, random?}), <esRoot>/spikes/toggle/mod/ is copied to <copyDir>/mod (no
// *.test.mjs) and <copyDir>/mod/config.json is written as { ...mod, logPath: opts.logPath ?? MOD_LOG_PATH }: the mod's own config reader insists on
// a logPath, and the log lives outside /work. `opts.logPath` (an absolute path, else a TypeError before anything is written) is for a hook
// copy used on the host (toggle.mjs hook-copy, G1a), where the container path is not writable; the batch (run.mjs) never passes it.
// `modDir` is that directory, or null without a mod. The container loads it with
// --plugin-dir /opt/es/mod (run.mjs, not this file). Without a mod the copy is byte for byte what it was before the mod existed.
// Which arm a run is in comes from the environment, not from the copy: EFFORT_STEERING_HOLDOUT_RATE '0' steers every prompt (B),
// '1' holds every prompt out (A and C), and in both the hook leaves one decision-log line per prompt.
//
// The copy is rebuilt from nothing on every call (`copyDir` is removed first, and only `copyDir`: whatever else `root` holds, a
// rows file or run directories, is not touched), so a file a former call left there is gone, and the source tree is only read.
// Every argument and source directory (the mod's too, when asked for) is checked before anything is removed or written.
// Never runs the hook, never calls a model, never touches Docker.

import { cpSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The directories of effort-steering/ the hook needs: the CLI (bin/), the policy and its rules and table (core/), the adapter.
const HOOK_DIRS = ['bin', 'core', 'adapter'];
// Where a container sees the copy.
const CONTAINER_ROOT = '/opt/es';
const HOOK_COMMAND = `node ${CONTAINER_ROOT}/adapter/claude-code/user-prompt-submit.mjs`;
// The effort-toggle mod inside the mounted copy, and its log outside /work (a state directory the container provides).
export const MOD_CONTAINER_DIR = `${CONTAINER_ROOT}/mod`;
export const MOD_LOG_PATH = '/run/state/effort-toggle/log.jsonl';
// Where the mod's source sits under esRoot.
const MOD_SOURCE_PARTS = ['spikes', 'toggle', 'mod'];
// One rule that matches every prompt: the steer is a function of the arm alone, never of the prompt. (One exception that is not the
// rule's: an explicit "ultrathink" in a prompt wins over every rule, core/decide.mjs, and buildTask refuses such a prompt, R147.)
const RULE = { id: 's5-all', level: 'shallow', confidence: 'high', reason: 's5', when: { minChars: 0 } };
// The rules file the copy holds, and what buildTask asks decide() about a prompt.
export const HOOK_RULES = Object.freeze({ version: 1, rules: Object.freeze([Object.freeze(RULE)]) });
const SETTINGS = { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } };

const isDirectory = (dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;

export function writeHookCopy(root, esRoot, mod = null, opts = {}) {
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

  if (mod !== null && (typeof mod !== 'object' || Array.isArray(mod))) {
    throw new TypeError(`writeHookCopy: mod must be null or an object, got ${JSON.stringify(mod) ?? String(mod)}`);
  }
  if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
    throw new TypeError(`writeHookCopy: opts must be an object, got ${JSON.stringify(opts) ?? String(opts)}`);
  }
  const logPath = opts.logPath === undefined ? MOD_LOG_PATH : opts.logPath;
  if (typeof logPath !== 'string' || !path.isAbsolute(logPath)) {
    throw new TypeError(`writeHookCopy: opts.logPath must be an absolute path, got ${JSON.stringify(logPath) ?? String(logPath)}`);
  }
  const modSource = path.join(source, ...MOD_SOURCE_PARTS);
  if (mod !== null && !isDirectory(modSource)) {
    throw new Error(`writeHookCopy: ${modSource} is not a directory (the config names a mod, and esRoot must hold spikes/toggle/mod/)`);
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
  let modDir = null;
  if (mod !== null) {
    modDir = path.join(copyDir, 'mod');
    cpSync(modSource, modDir, { recursive: true, filter: (src) => !src.endsWith('.test.mjs') });
    writeFileSync(path.join(modDir, 'config.json'), `${JSON.stringify({ ...mod, logPath }, null, 2)}\n`);
  }
  return { copyDir, settingsFile, modDir };
}
