// Shell-command parser for review-guard: which integration-relevant git / gh
// invocations does a command line contain? Pure, no I/O.
//
// Splits on ; & | ( ) ` and newlines outside quotes, honours '…', "…", $'…' and
// backslash escapes, so a quoted "git commit" is data, not an intent. It tracks two
// pieces of state across the segments of one command line: the directory (`cd`,
// `pushd`, `popd`, `git -C`) and the branch a `git checkout|switch <b>` put that
// directory on, and stamps each intent with `dir` / `dirUnknown` / `assumedBranch` /
// `assumedNew`. A `cd` inside ( … ) is undone at the closing paren.
//
// Still NOT followed (the guards are not a sandbox; see the spec): `sh -c '…'` and
// `eval`, command substitution inside double quotes, aliases and functions, `git pull`,
// `rebase`, `cherry-pick`, `reset`, pipeline subshells (`a | ( cd x )` scoping is the
// plain paren rule only), `cd` or `checkout` sent in an EARLIER command (the guard's
// merge rule compensates for the merge case), a `checkout` of a path that looks like a
// branch (the guard checks the branch exists; a checkout with paths, `--` or -p is not a
// branch switch), shell variables holding a directory or branch name (the directory
// becomes "unknown").
import { basename, isAbsolute, join } from 'node:path';

const SEPARATORS = new Set([';', '&', '|', '(', ')', '`', '\n']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'env', 'nohup', 'xargs']);
const KEYWORDS = new Set(['then', 'do', 'else', 'elif', 'if', 'while', 'until', '{', '!']);
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const PUSH_OPT_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MERGE_OPT_WITH_VALUE = new Set(['-m', '-s', '-X', '-F', '--strategy', '--strategy-option', '--file', '--into-name']);
const CREATE_FLAGS = new Set(['-b', '-B', '-c', '-C', '--orphan']);

// -> (string[] | '(' | ')')[] : one token list per simple command, quotes removed,
// with a marker wherever an unquoted parenthesis opens or closes a group.
function scan(command) {
  const segments = [];
  let toks = [];
  let cur = null;
  const endTok = () => { if (cur !== null) { toks.push(cur); cur = null; } };
  const endSeg = () => { endTok(); if (toks.length) segments.push(toks); toks = []; };
  const s = String(command ?? '');
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') { i++; continue; }
      cur = (cur ?? '') + (s[i + 1] ?? '');
      i++;
    } else if (c === "'") {
      const j = s.indexOf("'", i + 1);
      const end = j < 0 ? n : j;
      cur = (cur ?? '') + s.slice(i + 1, end);
      i = end;
    } else if (c === '$' && s[i + 1] === "'") {
      let j = i + 2;
      let text = '';
      while (j < n && s[j] !== "'") {
        if (s[j] === '\\' && j + 1 < n) { text += s[j + 1]; j += 2; } else { text += s[j]; j++; }
      }
      cur = (cur ?? '') + text;
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let text = '';
      while (j < n && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < n && '"\\$`\n'.includes(s[j + 1])) { text += s[j + 1]; j += 2; } else { text += s[j]; j++; }
      }
      cur = (cur ?? '') + text;
      i = j;
    } else if (c === '#' && cur === null) {
      while (i < n && s[i] !== '\n') i++;
      endSeg();
    } else if (SEPARATORS.has(c)) {
      endSeg();
      if (c === '(' || c === ')') segments.push(c);
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endTok();
    } else {
      cur = (cur ?? '') + c;
    }
  }
  endSeg();
  return segments;
}

// -> string[][] : one token list per simple command.
export function splitCommands(command) {
  return scan(command).filter(Array.isArray);
}

// Drop leading env assignments, wrappers (sudo, xargs, …) and shell keywords (then,
// do, {, !, …) so toks[0] is the command word.
export function skipPrefix(toks) {
  for (;;) {
    if (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) toks = toks.slice(1);
    else if (toks.length && (WRAPPERS.has(basename(toks[0])) || KEYWORDS.has(toks[0]))) toks = toks.slice(1);
    else return toks;
  }
}

