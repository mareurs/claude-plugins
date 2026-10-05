// user-prompt-submit.mjs — the Claude Code UserPromptSubmit hook entry.
//
// SAFETY. In Claude Code, exit 2 from this hook BLOCKS and ERASES the user's prompt, and
// any stray stdout is read as hook output. So: this script always exits 0, stdout carries
// ONE JSON line only when there is a non-empty steer (otherwise nothing), and every
// diagnostic goes to stderr as `effort-steering: <reason>`. No prompt text is ever written
// to stderr. The CLI is found through runPolicy (import.meta.url), never CLAUDE_PLUGIN_ROOT.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildContext } from './build-context.mjs';
import { runPolicy } from './run-policy.mjs';

// Reasons worth a stderr line. Decision reasons (no_rule, rule ids, user_override, ...) are not.
const ALERT_REASONS = new Set([
  'unknown_arg',
  'bad_holdout_rate',
  'rules_unreadable',
  'table_unreadable',
  'log_failed',
  'log_skipped_no_ids',
  'adapter_timeout',
  'adapter_cli_failed',
  'adapter_bad_output',
]);
const isAlert = (r) => typeof r === 'string' && (ALERT_REASONS.has(r) || r.startsWith('rules_skipped:'));

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// handle never throws. `opts` ({ cliPath, timeoutMs }) is for tests; main passes none.
export function handle(stdinText, env = {}, opts = undefined) {
  try {
    let input;
    try {
      input = JSON.parse(stdinText);
    } catch {
      return { output: null, alerts: [] };
    }
    if (!isPlainObject(input)) return { output: null, alerts: [] };

    const args = ['--log'];
    const rate = env.EFFORT_STEERING_HOLDOUT_RATE;
    if (rate !== undefined) args.push('--holdout-rate', rate);

    const res = runPolicy(buildContext(input), { ...(opts ?? {}), args });

    const alerts = Array.isArray(res.reasons) ? res.reasons.filter(isAlert) : [];
    const steer = res.steer;
    if (steer !== null && typeof steer !== 'string') {
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

function main() {
  try {
    let text = '';
    try {
      text = readFileSync(0, 'utf8');
    } catch {
      // unreadable stdin is the same as empty stdin
    }
    const { output, alerts } = handle(text, process.env);
    for (const reason of alerts) process.stderr.write(`effort-steering: ${reason}\n`);
    if (output !== null) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // nothing may escape: the exit below is the contract
  }
  process.exit(0);
}

process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
