// Companion hook dispatcher: one node process per tool-use event instead of one per hook.
//
//   node dispatch.mjs <PreToolUse|PostToolUse>      (hook event JSON on stdin)
//
// Each hook costs a process start, and under endpoint protection that start is the
// bulk of a hook's time. The dispatcher picks the hooks of dispatch-table.json whose
// matcher fits the tool, runs each UNCHANGED in a worker thread (a worker's own
// process.exit() ends only that worker), and merges the outputs the way Claude Code
// merges parallel hooks:
//   - permissionDecision: deny beats ask beats allow; the winner's reason is kept.
//   - additionalContext: every hook's text, in table order, joined by a newline.
//   - updatedInput / updatedToolOutput and any other field: the first hook that sets it.
//   - exit code 2 from any hook blocks with that hook's stderr.
// FAIL-OPEN, as lib.mjs requires: a hook that throws, exits non-zero other than 2, or
// outlives its timeout contributes nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { finished } from 'node:stream/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_S = 30;
const DECISION_RANK = { deny: 3, ask: 2, allow: 1 };

// Claude Code anchors a matcher: `Bash` does not match `BashOutput`.
const matches = (matcher, toolName) =>
  !matcher || new RegExp(`^(?:${matcher})$`).test(toolName);

export function selectHooks(table, event, toolName) {
  return (table[event] || []).filter((h) => matches(h.matcher, toolName));
}

export function runHook(entry, raw, hooksDir = HERE) {
  return new Promise((resolve) => {
    const started = Date.now();
    const result = { hook: entry.hook, code: 0, out: '', err: '', ms: 0 };
    let settled = false;
    let worker;
    const settle = async () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Wait for the worker's stdio to drain: output written just before process.exit().
      result.exitMs = Date.now() - started;
      await Promise.all([finished(worker.stdout), finished(worker.stderr)]).catch(() => {});
      result.ms = Date.now() - started;
      resolve(result);
    };
    try {
      worker = new Worker(join(hooksDir, entry.hook), {
        workerData: { hookInput: raw },
        stdout: true,
        stderr: true,
      });
    } catch (e) {
      resolve(result);
      return;
    }
    worker.stdout.setEncoding('utf8').on('data', (d) => { result.out += d; });
    worker.stderr.setEncoding('utf8').on('data', (d) => { result.err += d; });
    let aborted = false; // threw or timed out: fail open, contribute nothing
    worker.on('error', () => { aborted = true; });
    worker.on('exit', (code) => {
      if (aborted) { result.code = 0; result.out = ''; } else result.code = code;
      settle();
    });
    const timer = setTimeout(() => {
      aborted = true;
      worker.terminate();
    }, (entry.timeout || DEFAULT_TIMEOUT_S) * 1000);
  });
}

export function mergeResults(results) {
  const blocker = results.find((r) => r.code === 2);
  if (blocker) return { code: 2, stdout: '', stderr: blocker.err };

  const top = {};
  const specific = {};
  const contexts = [];
  let decision = null;
  const text = [];
  for (const r of results) {
    const body = r.out.trim();
    if (!body) continue;
    let obj;
    try { obj = JSON.parse(body); } catch { text.push(body); continue; }
    if (obj === null || typeof obj !== 'object') { text.push(body); continue; }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== 'hookSpecificOutput' || v === null || typeof v !== 'object') {
        if (!(k in top)) top[k] = v;
        continue;
      }
      for (const [hk, hv] of Object.entries(v)) {
        if (hk === 'additionalContext') contexts.push(hv);
        else if (hk === 'permissionDecision') {
          if (!decision || (DECISION_RANK[hv] || 0) > (DECISION_RANK[decision.value] || 0)) {
            decision = { value: hv, reason: v.permissionDecisionReason };
          }
        } else if (hk === 'permissionDecisionReason') {
          // travels with its decision
        } else if (!(hk in specific)) specific[hk] = hv;
      }
    }
  }
  if (decision) {
    specific.permissionDecision = decision.value;
    if (decision.reason !== undefined) specific.permissionDecisionReason = decision.reason;
  }
  if (contexts.length) specific.additionalContext = contexts.join('\n');
  if (Object.keys(specific).length) top.hookSpecificOutput = specific;
  const stdout = [Object.keys(top).length ? JSON.stringify(top) : '', ...text].filter(Boolean).join('\n');
  const stderr = results.map((r) => r.err).filter(Boolean).join('');
  return { code: 0, stdout, stderr };
}

export async function dispatch(event, raw, table, hooksDir = HERE) {
  let input = null;
  try { input = raw ? JSON.parse(raw) : null; } catch { /* unparsable: fail open */ }
  if (!input) return { code: 0, stdout: '', stderr: '' };
  const selected = selectHooks(table, event, input.tool_name || '');
  if (selected.length === 0) return { code: 0, stdout: '', stderr: '' };
  const results = await Promise.all(selected.map((h) => runHook(h, raw, hooksDir)));
  const merged = mergeResults(results);
  merged.timings = results.map((r) => `${r.hook.replace('.mjs', '')}:${r.exitMs}/${r.ms}`).join(',');
  return merged;
}

async function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin: nothing to dispatch */ }
  const table = JSON.parse(readFileSync(join(HERE, 'dispatch-table.json'), 'utf8'));
  const merged = await dispatch(process.argv[2] || '', raw, table);
  if (merged.stdout) process.stdout.write(merged.stdout);
  if (merged.stderr) process.stderr.write(merged.stderr);
  return merged.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), () => process.exit(0));
}
