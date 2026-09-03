// PreToolUse hook on Agent — explore/foreign-project bootstrap injector.
// Port of explore-inject.sh. When a subagent dispatch's prompt names an absolute
// path in a DIFFERENT git repo than the session cwd, prepend a compact bootstrap
// directive (foreign CLAUDE.md + memories + codescout-pinned tools) to the prompt
// via hookSpecificOutput.updatedInput.prompt. Otherwise no-op.
//
// Testing seams: `node explore-inject.mjs --is-foreign <cwd> <path>` prints
// inject|skip (unit + corpus layers); CS_EXPLORE_INJECT_FORCE=1 bypasses the
// codescout gate (e2e layer).
import { existsSync, statSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { readInput, detectFor, git, emit } from './lib.mjs';

const MARKER = '[[cs-explore-bootstrap]]';
// Agent types dedicated to read-only work. Their native Edit/Write are stripped by
// the harness, but codescout's edit_code is not — so the directive must not name it.
const READ_ONLY_AGENTS = new Set(['Explore', 'Plan']);
const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// repo_id(path) → absolute git-common-dir of the repo containing path, else ''.
// Worktrees of the same repo fold to one identity (git-common-dir is shared).
function repoId(p) {
  let x = p;
  if (x.startsWith('~/')) x = HOME + x.slice(1);
  else if (x === '~') x = HOME;
  let dir = isDir(x) ? x : dirname(x);
  while (dir && dir !== '/' && !isDir(dir)) dir = dirname(dir);
  if (!isDir(dir)) return '';
  const g = git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!g) return '';
  try {
    return realpathSync(g);
  } catch {
    return g;
  }
}

// is_foreign(cwd, path) → true if path is a git repo different from cwd's.
function isForeign(cwd, p) {
  const pr = repoId(p);
  return pr !== '' && pr !== repoId(cwd);
}

// extract_paths(prompt) → absolute-ish paths named in the prompt, deduped+sorted.
// extract_paths(prompt) → absolute-ish paths named in the prompt, deduped+sorted.
function extractPaths(prompt) {
  const re = /(~|\/(home|tmp|etc|data|mnt|opt|usr|var|root))(\/[A-Za-z0-9._-]+)+\/?/g;
  const out = new Set();
  for (const m of prompt.match(re) || []) {
    out.add(m);
    // '.' is a path character, so a path ending a sentence ("…/repo.") is captured
    // WITH the period, names no real dir, and the hook skips silently (F-9). Offer
    // the dot-stripped form as an extra candidate: firstForeignRoot discards
    // candidates that aren't real dirs, so this can only add hits, never lose one.
    const stripped = m.replace(/\.+\/?$/, '');
    if (stripped && stripped !== m) out.add(stripped);
  }
  return [...out].sort();
}

// first_foreign_root(cwd, prompt) → worktree root of the first foreign repo named
// in the prompt, else ''.
function firstForeignRoot(cwd, prompt) {
  for (const p of extractPaths(prompt)) {
    if (!p) continue;
    if (p === cwd || p.startsWith(`${cwd}/`)) continue; // short-circuit: under cwd
    let exp = p;
    if (exp.startsWith('~/')) exp = HOME + exp.slice(1);
    let dir = isDir(exp) ? exp : dirname(exp);
    while (dir && dir !== '/' && !isDir(dir)) dir = dirname(dir);
    if (!isDir(dir)) continue;
    if (isForeign(cwd, exp)) {
      const top = git(dir, ['rev-parse', '--show-toplevel']);
      if (top) return top;
    }
  }
  return '';
}

function buildDirective(root, agentType) {
  // Read-only agent types get a read-only tool list. Claude Code strips native
  // Edit/Write from these, but NOT codescout's edit_code — so naming an editing
  // tool here would invite a write the dispatcher never asked for.
  const readOnly = READ_ONLY_AGENTS.has(agentType || '');
  const tools = readOnly
    ? 'symbols/semantic_search/grep/read_file/tree'
    : 'symbols/semantic_search/grep/read_file/edit_code';
  const rule = readOnly
    ? ' READ-ONLY task: do not write or modify any file in that project.'
    : '';
  return `${MARKER} This task targets a FOREIGN project at ${root} (a different git repo than the session cwd). Before the task below, load its context: read_file("${root}/CLAUDE.md") if present, and memory(action="list", workspace="${root}") then read the relevant topics. Pin every codescout call to it with workspace="${root}". Use codescout tools (${tools}) — not native Read/Grep/Bash on source.${rule}

--- original task ---`;
}

// --- Test seam: --is-foreign <cwd> <path> ---
if (process.argv[2] === '--is-foreign') {
  process.stdout.write(isForeign(process.argv[3] || '', process.argv[4] || '') ? 'inject\n' : 'skip\n');
  process.exit(0);
}

const input = readInput();
if (!input) process.exit(0);
if ((input.tool_name || '') !== 'Agent') process.exit(0);

const cwd = input.cwd || '';
const prompt = (input.tool_input && input.tool_input.prompt) || '';
if (!cwd || !prompt) process.exit(0);

// codescout gate (the injected directive only helps codescout-active sessions).
if (process.env.CS_EXPLORE_INJECT_FORCE !== '1') {
  if (detectFor(cwd).HAS_CODESCOUT === 'false') process.exit(0);
}

// Idempotency: already bootstrapped, or the dispatcher already set up activation.
if (prompt.includes(MARKER) || prompt.includes('workspace(action="activate"')) process.exit(0);

const root = firstForeignRoot(cwd, prompt);
if (!root) process.exit(0);

const updated = { ...(input.tool_input || {}), prompt: `${buildDirective(root, (input.tool_input || {}).subagent_type)}\n${prompt}` };
emit({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    updatedInput: updated,
  },
});
process.exit(0);
