// buddy hook launcher — cross-platform.
//
// Claude Code always runs on a system Node (it requires Node >= 20), so
// `node run.mjs <event>` is a portable hook entry point on every OS. Its only
// job is to resolve a Python interpreter (python3 -> python -> `py -3`) and run
// the Python dispatcher, since Python's interpreter name is not uniform across
// platforms (`python3` is absent on Windows; bare `python` is often absent on
// macOS). This is a thin shim, not a rewrite — buddy's logic stays in Python.
//
// stdin/stdout/stderr are inherited so the event JSON and any injected context
// pass straight through. Fail-open: any launcher error exits 0 (buddy is
// non-blocking); only an intentional pre-tool-use judge block (exit 2) is
// forwarded to Claude Code. Claude Code's PID is passed as BUDDY_HOOK_PPID so
// the Python side keys the by-ppid index on Claude Code, not on this launcher.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const dispatch = join(HERE, 'hook_dispatch.py');
const event = process.argv[2] || '';

// Interpreter candidates, in preference order.
const candidates = [
  ['python3', []],
  ['python', []],
  ['py', ['-3']],
];

// Resolve a REAL Python by probing each candidate with a trivial program. This
// is deliberately NOT "run the dispatcher and try the next on failure": on
// Windows `python3` is frequently the Microsoft Store app-execution-alias stub,
// which spawns successfully but exits nonzero (not ENOENT) — probing rejects it
// (its `-c ''` does not exit 0) so we fall through to the real `python`/`py`,
// instead of mistaking the stub's nonzero exit for the dispatcher having run.
function resolvePython() {
  for (const [cmd, pre] of candidates) {
    const probe = spawnSync(cmd, [...pre, '-c', ''], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return [cmd, pre];
  }
  return null;
}

function run() {
  if (!event || !existsSync(dispatch)) return 0;
  const found = resolvePython();
  if (!found) return 0; // no working interpreter — fail open
  const [cmd, pre] = found;
  const res = spawnSync(cmd, [...pre, dispatch, event], {
    stdio: 'inherit',
    env: { ...process.env, BUDDY_HOOK_PPID: String(process.ppid) },
  });
  if (res.error) return 0; // spawn failed after a good probe — fail open
  // Forward only the intentional pre-tool-use block; a normal exit or a Python
  // crash both fail open.
  return res.status === 2 ? 2 : 0;
}

process.exit(run());
