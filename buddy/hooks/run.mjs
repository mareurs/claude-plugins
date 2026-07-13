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

function run() {
  if (!event || !existsSync(dispatch)) return 0;
  for (const [cmd, pre] of candidates) {
    const res = spawnSync(cmd, [...pre, dispatch, event], {
      stdio: 'inherit',
      env: { ...process.env, BUDDY_HOOK_PPID: String(process.ppid) },
    });
    if (res.error) {
      if (res.error.code === 'ENOENT') continue; // interpreter absent — try next
      return 0; // other spawn failure — fail open
    }
    // Interpreter ran: forward only the intentional block; a normal exit or a
    // Python crash both fail open.
    return res.status === 2 ? 2 : 0;
  }
  return 0; // no interpreter found — fail open
}

process.exit(run());
