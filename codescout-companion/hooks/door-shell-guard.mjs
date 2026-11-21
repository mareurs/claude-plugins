
// PreToolUse hook — refuse a `codescout call` / `codescout box` / `codescout doc create|update`
// Bash command whose text the shell would expand before codescout reads it. The native-Bash
// twin of the gate in codescout's run_command (`door_shell_hazard`, src/util/path_security.rs;
// step 2.6b in src/tools/run_command/inner.rs): same detection, same error and hint text.
//
// The door verbs take a markdown body, and markdown carries backticks and `$`. In an
// unquoted heredoc (`<<EOF`), a double-quoted JSON argument or a double-quoted `--body` the
// shell runs the backticks and expands the `$` before codescout reads a byte, with no report.
//
// Checked, only when the command (heredoc bodies stripped) runs `codescout call`,
// `codescout box`, `codescout doc create` or `codescout doc update` at an unquoted position,
// with or without a path prefix:
//   - an unquoted `<<` / `<<-` whose delimiter is bare;
//   - for call and box only: a double-quoted word that starts with `{` and holds an unescaped
//     backtick or `$`;
//   - for doc create|update only: a double-quoted word that directly follows `--body`
//     (`--body "…"` or `--body="…"`, the flag a whole word) and holds an unescaped backtick
//     or `$`.
// Not checked: any other argument (`--project "$PWD"`, `--title "$X"` may expand on purpose),
// `codescout doc get|find|…`, and anything inside single quotes. `<<'EOF'`, `<<"EOF"` and
// `<<\EOF` are safe; `<<<` takes no body; `--body -` and `--body '…'` are safe.
//
// The detection is a port, line for line, of the Rust: the two repositories cannot share a
// file, so the table of the Rust unit test is repeated in door-shell-guard.test.sh.
import { readInput, denyPreToolUse } from './lib.mjs';

// The one heredoc opener pattern: group 1 and 2 are a quoted delimiter, group 3 a bare one.
const HEREDOC_OPEN = /<<-?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))/;
// The same pattern, anchored at `lastIndex`, for the quote-aware scan.
const HEREDOC_OPEN_AT = new RegExp(HEREDOC_OPEN.source, 'y');

// Group 1 is the `codescout` word: an invocation counts only where that word sits unquoted.
// Group 2 is set for `doc create|update`, unset for call and box. The `d` flag gives the
// word's index.
const DOOR_INVOCATION = /(?:^|[\s;&|(])((?:\S*\/)?codescout)\s+(?:call|box|(doc\s+(?:create|update)))\b/dg;

// Whether index `pos` of `s` sits inside a quoted span, by the quote rules of the scan below:
// single quotes take every character literally, double quotes open and close outside single
// quotes, and a backslash outside single quotes escapes the next character.
function isQuotedAt(s, pos) {
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < pos && i < s.length) {
    const c = String.fromCodePoint(s.codePointAt(i));
    i += c.length;
    if (c === '\\' && !inSingle) {
      if (i < s.length) i += String.fromCodePoint(s.codePointAt(i)).length;
    } else if (c === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
    }
  }
  return inSingle || inDouble;
}

// The door invocations in `s` that have the `codescout` word unquoted:
// `{ callOrBox, docVerb }` (`call` / `box`, and `doc create|update`).
function doorInvocationsIn(s) {
  const found = { callOrBox: false, docVerb: false };
  for (const m of s.matchAll(DOOR_INVOCATION)) {
    if (isQuotedAt(s, m.indices[1][0])) continue;
    if (m[2] !== undefined) found.docVerb = true;
    else found.callOrBox = true;
  }
  return found;
}

// Whether `s.slice(0, quote)` ends in `--body ` or `--body=` (the flag a whole word), so the
// double quote at `quote` opens the body word.
function quoteFollowsBodyFlag(s, quote) {
  const before = s.slice(0, quote);
  let flag;
  if (before.endsWith('=')) {
    flag = before.slice(0, -1);
  } else {
    const trimmed = before.trimEnd();
    if (trimmed.length === before.length) return false;
    flag = trimmed;
  }
  if (!flag.endsWith('--body')) return false;
  const head = flag.slice(0, -'--body'.length);
  return head === '' || /\s/u.test(Array.from(head).pop());
}

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

