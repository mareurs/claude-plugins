// user-prompt-submit.mjs — the Claude Code UserPromptSubmit hook entry.
//
// SAFETY. In Claude Code, exit 2 from this hook BLOCKS and ERASES the user's prompt, and
// any stray stdout is read as hook output. So: this script always exits 0, stdout carries
// ONE JSON line only when there is a non-empty steer (otherwise nothing), and every
// diagnostic goes to stderr as `effort-steering: <reason>`. No prompt text is ever written
// to stderr. The CLI is found through runPolicy (import.meta.url), never CLAUDE_PLUGIN_ROOT.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildContext } from './build-context.mjs';
import { runPolicy } from './run-policy.mjs';

// Reasons worth a stderr line. Decision reasons (no_rule, rule ids, user_override, ...) are not.
// bad_input and internal_error are the CLI's own failure lines.
const ALERT_REASONS = new Set([
  'unknown_arg',
  'bad_holdout_rate',
  'rules_unreadable',
  'table_unreadable',
  'log_failed',
  'log_skipped_no_ids',
  'bad_input',
  'internal_error',
  'adapter_timeout',
  'adapter_cli_failed',
  'adapter_bad_output',
]);
const isAlert = (r) => ALERT_REASONS.has(r) || r.startsWith('rules_skipped:');

// A steer above this is refused: process.exit can drop a queued pipe write above 64 KiB,
// and Claude Code would read truncated JSON.
const MAX_STEER_CHARS = 4096;

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// handle never throws. `opts` ({ cliPath, timeoutMs }) is for tests; main passes none.
export function handle(stdinText, env = {}, opts = undefined) {
  try {
    let input;
    try {
      input = JSON.parse(stdinText);
    } catch {
      return { output: null, alerts: ['adapter_bad_input'] };
    }
    if (!isPlainObject(input)) return { output: null, alerts: ['adapter_bad_input'] };

    const args = ['--log'];
    const rate = env.EFFORT_STEERING_HOLDOUT_RATE;
    // Joined form: the value is one argv element and can never be read as the next flag.
    if (rate !== undefined) args.push(`--holdout-rate=${rate}`);

    const res = runPolicy(buildContext(input), { ...(opts ?? {}), args });

    if (!Array.isArray(res.reasons) || !res.reasons.every((r) => typeof r === 'string')) {
      return { output: null, alerts: ['adapter_bad_output'] };
    }
    const alerts = res.reasons.filter(isAlert);
    const steer = res.steer;
    if (steer !== null && (typeof steer !== 'string' || steer.length > MAX_STEER_CHARS)) {
      if (!alerts.includes('adapter_bad_output')) alerts.push('adapter_bad_output');
      return { output: null, alerts };
    }
    if (steer === null || steer === '') return { output: null, alerts };
    return {
      output: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: steer } },
      alerts,
    };
  } catch {
    return { output: null, alerts: ['adapter_internal_error'] };
  }
}

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

function main() {
  try {
    let text = '';
    try {
      text = readFileSync(0, 'utf8');
    } catch {
      // unreadable stdin is the same as empty stdin
    }
    const { output, alerts } = handle(text, process.env);
    // Escaped, so a reason holding a newline cannot forge a second stderr line.
    for (const reason of alerts) process.stderr.write(`effort-steering: ${JSON.stringify(reason).slice(1, -1)}\n`);
    if (output !== null) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // nothing may escape: the exit below is the contract
  }
  process.exit(0);
}

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

if (isMainModule()) main();
