// Shell-command parser for review-guard: which integration-relevant git / gh
// invocations does a command line contain? Pure, no I/O.
//
// Splits on ; & | ( ) ` and newlines outside quotes, honours '…', "…", $'…' and
// backslash escapes, so a quoted "git commit" is data, not an intent. Not a shell:
// command substitution inside double quotes, `sh -c '…'`, aliases and `cd x && git …`
// directory changes are not followed (the guards are not a sandbox; see the spec).
import { basename, isAbsolute, join } from 'node:path';

const SEPARATORS = new Set([';', '&', '|', '(', ')', '`', '\n']);
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'env', 'nohup']);
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const PUSH_OPT_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const MERGE_OPT_WITH_VALUE = new Set(['-m', '-s', '-X', '-F', '--strategy', '--strategy-option', '--file', '--into-name']);

// -> string[][] : one token list per simple command, quotes removed.
export function splitCommands(command) {
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
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endTok();
    } else {
      cur = (cur ?? '') + c;
    }
  }
  endSeg();
  return segments;
}

function pushDst(spec) {
  let r = spec.replace(/^\+/, '');
  const k = r.lastIndexOf(':');
  if (k >= 0) r = r.slice(k + 1);
  return r.replace(/^refs\/heads\//, '');
}

function parseGit(toks) {
  let i = 1;
  let dir;
  while (i < toks.length && toks[i].startsWith('-')) {
    const t = toks[i];
    if (t === '-C' && i + 1 < toks.length) {
      const v = toks[i + 1];
      dir = dir === undefined || isAbsolute(v) ? v : join(dir, v);
      i += 2;
    } else if (GIT_GLOBAL_WITH_VALUE.has(t)) i += 2;
    else i += 1;
  }
  const sub = toks[i];
  const args = toks.slice(i + 1);
  const withDir = (o) => (dir === undefined ? o : { ...o, dir });
  if (sub === 'commit') return [withDir({ kind: 'commit' })];
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
    return [withDir(mergeRef === undefined ? { kind: 'merge' } : { kind: 'merge', mergeRef })];
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
    if (!refs.length) return [withDir({ kind: 'push' })];
    return refs.map((r) => withDir({ kind: 'push', pushRef: pushDst(r) }));
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

// -> {kind, pushRef?, mergeRef?, dir?}[]
export function gitIntents(command) {
  const out = [];
  for (const raw of splitCommands(command)) {
    let toks = raw;
    for (;;) {
      if (toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[0])) toks = toks.slice(1);
      else if (toks.length && WRAPPERS.has(basename(toks[0]))) toks = toks.slice(1);
      else break;
    }
    if (!toks.length) continue;
    const exe = basename(toks[0]).replace(/\.exe$/i, '');
    if (exe === 'git') out.push(...parseGit(toks));
    else if (exe === 'gh') out.push(...parseGh(toks));
  }
  return out;
}
