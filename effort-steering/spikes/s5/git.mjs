// git.mjs — hardened git spawn for a repository DIRECTORY (S5 harness).
//
// The environment scrub, the argv prefix and the two post-scrub variables mirror
// runGit() in ../s4-prereg.mjs. The one difference: runGit takes a FILE and runs git in
// its directory; this takes the directory itself.
//
// Nothing outside the repository may steer git. EVERY GIT_* variable is dropped
// (GIT_DIR, GIT_CONFIG_COUNT/KEY/VALUE injection, ...), HOME and XDG_CONFIG_HOME point
// nowhere, and global/system config is switched off. The caller cannot widen any of it:
// there is no env option.

import { spawnSync } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

// git(dir, args, { input }) -> { status, stdout, stderr }. stdout and stderr are Buffers.
// A non-zero exit is RETURNED (the caller reads `status`); a git that could not start, was
// killed by a signal, or overran the buffer THROWS, so `status` is always a number.
export function git(dir, args, opts = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  env.HOME = '/nonexistent';
  env.XDG_CONFIG_HOME = '/nonexistent';
  env.GIT_CONFIG_GLOBAL = '/dev/null';
  env.GIT_CONFIG_NOSYSTEM = '1';
  // Set AFTER the scrub: never prompt for credentials, never lazy-fetch a missing object
  // (a partial clone would otherwise hang, then write into .git/objects).
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  // --no-replace-objects: `git replace` must not be able to forge an object.
  // core.fsmonitor=false: a repo-local fsmonitor hook must not run commands.
  // --literal-pathspecs: a path in `args` is a path, never a glob or a magic pathspec.
  const argv = ['--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-C', dir, ...args];
  const r = spawnSync('git', argv, { env, maxBuffer: MAX_BUFFER, input: opts.input });
  if (r.error) throw new Error(`git ${args.join(' ')} could not run in ${dir}: ${r.error.message}`);
  if (r.status === null) throw new Error(`git ${args.join(' ')} in ${dir} ended on signal ${r.signal}`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
