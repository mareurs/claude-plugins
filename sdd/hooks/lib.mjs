// sdd/hooks/lib.mjs
// Shared helpers for the sdd gate hooks. Node-only, no dependencies, no imports
// from other plugins: the eight functions below the "copied" marker are
// byte-for-byte copies from codescout-companion/hooks/lib.mjs (lib.test.mjs
// asserts parity).
//
// FAIL-OPEN CONTRACT: hooks exit 0 even on error; intended denials go through
// the JSON `permissionDecision` field.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, basename, isAbsolute, sep } from 'node:path';

// ---- copied from codescout-companion/hooks/lib.mjs -------------------------

// Read the hook event JSON from stdin. Returns null on empty/parse error.
export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8'); // fd 0 = stdin
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

// PreToolUse hard block with a reason.
export function denyPreToolUse(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

// PreToolUse advisory context injection (the call still proceeds).
export function contextPreToolUse(context) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: context,
    },
  });
}

// Normalize host-specific names and input keys at the hook boundary. Claude
// Code uses PascalCase tools and snake_case paths; Copilot/VS Code use
// lower-case tools and camelCase paths.
export function normalizedToolName(input) {
  const name = input && input.tool_name;
  if (name === 'read_file' || name === 'readFile') return 'Read';
  if (name === 'search' || name === 'search_codebase' || name === 'grep') return 'Grep';
  if (name === 'find_files' || name === 'glob') return 'Glob';
  if (name === 'run_in_terminal' || name === 'run_command' || name === 'terminal') return 'Bash';
  if (name === 'replace_string_in_file' || name === 'replace_file_content') return 'Edit';
  if (name === 'create_file' || name === 'write_file') return 'Write';
  return name || '';
}

export function inputPath(input) {
  const toolInput = (input && input.tool_input) || {};
  return toolInput.path || toolInput.file_path || toolInput.filePath || toolInput.uri || '';
}


export function isCodescoutTool(input, toolNames) {
  const toolName = (input && input.tool_name) || '';
  return toolNames.some((name) =>
    toolName === name ||
    toolName.endsWith(`__${name}`) ||
    toolName === `codescout_${name}` ||
    toolName === `codescout/${name}`,
  );
}

export function isWriteOperation(input) {
  const nativeTool = normalizedToolName(input);
  return nativeTool === 'Edit' ||
    nativeTool === 'Write' ||
    isCodescoutTool(input, ['edit_code', 'edit_file', 'create_file']);
}

// ---- sdd's own --------------------------------------------------------------

