#!/usr/bin/env node
// effort-policy: the surface a harness hook calls on every prompt.
//
//   effort-policy decide [--rules <file>] [--table <file>] [--holdout-rate <0..1>] [--log]
//
// Reads one JSON context from stdin, prints exactly one JSON line on stdout:
//   { level, confidence, reasons, steer, arm }
//
// `decide` is FAIL-OPEN: whatever goes wrong (bad input, unreadable file, bad flag,
// failing log, a bug here) it still prints one valid result line and exits 0.
// Diagnostics go to stderr and never carry prompt text. Only an unknown or missing
// subcommand is an error: usage on stderr, nothing on stdout, exit 2.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFeatures } from '../core/features.mjs';
import { compileRules, decide } from '../core/decide.mjs';
import { render } from '../core/steer.mjs';
import { assignArm } from '../core/arm.mjs';
import { appendRecord, buildRecord, stateDirFor } from '../core/log.mjs';

// A hook runs with the project as its cwd, so the defaults resolve against this
// script file, never against the current directory.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_RULES = path.join(HERE, '..', 'core', 'rules.json');
const DEFAULT_TABLE = path.join(HERE, '..', 'core', 'steer.table.json');

const USAGE = 'usage: effort-policy decide [--rules <file>] [--table <file>] [--holdout-rate <0..1>] [--log]';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === 'string';

// A strict decimal. Number() alone would accept '', ' ', '0x1' and 'Infinity'.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// Flag parsing never throws and never rejects: an unknown flag or a flag with no
// value is ignored. A value that starts with `--` is the next flag, not a value.
function parseFlags(argv) {
  const flags = { rules: DEFAULT_RULES, table: DEFAULT_TABLE, holdoutRate: undefined, log: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    if (arg === '--log') {
      flags.log = true;
    } else if (arg === '--rules' || arg === '--table') {
      const key = arg === '--rules' ? 'rules' : 'table';
      // A missing value is an unreadable file: the empty path cannot be opened.
      flags[key] = hasValue ? next : '';
      if (hasValue) i += 1;
    } else if (arg === '--holdout-rate') {
      if (hasValue) {
        flags.holdoutRate = next;
        i += 1;
      }
    }
  }
  return flags;
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseContext(text) {
  try {
    const value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Returns a rate in [0, 1] and whether the flag was bad. A bad rate is rate 0.
function resolveRate(raw) {
  if (raw === undefined) return { rate: 0, bad: false };
  if (DECIMAL.test(raw)) {
    const rate = Number(raw);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 1) return { rate, bad: false };
  }
  return { rate: 0, bad: true };
}

function emit(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const fallback = (reason) => ({ level: 'default', confidence: 'low', reasons: [reason], steer: null, arm: 'treated' });

function runDecide(argv) {
  const ctx = parseContext(readStdin());
  if (ctx === null) {
    emit(fallback('bad_input'));
    return;
  }
  const flags = parseFlags(argv);
  // CLI reasons, appended in the order they happen.
  const cli = [];

  let compiled;
  try {
    compiled = compileRules(readJson(flags.rules));
  } catch {
    cli.push('rules_unreadable');
    compiled = { version: 0, rules: [], skipped: [] };
  }
  for (const s of compiled.skipped) {
    process.stderr.write(`effort-policy: rule skipped: ${String(s.id)}: ${String(s.error)}\n`);
  }

  let table = null;
  try {
    const parsed = readJson(flags.table);
    if (!isPlainObject(parsed)) throw new TypeError('table must be an object');
    table = parsed;
  } catch {
    cli.push('table_unreadable');
  }

  const { rate, bad } = resolveRate(flags.holdoutRate);
  if (bad) cli.push('bad_holdout_rate');

  const prompt = isString(ctx.prompt) ? ctx.prompt : '';
  const features = extractFeatures(prompt);
  // The raw prompt goes to decide: it has its own rule for a non-string.
  const decision = decide({ prompt: ctx.prompt, signals: ctx.signals }, compiled);
  const steerText = render(decision, table);

  const sessionId = ctx.session_id;
  const turnId = ctx.turn_id;
  const haveIds = isString(sessionId) && isString(turnId);
  const arm = haveIds ? assignArm(sessionId, turnId, rate) : 'treated';
  const steer = arm === 'treated' ? steerText : null;

  if (flags.log) {
    if (!haveIds) {
      cli.push('log_skipped_no_ids');
    } else {
      try {
        const record = buildRecord({
          sessionId,
          turnId,
          harness: isString(ctx.harness) ? ctx.harness : 'unknown',
          prompt,
          features,
          decision: { level: decision.level, confidence: decision.confidence, reasons: [...decision.reasons, ...cli] },
          arm,
          steered: arm === 'treated' && steerText !== null,
          rulesVersion: compiled.version,
          steerVersion: table !== null && typeof table.version === 'number' ? table.version : 0,
        });
        appendRecord(stateDirFor(process.env), record);
      } catch (err) {
        cli.push('log_failed');
        process.stderr.write(`effort-policy: log failed: ${err && err.message ? err.message : String(err)}\n`);
      }
    }
  }

  emit({ level: decision.level, confidence: decision.confidence, reasons: [...decision.reasons, ...cli], steer, arm });
}

function main(argv) {
  if (argv[0] !== 'decide') {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  try {
    runDecide(argv.slice(1));
  } catch (err) {
    process.stderr.write(`effort-policy: internal error: ${err && err.message ? err.message : String(err)}\n`);
    try {
      emit(fallback('internal_error'));
    } catch {
      // stdout is gone; there is nothing left to do but exit 0.
    }
  }
  process.exitCode = 0;
}

// A closed stdout pipe must not turn into a crash or a non-zero exit.
process.stdout.on('error', () => {});
main(process.argv.slice(2));
