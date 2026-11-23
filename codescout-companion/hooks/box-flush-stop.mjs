// Stop hook: flush the batched box writes of this session at the end of a turn.
//
// A box with `commit: batched` records each write in the main checkout's
// `.codescout/state/batched/<session>.jsonl` and commits nothing; `codescout box flush` commits
// the session's entries in one commit. This hook runs it when the turn ends, and only when the
// folder holds a record file that belongs to the session, so a turn that wrote no batched entry
// starts no process.
//
// CONTRACT (codescout docs/superpowers/specs/2026-11-22-box-batched-commits-design.md D3, D4):
//  - Fail open. Every path prints `{"continue":true}` and exits 0; the hook never blocks a stop.
//  - NEVER KILL THE FLUSH. It holds the project write lock and runs git; a kill inside its
//    shared-index step can leave `.git/index.lock`, which stops every session's git. The child is
//    started detached with its output in a file, the hook waits for it at most WAIT_MS, and then
//    returns whether or not it ended. A flush still running goes on alone.
//  - A flush that ended and failed (`failed`, `stands`, or an error that is not a busy lock) is not
//    silent: it is logged and sent to the agent as a `systemMessage`. A busy lock is normal: the
//    records stay for the next flush.
//
// Input (Claude Code Stop): `session_id` and `cwd`, as goal-stop-hook.mjs reads `input.cwd`. The
// first line of every run logs the keys of the input, so a real turn confirms both are there.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { emit, git, readInput, resolveCodescoutBinary, sanitizeSessionId, stateHome } from './lib.mjs';

// How long the hook waits for the flush to end. The flush is not stopped when this passes.
const DEFAULT_WAIT_MS = 4000;
// The longest a record file is read, and how long an output file is kept.
const MAX_RECORD_BYTES = 4 * 1024 * 1024;
const OUT_KEEP_MS = 24 * 3600 * 1000;
const MESSAGE_MAX = 400;

function waitMs() {
  const n = Number.parseInt(process.env.BOX_FLUSH_STOP_WAIT_MS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WAIT_MS;
}

let logDir = null;
function log(msg) {
  if (!logDir) return;
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, 'codescout-companion.log'), `box-flush-stop: ${msg}\n`);
  } catch {
    /* best-effort */
  }
}

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// The main checkout of the repository `cwd` is in (the parent of the common git dir, which is the
// same from a linked worktree), or null when it cannot be told.
function mainCheckout(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!common || basename(common) !== '.git') return null;
  return dirname(common);
}

// The pids of the registry rows (`<profile>/sessions/<pid>.json`) that name this session. A record
// written before a `/clear` carries the old id and the same pid. Every profile of this machine is
// read, as the flush's own registry lookup does; a row that is not live is harmless here, because a
// match only starts a flush that judges for itself.
function sessionPids(sid) {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const dirs = new Set();
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(join(process.env.CLAUDE_CONFIG_DIR, 'sessions'));
  try {
    for (const e of readdirSync(home)) if (e.startsWith('.claude')) dirs.add(join(home, e, 'sessions'));
  } catch {
    /* no home */
  }
  const pids = new Set();
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json'));
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const row = JSON.parse(readFileSync(join(dir, n), 'utf8'));
        if (row && row.sessionId === sid && Number.isInteger(row.pid)) pids.add(row.pid);
      } catch {
        /* a row that does not parse names nobody */
      }
    }
  }
  return pids;
}

// Whether the batched folder of `root` holds a record file of the session: a file named for it,
// or a file with a record of the session id or of a pid the registry gives the session.
function hasSessionRecords(batchDir, sid) {
  let files;
  try {
    files = readdirSync(batchDir).filter((n) => n.endsWith('.jsonl'));
  } catch {
    return false;
  }
  if (files.includes(`${sid}.jsonl`)) return true;
  if (files.length === 0) return false;
  const pids = sessionPids(sid);
  for (const name of files) {
    try {
      const path = join(batchDir, name);
      if (statSync(path).size > MAX_RECORD_BYTES) continue;
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue;
        let rec;
        try {
          rec = JSON.parse(line);
        } catch {
          continue; // a torn line: the flush reports it
        }
        if (rec && (rec.session === sid || (Number.isInteger(rec.pid) && pids.has(rec.pid)))) return true;
      }
    } catch {
      /* unreadable file: not this session's, as far as the hook can tell */
    }
  }
  return false;
}

// Remove the output files of earlier runs that are a day old. Best effort.
function pruneOutputs(dir) {
  try {
    const now = Date.now();
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      try {
        if (now - statSync(p).mtimeMs > OUT_KEEP_MS) unlinkSync(p);
      } catch {
        /* gone already */
      }
    }
  } catch {
    /* no folder yet */
  }
}