// SessionStart / SubagentStart / UserPromptSubmit context injection.
export function contextEvent(eventName, text) {
  emit({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

// Resolve the main checkout from any cwd without spawning git. Walks up to the
// nearest `.git`. A `.git` file (linked worktree) is followed: `gitdir:` points
// at <common>/worktrees/<name>, whose `commondir` file points back at <common>.
// root = parent of the common dir.
export function mainCheckout(cwd) {
  try {
    let dir = resolvePath(cwd);
    for (;;) {
      const dotGit = join(dir, '.git');
      if (isDir(dotGit)) {
        return { root: dirname(dotGit), commonDir: dotGit, gitDir: dotGit };
      }
      if (isFile(dotGit)) {
        const m = readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m);
        if (!m) return null;
        const gitDir = isAbsolute(m[1]) ? m[1] : resolvePath(dir, m[1]);
        let commonDir = gitDir;
        const cd = join(gitDir, 'commondir');
        if (isFile(cd)) {
          const rel = readFileSync(cd, 'utf8').trim();
          commonDir = isAbsolute(rel) ? rel : resolvePath(gitDir, rel);
        }
        // No commondir (separate git dir, submodule), or a common dir that is not
        // a `.git` (separate-git-dir repo's worktree): the main root is not derivable
        // from the git dir, so fall back to the directory holding the .git file.
        const root = basename(commonDir) === '.git' && commonDir !== gitDir ? dirname(commonDir) : dir;
        return { root, commonDir, gitDir };
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    return null;
  }
}

// Branch name from <gitDir>/HEAD; null when detached or unreadable.
export function currentBranch(gitDir) {
  try {
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// .sdd/config.json. null when absent; malformed -> warn + error:'unreadable'.
export function loadConfig(root) {
  const p = join(root, '.sdd', 'config.json');
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('not an object');
    return {
      enforcement: j.enforcement === 'strict' ? 'strict' : 'warn',
      baseBranch: typeof j.baseBranch === 'string' && j.baseBranch ? j.baseBranch : null,
      error: null,
    };
  } catch {
    return { enforcement: 'warn', baseBranch: null, error: 'unreadable' };
  }
}

// open delimiter | (close2: immediately-closed block) or (inner + close)
const FM_RE = /^(?<open>﻿?---[ \t]*\r?\n)(?:(?<close2>---[ \t]*(?:\r?\n|$))|(?<inner>[\s\S]*?)(?<close>\r?\n---[ \t]*(?:\r?\n|$)))/;

// First `---` block as flat key: value pairs. Tolerates BOM and CRLF.
export function readFrontmatter(text) {
  const m = String(text).match(FM_RE);
  const out = {};
  if (!m) return out;
  for (const line of (m.groups.inner ?? '').split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/);
    if (!kv) continue;
    let v = kv[2];
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

// Set/insert keys in the first frontmatter block (create it if absent); every
// other byte is preserved.
export function writeFrontmatterFields(path, fields) {
  const text = readFileSync(path, 'utf8');
  const m = text.match(FM_RE);
  const entries = Object.entries(fields);
  if (!m) {
    const block = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
    writeFileSync(path, `---\n${block}\n---\n${text}`);
    return;
  }
  const { open, close2, close } = m.groups;
  const eol = open.includes('\r\n') ? '\r\n' : '\n';
  let inner = m.groups.inner ?? '';
  for (const [k, v] of entries) {
    const re = new RegExp(`^${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm');
    if (re.test(inner)) inner = inner.replace(re, () => `${k}: ${v}`);
    else inner = inner === '' ? `${k}: ${v}` : `${inner}${eol}${k}: ${v}`;
  }
  // close2 = the block closed on the line right after the opener (no inner text,
  // so no eol belongs before the closer); otherwise close carries its own leading eol.
  const rebuilt = close2 !== undefined
    ? open + (inner === '' ? '' : inner + eol) + close2
    : open + inner + close;
  writeFileSync(path, rebuilt + text.slice(m[0].length));
}

// *.md files in <root>/docs/superpowers/<kind>/.
export function listArtifacts(root, kind) {
  const dir = join(root, 'docs', 'superpowers', kind);
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names.sort()) {
    if (!n.endsWith('.md')) continue;
    const path = join(dir, n);
    try {
      const body = readFileSync(path, 'utf8');
      out.push({ path, fm: readFrontmatter(body), body });
    } catch { /* unreadable: skip */ }
  }
  return out;
}

// The path after `**Spec:**` in a plan body.
export function specPointer(planBody) {
  const m = String(planBody).match(/\*\*Spec:\*\*[ \t]*`?([^\s`]+)`?/);
  return m ? m[1] : null;
}

// Approved plans whose spec pointer resolves (relative to root) to an approved spec.
export function activePlans(root) {
  const out = [];
  for (const p of listArtifacts(root, 'plans')) {
    if (p.fm.status !== 'approved') continue;
    const ptr = specPointer(p.body);
    if (!ptr) continue;
    const specPath = isAbsolute(ptr) ? resolvePath(ptr) : resolvePath(root, ptr);
    // The spec must live in <root>/docs/superpowers/specs/ (a pointer elsewhere,
    // or one that climbs out with `..`, does not count).
    const specsDir = resolvePath(root, 'docs', 'superpowers', 'specs');
    if (!specPath.startsWith(specsDir + sep)) continue;
    try {
      if (readFrontmatter(readFileSync(specPath, 'utf8')).status !== 'approved') continue;
    } catch { continue; }
    out.push({ path: p.path, fm: p.fm, specPath });
  }
  return out;
}

export function approvalsDir(commonDir) {
  return join(commonDir, 'sdd', 'approvals');
}

// 2026-11-05-auth-login-design.md -> auth-login
export function featureFromSpecPath(p) {
  return basename(p).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-design\.md$/, '').replace(/\.md$/, '');
}
