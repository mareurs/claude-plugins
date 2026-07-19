#!/usr/bin/env node
// scripts/gen-copilot-hook-wrappers.mjs <plugin-dir>
//
// Regenerates polyglot .cmd wrapper files for every exec-form hook entry
// (`"command": "node", "args": [...]`) in <plugin-dir>/hooks/hooks.json, and
// rewrites those entries to a single self-contained "command" string with no
// "args" key.
//
// Why this exists: Claude Code's hook runner supports the {command, args}
// exec-form (spawns `command` with `args` as argv). GitHub Copilot CLI/Chat's
// hook runner does NOT — empirically, it execs only the "command" string and
// drops "args" entirely, so `{"command":"node","args":["session-start.mjs"]}`
// spawns a bare `node` with zero argv and the hook's JSON payload piped to
// its stdin. With no script path, Node falls into its `eval_stdin` REPL-style
// mode and tries to *execute* the JSON payload as JavaScript, crashing with
// `SyntaxError: Unexpected token ':'` on every hook call. (Observed 2026-07-19
// against codescout-companion 1.16.0 / buddy 0.9.0; see docs/trackers/
// copilot-cli-hook-format-session-log.md for the incident writeup.)
//
// The fix is the same shape that already worked pre-refactor (commit
// d15e49c, "recover + extend Windows/Copilot-CLI hook compatibility"): make
// "command" a single, directly-executable file with no separate argv to
// drop. A `.cmd` file is directly executable on Windows (CreateProcess file
// association) and, via the `: << 'CMDBLOCK' ... exec ...` polyglot trick,
// also directly executable as a POSIX `sh` script on Linux/macOS — so ONE
// file satisfies both hosts without hooks.json needing an "args" key at all.
//
// Usage:
//   node scripts/gen-copilot-hook-wrappers.mjs codescout-companion
//   node scripts/gen-copilot-hook-wrappers.mjs buddy
//
// Idempotent: safe to re-run after editing hooks.json's exec-form entries
// (e.g. after adding a new hook) — regenerates all wrappers from scratch and
// rewrites every matching entry.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginName = process.argv[2];
if (!pluginName) {
  console.error('usage: gen-copilot-hook-wrappers.mjs <plugin-dir-name>');
  process.exit(1);
}

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PLUGIN_DIR = join(REPO_ROOT, pluginName);
const HOOKS_DIR = join(PLUGIN_DIR, 'hooks');
const HOOKS_JSON_PATH = join(HOOKS_DIR, 'hooks.json');

if (!existsSync(HOOKS_JSON_PATH)) {
  console.error(`ERROR: ${HOOKS_JSON_PATH} not found`);
  process.exit(1);
}

const hooksConfig = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));

function wrapperTemplate(mjsBasename, extraArgs) {
  const argStr = extraArgs.length ? ' ' + extraArgs.join(' ') : '';
  // Windows branch runs first (cmd.exe reads top-to-bottom, always exits
  // before reaching CMDBLOCK); POSIX sh feeds the whole cmd block to the
  // no-op `:` builtin as a heredoc, then continues after CMDBLOCK.
  return `: << 'CMDBLOCK'
@echo off
node "%~dp0${mjsBasename}"${argStr}
exit /b %ERRORLEVEL%
CMDBLOCK

exec node "$(cd "$(dirname "$0")" && pwd)/${mjsBasename}"${argStr}
`;
}

let generated = 0;
let rewritten = 0;

function processHookEntry(entry) {
  if (entry?.command !== 'node' || !Array.isArray(entry.args) || entry.args.length === 0) {
    return; // not exec-form (node + args) — leave untouched (already single-command, or a non-node hook)
  }

  const scriptArg = entry.args[0]; // e.g. "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs"
  const match = /\/([^/]+)\.mjs$/.exec(scriptArg);
  if (!match) {
    console.warn(`  ! skipping unrecognized args[0] shape: ${scriptArg}`);
    return;
  }
  const mjsBasename = `${match[1]}.mjs`;
  const extraArgs = entry.args.slice(1); // e.g. ["session-start"] for buddy's run.mjs dispatcher

  // Wrapper name: the trailing dispatcher arg if present (buddy: run.mjs + event
  // name), otherwise the script's own basename (codescout-companion: 1 hook = 1 file).
  const wrapperName = extraArgs.length > 0 ? extraArgs[extraArgs.length - 1] : match[1];

  const wrapperPath = join(HOOKS_DIR, `${wrapperName}.cmd`);
  writeFileSync(wrapperPath, wrapperTemplate(mjsBasename, extraArgs), 'utf8');
  generated++;

  delete entry.args;
  entry.command = `\${CLAUDE_PLUGIN_ROOT}/hooks/${wrapperName}.cmd`;
  rewritten++;
}

for (const eventName of Object.keys(hooksConfig.hooks || {})) {
  for (const matcherBlock of hooksConfig.hooks[eventName]) {
    for (const entry of matcherBlock.hooks || []) {
      processHookEntry(entry);
    }
  }
}

writeFileSync(HOOKS_JSON_PATH, JSON.stringify(hooksConfig, null, 2) + '\n', 'utf8');

console.log(`${pluginName}: generated ${generated} wrapper(s), rewrote ${rewritten} hooks.json entr${rewritten === 1 ? 'y' : 'ies'}`);