function pushDst(spec) {
  let r = spec.replace(/^\+/, '');
  const k = r.lastIndexOf(':');
  if (k >= 0) r = r.slice(k + 1);
  return r.replace(/^refs\/heads\//, '');
}

// dir state: undefined = the payload cwd, null = unknown, string = a path.
function applyDir(state, target) {
  if (isAbsolute(target)) return target;
  if (state === null) return null;
  return state === undefined ? target : join(state, target);
}

function cdTarget(state, args) {
  const t = args.find((a) => !a.startsWith('-') || a === '-');
  if (t === undefined || t === '-' || t.includes('$') || t.startsWith('~')) return null;
  return applyDir(state, t);
}

// Visit every simple command in order with the tracked state BEFORE it runs:
// {cwd, branches}. `cd`, `pushd`, `popd` update it; a cd inside ( … ) is undone at the
// closing paren.
export function traverse(command, visit) {
  let st = { cwd: undefined, branches: new Map(), stack: [] };
  const scopes = [];
  for (const item of scan(command)) {
    if (item === '(') { scopes.push({ cwd: st.cwd, branches: new Map(st.branches), stack: [...st.stack] }); continue; }
    if (item === ')') { const s = scopes.pop(); if (s) st = s; continue; }
    visit(item, st);
    const toks = skipPrefix(item);
    if (!toks.length) continue;
    const exe = basename(toks[0]);
    if (exe === 'cd') st.cwd = cdTarget(st.cwd, toks.slice(1));
    else if (exe === 'pushd') { st.stack.push(st.cwd); st.cwd = cdTarget(st.cwd, toks.slice(1)); }
    else if (exe === 'popd') st.cwd = st.stack.length ? st.stack.pop() : null;
  }
}

const dirKey = (d) => (d === undefined ? '' : d === null ? '\0?' : d);

function parseGit(toks, cwdState, branches) {
  let i = 1;
  let eff = cwdState;
  while (i < toks.length && toks[i].startsWith('-')) {
    const t = toks[i];
    if (t === '-C' && i + 1 < toks.length) {
      eff = applyDir(eff, toks[i + 1]);
      i += 2;
    } else if (GIT_GLOBAL_WITH_VALUE.has(t)) i += 2;
    else i += 1;
  }
  const sub = toks[i];
  const args = toks.slice(i + 1);
  const withState = (o) => {
    const r = { ...o };
    if (typeof eff === 'string') r.dir = eff;
    else if (eff === null) r.dirUnknown = true;
    const a = branches.get(dirKey(eff));
    if (a) { r.assumedBranch = a.name; if (a.isNew) r.assumedNew = true; }
    return r;
  };
  if (sub === 'checkout' || sub === 'switch') {
    // A branch switch: a create flag with a name, or exactly one positional and no
    // `--` / -p. Anything else (paths, patch mode) leaves the working branch alone.
    let name;
    let isNew = false;
    const pos = [];
    let pathMode = false;
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (a === '--' || /^(-p|--patch)/.test(a)) { pathMode = true; continue; }
      if (CREATE_FLAGS.has(a)) { name = args[k + 1]; isNew = true; break; }
      if (a.startsWith('-')) continue;
      pos.push(a);
    }
    if (!isNew && !pathMode && pos.length === 1) name = pos[0];
    if (name) branches.set(dirKey(eff), { name, isNew });
    return [];
  }
  if (sub === 'commit') return [withState({ kind: 'commit' })];
  if (sub === 'merge') {
    if (args.some((a) => a === '--abort' || a === '--quit')) return [];
    let mergeRef;
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (MERGE_OPT_WITH_VALUE.has(a)) { k++; continue; }
      if (a.startsWith('-')) continue;
      mergeRef = a;
      break;
    }
    return [withState(mergeRef === undefined ? { kind: 'merge' } : { kind: 'merge', mergeRef })];
  }
  if (sub === 'push') {
    const pos = [];
    for (let k = 0; k < args.length; k++) {
      const a = args[k];
      if (PUSH_OPT_WITH_VALUE.has(a)) { k++; continue; }
      if (a.startsWith('-')) continue;
      pos.push(a);
    }
    const refs = pos.slice(1);
    if (!refs.length) return [withState({ kind: 'push' })];
    return refs.map((r) => withState({ kind: 'push', pushRef: pushDst(r) }));
  }
  return [];
}

function parseGh(toks) {
  let i = 1;
  while (i < toks.length && toks[i].startsWith('-')) i += (toks[i] === '-R' || toks[i] === '--repo') ? 2 : 1;
  if (toks[i] !== 'pr') return [];
  if (toks[i + 1] === 'create') return [{ kind: 'pr-create' }];
  if (toks[i + 1] === 'merge') return [{ kind: 'pr-merge' }];
  return [];
}

// -> {kind, pushRef?, mergeRef?, dir?, dirUnknown?, assumedBranch?, assumedNew?}[]
export function gitIntents(command) {
  const out = [];
  traverse(command, (raw, st) => {
    const toks = skipPrefix(raw);
    if (!toks.length) return;
    const exe = basename(toks[0]).replace(/\.exe$/i, '');
    if (exe === 'git') out.push(...parseGit(toks, st.cwd, st.branches));
    else if (exe === 'gh') {
      out.push(...parseGh(toks).map((o) => {
        if (typeof st.cwd === 'string') return { ...o, dir: st.cwd };
        return st.cwd === null ? { ...o, dirUnknown: true } : o;
      }));
    }
  });
  return out;
}