// What the ended flush says, as `{ message }` for the agent (or null) and a line for the log.
function judge(code, text) {
  let obj = null;
  try {
    obj = JSON.parse(text.trim().split('\n').filter(Boolean).pop() || '');
  } catch {
    /* not JSON */
  }
  if (obj && obj.flush) {
    const reason = obj.flush.failed || obj.flush.stands || '';
    if (reason) return { message: oneLine(reason), log: `${obj.flush.failed ? 'failed' : 'stands'}: ${oneLine(reason)}` };
    const s = obj.sweep;
    if (s && (s.failed || s.stands)) return { message: null, log: `sweep ${s.failed ? 'failed' : 'stands'}: ${oneLine(s.failed || s.stands)}` };
    if (obj.sweep_error) return { message: null, log: `sweep error: ${oneLine(obj.sweep_error)}` };
    if (obj.flush.moved) return { message: null, log: `moved: ${oneLine(obj.flush.moved)}` };
    if (code !== 0) return { message: null, log: `exit ${code} with no failure named: ${oneLine(text).slice(0, 200)}` };
    return { message: null, log: null };
  }
  if (obj && obj.error) {
    const err = oneLine(obj.error);
    if (/write lock held/i.test(err)) return { message: null, log: `busy: ${err}` };
    return { message: err, log: `error: ${err}` };
  }
  if (code === 0) return { message: null, log: null };
  // A refusal (exit 2, `NOT DONE`) or output that is not JSON.
  const said = oneLine(obj ? JSON.stringify(obj) : text).slice(0, 300) || `exit ${code}`;
  return { message: `not done (exit ${code}): ${said}`, log: `exit ${code}: ${said}` };
}

async function main() {
  const input = readInput() || {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : '';
  if (cwd) logDir = join(cwd, '.claude');
  const keys = Object.keys(input).sort().join(',') || '(none)';

  const sid = typeof input.session_id === 'string' ? input.session_id : '';
  if (!sid || !cwd) {
    log(`session_id or cwd missing (input keys: ${keys}): no flush`);
    return null;
  }
  if (sanitizeSessionId(sid) !== sid) {
    log('session_id is not a plain id: no flush');
    return null;
  }

  const root = mainCheckout(cwd);
  if (!root) {
    log(`no main checkout found from ${cwd}: no flush`);
    return null;
  }
  // The probe line is written only where a batched folder exists, so a project that has no
  // batched box gets no new log file from this hook.
  const batchDir = join(root, '.codescout', 'state', 'batched');
  if (existsSync(batchDir)) log(`input keys: ${keys}`);
  if (!hasSessionRecords(batchDir, sid)) return null;

  const cs = resolveCodescoutBinary(root);
  if (!cs) {
    log('codescout binary not found: no flush');
    return null;
  }

  const outDir = join(stateHome(process.env.HOME || process.env.USERPROFILE || homedir()), 'codescout-companion', 'box-flush');
  mkdirSync(outDir, { recursive: true });
  pruneOutputs(outDir);
  const outFile = join(outDir, `${sid}-${Date.now()}.out`);
  const fd = openSync(outFile, 'w');
  let child;
  try {
    child = spawn(cs, ['box', 'flush', '--project', root, '--session', sid, '--json'], {
      cwd: root,
      detached: true,
      stdio: ['ignore', fd, fd],
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: sid },
      windowsHide: true,
    });
  } finally {
    closeSync(fd); // the child holds its own copy
  }

  const ended = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), waitMs());
    child.once('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, error: e.message });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, signal });
    });
  });

  if (!ended) {
    // Not killed: it holds the write lock and may be inside git. Its output stays in the file.
    child.unref();
    log(`flush still running after ${waitMs()} ms, left running (pid ${child.pid}); output in ${outFile}`);
    return null;
  }
  if (ended.error) {
    log(`flush did not start: ${ended.error}`);
    return null;
  }
  let text = '';
  try {
    text = readFileSync(outFile, 'utf8');
    unlinkSync(outFile);
  } catch {
    /* judged on what was read */
  }
  const verdict = judge(ended.code, text);
  if (verdict.log) log(verdict.log);
  return verdict.message ? `box flush: ${verdict.message.slice(0, MESSAGE_MAX)}` : null;
}

let message = null;
try {
  message = await main();
} catch (e) {
  log(`error: ${e && e.message ? e.message : e}`);
}
emit(message ? { continue: true, systemMessage: message } : { continue: true });
process.exitCode = 0;