// `{ kind: 'heredoc', delimiter, invoked }`, `{ kind: 'json', excerpt, invoked }`,
// `{ kind: 'body', excerpt, invoked }`, or null. `invoked` is what the command runs, so the
// refusal can name the example that fits.
function doorShellHazard(command) {
  const s = stripHeredocBodies(command);
  const invoked = doorInvocationsIn(s);
  if (!invoked.callOrBox && !invoked.docVerb) return null;

  let inSingle = false;
  let inDouble = false;
  // Start index while inside a double-quoted word that starts with `{` (call / box only).
  let jsonWord = null;
  // Start index while inside a double-quoted word that follows `--body` (doc verbs only).
  let bodyWord = null;
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
      jsonWord = inDouble && invoked.callOrBox && s[i + step] === '{' ? i + step : null;
      bodyWord = inDouble && invoked.docVerb && quoteFollowsBodyFlag(s, i) ? i + step : null;
    } else if (c === '<' && !inSingle && !inDouble && s.startsWith('<<', i)) {
      if (s.startsWith('<<<', i)) {
        i += 3;
        continue;
      }
      HEREDOC_OPEN_AT.lastIndex = i;
      const cap = HEREDOC_OPEN_AT.exec(s);
      if (cap) {
        if (cap[3] !== undefined) return { kind: 'heredoc', delimiter: cap[3], invoked };
        // A quoted delimiter: skip the opener whole so its quotes do not toggle the quote state.
        i += cap[0].length;
        continue;
      }
      i += 2;
      continue;
    } else if ((c === '`' || c === '$') && inDouble) {
      // The body word is the more specific diagnosis: it wins over the JSON wording.
      if (bodyWord !== null) {
        return { kind: 'body', excerpt: firstChars(s.slice(bodyWord).split('"')[0], 40), invoked };
      }
      if (jsonWord !== null) {
        return { kind: 'json', excerpt: firstChars(s.slice(jsonWord), 40), invoked };
      }
    }
    i += step;
  }
  return null;
}

// Error and hint text: the run_command step 2.6b text, except the last sentence, which names
// run_command's acknowledge_risk (a hard deny here cannot be approved by the user).
function refusal(hazard) {
  let error;
  if (hazard.kind === 'heredoc') {
    error =
      `the heredoc \`<<${hazard.delimiter}\` is unquoted, so the shell runs backticks and ` +
      'expands `$` in its body before codescout reads it';
  } else if (hazard.kind === 'body') {
    error =
      'the --body text is in double quotes, so the shell runs backticks and expands `$` ' +
      `in it before codescout reads it: ${hazard.excerpt}`;
  } else {
    error =
      'the JSON argument is in double quotes, so the shell runs backticks and expands `$` ' +
      `in it before codescout reads it: ${hazard.excerpt}`;
  }
  const callHint =
    'Put the body after the command with a quoted delimiter, and keep the JSON in single quotes:\n' +
    '  codescout call doc \'{"action":"create","kind":"…","title":"…","rel_path":"docs/…"}\' --text body - <<\'EOF\'\n' +
    '  <markdown>\n' +
    '  EOF\n' +
    'An update that overwrites a whole body:\n' +
    '  codescout call doc \'{"action":"update","id":"…","patch":{}}\' --text /patch/body - <<\'EOF\'\n';
  const docHint =
    'Pass the body on stdin with --body - and a quoted delimiter (or put a literal body in single quotes):\n' +
    "  codescout doc update <id> --body - <<'EOF'\n" +
    '  <markdown>\n' +
    '  EOF\n' +
    "  codescout doc create --kind … --title … --rel-path docs/… --body - <<'EOF'\n";
  const { callOrBox, docVerb } = hazard.invoked;
  const examples = !docVerb ? callHint : !callOrBox ? docHint : callHint + docHint;
  const hint = `${examples}To run it as written anyway, use run_command with acknowledge_risk=true.`;
  return `${error}\n\n${hint}`;
}

const input = readInput();
if (!input) process.exit(0);
// The raw name, not normalizedToolName: that maps run_command/terminal/shell to Bash too, and
// codescout's own run_command already runs this gate (a hard deny there is wrong).
if (input.tool_name !== 'Bash') process.exit(0);
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
