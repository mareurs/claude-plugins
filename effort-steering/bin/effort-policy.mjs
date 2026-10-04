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
// subcommand is an error: usage on stderr, nothing on stdout, exit 64 (EX_USAGE).
// It is 64 and not 2 on purpose: exit 2 from a Claude Code UserPromptSubmit hook
// blocks the prompt and erases it, so an adapter that passes our exit code through
// must never be handed a 2.
//
// Flags: value flags accept `--flag V` and `--flag=V` (split at the first `=`). Any
// argv token after `decide` that is not consumed adds the reason `unknown_arg`.
//
// REASONS. `reasons` is the list of strings below. `decide` emits the first group,
// then the CLI appends its own, in the order given in the second group.
//
// From `decide` (core/decide.mjs):
//   user_override       the prompt holds an explicit "ultrathink"; deep wins, no steering added
//   no_rule             no rule matched (this is also the answer of the shipped, empty rules)
//   tie_shallow_deep    shallow and deep rules tie at the top confidence class: default
//                       (the tied rule ids follow)
//   guard_shallow       a shallow rule won but is blocked, because its confidence is below
//                       high or the previous turn failed: default (the rule ids follow)
//   low_confidence      a deep rule won at low confidence: default (the rule ids follow)
//   <rule id>           a rule at the winning confidence class and level fired; each such
//                       rule's id is a reason
//   internal_error      an unexpected error inside decide: default, low confidence
//
// From the CLI, in this order (after the decide reasons):
//   unknown_arg         an argv token was not recognized or consumed; added once per run
//   rules_unreadable    the rules file could not be read, parsed or used (not an object with a
//                       `rules` array); no rules apply and rules_version is 0
//   table_unreadable    the steering table could not be read, parsed or used (not an object
//                       with a `phrases` object); steer is null and steer_version is 0
//   bad_holdout_rate    --holdout-rate is not a decimal in [0, 1]; rate 0 is used
//   log_skipped_no_ids  --log was given but session_id or turn_id is missing, or present
//                       but not a string; nothing is written
//   log_failed          --log was given and writing the record failed; stderr has the cause
//
// Alone in the line (the only reason; no flag was read and nothing is logged):
//   bad_input           stdin is not one JSON object
//   internal_error      the CLI itself failed unexpectedly; this is its fail-open line

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

const USAGE = 'usage: effort-policy decide [--rules <file>] [--table <file>] [--holdout-rate <0..1>] [--log]  (--flag=value also works)';

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v) => typeof v === 'string';

// A strict decimal. Number() alone would accept '', ' ', '0x1' and 'Infinity'.
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

// Flag parsing never throws. Value flags take their value in two forms: spaced
// (`--rules F`) or joined (`--rules=F`, split at the FIRST `=`, so the value may
// contain `=`). In the spaced form a value that starts with `--` is the next flag,
// not a value. An empty joined value (`--rules=`) is a missing value. Any token
// that is not consumed (an unknown flag, `--log=x`, a stray positional) sets
// `unknown`, which runDecide reports once as the reason `unknown_arg`.
const VALUE_FLAGS = { '--rules': 'rules', '--table': 'table', '--holdout-rate': 'holdoutRate' };

function parseFlags(argv) {
  const flags = { rules: DEFAULT_RULES, table: DEFAULT_TABLE, holdoutRate: undefined, log: false, unknown: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--log') {
      flags.log = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    // hasOwn: a token such as `--constructor` must not resolve through the prototype.
    if (!Object.hasOwn(VALUE_FLAGS, name)) {
      flags.unknown = true;
      continue;
    }
    const key = VALUE_FLAGS[name];
    let value;
    if (eq !== -1) {
      value = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i += 1;
      }
    }
    if (key === 'holdoutRate') {
      // A bare `--holdout-rate` with no value at all is ignored; an empty or bad
      // value is reported by resolveRate.
      if (value !== undefined) flags.holdoutRate = value;
    } else {
      // A missing value is an unreadable file: the empty path cannot be opened.
      flags[key] = value ?? '';
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
  // Args are parsed first, so this is the first CLI reason.
  if (flags.unknown) cli.push('unknown_arg');

  // A rules file that cannot be USED is unreadable, not merely empty: a read or
  // parse failure, or a value compileRules reports as invalid_rules_file (not an
  // object, or no usable `rules` array). Its own version must never reach the log.
  // A file with some bad RULES is still usable. The check is on the error code,
  // because a rule may legitimately be named "(file)".
  let compiled;
  try {
    compiled = compileRules(readJson(flags.rules));
    if (compiled.skipped.some((s) => s.error === 'invalid_rules_file')) throw new TypeError('rules file has no usable rules array');
  } catch {
    cli.push('rules_unreadable');
    compiled = { version: 0, rules: [], skipped: [] };
  }
  for (const s of compiled.skipped) {
    process.stderr.write(`effort-policy: rule skipped: ${String(s.id)}: ${String(s.error)}\n`);
  }

  // The same for the table: it must be an object holding a `phrases` object.
  let table = null;
  try {
    const parsed = readJson(flags.table);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.phrases)) throw new TypeError('table must be an object with a phrases object');
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
    // 64 (EX_USAGE), never 2: see the header.
    process.exitCode = 64;
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
