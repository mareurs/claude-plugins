// sdd/hooks/lib.mjs
// Shared helpers for the SDD Node hooks. Cross-platform by construction:
// no bash, no jq, no coreutils, no /tmp, no GNU-only tools. Node ships with
// Claude Code / Copilot on every OS, so `node <hook>.mjs` runs everywhere.
//
// FAIL-OPEN CONTRACT: every hook must exit 0 even on error. On Copilot CLI a
// PreToolUse hook that exits non-zero DENIES the user's tool call (fail-closed),
// so a crash here would silently block the user. Intended denials go through the
// JSON `permissionDecision` field with exit 0 — never via the exit code.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Read the hook event JSON from stdin. Fail-open to {}.
export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin (piped JSON)
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Project root: the payload's cwd, else $CWD, else the process cwd.
export function projectDir(input) {
  return (input && input.cwd) || process.env.CWD || process.cwd();
}

export function hasConstitution(dir) {
  return existsSync(join(dir, 'memory', 'constitution.md'));
}

// `enforcement:` value from the YAML frontmatter of memory/sdd-config.md.
// Only the first `---`-delimited block is consulted (matches the old sed).
export function enforcement(dir) {
  const cfg = join(dir, 'memory', 'sdd-config.md');
  if (!existsSync(cfg)) return 'warn';
  let text;
  try {
    text = readFileSync(cfg, 'utf8');
  } catch {
    return 'warn';
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return 'warn';
  const m = fm[1].match(/^enforcement:[ \t]*(.+?)[ \t]*$/m);
  if (!m) return 'warn';
  const v = m[1].replace(/^["']|["']$/g, '').trim();
  return v || 'warn';
}

// Spec basenames, e.g. ["auth.md"]. Empty array if none.
export function specNames(dir) {
  const d = join(dir, 'memory', 'specs');
  if (!existsSync(d)) return [];
  try {
    return readdirSync(d).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

// Spec full paths, for the Explore listing.
export function specPaths(dir) {
  const d = join(dir, 'memory', 'specs');
  return specNames(dir).map((f) => join(d, f));
}

// memory/plans/ entry names. Empty array if the dir is absent/empty.
export function planNames(dir) {
  const d = join(dir, 'memory', 'plans');
  if (!existsSync(d)) return [];
  try {
    return readdirSync(d);
  } catch {
    return [];
  }
}

// Path of the "review performed" marker for a project. Per-user temp dir
// (os.tmpdir(), not world-writable /tmp), filename keyed on the project path.
// The /review command and review-guard MUST agree on this — both call here.
export function reviewMarker(dir) {
  const hash = createHash('md5').update(dir).digest('hex').slice(0, 8);
  return join(tmpdir(), `.sdd-reviewed-${hash}`);
}

// Emit a JSON object to stdout (no trailing newline).
export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}
