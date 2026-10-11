#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { normalizeHookContext } from '../hooks/session-context.mjs';

let result;
try {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--harness', '--workspace'].includes(flag) || !args[i + 1] || options[flag]) throw new Error('usage: --harness <host> --workspace <absolute-root>');
    options[flag] = args[i + 1];
  }
  if (!options['--harness'] || !isAbsolute(options['--workspace'] || '')) throw new Error('harness and absolute workspace required');
  const input = JSON.parse(readFileSync(0, 'utf8'));
  result = normalizeHookContext(options['--harness'], input, options['--workspace']);
  if (result.state === 'available') {
    const actual = realpathSync(execFileSync('git', ['-C', input.cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
    if (actual !== result.context.workspace) result = { state: 'conflicting', context: null, reason: 'native cwd resolves to another Git checkout' };
  }
} catch (error) {
  result = { state: 'unsupported', context: null, reason: String(error.message) };
}
console.log(JSON.stringify(result));
process.exitCode = result.state === 'available' ? 0 : 2;
