// PreToolUse hook — refuse a `codescout call` / `codescout box` Bash command whose text the
// shell would expand before codescout reads it. The native-Bash twin of the gate in
// codescout's run_command (`door_shell_hazard`, src/util/path_security.rs; step 2.6b in
// src/tools/run_command/inner.rs): same detection, same error and hint text.
//
// The door verbs take a markdown body, and markdown carries backticks and `$`. In an
// unquoted heredoc (`<<EOF`) or a double-quoted JSON argument the shell runs the backticks
// and expands the `$` before codescout reads a byte, with no report.
//
// Checked, only when the command (heredoc bodies stripped) runs `codescout call` or
// `codescout box`, with or without a path prefix:
//   - an unquoted `<<` / `<<-` whose delimiter is bare;
//   - a double-quoted word that starts with `{` and holds an unescaped backtick or `$`.
// Not checked: any other argument (`--project "$PWD"` may expand on purpose), and anything
// inside single quotes. `<<'EOF'`, `<<"EOF"` and `<<\EOF` are safe; `<<<` takes no body.
//
// The detection is a port, line for line, of the Rust: the two repositories cannot share a
// file, so the 14-row table of the Rust unit test is repeated in door-shell-guard.test.sh.
import { readInput, denyPreToolUse, normalizedToolName } from './lib.mjs';

// The one heredoc opener pattern: group 1 and 2 are a quoted delimiter, group 3 a bare one.
const HEREDOC_OPEN = /<<-?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/;
// The same pattern, anchored at `lastIndex`, for the quote-aware scan.
const HEREDOC_OPEN_AT = new RegExp(HEREDOC_OPEN.source, 'y');

const DOOR_INVOCATION = /(?:^|[\s;&|(])(?:\S*\/)?codescout\s+(?:call|box)\b/;

// Drop each heredoc's body and terminator line; keep the opener line. `<<<` (here-string)
// takes no body and opens nothing.
function stripHeredocBodies(command) {
  if (!command.includes('<<')) return command;
  let out = '';
  let awaiting = null;
  for (const line of command.split('\n')) {
    if (awaiting !== null) {
      // A terminator is the delimiter alone on its line; `<<-` allows leading tabs.
      if (line.trim() === awaiting) awaiting = null;
      continue;
    }
    out += `${line}\n`;
    if (!line.includes('<<<')) {
      const c = HEREDOC_OPEN.exec(line);
      if (c) awaiting = c[1] ?? c[2] ?? c[3] ?? null;
    }
  }
  return out;
}

const firstChars = (s, n) => Array.from(s).slice(0, n).join('');

// `{ kind: 'heredoc', delimiter }`, `{ kind: 'json', excerpt }`, or null.
function doorShellHazard(command) {
  const s = stripHeredocBodies(command);
  if (!DOOR_INVOCATION.test(s)) return null;

  let inSingle = false;
  let inDouble = false;
  // Start index while inside a double-quoted word that starts with `{`.
  let jsonWord = null;
  let i = 0;
  while (i < s.length) {
    const cp = s.codePointAt(i);
    const c = String.fromCodePoint(cp);
    const step = c.length;
    if (c === '\\' && !inSingle) {
      // Inside single quotes a backslash is literal; everywhere else it escapes the next character.
      i += step;
      if (i < s.length) i += String.fromCodePoint(s.codePointAt(i)).length;
      continue;
    }
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
      jsonWord = inDouble && s[i + step] === '{' ? i + step : null;
    } else if (c === '<' && !inSingle && !inDouble && s.startsWith('<<', i)) {
      if (s.startsWith('<<<', i)) {
        i += 3;
        continue;
      }
      HEREDOC_OPEN_AT.lastIndex = i;
      const cap = HEREDOC_OPEN_AT.exec(s);
      if (cap) {
        if (cap[3] !== undefined) return { kind: 'heredoc', delimiter: cap[3] };
        // A quoted delimiter: skip the opener whole so its quotes do not toggle the quote state.
        i += cap[0].length;
        continue;
      }
      i += 2;
      continue;
    } else if ((c === '`' || c === '$') && inDouble) {
      if (jsonWord !== null) return { kind: 'json', excerpt: firstChars(s.slice(jsonWord), 40) };
    }
    i += step;
  }
  return null;
}

// Error and hint text: the run_command step 2.6b text, except the last sentence. A native
// Bash call has no acknowledge_risk.
function refusal(hazard) {
  const error =
    hazard.kind === 'heredoc'
      ? `the heredoc \`<<${hazard.delimiter}\` is unquoted, so the shell runs backticks and ` +
        'expands `$` in its body before codescout reads it'
      : 'the JSON argument is in double quotes, so the shell runs backticks and expands `$` ' +
        `in it before codescout reads it: ${hazard.excerpt}`;
  const hint =
    'Put the body after the command with a quoted delimiter, and keep the JSON in single quotes:\n' +
    '  codescout call doc \'{"action":"create","kind":"…","title":"…"}\' --text body - <<\'EOF\'\n' +
    '  <markdown>\n' +
    '  EOF\n' +
    'An update that overwrites a whole body:\n' +
    '  codescout call doc \'{"action":"update","id":"…","patch":{}}\' --text /patch/body - <<\'EOF\'\n' +
    'To run it as written anyway, ask the user to approve the command.';
  return `${error}\n\n${hint}`;
}

const input = readInput();
if (!input) process.exit(0);
if (normalizedToolName(input) !== 'Bash') process.exit(0);
const cmd = (input.tool_input && input.tool_input.command) || '';
if (!cmd) process.exit(0);

// Fail open: a hook must exit 0 even on error (lib.mjs FAIL-OPEN CONTRACT).
let hazard = null;
try {
  hazard = doorShellHazard(cmd);
} catch {
  process.exit(0);
}
if (!hazard) process.exit(0);
denyPreToolUse(refusal(hazard));
process.exit(0);
